// Database Module
const DB = {
    db: null,
    storage: null,
    rtdb: null,
    
    // Cache performance metrics
    _cacheMetrics: {
        hits: 0,
        misses: 0,
        firestoreFallbacks: 0,
        rtdbReads: 0,
        firestoreReads: 0,
        preComputedReads: 0,
        indexedReads: 0,
        localStorageHits: 0
    },
    
    // In-flight request map for deduplication (key -> Promise)
    _pendingRequests: new Map(),
    
    /**
     * Get cache performance metrics
     */
    getCacheMetrics() {
        const total = this._cacheMetrics.hits + this._cacheMetrics.misses;
        const hitRate = total > 0 ? (this._cacheMetrics.hits / total * 100).toFixed(1) : 0;
        return {
            hitRate: `${hitRate}%`,
            hits: this._cacheMetrics.hits,
            misses: this._cacheMetrics.misses,
            firestoreFallbacks: this._cacheMetrics.firestoreFallbacks,
            rtdbReads: this._cacheMetrics.rtdbReads,
            firestoreReads: this._cacheMetrics.firestoreReads,
            preComputedReads: this._cacheMetrics.preComputedReads,
            indexedReads: this._cacheMetrics.indexedReads,
            localStorageHits: this._cacheMetrics.localStorageHits,
            total: total
        };
    },
    
    /**
     * Log cache metrics (called periodically)
     */
    logCacheMetrics() {
        // Metrics logging disabled for production
    },
    
    init() {
        this.db = firebase.firestore();
        this.storage = firebase.storage();
        this.rtdb = firebase.database();
    },
    
    /**
     * Unified cache read function with 3-layer strategy
     * Layer 1: localStorage (instant, free)
     * Layer 2: RTDB (fast, low cost)
     * Layer 3: Error (no Firestore fallback for attendees)
     * 
     * @param {string} path - RTDB path (e.g., 'users/{uid}/pendingActivities/combined')
     * @param {object} options - Options for cache read
     * @returns {Promise<{data: any, fromCache: string, error: string|null}>}
     */
    async readFromCache(path, options = {}) {
        const {
            useLocalStorage = true,
            ttl = 30 * 60 * 1000, // 30 minutes default
            cacheKey = null
        } = options;
        
        const fullPath = path.startsWith('cache/') ? path : `cache/${path}`;
        const storageKey = cacheKey || `rtdb_cache_${fullPath.replace(/\//g, '_')}`;
        
        // Some paths are highly dynamic and tightly coupled to Cloud Function
        // pre-computations. For these we deliberately avoid localStorage so
        // attendees always see the latest RTDB state.
        const isHighlyDynamicPath =
            fullPath.includes('/pendingActivities/') ||
            fullPath.includes('/completedActivities/') ||
            fullPath.includes('/completions/') ||
            fullPath.includes('/stats/');
        
        // Layer 1: Check localStorage
        if (useLocalStorage && !isHighlyDynamicPath) {
            const cached = Cache.get(storageKey);
            if (cached && cached.data && cached.timestamp) {
                const age = Date.now() - cached.timestamp;
                if (age < ttl) {
                    this._cacheMetrics.hits++;
                    this._cacheMetrics.localStorageHits++;
                    return {
                        data: cached.data,
                        fromCache: 'localStorage',
                        error: null
                    };
                }
            }
        }
        
        // Layer 2: Read from RTDB
        try {
            const snapshot = await this.rtdb.ref(fullPath).once('value');
            this._cacheMetrics.rtdbReads++;
            
            if (snapshot.exists()) {
                const data = snapshot.val();
                
                // Cache in localStorage for next time (except for highly dynamic paths)
                if (useLocalStorage && !isHighlyDynamicPath) {
                    Cache.set(storageKey, {
                        data: data,
                        timestamp: Date.now()
                    }, 'SYSTEM');
                }
                
                // Track if it's pre-computed or indexed
                if (fullPath.includes('/pendingActivities/') || fullPath.includes('/completedActivities/')) {
                    this._cacheMetrics.preComputedReads++;
                } else if (fullPath.includes('/byId/') || fullPath.includes('/byPoints/') || fullPath.includes('/byDate/')) {
                    this._cacheMetrics.indexedReads++;
                }
                
                this._cacheMetrics.hits++;
                return {
                    data: data,
                    fromCache: 'rtdb',
                    error: null
                };
            } else {
                this._cacheMetrics.misses++;
                return {
                    data: null,
                    fromCache: null,
                    error: `Cache path ${fullPath} does not exist`
                };
            }
        } catch (error) {
            this._cacheMetrics.misses++;
            console.error(`RTDB cache read failed for ${fullPath}:`, error);
            return {
                data: null,
                fromCache: null,
                error: error.message || 'RTDB read failed'
            };
        }
    },
    
    /**
     * Get pending activities (pre-computed, no filtering!)
     */
    async getPendingActivities(userId) {
        // For correctness, always read from RTDB for pending activities.
        // We intentionally bypass localStorage here so that when admins
        // create/delete/update activities, users don't keep seeing stale
        // items from a 30-minute local cache.
        const result = await this.readFromCache(`users/${userId}/pendingActivities/combined`, {
            useLocalStorage: false,
            ttl: 0
        });
        return result.data || [];
    },
    
    /**
     * Get completed activities (pre-computed, no filtering!)
     */
    async getCompletedActivities(userId) {
        try {
            const result = await this.readFromCache(`users/${userId}/completedActivities/combined`);
            const activities = result.data || [];
            // Ensure all activities have proper structure
            return activities.map(a => ({
                ...a,
                id: a.id || a.quizId || a.taskId || a.formId,
                itemType: a.itemType || (a.quizId ? 'quiz' : a.taskId ? 'task' : a.formId ? 'form' : 'unknown')
            }));
        } catch (error) {
            console.error('Error fetching completed activities:', error);
            return [];
        }
    },
    
    /**
     * Get pending quizzes (pre-computed)
     */
    async getPendingQuizzes(userId) {
        const result = await this.readFromCache(`users/${userId}/pendingActivities/quizzes`);
        return result.data || [];
    },
    
    /**
     * Get pending tasks (pre-computed)
     */
    async getPendingTasks(userId) {
        const result = await this.readFromCache(`users/${userId}/pendingActivities/tasks`);
        return result.data || [];
    },
    
    /**
     * Get pending forms (pre-computed)
     */
    async getPendingForms(userId) {
        const result = await this.readFromCache(`users/${userId}/pendingActivities/forms`);
        return result.data || [];
    },
    
    /**
     * Get completed quizzes (pre-computed)
     */
    async getCompletedQuizzes(userId) {
        try {
            const result = await this.readFromCache(`users/${userId}/completedActivities/quizzes`);
            const quizzes = result.data || [];
            // Ensure all quizzes have proper structure
            return quizzes.map(q => ({
                ...q,
                itemType: 'quiz',
                id: q.id || q.quizId
            }));
        } catch (error) {
            console.error('Error fetching completed quizzes:', error);
            return [];
        }
    },
    
    /**
     * Get completed tasks (pre-computed)
     */
    async getCompletedTasks(userId) {
        try {
            const result = await this.readFromCache(`users/${userId}/completedActivities/tasks`);
            const tasks = result.data || [];
            // Ensure all tasks have proper structure
            return tasks.map(t => ({
                ...t,
                itemType: 'task',
                id: t.id || t.taskId
            }));
        } catch (error) {
            console.error('Error fetching completed tasks:', error);
            return [];
        }
    },
    
    /**
     * Get completed forms (pre-computed)
     */
    async getCompletedForms(userId) {
        const result = await this.readFromCache(`users/${userId}/completedActivities/forms`);
        return result.data || [];
    },
    
    /**
     * Simple client-side text search (fast for small lists)
     */
    filterBySearch(items, searchTerm) {
        if (!searchTerm || !items || !Array.isArray(items)) return items;
        const term = searchTerm.toLowerCase().trim();
        if (!term) return items;
        
        return items.filter(item => 
            (item.title && item.title.toLowerCase().includes(term)) ||
            (item.description && item.description.toLowerCase().includes(term))
        );
    },
    
    // Helper to get current user (works in both attendee and admin contexts)
    getCurrentUser() {
        if (typeof Auth !== 'undefined' && Auth.currentUser) {
            return Auth.currentUser;
        }
        if (typeof AdminAuth !== 'undefined' && AdminAuth.currentAdmin) {
            return AdminAuth.currentAdmin;
        }
        return null;
    },
    
    // Admin Operations
    async checkIfAdmin(uid) {
        try {
            const adminDoc = await this.db.collection('admins').doc(uid).get();
            return adminDoc.exists;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    },
    
    async getAdmin(uid) {
        try {
            const adminDoc = await this.db.collection('admins').doc(uid).get();
            if (adminDoc.exists) {
                return { uid: adminDoc.id, ...adminDoc.data() };
            }
            return null;
        } catch (error) {
            console.error('Error getting admin:', error);
            return null;
        }
    },
    
    // User Operations
    async getUser(uid, useCache = true) {
        const currentUser = this.getCurrentUser();
        
        // Try localStorage cache first (free, instant) - only for current user
        if (useCache && currentUser && uid === currentUser.uid) {
            const cached = Cache.get(Cache.keys.userData(uid));
            if (cached) {
                return cached;
            }
        }
        
        // Try RTDB cache (attendeeCache/users/{uid}) - works for all users
        if (useCache) {
            try {
                const cacheRef = this.rtdb.ref(`attendeeCache/users/${uid}`);
                const cacheSnap = await cacheRef.once('value');
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                    
                    // Use cache if not stale
                    if (now - lastUpdated < staleThreshold) {
                        this._cacheMetrics.hits++;
                        this._cacheMetrics.rtdbReads++;
                        
                        // Cache current user's data in localStorage for faster subsequent access
                        if (currentUser && uid === currentUser.uid) {
                            Cache.set(Cache.keys.userData(uid), cacheData, 'USER_DATA');
                        }
                        
                        return cacheData;
                    }
                }
            } catch (error) {
                // RTDB read failed, fall through to Firestore
                this._cacheMetrics.misses++;
            }
        }
        
        // Fallback to Firestore
        this._cacheMetrics.firestoreReads++;
        const doc = await this.db.collection('users').doc(uid).get();
        const userData = doc.exists ? { uid: doc.id, ...doc.data() } : null;
        
        // Cache current user's data in localStorage
        if (userData && currentUser && uid === currentUser.uid) {
            Cache.set(Cache.keys.userData(uid), userData, 'USER_DATA');
        }
        
        return userData;
    },
    
    // Check if user is a registered participant (in users or pendingUsers)
    async checkIfParticipant(uid, email) {
        try {
            if (!email) return false;
            
            // Check if user already exists in users collection
            const userRef = this.db.collection('users').doc(uid);
            const userSnap = await userRef.get();
            if (userSnap.exists) return true; // Use .exists as property, not function
            
            // Check if email exists in pendingUsers (document ID is the normalized email)
            const normalizedEmail = email.toLowerCase().trim();
            const pendingUserRef = this.db.collection('pendingUsers').doc(normalizedEmail);
            const pendingSnap = await pendingUserRef.get();
            
            if (pendingSnap.exists) {
                return true; // Found in pendingUsers
            }
            
            return false;
        } catch (error) {
            console.error('Error checking participant:', error);
            if (error.code === 'permission-denied') {
                console.error('Permission denied - check Firestore security rules');
            }
            return false;
        }
    },
    
        // Migrate pending user to active user
        async migratePendingUser(uid, normalizedEmail, pendingData) {
            try {
                const userRef = this.db.collection('users').doc(uid);
                
                // Create user document
                // Ensure we carry over all important profile fields from pending user,
                // including phone number which was previously being dropped.
                await userRef.set({
                    email: normalizedEmail,
                    name: pendingData.name,
                    phone: pendingData.phone || '', // Preserve phone from pendingUsers
                    district: pendingData.district,
                    designation: pendingData.designation,
                    points: 0,
                    role: 'attendee',
                    status: 'active',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    firstLoginAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                // Delete from pendingUsers
                try {
                    const pendingUserRef = this.db.collection('pendingUsers').doc(normalizedEmail);
                    await pendingUserRef.delete();
                } catch (deleteError) {
                    // Non-critical - user is migrated, pendingUsers entry can be cleaned up later
                }
                
                return await this.getUser(uid);
            } catch (error) {
                console.error('Error during migration:', error);
                throw error;
            }
        },
    
    // Update user document with Firebase auth data on login
    async updateUserOnLogin(uid, authData) {
        try {
            const userRef = this.db.collection('users').doc(uid);
            const userSnap = await userRef.get();
            
            if (!userSnap.exists) { // Use .exists as property, not function
                throw new Error('User not found. UID: ' + uid);
            }
            
            const userData = userSnap.data();
            const updateData = {};
            
            // Always update displayName and photoURL if available from auth
            if (authData.displayName) {
                updateData.displayName = authData.displayName;
            }
            if (authData.photoURL) {
                updateData.photoURL = authData.photoURL; // Store Google profile photo
            }
            if (authData.email) {
                updateData.email = authData.email;
            }
            
            // Set firstLoginAt if not exists, otherwise update lastLoginAt
            if (!userData.firstLoginAt) {
                updateData.firstLoginAt = firebase.firestore.FieldValue.serverTimestamp();
            } else {
                updateData.lastLoginAt = firebase.firestore.FieldValue.serverTimestamp();
            }
            
            if (Object.keys(updateData).length > 0) {
                await userRef.update(updateData);
            }
            
            return await this.getUser(uid);
        } catch (error) {
            console.error('Error updating user on login:', error);
            if (error.code === 'permission-denied') {
                console.error('Permission denied - check Firestore rules');
            }
            throw error;
        }
    },
    
    async getAllUsers() {
        // For attendee app: use attendeeCache/directory only (no Firestore fallback to save costs)
        // This cache should be populated by Cloud Functions
        try {
            const cacheRef = this.rtdb.ref('attendeeCache/directory');
            const cacheSnap = await new Promise((resolve, reject) => {
                cacheRef.once('value', resolve, reject);
            });
            
            if (cacheSnap.exists()) {
                const cacheData = cacheSnap.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                const now = Date.now();
                const staleThreshold = 5 * 60 * 1000; // 5 minutes
                const age = now - lastUpdated;
                
                // Use cache if not stale (or even if stale, since we have no fallback)
                if (age < staleThreshold || age < 30 * 60 * 1000) { // Allow up to 30 minutes
                    // Attendee cache structure: { [uid]: {...}, lastUpdated: ... }
                    const users = [];
                    Object.keys(cacheData).forEach(key => {
                        if (key !== 'lastUpdated' && cacheData[key]) {
                            const u = cacheData[key];
                            const user = {
                                uid: u.uid || key,
                                email: u.email || null,
                                name: u.name || null,
                                district: u.district || null,
                                designation: u.designation || null,
                                points: u.points || 0,
                                photoURL: u.photoURL || u.photo || null,
                                photo: u.photoURL || u.photo || null,
                                status: u.status || 'active'
                            };
                            users.push(user);
                        }
                    });
                    if (users.length > 0) {
                        return users;
                    }
                } else {
                    // Still try to use stale cache if available
                    const users = [];
                    Object.keys(cacheData).forEach(key => {
                        if (key !== 'lastUpdated' && cacheData[key]) {
                            const u = cacheData[key];
                            users.push({
                                uid: u.uid || key,
                                email: u.email || null,
                                name: u.name || null,
                                district: u.district || null,
                                designation: u.designation || null,
                                points: u.points || 0,
                                photoURL: u.photoURL || u.photo || null,
                                photo: u.photoURL || u.photo || null,
                                status: u.status || 'active'
                            });
                        }
                    });
                    if (users.length > 0) {
                        return users;
                    }
                }
            }
        } catch (error) {
            // Cache not available - return empty array (no Firestore fallback to save costs)
        }
        
        // Return empty array if cache is not available (no Firestore fallback)
        return [];
    },
    
    /**
     * Get admin dashboard statistics from RTDB cache
     * Falls back to Firestore if cache is unavailable or stale
     */
    async getAdminStats() {
        // Try RTDB cache first (cheap read)
        try {
            const cacheRef = this.rtdb.ref('adminCache/stats');
            const cacheSnap = await new Promise((resolve, reject) => {
                cacheRef.once('value', resolve, reject);
            });
            
            if (cacheSnap.exists()) {
                const cacheData = cacheSnap.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                const now = Date.now();
                const staleThreshold = 5 * 60 * 1000; // 5 minutes
                
                // Use cache if not stale
                if (now - lastUpdated < staleThreshold) {
                    return cacheData;
                }
            }
        } catch (error) {
            // Permission denied or other error - fall back to Firestore
        }
        
        // Fallback to Firestore (calculate on the fly)
        // Try RTDB participants cache first to avoid reading all pendingUsers
        let pendingUsersCount = 0;
        try {
            const participantsCacheRef = this.rtdb.ref('adminCache/participants');
            const participantsCacheSnap = await new Promise((resolve, reject) => {
                participantsCacheRef.once('value', resolve, reject);
            });
            if (participantsCacheSnap.exists()) {
                const cacheData = participantsCacheSnap.val();
                pendingUsersCount = cacheData.pending ? cacheData.pending.length : 0;
            }
        } catch (error) {
            // Cache miss - will read from Firestore below
        }
        
        try {
            const [usersSnapshot, pendingUsersSnapshot, submissionsSnapshot] = await Promise.all([
                this.db.collection('users')
                    .where('role', '==', 'attendee')
                    .get(),
                // Only read pendingUsers if we couldn't get count from cache
                pendingUsersCount > 0 
                    ? Promise.resolve({ size: pendingUsersCount }) 
                    : this.db.collection('pendingUsers').get(),
                this.db.collection('submissions').get()
            ]);
            
            const allUsers = [];
            usersSnapshot.forEach((doc) => {
                const data = doc.data();
                allUsers.push({
                    uid: doc.id,
                    status: data.status || 'active',
                    points: data.points || 0,
                });
            });
            
            const activeUsers = allUsers.filter(u => u.status === 'active');
            const pendingUsers = pendingUsersCount > 0 ? pendingUsersCount : pendingUsersSnapshot.size;
            const totalUsers = allUsers.length + pendingUsers;
            const totalPoints = allUsers.reduce((sum, u) => sum + (u.points || 0), 0);
            
            const submissions = [];
            submissionsSnapshot.forEach((doc) => {
                const data = doc.data();
                submissions.push({
                    status: data.status || 'pending',
                });
            });
            
            const pendingSubmissions = submissions.filter(s => s.status === 'pending').length;
            const approvedSubmissions = submissions.filter(s => s.status === 'approved').length;
            const rejectedSubmissions = submissions.filter(s => s.status === 'rejected').length;
            
            return {
                totalUsers: totalUsers,
                activeUsers: activeUsers.length,
                pendingUsers: pendingUsers,
                totalPoints: totalPoints,
                pendingSubmissions: pendingSubmissions,
                approvedSubmissions: approvedSubmissions,
                rejectedSubmissions: rejectedSubmissions,
                lastUpdated: Date.now(),
            };
        } catch (error) {
            console.error('Error calculating admin stats from Firestore:', error);
            throw error;
        }
    },
    
    /**
     * Get recent activity from RTDB cache
     * Falls back to Firestore if cache is unavailable
     * @param {number} limit - Maximum number of activities to return
     * @returns {Promise<Array>} Array of recent activities
     */
    async getRecentActivity(limit = 20) {
        // Try RTDB cache first (cheap read)
        try {
            const cacheRef = this.rtdb.ref('adminCache/recentActivity');
            const cacheSnap = await new Promise((resolve, reject) => {
                cacheRef.once('value', resolve, reject);
            });
            
            if (cacheSnap.exists()) {
                const cacheData = cacheSnap.val();
                const items = cacheData.items || {};
                
                // Convert object to array and sort by submittedAt
                const activities = Object.values(items)
                    .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
                    .slice(0, limit);
                
                return activities;
            }
        } catch (error) {
            // Permission denied or other error - fall back to Firestore
        }
        
        // Fallback to Firestore
        try {
            const [taskSubmissionsSnapshot, formSubmissionsSnapshot, quizSubmissionsSnapshot] = await Promise.all([
                this.db.collection('submissions')
                    .orderBy('submittedAt', 'desc')
                    .limit(limit)
                    .get(),
                this.db.collection('formSubmissions')
                    .orderBy('submittedAt', 'desc')
                    .limit(limit)
                    .get(),
                this.db.collection('quizSubmissions')
                    .orderBy('submittedAt', 'desc')
                    .limit(limit)
                    .get()
            ]);
            
            const allActivities = [];
            
            // Process task submissions
            taskSubmissionsSnapshot.forEach((doc) => {
                const data = doc.data();
                if (data.taskId && data.userId) {
                    allActivities.push({
                        id: doc.id,
                        type: 'task',
                        userId: data.userId,
                        userName: data.userName || data.name || 'Unknown',
                        taskId: data.taskId,
                        taskTitle: data.taskTitle || data.title || 'Untitled Task',
                        status: data.status || 'pending',
                        submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
                    });
                }
            });
            
            // Process form submissions
            formSubmissionsSnapshot.forEach((doc) => {
                const data = doc.data();
                if (data.formId && data.userId) {
                    allActivities.push({
                        id: doc.id,
                        type: 'form',
                        userId: data.userId,
                        userName: data.userName || data.name || 'Unknown',
                        formId: data.formId,
                        taskTitle: data.formTitle || data.title || 'Untitled Form',
                        status: 'submitted',
                        submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
                    });
                }
            });
            
            // Process quiz submissions
            quizSubmissionsSnapshot.forEach((doc) => {
                const data = doc.data();
                if (data.quizId && data.userId) {
                    allActivities.push({
                        id: doc.id,
                        type: 'quiz',
                        userId: data.userId,
                        userName: data.userName || data.name || 'Unknown',
                        quizId: data.quizId,
                        taskTitle: data.quizTitle || data.title || 'Untitled Quiz',
                        status: 'completed',
                        score: data.score || 0,
                        totalScore: data.totalScore || 0,
                        submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
                    });
                }
            });
            
            // Sort by submittedAt descending and take top limit
            allActivities.sort((a, b) => b.submittedAt - a.submittedAt);
            return allActivities.slice(0, limit);
        } catch (error) {
            console.error('Error fetching recent activity from Firestore:', error);
            throw error;
        }
    },
    
    async updateUser(uid, data) {
        await this.db.collection('users').doc(uid).update(data);
        return await this.getUser(uid);
    },
    
    async createUser(userData) {
        const docRef = await this.db.collection('users').add(userData);
        return { uid: docRef.id, ...userData };
    },
    
    // Pending Users Operations (for admin to add attendees)
    /**
     * Get all pending users - tries RTDB cache first, falls back to Firestore
     * WARNING: This reads the entire collection. Use checkPendingUserExists() for single email checks.
     */
    async getPendingUsers(options = {}) {
        const { forceRefresh = false } = options;
        let lastSynced = null;
        let stale = true;
        
        // Try RTDB cache first (cheap read)
        try {
            const [pendingSnap, metaSnap] = await Promise.all([
                this.rtdb.ref('adminCache/participants/pending').once('value'),
                this.rtdb.ref('adminCache/metadata').once('value')
            ]);
            
            const pendingData = pendingSnap.exists() ? pendingSnap.val() : [];
            const metadata = metaSnap.exists() ? metaSnap.val() : {};
            lastSynced = metadata.lastUpdated || null;
            const isFresh = lastSynced ? (Date.now() - lastSynced) < (10 * 60 * 1000) : false;
            stale = !isFresh;
            
            if (!forceRefresh && Array.isArray(pendingData) && pendingData.length >= 0) {
                const pending = pendingData.map(p => ({
                    email: p.email,
                    ...p,
                    uid: null,
                    points: 0,
                    status: 'pending'
                }));
                pending.lastSynced = lastSynced;
                pending.stale = stale;
                return pending;
            }
        } catch (error) {
            // Cache miss - optionally fall through to Firestore if forced
        }
        
        if (!forceRefresh) {
            // If cache is completely missing (first deploy), do read-through to Firestore
            if (lastSynced === null && (!pendingData || pendingData.length === 0)) {
                console.log('[getPendingUsers] Cache empty on first access, doing read-through');
                return await this.getPendingUsers({ forceRefresh: true });
            }
            // Otherwise return cached data (even if stale)
            const pending = (pendingData || []).map(p => ({
                email: p.email,
                ...p,
                uid: null,
                points: 0,
                status: 'pending'
            }));
            pending.lastSynced = lastSynced;
            pending.stale = stale;
            return pending;
        }
        
        // Explicit hard refresh (expensive - reads entire collection)
        const snapshot = await this.db.collection('pendingUsers').get();
        const pending = snapshot.docs.map(doc => ({
            email: doc.id,
            ...doc.data(),
            uid: null,
            points: 0,
            status: 'pending'
        }));
        pending.lastSynced = Date.now();
        pending.stale = false;
        return pending;
    },
    
    /**
     * Sanitize email for use as RTDB key
     * RTDB keys cannot contain: $, #, [, ]
     * Note: . (dot) is allowed in RTDB keys
     */
    _sanitizeEmailForRTDBKey(email) {
        if (!email) return null;
        return email
            .toLowerCase()
            .trim()
            .replace(/\$/g, '_DOLLAR_')
            .replace(/#/g, '_HASH_')
            .replace(/\[/g, '_LBRACK_')
            .replace(/\]/g, '_RBRACK_');
    },
    
    /**
     * Check if a specific email exists in pendingUsers using direct document lookup
     * This is MUCH more efficient than getPendingUsers() - only 1 read instead of reading all documents
     * @param {string} email - Email to check (will be normalized)
     * @returns {Promise<boolean>} - True if email exists in pendingUsers
     */
    async checkPendingUserExists(email) {
        if (!email) return false;
        
        const normalizedEmail = email.toLowerCase().trim();
        const sanitizedKey = this._sanitizeEmailForRTDBKey(email);
        
        // Try RTDB email cache first (cheapest - 0 Firestore reads)
        try {
            const emailCacheResult = await this.readFromCache(`adminCache/emails/${sanitizedKey}`);
            if (emailCacheResult.data && emailCacheResult.data.type === 'pending') {
                return true;
            }
            // If email exists but type is 'active', it's not in pendingUsers
            if (emailCacheResult.data && emailCacheResult.data.type === 'active') {
                return false;
            }
        } catch (error) {
            // Cache miss - proceed to direct document lookup
        }
        
        // Direct document lookup (1 read instead of reading all documents)
        try {
            const pendingUserRef = this.db.collection('pendingUsers').doc(normalizedEmail);
            const pendingSnap = await pendingUserRef.get();
            return pendingSnap.exists;
        } catch (error) {
            console.error('Error checking pending user:', error);
            return false;
        }
    },
    
    async createPendingUser(userData) {
        const normalizedEmail = userData.email.toLowerCase().trim();
        const pendingUserRef = this.db.collection('pendingUsers').doc(normalizedEmail);
        
        await pendingUserRef.set({
            ...userData,
            email: normalizedEmail,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        return { email: normalizedEmail, ...userData };
    },
    
    async getAllAttendees(options = {}) {
        const { forceRefresh = false } = options;
        let lastSynced = null;
        let stale = true;
        let participantsSnap = null;
        let cacheData = null;
        
        // Try RTDB cache first (cheap read)
        try {
            const [snap, metadataSnap] = await Promise.all([
                this.rtdb.ref('adminCache/participants').once('value'),
                this.rtdb.ref('adminCache/metadata').once('value')
            ]);
            
            participantsSnap = snap;
            
            if (participantsSnap.exists()) {
                cacheData = participantsSnap.val();
                const metadata = metadataSnap.exists() ? metadataSnap.val() : {};
                lastSynced = metadata.lastUpdated || cacheData.lastUpdated || null;
                const isFresh = lastSynced ? (Date.now() - lastSynced) < (10 * 60 * 1000) : false;
                stale = !isFresh;
                
                const active = Array.isArray(cacheData.active) ? cacheData.active.map(u => ({
                    uid: u.uid,
                    email: u.email,
                    name: u.name,
                    phone: u.phone || null,
                    district: u.district,
                    designation: u.designation,
                    points: u.points || 0,
                    photoURL: u.photoURL || u.photo, // Use photoURL (fallback to photo for backward compatibility)
                    status: u.status || 'active'
                })) : [];
                
                const pending = Array.isArray(cacheData.pending) ? cacheData.pending.map(p => ({
                    email: p.email,
                    name: p.name,
                    district: p.district,
                    designation: p.designation,
                    uid: null,
                    points: 0,
                    photoURL: p.photoURL || p.photo, // Use photoURL (fallback to photo for backward compatibility)
                    status: 'pending'
                })) : [];
                
                if (!forceRefresh || (isFresh && (active.length || pending.length))) {
                    const attendees = [...active, ...pending];
                    attendees.lastSynced = lastSynced;
                    attendees.stale = stale;
                    return attendees;
                }
            }
        } catch (error) {
            // Cache miss - fall through to Firestore only if forced
            console.error('[getAllAttendees] RTDB cache read error:', error);
        }
        
        if (!forceRefresh) {
            // If cache is completely missing (first deploy), do read-through to Firestore
            const cacheExists = participantsSnap && participantsSnap.exists();
            const hasData = cacheData && (cacheData.active || cacheData.pending);
            
            if (lastSynced === null && (!cacheExists || !hasData)) {
                console.log('[getAllAttendees] Cache empty on first access, doing read-through');
                return await this.getAllAttendees({ forceRefresh: true });
            }
            // Otherwise return cached data (even if stale)
            if (cacheData) {
                const active = Array.isArray(cacheData.active) ? cacheData.active.map(u => ({
                    uid: u.uid,
                    email: u.email,
                    name: u.name,
                    phone: u.phone || null,
                    district: u.district,
                    designation: u.designation,
                    points: u.points || 0,
                    photoURL: u.photoURL || u.photo,
                    status: u.status || 'active'
                })) : [];
                
                const pending = Array.isArray(cacheData.pending) ? cacheData.pending.map(p => ({
                    email: p.email,
                    name: p.name,
                    district: p.district,
                    designation: p.designation,
                    uid: null,
                    points: 0,
                    photoURL: p.photoURL || p.photo,
                    status: 'pending'
                })) : [];
                
                const attendees = [...active, ...pending];
                attendees.lastSynced = lastSynced;
                attendees.stale = stale;
                return attendees;
            }
        }
        
        // Explicit hard refresh (expensive - reads entire collections)
        const [usersSnapshot, pendingSnapshot] = await Promise.all([
            this.db.collection('users').where('role', '==', 'attendee').get(),
            this.db.collection('pendingUsers').get()
        ]);
        
        const users = usersSnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
        const pending = pendingSnapshot.docs.map(doc => ({
            email: doc.id,
            ...doc.data(),
            uid: null,
            points: 0,
            status: 'pending'
        }));
        
        const attendees = [...users, ...pending];
        attendees.lastSynced = Date.now();
        attendees.stale = false;
        return attendees;
    },
    
    // Get user's leaderboard rank from RTDB cache (indexed)
    async getUserRank(uid, useCache = true) {
        // Try new cache path first (cache/leaderboard/ranks/{uid}) - this is where Cloud Functions write
        let result = await this.readFromCache(`cache/leaderboard/ranks/${uid}`, {
            useLocalStorage: useCache,
            ttl: 5 * 60 * 1000 // 5 minutes
        });
        
        // If not found, try old path (ranks/{uid}) for backward compatibility
        if (!result.data || !result.data.rank) {
            result = await this.readFromCache(`ranks/${uid}`, {
                useLocalStorage: useCache,
                ttl: 5 * 60 * 1000
            });
        }
        
        // If still not found, try incorrect path (leaderboard/ranks/{uid}) for backward compatibility
        // Note: This path doesn't exist in Cloud Functions, but might exist from old code
        if (!result.data || !result.data.rank) {
            result = await this.readFromCache(`leaderboard/ranks/${uid}`, {
                useLocalStorage: useCache,
                ttl: 5 * 60 * 1000
            });
        }
        
        if (result.data && result.data.rank) {
            return result.data.rank;
        }
        
        // Fallback: derive rank from leaderboard cache if dedicated rank is missing
        try {
            const leaderboard = await this.getLeaderboard(50, useCache);
            if (Array.isArray(leaderboard) && leaderboard.length > 0) {
                const index = leaderboard.findIndex((entry) => entry && entry.uid === uid);
                if (index !== -1) {
                    return index + 1;
                }
            }
        } catch (e) {
            // Non-critical – ignore and fall through to default
        }
        
        // No rank information available in cache
        // Return null so callers can display a placeholder instead of an incorrect rank
        return null;
    },
    
    // Get leaderboard from RTDB cache (indexed)
    async getLeaderboard(limit = 50, useCache = true) {
        // Try new cache path first (cache/leaderboard/top50)
        let result = await this.readFromCache('leaderboard/top50', {
            useLocalStorage: useCache,
            ttl: 5 * 60 * 1000 // 5 minutes
        });
        
        // If not found, try cache/leaderboard/top50 (new architecture path)
        if (!result.data || Object.keys(result.data).length === 0) {
            result = await this.readFromCache('cache/leaderboard/top50', {
                useLocalStorage: useCache,
                ttl: 5 * 60 * 1000
            });
        }
        
        // If still not found, try old path (for backward compatibility)
        if (!result.data || Object.keys(result.data).length === 0) {
            result = await this.readFromCache('cache/leaderboard/top50', {
                useLocalStorage: false, // Don't cache old path
                ttl: 0
            });
        }
        
        if (result.data) {
            // Convert object to array, filter nulls
            const leaderboard = Object.values(result.data)
                .filter(p => p !== null && p.uid) // Ensure valid user data
                .slice(0, limit);
            return leaderboard;
        }
        
        // Return empty leaderboard - no Firestore fallback
        return [];
    },
    
    // Quiz Operations
    async getQuizzes(useCache = true, adminMode = false) {
        // For admin, use indexed cache or old cache (backward compatibility)
        if (adminMode) {
            try {
                // Try new indexed cache first
                const result = await this.readFromCache('activities/quizzes/list', {
                    useLocalStorage: false,
                    ttl: 15 * 60 * 1000 // 15 minutes (increased from 10)
                });
                
                if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                    // Fetch full quiz data from byId
                    const quizPromises = result.data.slice(0, 100).map(quizId => 
                        this.readFromCache(`activities/quizzes/byId/${quizId}`, {
                            useLocalStorage: false,
                            ttl: 15 * 60 * 1000 // 15 minutes (increased from 10)
                        })
                    );
                    const quizzes = await Promise.all(quizPromises);
                    return quizzes.map(q => q.data).filter(q => q !== null);
                }
                
                // Fallback to old cache
                const cacheRef = this.rtdb.ref('adminCache/quizzes');
                const cacheSnap = await new Promise((resolve, reject) => {
                    cacheRef.once('value', resolve, reject);
                });
                
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                    
                    if (now - lastUpdated < staleThreshold) {
                        const quizzes = Object.keys(cacheData)
                            .filter(key => key !== 'lastUpdated')
                            .map(key => cacheData[key]);
                        return quizzes;
                    }
                }
            } catch (error) {
            }
            
            // Fallback to Firestore for admin
            const snapshot = await this.db.collection('quizzes').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        
        // For attendees, use pre-computed pending quizzes
        const currentUser = this.getCurrentUser();
        if (currentUser && currentUser.uid) {
            try {
                const quizzes = await this.getPendingQuizzes(currentUser.uid);
                return quizzes || [];
            } catch (error) {
                return [];
            }
        }
        
        return [];
    },
    
    /**
     * Get all quizzes for admin (includes inactive)
     * Uses RTDB cache for cost optimization
     */
    async getAllQuizzes() {
        // Try RTDB cache first
        try {
            const cacheRef = this.rtdb.ref('adminCache/quizzes');
            const cacheSnap = await new Promise((resolve, reject) => {
                cacheRef.once('value', resolve, reject);
            });
            
            if (cacheSnap.exists()) {
                const cacheData = cacheSnap.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                const now = Date.now();
                const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                
                // Use cache if not stale
                if (now - lastUpdated < staleThreshold) {
                    // Convert object to array, exclude lastUpdated
                    const quizzes = Object.keys(cacheData)
                        .filter(key => key !== 'lastUpdated')
                        .map(key => {
                            const quiz = cacheData[key];
                            // Ensure questionsCount is available for rendering
                            // RTDB cache has questionsCount but may not have questions array
                            return {
                                ...quiz,
                                questionsCount: quiz.questionsCount || quiz.questions?.length || 0
                            };
                        });
                    return quizzes;
                }
            }
        } catch (error) {
        }
        
        // Fallback to Firestore
        const snapshot = await this.db.collection('quizzes').get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                ...data,
                // Ensure questionsCount is available even if questions array exists
                questionsCount: data.questions?.length || data.questionsCount || 0
            };
        });
    },
    
    async getQuiz(quizId) {
        // Try memory cache first (session-scoped, fastest)
        const memoryKey = `quiz:${quizId}`;
        const memoryCached = MemoryCache.get(memoryKey);
        if (memoryCached) {
            this._cacheMetrics.hits++;
            return memoryCached;
        }
        
        // Check for pending request (request deduplication)
        const requestKey = `getQuiz:${quizId}`;
        if (this._pendingRequests.has(requestKey)) {
            // Return the same promise if request is already in flight
            return this._pendingRequests.get(requestKey);
        }
        
        // Create new request promise
        const requestPromise = (async () => {
            try {
                // Try RTDB cache (adminCache/quizzes) to avoid Firestore reads
                try {
                    const cacheRef = this.rtdb.ref('adminCache/quizzes');
                    const cacheSnap = await cacheRef.once('value');
                    if (cacheSnap.exists()) {
                        const cacheData = cacheSnap.val();
                        const lastUpdated = cacheData.lastUpdated || 0;
                        const now = Date.now();
                        // Check if cache is fresh (within 10 minutes)
                        if (now - lastUpdated < 10 * 60 * 1000 && cacheData[quizId]) {
                            const cachedQuiz = { id: quizId, ...cacheData[quizId] };
                            // If questions array is missing, fall through to Firestore to get full quiz
                            if (cachedQuiz.questions && Array.isArray(cachedQuiz.questions) && cachedQuiz.questions.length > 0) {
                                // Cache in memory for faster subsequent access
                                MemoryCache.set(memoryKey, cachedQuiz, 15 * 60 * 1000); // 15 minutes TTL
                                this._cacheMetrics.hits++;
                                this._cacheMetrics.rtdbReads++;
                                return cachedQuiz;
                            }
                            // Cache doesn't have questions, fall through to Firestore
                        }
                    }
                } catch (error) {
                    // Cache read failed, fall through to Firestore
                }
                
                // Fallback to Firestore if cache miss, stale, or missing questions
                this._cacheMetrics.misses++;
                this._cacheMetrics.firestoreReads++;
                const doc = await this.db.collection('quizzes').doc(quizId).get();
                const quiz = doc.exists ? { id: doc.id, ...doc.data() } : null;
                
                // Cache in memory if found
                if (quiz) {
                    MemoryCache.set(memoryKey, quiz, 15 * 60 * 1000); // 15 minutes TTL
                }
                
                return quiz;
            } finally {
                // Remove from pending requests when done
                this._pendingRequests.delete(requestKey);
            }
        })();
        
        // Store pending request
        this._pendingRequests.set(requestKey, requestPromise);
        
        return requestPromise;
    },
    
    async submitQuiz(quizData) {
        const docRef = await this.db.collection('quizSubmissions').add(quizData);
        return { id: docRef.id, ...quizData };
    },
    
    async getQuizSubmissions(userId, useCache = true) {
        const currentUser = this.getCurrentUser();
        
        // Try localStorage cache first (for current user)
        if (useCache && currentUser && userId === currentUser.uid) {
            const cached = Cache.get(Cache.keys.completedQuizzes(userId));
            if (cached) {
                return cached;
            }
        }
        
        const snapshot = await this.db.collection('quizSubmissions')
            .where('userId', '==', userId)
            .get();
        const submissions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Cache for current user
        if (currentUser && userId === currentUser.uid) {
            Cache.set(Cache.keys.completedQuizzes(userId), submissions, 'USER_DATA');
        }
        
        return submissions;
    },
    
    // Task Operations
    async getTasks(useCache = true, adminMode = false) {
        // For admin, use indexed cache or old cache (backward compatibility)
        if (adminMode) {
            try {
                // Try new indexed cache first
                const result = await this.readFromCache('activities/tasks/list', {
                    useLocalStorage: false,
                    ttl: 15 * 60 * 1000 // 15 minutes (increased from 10)
                });
                
                if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                    // Fetch full task data from byId
                    const taskPromises = result.data.slice(0, 100).map(taskId => 
                        this.readFromCache(`activities/tasks/byId/${taskId}`, {
                            useLocalStorage: false,
                            ttl: 15 * 60 * 1000 // 15 minutes (increased from 10)
                        })
                    );
                    const tasks = await Promise.all(taskPromises);
                    return tasks.map(t => t.data).filter(t => t !== null);
                }
                
                // Fallback to old cache
                const cacheRef = this.rtdb.ref('adminCache/tasks');
                const cacheSnap = await new Promise((resolve, reject) => {
                    cacheRef.once('value', resolve, reject);
                });
                
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                    
                    if (now - lastUpdated < staleThreshold) {
                        const tasks = Object.keys(cacheData)
                            .filter(key => key !== 'lastUpdated')
                            .map(key => cacheData[key]);
                        return tasks;
                    }
                }
            } catch (error) {
            }
            
            // Fallback to Firestore for admin
            const snapshot = await this.db.collection('tasks').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        
        // For attendees, use pre-computed pending tasks
        const currentUser = this.getCurrentUser();
        if (currentUser && currentUser.uid) {
            try {
                const tasks = await this.getPendingTasks(currentUser.uid);
                return tasks || [];
            } catch (error) {
                return [];
            }
        }
        
        return [];
    },
    
    /**
     * Get all tasks for admin (includes inactive)
     * Uses RTDB cache for cost optimization
     */
    async getAllTasks() {
        // Try RTDB cache first
        try {
            const cacheRef = this.rtdb.ref('adminCache/tasks');
            const cacheSnap = await new Promise((resolve, reject) => {
                cacheRef.once('value', resolve, reject);
            });
            
            if (cacheSnap.exists()) {
                const cacheData = cacheSnap.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                const now = Date.now();
                const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                
                // Use cache if not stale
                if (now - lastUpdated < staleThreshold) {
                    // Convert object to array, exclude lastUpdated
                    const tasks = Object.keys(cacheData)
                        .filter(key => key !== 'lastUpdated')
                        .map(key => cacheData[key]);
                    return tasks;
                }
            }
        } catch (error) {
        }
        
        // Fallback to Firestore
        const snapshot = await this.db.collection('tasks').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    
    async getTask(taskId) {
        // Try memory cache first (session-scoped, fastest)
        const memoryKey = `task:${taskId}`;
        const memoryCached = MemoryCache.get(memoryKey);
        if (memoryCached) {
            this._cacheMetrics.hits++;
            return memoryCached;
        }
        
        // Check for pending request (request deduplication)
        const requestKey = `getTask:${taskId}`;
        if (this._pendingRequests.has(requestKey)) {
            // Return the same promise if request is already in flight
            return this._pendingRequests.get(requestKey);
        }
        
        // Create new request promise
        const requestPromise = (async () => {
            try {
                // Try RTDB cache (adminCache/tasks) to avoid Firestore reads
                try {
                    const cacheRef = this.rtdb.ref('adminCache/tasks');
                    const cacheSnap = await cacheRef.once('value');
                    if (cacheSnap.exists()) {
                        const cacheData = cacheSnap.val();
                        const lastUpdated = cacheData.lastUpdated || 0;
                        const now = Date.now();
                        // Check if cache is fresh (within 10 minutes)
                        if (now - lastUpdated < 10 * 60 * 1000 && cacheData[taskId]) {
                            const cachedTask = { id: taskId, ...cacheData[taskId] };
                            
                            // FIX: If task is form type but formFields are missing from cache, fall back to Firestore
                            // This handles cases where cache was updated before formFields were added to cache logic
                            if (cachedTask.type === 'form' && (!cachedTask.formFields || !Array.isArray(cachedTask.formFields) || cachedTask.formFields.length === 0)) {
                                // Fall through to Firestore to get complete data including formFields
                            } else {
                                // Cache in memory for faster subsequent access
                                MemoryCache.set(memoryKey, cachedTask, 15 * 60 * 1000); // 15 minutes TTL
                                this._cacheMetrics.hits++;
                                this._cacheMetrics.rtdbReads++;
                                return cachedTask;
                            }
                        }
                    }
                } catch (error) {
                    // Cache read failed, fall through to Firestore
                }
                
                // Fallback to Firestore if cache miss or stale
                this._cacheMetrics.misses++;
                this._cacheMetrics.firestoreReads++;
                const doc = await this.db.collection('tasks').doc(taskId).get();
                const task = doc.exists ? { id: doc.id, ...doc.data() } : null;
                
                // Cache in memory if found
                if (task) {
                    MemoryCache.set(memoryKey, task, 15 * 60 * 1000); // 15 minutes TTL
                }
                
                return task;
            } finally {
                // Remove from pending requests when done
                this._pendingRequests.delete(requestKey);
            }
        })();
        
        // Store pending request
        this._pendingRequests.set(requestKey, requestPromise);
        
        return requestPromise;
    },
    
    async submitTask(submission) {
        const docRef = await this.db.collection('submissions').add({
            ...submission,
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return { id: docRef.id, ...submission };
    },
    
    async getSubmissions(userId, useCache = true) {
        const currentUser = this.getCurrentUser();
        
        // Try localStorage cache first (for current user)
        if (useCache && currentUser && userId === currentUser.uid) {
            const cached = Cache.get(Cache.keys.submissions(userId));
            if (cached) {
                return cached;
            }
        }
        
        const snapshot = await this.db.collection('submissions')
            .where('userId', '==', userId)
            .get();
        const submissions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Cache for current user
        if (currentUser && userId === currentUser.uid) {
            Cache.set(Cache.keys.submissions(userId), submissions, 'USER_DATA');
        }
        
        return submissions;
    },
    
    // File Upload
    async uploadFile(file, path) {
        const storageRef = this.storage.ref(path);
        const uploadTask = storageRef.put(file);
        
        return new Promise((resolve, reject) => {
            uploadTask.on('state_changed',
                null,
                (error) => reject(error),
                () => {
                    uploadTask.snapshot.ref.getDownloadURL().then((url) => {
                        resolve(url);
                    });
                }
            );
        });
    },
    
    // Forms/Surveys Operations
    async getForms(adminMode = false, useCache = true) {
        // For admin, use indexed cache or old cache (backward compatibility)
        if (adminMode) {
            try {
                // Try new indexed cache first
                const result = await this.readFromCache('activities/forms/list', {
                    useLocalStorage: false,
                    ttl: 15 * 60 * 1000 // 15 minutes (increased from 10)
                });
                
                if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                    // Fetch full form data from byId
                    const formPromises = result.data.slice(0, 100).map(formId => 
                        this.readFromCache(`activities/forms/byId/${formId}`, {
                            useLocalStorage: false,
                            ttl: 15 * 60 * 1000 // 15 minutes (increased from 10)
                        })
                    );
                    const forms = await Promise.all(formPromises);
                    return forms.map(f => f.data).filter(f => f !== null);
                }
                
                // Fallback to old cache
                const cacheRef = this.rtdb.ref('adminCache/forms');
                const cacheSnap = await new Promise((resolve, reject) => {
                    cacheRef.once('value', resolve, reject);
                });
                
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                    
                    if (now - lastUpdated < staleThreshold) {
                        const forms = Object.keys(cacheData)
                            .filter(key => key !== 'lastUpdated')
                            .map(key => cacheData[key]);
                        return forms;
                    }
                }
            } catch (error) {
            }
            
            // Fallback to Firestore for admin
            const snapshot = await this.db.collection('forms').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        
        // For attendees, use pre-computed pending forms
        const currentUser = this.getCurrentUser();
        if (currentUser && currentUser.uid) {
            try {
                const forms = await this.getPendingForms(currentUser.uid);
                return forms || [];
            } catch (error) {
                return [];
            }
        }
        
        return [];
    },
    
    /**
     * Get all forms for admin (includes inactive)
     * Uses RTDB cache for cost optimization
     */
    async getAllForms() {
        // Try RTDB cache first
        try {
            const cacheRef = this.rtdb.ref('adminCache/forms');
            const cacheSnap = await new Promise((resolve, reject) => {
                cacheRef.once('value', resolve, reject);
            });
            
            if (cacheSnap.exists()) {
                const cacheData = cacheSnap.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                const now = Date.now();
                const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                
                // Use cache if not stale
                if (now - lastUpdated < staleThreshold) {
                    // Convert object to array, exclude lastUpdated
                    const forms = Object.keys(cacheData)
                        .filter(key => key !== 'lastUpdated')
                        .map(key => cacheData[key]);
                    return forms;
                }
            }
        } catch (error) {
        }
        
        // Fallback to Firestore
        const snapshot = await this.db.collection('forms').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    
    async getForm(formId) {
        // Try memory cache first (session-scoped, fastest)
        const memoryKey = `form:${formId}`;
        const memoryCached = MemoryCache.get(memoryKey);
        if (memoryCached) {
            this._cacheMetrics.hits++;
            return memoryCached;
        }
        
        // Check for pending request (request deduplication)
        const requestKey = `getForm:${formId}`;
        if (this._pendingRequests.has(requestKey)) {
            // Return the same promise if request is already in flight
            return this._pendingRequests.get(requestKey);
        }
        
        // Create new request promise
        const requestPromise = (async () => {
            try {
                // Try RTDB cache (adminCache/forms) to avoid Firestore reads
                try {
                    const cacheRef = this.rtdb.ref('adminCache/forms');
                    const cacheSnap = await cacheRef.once('value');
                    if (cacheSnap.exists()) {
                        const cacheData = cacheSnap.val();
                        const lastUpdated = cacheData.lastUpdated || 0;
                        const now = Date.now();
                        // Check if cache is fresh (within 10 minutes)
                        if (now - lastUpdated < 10 * 60 * 1000 && cacheData[formId]) {
                            const form = { id: formId, ...cacheData[formId] };
                            // Cache in memory for faster subsequent access
                            MemoryCache.set(memoryKey, form, 15 * 60 * 1000); // 15 minutes TTL
                            this._cacheMetrics.hits++;
                            this._cacheMetrics.rtdbReads++;
                            return form;
                        }
                    }
                } catch (error) {
                    // Cache read failed, fall through to Firestore
                }
                
                // Fallback to Firestore if cache miss or stale
                this._cacheMetrics.misses++;
                this._cacheMetrics.firestoreReads++;
                try {
                    const doc = await this.db.collection('forms').doc(formId).get();
                    if (doc.exists) {
                        const form = { id: doc.id, ...doc.data() };
                        // Cache in memory if found
                        MemoryCache.set(memoryKey, form, 15 * 60 * 1000); // 15 minutes TTL
                        return form;
                    }
                    return null;
                } catch (error) {
                    console.error('Error getting form:', error);
                    return null;
                }
            } finally {
                // Remove from pending requests when done
                this._pendingRequests.delete(requestKey);
            }
        })();
        
        // Store pending request
        this._pendingRequests.set(requestKey, requestPromise);
        
        return requestPromise;
    },
    
    async submitForm(formSubmission) {
        // Submit to formSubmissions collection
        // Note: Don't update forms collection here - attendees don't have write permissions
        // The Cloud Function onFormSubmissionCreate will update the cache with submission counts
        
        // Validate formData before submission
        if (!formSubmission.formData || typeof formSubmission.formData !== 'object') {
            console.error(`[DB.submitForm] ERROR: formData is invalid:`, formSubmission.formData);
            throw new Error('Form data is invalid or missing');
        }
        
        const formDataKeys = Object.keys(formSubmission.formData);
        if (formDataKeys.length === 0) {
            console.error(`[DB.submitForm] ERROR: formData is empty object!`);
            console.error(`[DB.submitForm] Full submission object:`, formSubmission);
            throw new Error('Form data is empty. Please ensure all form fields are properly filled.');
        }
        
        // Ensure formData is properly included and not empty
        // Create a clean object to avoid any serialization issues
        const submissionData = {
            userId: formSubmission.userId,
            userName: formSubmission.userName,
            formId: formSubmission.formId,
            formTitle: formSubmission.formTitle,
            formData: { ...formSubmission.formData }, // Create a new object to ensure it's serializable
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        try {
            const docRef = await this.db.collection('formSubmissions').add(submissionData);
            return { id: docRef.id, ...submissionData };
        } catch (error) {
            console.error(`[DB.submitForm] Error saving form submission:`, error);
            console.error(`[DB.submitForm] Submission data that failed:`, submissionData);
            throw error;
        }
    },
    
    async getFormSubmissions(userId = null, formId = null) {
        let query = this.db.collection('formSubmissions');
        
        if (userId) {
            query = query.where('userId', '==', userId);
        }
        if (formId) {
            query = query.where('formId', '==', formId);
        }
        
        const snapshot = await query.orderBy('submittedAt', 'desc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    
    // Points Operations
    async addPoints(userId, points, reason) {
        if (!userId) {
            throw new Error('User ID is required to award points');
        }
        if (!points || points <= 0) {
            throw new Error('Points must be a positive number');
        }
        
        try {
            const userRef = this.db.collection('users').doc(userId);
            
            // Verify user exists before updating
            const userDoc = await userRef.get();
            if (!userDoc.exists) {
                throw new Error(`User with ID ${userId} not found`);
            }
            
            // Update points
            await userRef.update({
                points: firebase.firestore.FieldValue.increment(points)
            });
            
            // Clear caches that depend on points
            Cache.clear(Cache.keys.userData(userId));
            Cache.clear(Cache.keys.userRank(userId));
            Cache.clear(Cache.keys.leaderboard());
            
        } catch (error) {
            console.error('Error adding points:', error);
            throw error; // Re-throw to let caller handle
        }
        
        // Get updated user (will be cached)
        return await this.getUser(userId, false);
    },
    
    // Attendee Cache Operations (RTDB)
    
    /**
     * Get attendee activities from RTDB cache (quizzes, tasks, forms)
     * Uses pre-computed pending activities list
     * No Firestore fallback to save costs
     */
    async getAttendeeActivities(useCache = true, skipBackgroundRefresh = false) {
        const currentUser = this.getCurrentUser();
        if (!currentUser || !currentUser.uid) {
            return { quizzes: [], tasks: [], forms: [] };
        }
        
        // Use pre-computed pending activities (new architecture)
        try {
            const pending = await this.getPendingActivities(currentUser.uid);
            
            // Convert combined list back to separate arrays for backward compatibility
            const result = {
                quizzes: pending.filter(item => item.itemType === 'quiz' || !item.itemType),
                tasks: pending.filter(item => item.itemType === 'task'),
                forms: pending.filter(item => item.itemType === 'form')
            };
            
            // Remove itemType for backward compatibility
            result.quizzes = result.quizzes.map(q => {
                const { itemType, ...rest } = q;
                return rest;
            });
            result.tasks = result.tasks.map(t => {
                const { itemType, ...rest } = t;
                return rest;
            });
            result.forms = result.forms.map(f => {
                const { itemType, ...rest } = f;
                return rest;
            });
            
            return result;
        } catch (error) {
            console.error('Error getting pending activities:', error);
            // Return empty result - no Firestore fallback
            return {
                quizzes: [],
                tasks: [],
                forms: [],
                error: 'Activities cache not available. Please refresh in a moment or contact admin.'
            };
        }
    },
    
    /**
     * Get user completion status from RTDB cache (indexed structure)
     * Uses cache/users/{uid}/completions
     * No Firestore fallback to save costs
     */
    async getUserCompletionStatus(userId, useCache = true, skipBackgroundRefresh = false) {
        if (!userId) {
            return { quizzes: {}, tasks: {}, forms: {} };
        }
        
        try {
            const result = await this.readFromCache(`users/${userId}/completions`, {
                useLocalStorage: useCache,
                ttl: 5 * 60 * 1000 // 5 minutes
            });
            
            if (result && result.data) {
                const completionData = result.data;
                if (typeof completionData === 'object' && completionData !== null) {
                    // Handle backward compatibility - migrate 'quizs' to 'quizzes'
                    if (completionData.quizs && !completionData.quizzes) {
                        completionData.quizzes = completionData.quizs;
                        delete completionData.quizs;
                    }
                    
                    // Ensure quizzes, tasks, forms exist
                    if (!completionData.quizzes) completionData.quizzes = {};
                    if (!completionData.tasks) completionData.tasks = {};
                    if (!completionData.forms) completionData.forms = {};
                    
                    return completionData;
                }
            }
            
            // Return empty result - no Firestore fallback
            return {
                quizzes: {},
                tasks: {},
                forms: {},
                lastUpdated: Date.now(),
                error: 'Completion status cache not available. Please refresh in a moment.',
                fromCache: false
            };
        } catch (error) {
            console.error(`[getUserCompletionStatus] Error reading completion status for ${userId}:`, error);
            return {
                quizzes: {},
                tasks: {},
                forms: {},
                lastUpdated: Date.now(),
                error: error.message,
                fromCache: false
            };
        }
        
        const completionData = {
            quizzes: {},
            tasks: {},
            forms: {},
            lastUpdated: Date.now()
        };
        
        quizSubmissions.forEach(s => {
            if (s.quizId) {
                completionData.quizzes[s.quizId] = {
                    completed: true,
                    score: s.score || 0,
                    totalScore: s.totalScore || 0,
                    submittedAt: s.submittedAt ? (s.submittedAt.toMillis ? s.submittedAt.toMillis() : s.submittedAt) : Date.now()
                };
            }
        });
        
        // Keep most recent task submission
        const taskCompletions = {};
        taskSubmissions.forEach(s => {
            if (s.taskId) {
                const submittedAt = s.submittedAt ? (s.submittedAt.toMillis ? s.submittedAt.toMillis() : s.submittedAt) : 0;
                if (!taskCompletions[s.taskId] || submittedAt > (taskCompletions[s.taskId].submittedAt || 0)) {
                    taskCompletions[s.taskId] = {
                        completed: true,
                        status: s.status || 'pending',
                        submittedAt: submittedAt
                    };
                }
            }
        });
        completionData.tasks = taskCompletions;
        
        formSubmissions.forEach(s => {
            if (s.formId) {
                completionData.forms[s.formId] = {
                    completed: true,
                    submittedAt: s.submittedAt ? (s.submittedAt.toMillis ? s.submittedAt.toMillis() : s.submittedAt) : Date.now()
                };
            }
        });
        
        // Cache in localStorage for faster subsequent access
        Cache.set(`cache_completion_${userId}`, completionData, 'USER_DATA');
        return completionData;
    },
    
    /**
     * Get user statistics from RTDB cache (pre-computed)
     * Uses cache/users/{uid}/stats
     * No Firestore fallback to save costs
     */
    async getUserStats(userId, useCache = true) {
        if (!userId) return null;
        
        // Try new pre-computed cache structure first (cache/users/{userId}/stats)
        let result = await this.readFromCache(`users/${userId}/stats`, {
            useLocalStorage: useCache,
            ttl: 5 * 60 * 1000 // 5 minutes
        });
        
        // If not found, try old path (attendeeCache/userStats/{userId})
        if (!result.data) {
            result = await this.readFromCache(`attendeeCache/userStats/${userId}`, {
                useLocalStorage: useCache,
                ttl: 5 * 60 * 1000
            });
        }
        
        if (result.data) {
            return result.data;
        }
        
        // Return default stats - no Firestore fallback
        return {
            totalPoints: 0,
            rank: 1,
            quizzesCompleted: 0,
            tasksCompleted: 0,
            formsCompleted: 0,
            pendingSubmissions: 0,
            approvedSubmissions: 0,
            rejectedSubmissions: 0,
            lastUpdated: Date.now(),
            error: 'User stats cache not available. Please refresh in a moment.',
            fromCache: false
        };
    },
    
    /**
     * Get activity metadata from RTDB cache
     * Falls back to Firestore if cache is unavailable
     */
    async getActivityMetadata(useCache = true) {
        // Try RTDB cache first
        if (useCache) {
            try {
                const cacheRef = this.rtdb.ref('attendeeCache/activityMetadata');
                const cacheSnap = await new Promise((resolve, reject) => {
                    cacheRef.once('value', resolve, reject);
                });
                
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    const staleThreshold = 15 * 60 * 1000; // 15 minutes (increased from 10)
                    
                    // Use cache if not stale
                    if (now - lastUpdated < staleThreshold) {
                        return cacheData;
                    }
                }
            } catch (error) {
            }
        }
        
        // Fallback: calculate from Firestore
        const [quizzes, tasks, forms] = await Promise.all([
            this.getQuizzes(false, false),
            this.getTasks(false, false),
            this.getForms(false)
        ]);
        
        return {
            quizzes: {
                count: quizzes.length,
                totalPoints: quizzes.reduce((sum, q) => sum + (q.totalPoints || 0), 0)
            },
            tasks: {
                count: tasks.length,
                totalPoints: tasks.reduce((sum, t) => sum + (t.points || 0), 0)
            },
            forms: {
                count: forms.length,
                totalPoints: forms.reduce((sum, f) => sum + (f.points || 0), 0)
            },
            totalPoints: quizzes.reduce((sum, q) => sum + (q.totalPoints || 0), 0) +
                         tasks.reduce((sum, t) => sum + (t.points || 0), 0) +
                         forms.reduce((sum, f) => sum + (f.points || 0), 0),
            lastUpdated: Date.now()
        };
    },
    
    // Batch Operations for Optimization
    
    /**
     * Batch get users by IDs (max 10 per batch due to Firestore 'in' operator limit)
     * @param {string[]} userIds - Array of user IDs (will be deduplicated)
     * @returns {Promise<Map<string, Object>>} Map of userId to user data
     */
    async getUsersBatch(userIds) {
        if (!userIds || userIds.length === 0) {
            return new Map();
        }
        
        // Deduplicate IDs
        const uniqueIds = [...new Set(userIds.filter(id => id))];
        if (uniqueIds.length === 0) {
            return new Map();
        }
        
        const usersMap = new Map();
        const batchSize = 10;
        
        // Process in batches
        for (let i = 0; i < uniqueIds.length; i += batchSize) {
            const batch = uniqueIds.slice(i, i + batchSize);
            if (batch.length === 0) continue;
            
            try {
                const snapshot = await this.db.collection('users')
                    .where(firebase.firestore.FieldPath.documentId(), 'in', batch)
                    .get();
                
                snapshot.docs.forEach(doc => {
                    usersMap.set(doc.id, { uid: doc.id, ...doc.data() });
                });
            } catch (error) {
                console.error(`Error loading batch of users:`, error, batch);
                // Continue with next batch on error
            }
        }
        
        return usersMap;
    },
    
    /**
     * Batch get tasks by IDs (max 10 per batch due to Firestore 'in' operator limit)
     * Uses RTDB cache first, falls back to Firestore batch read
     * @param {string[]} taskIds - Array of task IDs (will be deduplicated)
     * @returns {Promise<Map<string, Object>>} Map of taskId to task data
     */
    async getTasksBatch(taskIds) {
        if (!taskIds || taskIds.length === 0) {
            return new Map();
        }
        
        // Deduplicate IDs
        const uniqueIds = [...new Set(taskIds.filter(id => id))];
        if (uniqueIds.length === 0) {
            return new Map();
        }
        
        const tasksMap = new Map();
        
        // Try RTDB cache first for each task
        const cachePromises = uniqueIds.map(async (taskId) => {
            try {
                const cacheRef = this.rtdb.ref('adminCache/tasks');
                const cacheSnap = await cacheRef.once('value');
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    if (now - lastUpdated < 10 * 60 * 1000 && cacheData[taskId]) {
                        return { id: taskId, data: { id: taskId, ...cacheData[taskId] } };
                    }
                }
            } catch (error) {
                // Cache read failed, will fall back to Firestore
            }
            return { id: taskId, data: null };
        });
        
        const cacheResults = await Promise.all(cachePromises);
        const missingIds = cacheResults
            .filter(r => !r.data)
            .map(r => r.id);
        
        // Add cached results to map
        cacheResults.forEach(r => {
            if (r.data) {
                tasksMap.set(r.id, r.data);
            }
        });
        
        // Batch load missing tasks from Firestore
        if (missingIds.length > 0) {
            const batchSize = 10;
            for (let i = 0; i < missingIds.length; i += batchSize) {
                const batch = missingIds.slice(i, i + batchSize);
                if (batch.length === 0) continue;
                
                try {
                    const snapshot = await this.db.collection('tasks')
                        .where(firebase.firestore.FieldPath.documentId(), 'in', batch)
                        .get();
                    
                    snapshot.docs.forEach(doc => {
                        tasksMap.set(doc.id, { id: doc.id, ...doc.data() });
                    });
                } catch (error) {
                    console.error(`Error loading batch of tasks:`, error, batch);
                    // Continue with next batch on error
                }
            }
        }
        
        return tasksMap;
    },
    
    /**
     * Batch get forms by IDs (max 10 per batch due to Firestore 'in' operator limit)
     * Uses RTDB cache first, falls back to Firestore batch read
     * @param {string[]} formIds - Array of form IDs (will be deduplicated)
     * @returns {Promise<Map<string, Object>>} Map of formId to form data
     */
    async getFormsBatch(formIds) {
        if (!formIds || formIds.length === 0) {
            return new Map();
        }
        
        // Deduplicate IDs
        const uniqueIds = [...new Set(formIds.filter(id => id))];
        if (uniqueIds.length === 0) {
            return new Map();
        }
        
        const formsMap = new Map();
        
        // Try RTDB cache first for each form
        const cachePromises = uniqueIds.map(async (formId) => {
            try {
                const cacheRef = this.rtdb.ref('adminCache/forms');
                const cacheSnap = await cacheRef.once('value');
                if (cacheSnap.exists()) {
                    const cacheData = cacheSnap.val();
                    const lastUpdated = cacheData.lastUpdated || 0;
                    const now = Date.now();
                    if (now - lastUpdated < 10 * 60 * 1000 && cacheData[formId]) {
                        return { id: formId, data: { id: formId, ...cacheData[formId] } };
                    }
                }
            } catch (error) {
                // Cache read failed, will fall back to Firestore
            }
            return { id: formId, data: null };
        });
        
        const cacheResults = await Promise.all(cachePromises);
        const missingIds = cacheResults
            .filter(r => !r.data)
            .map(r => r.id);
        
        // Add cached results to map
        cacheResults.forEach(r => {
            if (r.data) {
                formsMap.set(r.id, r.data);
            }
        });
        
        // Batch load missing forms from Firestore
        if (missingIds.length > 0) {
            const batchSize = 10;
            for (let i = 0; i < missingIds.length; i += batchSize) {
                const batch = missingIds.slice(i, i + batchSize);
                if (batch.length === 0) continue;
                
                try {
                    const snapshot = await this.db.collection('forms')
                        .where(firebase.firestore.FieldPath.documentId(), 'in', batch)
                        .get();
                    
                    snapshot.docs.forEach(doc => {
                        formsMap.set(doc.id, { id: doc.id, ...doc.data() });
                    });
                } catch (error) {
                    console.error(`Error loading batch of forms:`, error, batch);
                    // Continue with next batch on error
                }
            }
        }
        
        return formsMap;
    },
    
    /**
     * Batch load full submissions from Firestore (max 10 per batch)
     * Searches across submissions, formSubmissions, and quizSubmissions collections
     * @param {string[]} submissionIds - Array of submission IDs (will be deduplicated)
     * @returns {Promise<Map<string, Object>>} Map of submissionId to submission data
     */
    async loadFullSubmissionsBatch(submissionIds) {
        if (!submissionIds || submissionIds.length === 0) {
            return new Map();
        }
        
        // Deduplicate IDs
        const uniqueIds = [...new Set(submissionIds.filter(id => id))];
        if (uniqueIds.length === 0) {
            return new Map();
        }
        
        const submissionsMap = new Map();
        const batchSize = 10;
        
        // Process in batches
        for (let i = 0; i < uniqueIds.length; i += batchSize) {
            const batch = uniqueIds.slice(i, i + batchSize);
            if (batch.length === 0) continue;
            
            try {
                // Try submissions collection first
                const submissionsSnapshot = await this.db.collection('submissions')
                    .where(firebase.firestore.FieldPath.documentId(), 'in', batch)
                    .get();
                
                submissionsSnapshot.docs.forEach(doc => {
                    submissionsMap.set(doc.id, { id: doc.id, ...doc.data() });
                });
                
                // Check which IDs weren't found in submissions
                const foundIds = new Set(submissionsSnapshot.docs.map(d => d.id));
                const missingIds = batch.filter(id => !foundIds.has(id));
                
                if (missingIds.length > 0) {
                    // Try formSubmissions collection
                    const formSubmissionsSnapshot = await this.db.collection('formSubmissions')
                        .where(firebase.firestore.FieldPath.documentId(), 'in', missingIds)
                        .get();
                    
                    formSubmissionsSnapshot.docs.forEach(doc => {
                        submissionsMap.set(doc.id, { id: doc.id, ...doc.data() });
                    });
                    
                    // Check which IDs still weren't found
                    const formFoundIds = new Set(formSubmissionsSnapshot.docs.map(d => d.id));
                    const stillMissingIds = missingIds.filter(id => !formFoundIds.has(id));
                    
                    if (stillMissingIds.length > 0) {
                        // Try quizSubmissions collection
                        const quizSubmissionsSnapshot = await this.db.collection('quizSubmissions')
                            .where(firebase.firestore.FieldPath.documentId(), 'in', stillMissingIds)
                            .get();
                        
                        quizSubmissionsSnapshot.docs.forEach(doc => {
                            submissionsMap.set(doc.id, { id: doc.id, ...doc.data() });
                        });
                    }
                }
            } catch (error) {
                console.error(`Error loading batch of submissions:`, error, batch);
                // Continue with next batch on error
            }
        }
        
        return submissionsMap;
    },
    
    /**
     * Batch update submissions using Firestore batch writes (max 500 operations per batch)
     * @param {Array<{id: string, collection: string, data: Object}>} updates - Array of update objects
     * @returns {Promise<void>}
     */
    async batchUpdateSubmissions(updates) {
        if (!updates || updates.length === 0) {
            return;
        }
        
        const batchSize = 500; // Firestore batch write limit
        
        // Process in batches
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            if (batch.length === 0) continue;
            
            try {
                const firestoreBatch = this.db.batch();
                
                batch.forEach(update => {
                    if (!update.id || !update.collection || !update.data) {
                        console.warn('Invalid update object:', update);
                        return;
                    }
                    
                    const docRef = this.db.collection(update.collection).doc(update.id);
                    firestoreBatch.update(docRef, update.data);
                });
                
                await firestoreBatch.commit();
            } catch (error) {
                console.error(`Error in batch update:`, error, batch);
                throw error; // Re-throw to let caller handle
            }
        }
    },
    
    // Invalidate caches when data changes
    invalidateCache(type) {
        switch(type) {
            case 'quiz':
                Cache.clear(Cache.keys.quizList());
                break;
            case 'task':
                Cache.clear(Cache.keys.taskList());
                break;
            case 'form':
                Cache.clear('cache_forms_list');
                break;
            case 'leaderboard':
                Cache.clear(Cache.keys.leaderboard());
                // Also clear all user ranks
                const currentUser = this.getCurrentUser();
                if (currentUser) {
                    Cache.clear(Cache.keys.userRank(currentUser.uid));
                }
                break;
            case 'user':
                const currentUserForCache = this.getCurrentUser();
                if (currentUserForCache) {
                    Cache.clear(Cache.keys.userData(currentUserForCache.uid));
                    Cache.clear(Cache.keys.userRank(currentUserForCache.uid));
                }
                break;
            case 'all':
                Cache.clearAll();
                break;
        }
    }
};

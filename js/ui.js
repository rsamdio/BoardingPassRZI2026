// UI Rendering Module
const UI = {
    navigateTo(viewId) {
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
        });
        const target = document.getElementById(`view-${viewId}`);
        if(target) target.classList.add('active');

        document.querySelectorAll('.nav-btn').forEach(btn => {
            const icon = btn.querySelector('.nav-icon');
            const text = btn.querySelector('.nav-text');
            const bg = btn.querySelector('.nav-icon-bg');
            
            if (btn.dataset.target === viewId) {
                icon.classList.remove('text-slate-300');
                icon.classList.add('text-rota-pink');
                text.classList.remove('text-slate-400');
                text.classList.add('text-rota-pink');
                bg.classList.add('bg-rose-50');
            } else {
                icon.classList.add('text-slate-300');
                icon.classList.remove('text-rota-pink');
                text.classList.add('text-slate-400');
                text.classList.remove('text-rota-pink');
                bg.classList.remove('bg-rose-50');
            }
        });
        
        // Load data when navigating to specific views
        if (!Auth.currentUser) return;
        
        if (viewId === 'activities') {
            // Load activities data when navigating to activities view
            // First ensure the view is set up, then load data
            setTimeout(() => {
                this.renderActivities().catch(err => {
                    console.error('Error loading activities:', err);
                });
                // Set default tab to quizzes if not already set
                const quizzesTab = document.getElementById('tab-btn-quizzes');
                const quizzesContent = document.getElementById('activity-content-quizzes');
                if (quizzesTab && quizzesContent && quizzesContent.classList.contains('hidden')) {
                    this.switchActivityTab('quizzes');
                } else if (quizzesTab && !quizzesTab.classList.contains('bg-rota-pink')) {
                    this.switchActivityTab('quizzes');
                }
            }, 100);
        } else if (viewId === 'home') {
            // Ensure home data is loaded
            this.renderHome().catch(err => {
                console.error('Error loading home:', err);
            });
        } else if (viewId === 'directory') {
            // Ensure directory data is loaded
            this.renderDirectory().catch(err => {
                console.error('Error loading directory:', err);
            });
        } else if (viewId === 'profile') {
            // Ensure profile data is loaded
            // Add a small delay to ensure view is visible
            setTimeout(() => {
                this.renderProfile().catch(err => {
                    console.error('Error loading profile:', err);
                });
            }, 100);
        }
    },
    
    renderHeader() {
        if(!Auth.currentUser) return;
        document.getElementById('header-points').innerText = Auth.currentUser.points || 0;
        document.getElementById('header-avatar').src = this.getUserPhoto(Auth.currentUser);
    },
    
    /**
     * Get user photo URL (prioritizes Google photoURL, then fallback)
     * @param {Object} user - User object
     * @returns {string} Photo URL
     */
    getUserPhoto(user) {
        if (!user) return 'https://ui-avatars.com/api/?name=User';
        // Use photoURL (from Google auth) or photo (from RTDB cache) or fallback to generated avatar
        return user.photoURL || user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}`;
    },
    
    async renderHome() {
        if(!Auth.currentUser) return;
        
        // Show skeleton loaders immediately for better perceived performance
        const heroRankEl = document.getElementById('hero-rank');
        const heroPointsEl = document.getElementById('hero-points-display');
        if (heroRankEl) heroRankEl.innerText = '#--';
        if (heroPointsEl) heroPointsEl.innerText = '0 pts';
        
        // Fetch user stats from RTDB cache (parallel)
        const [myRank, userStats] = await Promise.all([
            DB.getUserRank(Auth.currentUser.uid),
            DB.getUserStats(Auth.currentUser.uid)
        ]);
        
        // Update rank and points
        if (heroRankEl) heroRankEl.innerText = `#${myRank || '--'}`;
        const points = userStats?.totalPoints || Auth.currentUser.points || 0;
        if (heroPointsEl) heroPointsEl.innerText = `${points} pts`;
        
        
        // Render quick stats cards
        this.renderQuickStats(userStats);
        
        // Render achievement badges
        this.renderAchievementBadges(userStats);
        
        // Clear submissions cache to ensure fresh data (especially after admin actions)
        Cache.clear(Cache.keys.submissions(Auth.currentUser.uid));
        
        // Set up real-time listeners
        this.setupRealtimeListeners();
        
        // Load home sections in parallel for faster rendering
        await this.renderPendingActivities();
    },
    
    /**
     * Render quick stats cards (completed quizzes, tasks, forms)
     */
    renderQuickStats(userStats) {
        const quickStatsEl = document.getElementById('quick-stats');
        if (!quickStatsEl) return;
        
        const stats = userStats || {
            quizzesCompleted: 0,
            tasksCompleted: 0,
            formsCompleted: 0
        };
        
        quickStatsEl.innerHTML = `
            <div class="bg-white/20 backdrop-blur-md rounded-lg p-2 text-center border border-white/10">
                <div class="text-lg font-bold">${stats.quizzesCompleted || 0}</div>
                <div class="text-[10px] text-white/80">Quizzes</div>
            </div>
            <div class="bg-white/20 backdrop-blur-md rounded-lg p-2 text-center border border-white/10">
                <div class="text-lg font-bold">${stats.tasksCompleted || 0}</div>
                <div class="text-[10px] text-white/80">Tasks</div>
            </div>
            <div class="bg-white/20 backdrop-blur-md rounded-lg p-2 text-center border border-white/10">
                <div class="text-lg font-bold">${stats.formsCompleted || 0}</div>
                <div class="text-[10px] text-white/80">Forms</div>
            </div>
        `;
    },
    
    /**
     * Render achievement badges
     */
    renderAchievementBadges(userStats) {
        const badgesEl = document.getElementById('achievement-badges');
        if (!badgesEl) return;
        
        const stats = userStats || {};
        const badges = [];
        
        // First quiz completed
        if (stats.quizzesCompleted > 0) {
            badges.push({ icon: 'fa-puzzle-piece', color: 'from-purple-500 to-pink-500', text: 'Quiz Master' });
        }
        
        // First task completed
        if (stats.tasksCompleted > 0) {
            badges.push({ icon: 'fa-tasks', color: 'from-orange-500 to-red-500', text: 'Task Hero' });
        }
        
        // First form completed
        if (stats.formsCompleted > 0) {
            badges.push({ icon: 'fa-file-alt', color: 'from-blue-500 to-green-500', text: 'Form Filler' });
        }
        
        // Top 10 rank
        if (stats.rank && stats.rank <= 10) {
            badges.push({ icon: 'fa-trophy', color: 'from-yellow-500 to-orange-500', text: 'Top 10' });
        }
        
        if (badges.length === 0) {
            badgesEl.innerHTML = '<span class="text-xs text-white/60">Complete activities to earn badges!</span>';
            return;
        }
        
        badgesEl.innerHTML = badges.map(badge => `
            <div class="bg-gradient-to-r ${badge.color} text-white text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1">
                <i class="fas ${badge.icon}"></i>
                <span>${badge.text}</span>
            </div>
        `).join('');
    },
    
    /**
     * Set up RTDB listeners for real-time updates
     */
    setupRealtimeListeners() {
        if (!Auth.currentUser) return;
        
        // Clean up existing listeners to prevent duplicates
        if (this._realtimeListeners) {
            this.cleanupRealtimeListeners();
        }
        
        this._realtimeListeners = {};
        const userId = Auth.currentUser.uid;
        
        // Listen for pre-computed list updates (version changes trigger refresh)
        const pendingMetadataRef = DB.rtdb.ref(`cache/users/${userId}/pendingActivities/metadata`);
        // Restore last version from cache to prevent null on re-init
        const cachedVersion = Cache.get(`pending_activities_version_${userId}`);
        let lastPendingVersion = cachedVersion || null;
        let lastPendingTimestamp = null;
        
        const pendingMetadataListener = (snapshot) => {
            if (snapshot.exists()) {
                const metadata = snapshot.val();
                const currentVersion = metadata.version || 0;
                const currentTimestamp = metadata.lastUpdated || 0;
                
                // Check if version changed (simplified - version is sufficient)
                // Also handle first-time initialization (lastPendingVersion is null)
                const isFirstTime = lastPendingVersion === null;
                const versionChanged = lastPendingVersion !== null && lastPendingVersion !== currentVersion;
                
                if (isFirstTime || versionChanged) {
                    // Clear cache to force fresh fetch
                    const cacheKey = `rtdb_cache_cache_users_${userId}_pendingActivities_combined`;
                    Cache.clear(cacheKey);
                    
                    // Refresh pending activities immediately
                    this.renderPendingActivities();
                }
                
                lastPendingVersion = currentVersion;
                Cache.set(`pending_activities_version_${userId}`, currentVersion, 'SYSTEM');
            }
        };
        
        pendingMetadataRef.on('value', pendingMetadataListener, (error) => {
            console.error('Error listening to pending activities updates:', error);
        });
        
        this._realtimeListeners.pendingMetadata = { ref: pendingMetadataRef, listener: pendingMetadataListener };
        
        // Listen directly to the combined list for immediate updates
        // This handles the case where data appears for the first time (new user)
        const pendingListRef = DB.rtdb.ref(`cache/users/${userId}/pendingActivities/combined`);
        let lastPendingListExists = false;
        const pendingListListener = (snapshot) => {
            const exists = snapshot.exists();
            const dataCount = exists ? (Array.isArray(snapshot.val()) ? snapshot.val().length : Object.keys(snapshot.val() || {}).length) : 0;
            
            // If data just appeared (wasn't there before, now it is), trigger render
            // This handles the new user case where cache is created after initial load
            if (exists && !lastPendingListExists && dataCount > 0) {
                // Clear cache to force fresh fetch
                const cacheKey = `rtdb_cache_cache_users_${userId}_pendingActivities_combined`;
                Cache.clear(cacheKey);
                
                // Trigger render immediately
                this.renderPendingActivities();
            }
            
            lastPendingListExists = exists;
            
            if (snapshot.exists()) {
                // Version-based change detection is handled by metadata listener above
                // This listener is kept for redundancy but simplified
                const cacheKey = `rtdb_cache_cache_users_${userId}_pendingActivities_combined`;
                Cache.clear(cacheKey);
                // Metadata listener will trigger renderPendingActivities
            }
        };
        
        pendingListRef.on('value', pendingListListener, (error) => {
            console.error('Error listening to pending activities list:', error);
        });
        
        this._realtimeListeners.pendingList = { ref: pendingListRef, listener: pendingListListener };
        
        // Listen for completed activities updates
        const completedMetadataRef = DB.rtdb.ref(`cache/users/${userId}/completedActivities/metadata`);
        let lastCompletedVersion = null;
        completedMetadataRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const metadata = snapshot.val();
                const currentVersion = metadata.version || 0;
                // Check if version changed (including initial load)
                if (lastCompletedVersion !== null && lastCompletedVersion !== currentVersion) {
                    // Clear cache to force fresh fetch
                    const cacheKey = `rtdb_cache_cache_users_${userId}_completedActivities_combined`;
                    Cache.clear(cacheKey);
                    // Refresh activities tab if it's active
                    const activeTab = document.querySelector('.activity-tab.active')?.id;
                    if (activeTab === 'tab-btn-all' || activeTab === 'tab-btn-quizzes' || activeTab === 'tab-btn-tasks' || activeTab === 'tab-btn-forms') {
                        this.renderActivities();
                    }
                }
                lastCompletedVersion = currentVersion;
                Cache.set(`completed_activities_version_${userId}`, currentVersion, 'SYSTEM');
            }
        }, (error) => {
            console.error('Error listening to completed activities updates:', error);
        });
        
        // Listen for user stats changes (pre-computed)
        const statsRef = DB.rtdb.ref(`cache/users/${userId}/stats`);
        statsRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const stats = snapshot.val();
                // Update points display
                const pointsEl = document.getElementById('hero-points-display');
                if (pointsEl) {
                    pointsEl.innerText = `${stats.totalPoints || 0} pts`;
                }
                // Update header points
                const headerPointsEl = document.getElementById('header-points');
                if (headerPointsEl) {
                    headerPointsEl.innerText = stats.totalPoints || 0;
                }
                // Update Auth.currentUser points
                if (Auth.currentUser) {
                    Auth.currentUser.points = stats.totalPoints || 0;
                }
            }
        }, (error) => {
            console.error('Error listening to user stats updates:', error);
        });
        
        // Listen for rank changes (indexed)
        const rankRef = DB.rtdb.ref(`cache/leaderboard/ranks/${userId}`);
        rankRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const rankData = snapshot.val();
                const rank = rankData.rank || 1;
                const rankEl = document.getElementById('hero-rank');
                if (rankEl) {
                    rankEl.innerText = `#${rank}`;
                }
                // Update localStorage cache
                Cache.set(Cache.keys.userRank(userId), rank, 'RANK');
            }
        }, (error) => {
            console.error('Error listening to rank updates:', error);
        });
        
        // Listen for leaderboard updates (indexed)
        const leaderboardMetadataRef = DB.rtdb.ref('cache/leaderboard/metadata');
        leaderboardMetadataRef.on('value', (snapshot) => {
            // Leaderboard updated - cache will be refreshed when modal is opened
            Cache.clear(Cache.keys.leaderboard());
        }, (error) => {
            console.error('Error listening to leaderboard updates:', error);
        });
        
        // Listen for activities metadata (indexed structure version changes)
        // Listen to all activity types (quizzes, tasks, forms) for changes
        const activitiesMetadataRefs = [
            DB.rtdb.ref('cache/activities/quizzes/metadata'),
            DB.rtdb.ref('cache/activities/tasks/metadata'),
            DB.rtdb.ref('cache/activities/forms/metadata')
        ];
        
        // Track last metadata versions for each activity type
        const lastMetadataVersions = {
            quizzes: null,
            tasks: null,
            forms: null
        };
        
        const activitiesListener = (snapshot, activityType) => {
            if (snapshot.exists()) {
                const metadata = snapshot.val();
                const currentVersion = metadata.version || 0;
                const currentTimestamp = metadata.lastUpdated || 0;
                
                // Check if version or timestamp changed
                const lastVersion = lastMetadataVersions[activityType];
                const versionChanged = lastVersion !== null && lastVersion !== currentVersion;
                
                if (versionChanged) {
                    // Clear all pending activities cache keys to force fresh fetch
                    const cacheKey = `rtdb_cache_cache_users_${userId}_pendingActivities_combined`;
                    Cache.clear(cacheKey);
                    
                    // Always refresh if home or activities view is active
                const activeView = document.querySelector('.view-section.active')?.id;
                if (activeView === 'view-activities' || activeView === 'view-home') {
                    this.renderActivities();
                    this.renderPendingActivities();
                    } else {
                        // Even if not active, clear cache so next view shows fresh data
                        Cache.clear(cacheKey);
                }
            }
                
                lastMetadataVersions[activityType] = currentVersion;
            }
        };
        
        // Set up listeners for each activity type
        activitiesMetadataRefs.forEach((ref, index) => {
            const activityTypes = ['quizzes', 'tasks', 'forms'];
            const activityType = activityTypes[index];
            
            ref.on('value', (snapshot) => {
                activitiesListener(snapshot, activityType);
        }, (error) => {
                console.error(`Error listening to ${activityType} updates:`, error);
            });
        });
        
    },
    
    async renderPendingActivities() {
        const listEl = document.getElementById('home-task-list');
        if (!listEl || !Auth.currentUser) return;
        
        // Prevent multiple simultaneous loads
        if (this._pendingActivitiesLoading) {
            return;
        }
        this._pendingActivitiesLoading = true;
        
        try {
            // Just fetch pre-computed list (no filtering needed!)
            // The server-side pre-computation already handles all filtering correctly
            const pending = await DB.getPendingActivities(Auth.currentUser.uid);
            
            // Only filter by search (simple text matching)
            const searchTerm = document.getElementById('activity-search')?.value || '';
            const filtered = DB.filterBySearch(pending, searchTerm);
            
            // CRITICAL FIX: Trust the pre-computed list from server
            // The server already filters out:
            // - Completed quizzes/forms
            // - Tasks with status 'pending' or 'approved'
            // - Deleted activities (explicitly excluded)
            // Additional client-side filtering was causing issues with stale completion status
            
            // FALLBACK: Verify activities exist in indexed cache (safety check for deleted items)
            // If a task appears in the list but doesn't exist in indexed cache, it was deleted
            let verifiedFiltered = filtered;
            const tasksToVerify = filtered.filter(item => item.itemType === 'task' || item.taskId);
            if (tasksToVerify.length > 0) {
                try {
                    const tasksCache = await DB.readFromCache('activities/tasks/byId', {
                        useLocalStorage: false,
                        ttl: 0
                    });
                    const existingTaskIds = tasksCache.data ? Object.keys(tasksCache.data) : [];
                
                    // Filter out tasks that don't exist in indexed cache (they were deleted)
                    verifiedFiltered = filtered.filter(item => {
                        if (item.itemType === 'task' || item.taskId) {
                            const taskId = item.id || item.taskId;
                            return existingTaskIds.includes(taskId);
                        }
                        return true; // Keep non-tasks
                    });
                } catch (error) {
                    // Continue with original filtered list if verification fails
                }
            }
            
            // Map items to ensure proper structure
            const allItems = verifiedFiltered.map(item => {
                    // For tasks, check the type field to determine if it's a form task
                    const isFormTask = item.itemType === 'task' && item.type === 'form';
                    const baseItem = {
                        ...item,
                        itemType: item.itemType || 'task',
                        // Preserve the type field for tasks (form vs upload)
                        type: item.type || (item.itemType === 'task' ? 'upload' : undefined),
                        isTask: item.itemType === 'task',
                        desc: item.description || (item.itemType === 'quiz' ? 'Test your knowledge now!' : 'Complete this activity')
                    };
                    return baseItem;
                });
            
            this.renderPendingActivitiesList(allItems);
        } catch (error) {
            console.error('Error loading pending activities:', error);
            listEl.innerHTML = `
                <div class="p-8 text-center">
                    <p class="text-slate-500 text-sm">Failed to load activities. Please try again.</p>
                    <button onclick="UI.renderPendingActivities()" class="mt-2 text-rota-pink text-sm font-bold">Retry</button>
                </div>
            `;
        } finally {
            this._pendingActivitiesLoading = false;
        }
    },
    
    /**
     * Render the pending activities list
     * @param {Array} allItems - Array of pending activities
     */
    renderPendingActivitiesList(allItems) {
        const listEl = document.getElementById('home-task-list');
        if (!listEl) return;
        
        listEl.innerHTML = '';
        
        if (allItems.length === 0) {
            listEl.innerHTML = `
                <div class="p-8 text-center flex flex-col items-center">
                    <div class="w-12 h-12 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-3">
                        <i class="fas fa-check text-xl"></i>
                    </div>
                    <p class="text-slate-800 font-bold">All caught up!</p>
                    <p class="text-xs text-slate-500 mt-1">You've completed all pending missions.</p>
                </div>
            `;
            return;
        }
        
        allItems.forEach(item => {
            // Icon + button configuration per activity type
            // Use separate classes for background and icon color to keep the UI clean
            let iconBgClass = '';
            let iconColorClass = '';
            let iconGlyph = '';
            let btnText;
            let btnIcon;
            let action;

            if (item.itemType === 'quiz') {
                // Quizzes: purple puzzle icon
                iconGlyph = 'fa-puzzle-piece';
                iconBgClass = 'bg-violet-100';
                iconColorClass = 'text-violet-600';
                btnText = 'Start Quiz';
                btnIcon = 'fa-play';
                action = `Quiz.startQuiz('${item.id}')`;
            } else if (item.itemType === 'form' && item.isTask === false) {
                // This is a standalone form/survey (from forms collection)
                // Treat as survey: clipboard icon, cool blue tone
                iconGlyph = 'fa-clipboard-list';
                iconBgClass = 'bg-sky-100';
                iconColorClass = 'text-sky-600';
                btnText = 'Fill the Form';
                btnIcon = 'fa-pen';
                action = `Forms.openForm('${item.id}')`;
            } else if (item.itemType === 'task' && item.type === 'form') {
                // This is a task-type form (from tasks collection with type: 'form')
                // Differentiate from surveys with a green checklist icon
                iconGlyph = 'fa-list-check';
                iconBgClass = 'bg-emerald-100';
                iconColorClass = 'text-emerald-600';
                btnText = 'Fill Task Form';
                btnIcon = 'fa-pen';
                action = `Task.openFormModal('${item.id}')`;
            } else {
                // Upload tasks: camera/upload icon in brand pink
                iconGlyph = 'fa-camera';
                iconBgClass = 'bg-rose-100';
                iconColorClass = 'text-rota-pink';
                btnText = 'Upload Proof';
                btnIcon = 'fa-upload';
                action = `Task.openUploadModal('${item.id}')`;
            }
            
            const itemId = item.id || item.taskId || item.quizId || item.formId;
            const itemType = item.itemType || 'task';
            
            listEl.innerHTML += `
                <div class="pending-activity-card p-4 bg-white hover:bg-slate-50 transition-all duration-300 group animate-fade-in" 
                     data-activity-id="${itemId}" 
                     data-activity-type="${itemType}"
                     style="animation: fadeIn 0.3s ease-in;">
                    <div class="flex items-start gap-3 mb-3">
                        <div class="w-10 h-10 rounded-full ${iconBgClass} flex items-center justify-center shrink-0">
                            <i class="fas ${iconGlyph} ${iconColorClass}"></i>
                        </div>
                        <div class="flex-1">
                            <div class="flex justify-between items-start">
                                <h4 class="font-bold text-slate-800 text-sm">${item.title}</h4>
                                <span class="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200">+${item.points || item.totalPoints}</span>
                            </div>
                            <p class="text-xs text-slate-500 line-clamp-2 leading-relaxed mt-1">${item.description || item.desc}</p>
                        </div>
                    </div>
                    <button onclick="${action}" class="w-full py-2.5 rounded-lg bg-slate-100 text-slate-600 group-hover:bg-slate-800 group-hover:text-white font-bold text-xs transition-all flex items-center justify-center gap-2">
                        <i class="fas ${btnIcon}"></i> ${btnText}
                    </button>
                </div>
            `;
        });
    },
    
    async renderDirectory() {
        const grid = document.getElementById('directory-grid');
        if (!grid) return;
        
        // Show loading state
        grid.innerHTML = '<div class="col-span-2 text-center text-slate-500 py-8">Loading participants...</div>';
        
        try {
            // Get users from RTDB cache
            let users = await DB.getAllUsers();
            
            if (!users || users.length === 0) {
                grid.innerHTML = '<div class="col-span-2 text-center text-slate-500 py-8">No participants available. The directory cache may not be populated yet.</div>';
                const countEl = document.getElementById('directory-count');
                if (countEl) {
                    countEl.textContent = '0 participants';
                }
                return;
            }
            
            // Apply search filter only
            const searchTerm = document.getElementById('directory-search')?.value?.toLowerCase() || '';
            
            // Filter users by search term
            let filteredUsers = users.filter(u => {
                if (searchTerm && !u.name?.toLowerCase().includes(searchTerm) && 
                    !u.district?.toLowerCase().includes(searchTerm) && 
                    !u.designation?.toLowerCase().includes(searchTerm)) return false;
                return true;
            });
            
            // Sort users by points (default)
            filteredUsers.sort((a, b) => (b.points || 0) - (a.points || 0));
        
        // Pagination
        const itemsPerPage = 50;
        const currentPage = this.directoryCurrentPage || 1;
        const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const paginatedUsers = filteredUsers.slice(startIndex, startIndex + itemsPerPage);
        
        // Update count
        const countEl = document.getElementById('directory-count');
        if (countEl) {
            countEl.textContent = `${filteredUsers.length} participant${filteredUsers.length !== 1 ? 's' : ''}`;
        }
        
        // Render users - clear loading text first
        grid.innerHTML = ''; // Clear loading text
        
        if (paginatedUsers.length === 0) {
            grid.innerHTML = '<div class="col-span-2 text-center text-slate-500 py-8">No participants found</div>';
        } else {
            // Use DocumentFragment for better performance
            const fragment = document.createDocumentFragment();
            paginatedUsers.forEach(u => {
                const rank = filteredUsers.findIndex(user => user.uid === u.uid) + 1;
                const cardDiv = document.createElement('div');
                cardDiv.className = 'bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center text-center cursor-pointer hover:shadow-md transition-shadow';
                cardDiv.onclick = () => UI.showUserProfileModal(u.uid);
                cardDiv.innerHTML = `
                    <div class="relative mb-2">
                        <img src="${this.getUserPhoto(u)}" class="w-16 h-16 rounded-full object-cover border-2 ${rank <= 3 ? 'border-yellow-400' : 'border-white'} shadow-sm">
                        ${rank <= 3 ? `<div class="absolute -top-1 -right-1 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">${rank}</div>` : ''}
                    </div>
                    <h4 class="font-bold text-sm text-slate-800 leading-tight">${this.escapeHtml(u.name || '')}</h4>
                    <p class="text-[10px] uppercase font-bold text-rota-pink mt-1 mb-1">${this.escapeHtml(u.district || '')}</p>
                    <p class="text-xs text-slate-500 truncate w-full mb-1">${this.escapeHtml(u.designation || '')}</p>
                    <p class="text-xs font-bold text-rota-orange">${u.points || 0} pts</p>
                `;
                fragment.appendChild(cardDiv);
            });
            grid.appendChild(fragment);
        }
        
            // Render pagination
            this.renderDirectoryPagination(currentPage, totalPages);
        } catch (error) {
            console.error('Error rendering directory:', error);
            grid.innerHTML = '<div class="col-span-2 text-center text-slate-500 py-8">Failed to load participants. Please try again.</div>';
            const countEl = document.getElementById('directory-count');
            if (countEl) {
                countEl.textContent = 'Error loading participants';
            }
        }
    },
    
    
    /**
     * Render directory pagination
     */
    renderDirectoryPagination(currentPage, totalPages) {
        const paginationEl = document.getElementById('directory-pagination');
        if (!paginationEl) return;
        
        if (totalPages <= 1) {
            paginationEl.innerHTML = '';
            return;
        }
        
        paginationEl.innerHTML = `
            <button onclick="UI.goToDirectoryPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} 
                    class="px-3 py-1 rounded-lg border border-slate-200 text-sm font-bold ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span class="px-4 py-1 text-sm font-bold text-slate-600">Page ${currentPage} of ${totalPages}</span>
            <button onclick="UI.goToDirectoryPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} 
                    class="px-3 py-1 rounded-lg border border-slate-200 text-sm font-bold ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
    },
    
    /**
     * Go to directory page
     */
    goToDirectoryPage(page) {
        this.directoryCurrentPage = page;
        this.renderDirectory();
    },
    
    /**
     * Clear directory filters
     */
    clearDirectoryFilters() {
        document.getElementById('directory-search').value = '';
        this.directoryCurrentPage = 1;
        this.renderDirectory();
    },
    
    filterDirectory() {
        // Legacy function - now handled by renderDirectory
        this.renderDirectory();
    },
    
    /**
     * Show user profile modal
     */
    async showUserProfileModal(userId) {
        if (!userId) return;
        
        const modal = document.getElementById('modal-user-profile');
        if (!modal) return;
        
        // Fetch user data
        const [user, userStats] = await Promise.all([
            DB.getUser(userId),
            DB.getUserStats(userId)
        ]);
        
        if (!user) {
            Toast.error('User not found');
            return;
        }
        
        // Update modal content
        document.getElementById('profile-modal-photo').src = this.getUserPhoto(user);
        document.getElementById('profile-modal-name').textContent = user.name || 'Unknown';
        document.getElementById('profile-modal-district').textContent = user.district || '--';
        document.getElementById('profile-modal-designation').textContent = user.designation || '--';
        document.getElementById('profile-modal-points').textContent = `${userStats?.totalPoints || user.points || 0} pts`;
        
        // Update rank badge
        const rankBadge = document.getElementById('profile-modal-rank-badge');
        if (rankBadge && userStats?.rank) {
            rankBadge.textContent = `#${userStats.rank}`;
            rankBadge.classList.toggle('hidden', !userStats.rank);
        }
        
        // Render stats
        const statsEl = document.getElementById('profile-modal-stats');
        if (statsEl && userStats) {
            statsEl.innerHTML = `
                <div class="bg-white/20 backdrop-blur-md rounded-lg p-2 text-center border border-white/10">
                    <div class="text-lg font-bold text-white">${userStats.quizzesCompleted || 0}</div>
                    <div class="text-[10px] text-white/80">Quizzes</div>
                </div>
                <div class="bg-white/20 backdrop-blur-md rounded-lg p-2 text-center border border-white/10">
                    <div class="text-lg font-bold text-white">${userStats.tasksCompleted || 0}</div>
                    <div class="text-[10px] text-white/80">Tasks</div>
                </div>
                <div class="bg-white/20 backdrop-blur-md rounded-lg p-2 text-center border border-white/10">
                    <div class="text-lg font-bold text-white">${userStats.formsCompleted || 0}</div>
                    <div class="text-[10px] text-white/80">Forms</div>
                </div>
            `;
        }
        
        // Render recent activity
        await this.renderProfileModalActivity(userId);
        
        // Show/hide compare button
        const compareBtn = document.getElementById('profile-modal-compare');
        if (compareBtn) {
            compareBtn.classList.toggle('hidden', userId === Auth.currentUser?.uid);
        }
        
        modal.classList.remove('hidden');
    },
    
    /**
     * Render activity in profile modal
     */
    async renderProfileModalActivity(userId) {
        const activityEl = document.getElementById('profile-modal-activity');
        if (!activityEl) return;
        
        activityEl.innerHTML = '';
        
        // Fetch recent submissions
        const [quizSubmissions, taskSubmissions, formSubmissions] = await Promise.all([
            DB.getQuizSubmissions(userId),
            DB.getSubmissions(userId),
            DB.getFormSubmissions(userId)
        ]);
        
        const activities = [];
        
        quizSubmissions.slice(0, 3).forEach(s => {
            activities.push({ type: 'quiz', text: 'Quiz completed', points: `${s.score || 0}/${s.totalScore || 0}`, timestamp: s.submittedAt });
        });
        
        taskSubmissions.slice(0, 3).forEach(s => {
            activities.push({ type: 'task', text: s.taskTitle || 'Task submitted', status: s.status, timestamp: s.submittedAt });
        });
        
        formSubmissions.slice(0, 3).forEach(s => {
            activities.push({ type: 'form', text: 'Form submitted', timestamp: s.submittedAt });
        });
        
        activities.sort((a, b) => {
            const timeA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : a.timestamp) : 0;
            const timeB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : b.timestamp) : 0;
            return timeB - timeA;
        });
        
        if (activities.length === 0) {
            activityEl.innerHTML = '<p class="text-center text-white/60 text-sm py-2">No recent activity</p>';
            return;
        }
        
        activities.slice(0, 5).forEach(activity => {
            const date = activity.timestamp ? new Date(activity.timestamp.toMillis ? activity.timestamp.toMillis() : activity.timestamp).toLocaleDateString() : 'Unknown';
            activityEl.innerHTML += `
                <div class="flex items-center gap-2 text-sm text-white/90">
                    <i class="fas ${activity.type === 'quiz' ? 'fa-puzzle-piece' : activity.type === 'form' ? 'fa-file-alt' : 'fa-tasks'} text-white/60"></i>
                    <span class="flex-1">${activity.text}</span>
                    ${activity.points ? `<span class="text-xs font-bold text-white/80">${activity.points} pts</span>` : ''}
                    ${activity.status ? `<span class="text-xs px-2 py-0.5 rounded bg-white/20">${activity.status}</span>` : ''}
                    <span class="text-xs text-white/60">${date}</span>
                </div>
            `;
        });
    },
    
    /**
     * Compare user with current user
     */
    compareWithUser() {
        // This could open a comparison view
        Toast.info('Comparison feature coming soon!');
    },
    
    /**
     * Show skeleton loader
     */
    showSkeletonLoader(container, count = 3) {
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            container.innerHTML += `
                <div class="skeleton h-20 mb-2"></div>
            `;
        }
    },
    
    /**
     * Show progress bar
     */
    showProgressBar(containerId, progress) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = `
            <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div class="bg-gradient-to-r from-rota-blue via-rota-green to-rota-orange h-2 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
            </div>
        `;
    },
    
    /**
     * Show clock tower spinner
     */
    showClockTowerSpinner(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-8">
                <i class="fas fa-clock text-4xl text-rota-pink clock-tower-spinner mb-4"></i>
                <p class="text-slate-500 text-sm">Loading...</p>
            </div>
        `;
    },
    
    /**
     * Initialize keyboard shortcuts
     */
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // '/' for search
            if (e.key === '/' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                const activeView = document.querySelector('.view-section.active')?.id;
                if (activeView === 'view-activities') {
                    document.getElementById('activity-search')?.focus();
                } else if (activeView === 'view-directory') {
                    document.getElementById('directory-search')?.focus();
                }
            }
            
            // Ctrl+K for command palette (future feature)
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                Toast.info('Command palette coming soon!');
            }
        });
    },
    
    async renderActivities() {
        // Prevent multiple simultaneous loads
        if (this._activitiesLoading) {
            return;
        }
        this._activitiesLoading = true;
        
        try {
            // Show loading state
            const quizList = document.getElementById('quiz-list');
            const taskList = document.getElementById('task-list');
            const formsList = document.getElementById('forms-list');
            const allList = document.getElementById('all-activities-list');
            
            if (quizList) quizList.innerHTML = '<div class="text-center text-slate-500 py-8">Loading...</div>';
            if (taskList) taskList.innerHTML = '<div class="text-center text-slate-500 py-8">Loading...</div>';
            if (formsList) formsList.innerHTML = '<div class="text-center text-slate-500 py-8">Loading...</div>';
            if (allList) allList.innerHTML = '<div class="text-center text-slate-500 py-8">Loading...</div>';
            
            // Load all activity types in parallel
            await Promise.all([
                this.renderQuizzes().catch(err => {
                    console.error('Error rendering quizzes:', err);
                    const qList = document.getElementById('quiz-list');
                    if (qList) qList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load quizzes. <button onclick="UI.renderQuizzes()" class="text-rota-pink font-bold">Retry</button></p>';
                }),
                this.renderTasks().catch(err => {
                    console.error('Error rendering tasks:', err);
                    const tList = document.getElementById('task-list');
                    if (tList) tList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load tasks. <button onclick="UI.renderTasks()" class="text-rota-pink font-bold">Retry</button></p>';
                }),
                this.renderForms().catch(err => {
                    console.error('Error rendering forms:', err);
                    const fList = document.getElementById('forms-list');
                    if (fList) fList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load forms. <button onclick="UI.renderForms()" class="text-rota-pink font-bold">Retry</button></p>';
                }),
                this.renderAllActivities().catch(err => {
                    console.error('Error rendering all activities:', err);
                    const aList = document.getElementById('all-activities-list');
                    if (aList) aList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load activities. <button onclick="UI.renderAllActivities()" class="text-rota-pink font-bold">Retry</button></p>';
                })
            ]);
        } finally {
            this._activitiesLoading = false;
        }
    },
    
    async renderQuizzes() {
        const qList = document.getElementById('quiz-list');
        if (!qList || !Auth.currentUser) return;
        
        try {
            qList.innerHTML = '';
            
            // Check completion status FIRST - force fresh read (source of truth)
            let completionStatus;
            try {
                completionStatus = await DB.getUserCompletionStatus(Auth.currentUser.uid, false, true);
            } catch (error) {
                console.error(`[renderQuizzes] Error getting completion status:`, error);
                completionStatus = { quizzes: {}, tasks: {}, forms: {} };
            }
            
            // Ensure completionStatus is an object with quizzes property
            if (!completionStatus || typeof completionStatus !== 'object') {
                completionStatus = { quizzes: {}, tasks: {}, forms: {} };
            }
            
            // Ensure quizzes, tasks, forms properties exist
            if (!completionStatus.quizzes) completionStatus.quizzes = {};
            if (!completionStatus.tasks) completionStatus.tasks = {};
            if (!completionStatus.forms) completionStatus.forms = {};
            
            // Fetch pre-computed list
            const quizzes = await DB.getPendingQuizzes(Auth.currentUser.uid);
            
            // CRITICAL: Filter out completed quizzes from pending list (double-check)
            // Even though Cloud Function should filter, we need client-side filtering as backup
            const pendingQuizzes = quizzes.filter(q => {
                const quizId = q.id || q.quizId;
                if (!quizId) return false;
                const isCompleted = !!completionStatus.quizzes?.[quizId];
                return !isCompleted;
            });
            
            // Get completed if "show completed" is checked
            const showCompleted = document.getElementById('show-completed-toggle')?.checked || false;
            let allQuizzes = pendingQuizzes;
            
            if (showCompleted) {
                let completed = await DB.getCompletedQuizzes(Auth.currentUser.uid);
                
                // FALLBACK: If completed cache is empty but we have completion status, build the list
                if (completed.length === 0 && Object.keys(completionStatus.quizzes || {}).length > 0) {
                    // Get all quizzes from indexed cache
                    const allQuizzesResult = await DB.readFromCache('activities/quizzes/byId', {
                        useLocalStorage: false,
                        ttl: 10 * 60 * 1000
                    }).catch(() => ({ data: {} }));
                    
                    const allQuizzesData = allQuizzesResult.data || {};
                    const completedQuizIds = Object.keys(completionStatus.quizzes || {});
                    
                    // Build completed quizzes list from indexed cache
                    completed = completedQuizIds.map(quizId => {
                        const quizData = allQuizzesData[quizId];
                        if (quizData) {
                            return {
                                ...quizData,
                                id: quizId,
                                ...completionStatus.quizzes[quizId],
                                itemType: 'quiz',
                                completed: true
                            };
                        }
                        return null;
                    }).filter(q => q !== null);
                }
                
                allQuizzes = [...pendingQuizzes, ...completed];
            }
            
            // Filter by search only
            const searchTerm = document.getElementById('activity-search')?.value || '';
            const filtered = DB.filterBySearch(allQuizzes, searchTerm);
            
            if (filtered.length === 0) {
                const message = showCompleted 
                    ? 'No quizzes available' 
                    : 'No pending quizzes available. Check "Show Completed" to see completed quizzes.';
                qList.innerHTML = `<p class="text-center text-slate-500 text-sm py-8">${message}</p>`;
                return;
            }
            
            // Use DocumentFragment for efficient DOM manipulation
            const fragment = document.createDocumentFragment();
            
            filtered.forEach(q => {
                const quizId = q.id || q.quizId;
                if (!quizId) {
                    return; // Skip invalid quizzes
                }
                
                // Check completion status - this is the source of truth
                // First, ensure completionStatus.quizzes exists
                if (!completionStatus.quizzes) {
                    completionStatus.quizzes = {};
                }
                
                const quizCompletion = completionStatus.quizzes[quizId];
                const isCompleted = !!quizCompletion;
                
                // Skip completed quizzes if not showing completed
                if (isCompleted && !showCompleted) {
                    return; // Don't render completed quizzes in pending view
                }
                
                const quizEl = document.createElement('div');
                quizEl.className = 'gradient-quiz text-white p-5 rounded-2xl shadow-lg flex justify-between items-center relative overflow-hidden group';
                quizEl.innerHTML = `
                    <div class="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
                    <div class="relative z-10 flex-1">
                        <h4 class="font-bold">${this.escapeHtml(q.title)}</h4>
                        <p class="text-xs text-white/80 mt-1">Win ${q.totalPoints || q.points || 0} Points</p>
                        ${q.isTimeBased ? `<p class="text-xs text-white/70 mt-1"><i class="fas fa-clock"></i> ${q.timeLimit} min</p>` : ''}
                        ${isCompleted ? '<span class="text-xs bg-green-500 px-2 py-1 rounded mt-2 inline-block">Completed</span>' : ''}
                    </div>
                    ${isCompleted ? `
                        <div class="relative z-10 bg-white/30 text-white text-xs font-bold px-5 py-2.5 rounded-full opacity-75 cursor-not-allowed">
                            Done
                        </div>
                    ` : `
                        <button onclick="Quiz.startQuiz('${quizId}')" class="relative z-10 bg-white text-slate-900 text-xs font-bold px-5 py-2.5 rounded-full shadow hover:scale-105 transition-transform">
                            Start
                        </button>
                    `}
                `;
                fragment.appendChild(quizEl);
            });
            
            qList.appendChild(fragment);
        } catch (error) {
            console.error('Error rendering quizzes:', error);
            qList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load quizzes. Please try again.</p>';
        }
    },
    
    async renderTasks() {
        const tList = document.getElementById('task-list');
        if (!tList || !Auth.currentUser) return;
        
        try {
            tList.innerHTML = '';
            
            // Fetch pre-computed list
            const tasks = await DB.getPendingTasks(Auth.currentUser.uid);
            
            // Get completed if "show completed" is checked
            const showCompleted = document.getElementById('show-completed-toggle')?.checked || false;
            let allTasks = tasks;
            
            if (showCompleted) {
                try {
                    const completed = await DB.getCompletedTasks(Auth.currentUser.uid);
                    if (completed && completed.length > 0) {
                        // Ensure proper structure
                        const completedWithStructure = completed.map(t => ({
                            ...t,
                            id: t.id || t.taskId,
                            itemType: 'task'
                        }));
                        allTasks = [...tasks, ...completedWithStructure];
                    }
                } catch (error) {
                    console.error('Error loading completed tasks:', error);
                }
            }
            
            // Get completion status for filtering
            const completionStatus = await DB.getUserCompletionStatus(Auth.currentUser.uid, false, true).catch(() => ({ tasks: {} }));
            
            if (showCompleted) {
                // When showing completed, we need to also include tasks with status 'pending' from the indexed cache
                // because they're not in the completed list (only 'approved' tasks are in completed)
                try {
                    // Fetch all tasks from indexed cache
                    const tasksListResult = await DB.readFromCache('activities/tasks/list', {
                        useLocalStorage: false,
                        ttl: 10 * 60 * 1000
                    }).catch(() => ({ data: [] }));
                    
                    if (tasksListResult.data && Array.isArray(tasksListResult.data)) {
                        // Fetch full task data from byId for tasks that have completion status
                        const existingTaskIds = new Set(allTasks.map(t => t.id || t.taskId).filter(Boolean));
                        
                        for (const taskId of tasksListResult.data) {
                            if (existingTaskIds.has(taskId)) continue;
                            
                            const taskCompletion = completionStatus.tasks?.[taskId];
                            if (taskCompletion) {
                                // Task has a completion status, fetch its full data
                                const taskResult = await DB.readFromCache(`activities/tasks/byId/${taskId}`, {
                                    useLocalStorage: false,
                                    ttl: 10 * 60 * 1000
                                }).catch(() => ({ data: null }));
                                
                                if (taskResult.data) {
                                    allTasks.push({
                                        ...taskResult.data,
                                        id: taskId,
                                        itemType: 'task',
                                        status: taskCompletion.status,
                                        completed: taskCompletion.status === 'approved'
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error loading all tasks for completed view:', error);
                }
            } else {
                // Final filter: Remove any tasks that shouldn't be shown in pending mode
                // Tasks with status 'pending' should not show in pending list
                allTasks = allTasks.filter(t => {
                    const taskId = t.id || t.taskId;
                    const taskCompletion = completionStatus.tasks?.[taskId];
                    
                    if (!taskCompletion) {
                        return true; // Not submitted, show it
                    }
                    
                    const status = taskCompletion.status;
                    // In pending mode, only show if not submitted or rejected (can resubmit)
                    return !status || status === 'rejected';
                });
            }
            
            // Filter by search only
            const searchTerm = document.getElementById('activity-search')?.value || '';
            const filtered = DB.filterBySearch(allTasks, searchTerm);
            
            if (filtered.length === 0) {
                const message = showCompleted 
                    ? 'No tasks available' 
                    : 'No pending tasks available. Check "Show Completed" to see completed tasks.';
                tList.innerHTML = `<p class="text-center text-slate-500 text-sm py-8">${message}</p>`;
                return;
            }
            
            // Use DocumentFragment for efficient DOM manipulation
            const fragment = document.createDocumentFragment();
            
            filtered.forEach(t => {
                // Ensure task has proper structure
                if (!t.id && !t.taskId) {
                    return; // Skip invalid tasks
                }
                
                const taskId = t.id || t.taskId;
                
                // Get status from completion status (source of truth)
                // Check both task object status (for completed tasks) and completion status
                const taskCompletion = completionStatus.tasks?.[taskId];
                const status = taskCompletion?.status || t.status || null;
                const isCompleted = t.completed || status === 'approved';
                
                // Determine button/status display based on completion status
                let buttonHtml = '';
                
                if (!taskCompletion || !status) {
                    // Task has not been submitted yet - show action button
                    const taskType = t.type === 'form' ? 'Form' : 'Upload';
                    const taskIcon = t.type === 'form' ? 'file-alt' : 'camera';
                    const taskText = t.type === 'form' ? 'Fill Form' : 'Upload Proof';
                    buttonHtml = `<button onclick="Task.open${taskType}Modal('${taskId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <i class="fas fa-${taskIcon}"></i> ${taskText}
                    </button>`;
                } else if (status === 'rejected') {
                    // Task was rejected - show redo button
                    const taskType = t.type === 'form' ? 'Form' : 'Upload';
                    const taskIcon = t.type === 'form' ? 'file-alt' : 'camera';
                    const taskText = t.type === 'form' ? 'Fill Form' : 'Upload Proof';
                    buttonHtml = `<button onclick="Task.open${taskType}Modal('${taskId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <i class="fas fa-${taskIcon}"></i> ${taskText} (Redo)
                    </button>`;
                } else if (status === 'approved') {
                    // Task was approved - show approved message
                    buttonHtml = `<div class="w-full py-3 rounded-xl bg-green-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                        <i class="fas fa-check-circle"></i> Approved - Points Awarded
                    </div>`;
                } else if (status === 'pending') {
                    // Task is pending review - show pending message
                    buttonHtml = `<div class="w-full py-3 rounded-xl bg-amber-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                        <i class="fas fa-clock"></i> Pending Review - Cannot Resubmit
                    </div>`;
                } else {
                    // Fallback: if status is unknown but task exists in completion status, show action button
                    const taskType = t.type === 'form' ? 'Form' : 'Upload';
                    const taskIcon = t.type === 'form' ? 'file-alt' : 'camera';
                    const taskText = t.type === 'form' ? 'Fill Form' : 'Upload Proof';
                    buttonHtml = `<button onclick="Task.open${taskType}Modal('${taskId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <i class="fas fa-${taskIcon}"></i> ${taskText}
                    </button>`;
                }
                
                const taskEl = document.createElement('div');
                taskEl.className = 'gradient-task text-white p-4 rounded-2xl shadow-lg';
                taskEl.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-bold">${this.escapeHtml(t.title)}</h4>
                        <span class="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-lg">+${t.points || 0}</span>
                    </div>
                    <p class="text-xs text-white/80 mb-4 leading-relaxed">${this.escapeHtml(t.description || '')}</p>
                    ${buttonHtml}
                `;
                fragment.appendChild(taskEl);
            });
            
            tList.appendChild(fragment);
        } catch (error) {
            console.error('Error rendering tasks:', error);
            tList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load tasks. Please try again.</p>';
        }
    },
    
    async renderProfile() {
        if(!Auth.currentUser) return;
        
        // Prevent multiple simultaneous loads
        if (this._profileLoading) {
            return;
        }
        this._profileLoading = true;
        
        try {
            const user = Auth.currentUser;
            
            // Update basic info immediately from currentUser
            const nameEl = document.getElementById('profile-name');
            const districtEl = document.getElementById('profile-district');
            const designationEl = document.getElementById('profile-designation');
            const emailEl = document.getElementById('profile-email');
            const avatarEl = document.getElementById('profile-avatar');
            
            if (nameEl) nameEl.innerText = user.name || '--';
            if (districtEl) districtEl.innerText = user.district || '--';
            if (designationEl) designationEl.innerText = user.designation || '--';
            if (emailEl) emailEl.innerText = user.email || '--';
            if (avatarEl) avatarEl.src = this.getUserPhoto(user);
            
            // Fetch user stats from RTDB (with error handling)
            let userStats = null;
            try {
                userStats = await DB.getUserStats(user.uid);
            } catch (error) {
                console.error('Error loading user stats:', error);
                // Use default stats
                userStats = {
                    totalPoints: user.points || 0,
                    quizzesCompleted: 0,
                    tasksCompleted: 0,
                    formsCompleted: 0
                };
            }
            
            const pointsEl = document.getElementById('profile-points');
            if (pointsEl) pointsEl.innerText = userStats?.totalPoints || user.points || 0;
            
            // Render activity statistics
            this.renderProfileStats(userStats);
            
            // Render achievements
            this.renderProfileAchievements(userStats);
            
            // Load notification settings
            this.loadNotificationSettings();
        } catch (error) {
            console.error('Error rendering profile:', error);
        } finally {
            this._profileLoading = false;
        }
    },
    
    /**
     * Render profile activity statistics
     */
    renderProfileStats(userStats) {
        const statsEl = document.getElementById('profile-stats');
        if (!statsEl) return;
        
        const stats = userStats || {
            quizzesCompleted: 0,
            tasksCompleted: 0,
            formsCompleted: 0
        };
        
        // Simple, clean stats display
        const quizzesEl = statsEl.children[0];
        const tasksEl = statsEl.children[1];
        const formsEl = statsEl.children[2];
        
        if (quizzesEl) {
            quizzesEl.querySelector('.text-2xl').textContent = stats.quizzesCompleted || 0;
        }
        if (tasksEl) {
            tasksEl.querySelector('.text-2xl').textContent = stats.tasksCompleted || 0;
        }
        if (formsEl) {
            formsEl.querySelector('.text-2xl').textContent = stats.formsCompleted || 0;
        }
    },
    
    /**
     * Render profile achievements
     */
    renderProfileAchievements(userStats) {
        const achievementsEl = document.getElementById('profile-achievements');
        if (!achievementsEl) return;
        
        const stats = userStats || {};
        const achievements = [];
        
        if (stats.quizzesCompleted > 0) {
            achievements.push({ icon: 'fa-puzzle-piece', color: 'bg-purple-500', text: 'Quiz Master', desc: 'Completed first quiz' });
        }
        if (stats.quizzesCompleted >= 5) {
            achievements.push({ icon: 'fa-puzzle-piece', color: 'bg-purple-600', text: 'Quiz Expert', desc: 'Completed 5+ quizzes' });
        }
        if (stats.tasksCompleted > 0) {
            achievements.push({ icon: 'fa-tasks', color: 'bg-orange-500', text: 'Task Hero', desc: 'Completed first task' });
        }
        if (stats.tasksCompleted >= 5) {
            achievements.push({ icon: 'fa-tasks', color: 'bg-orange-600', text: 'Task Champion', desc: 'Completed 5+ tasks' });
        }
        if (stats.formsCompleted > 0) {
            achievements.push({ icon: 'fa-file-alt', color: 'bg-blue-500', text: 'Form Filler', desc: 'Completed first form' });
        }
        if (stats.rank && stats.rank <= 10) {
            achievements.push({ icon: 'fa-trophy', color: 'bg-yellow-500', text: 'Top 10', desc: 'Ranked in top 10' });
        }
        if (stats.rank && stats.rank <= 3) {
            achievements.push({ icon: 'fa-crown', color: 'bg-yellow-400', text: 'Top 3', desc: 'Ranked in top 3' });
        }
        
        if (achievements.length === 0) {
            achievementsEl.innerHTML = '<p class="text-center text-slate-500 text-sm py-4">Complete activities to earn achievements!</p>';
            return;
        }
        
        achievementsEl.innerHTML = achievements.map(ach => `
            <div class="${ach.color} text-white p-3 rounded-lg flex items-center gap-3">
                <i class="fas ${ach.icon} text-xl"></i>
                <div class="flex-1">
                    <div class="font-bold text-sm">${ach.text}</div>
                    <div class="text-xs text-white/80">${ach.desc}</div>
                </div>
            </div>
        `).join('');
    },
    
    /**
     * Render profile submission history
     */
    async renderProfileSubmissionHistory(filter = 'all') {
        const submissionsEl = document.getElementById('profile-submissions');
        if (!submissionsEl) return;
        
        try {
            submissionsEl.innerHTML = '<p class="text-center text-slate-500 text-sm py-4">Loading...</p>';
            
            const [quizSubmissions, taskSubmissions, formSubmissions] = await Promise.all([
                DB.getQuizSubmissions(Auth.currentUser.uid).catch(() => []),
                DB.getSubmissions(Auth.currentUser.uid).catch(() => []),
                DB.getFormSubmissions(Auth.currentUser.uid).catch(() => [])
            ]);
            
            const allSubmissions = [];
            
            quizSubmissions.forEach(s => {
                allSubmissions.push({ 
                    type: 'quiz', 
                    title: 'Quiz', 
                    points: `${s.score || 0}/${s.totalScore || 0}`, 
                    timestamp: s.submittedAt 
                });
            });
            
            taskSubmissions.forEach(s => {
                allSubmissions.push({ 
                    type: 'task', 
                    title: s.taskTitle || 'Task', 
                    status: s.status, 
                    timestamp: s.submittedAt 
                });
            });
            
            formSubmissions.forEach(s => {
                allSubmissions.push({ 
                    type: 'form', 
                    title: 'Form', 
                    timestamp: s.submittedAt 
                });
            });
            
            // Filter by type
            const filtered = filter === 'all' ? allSubmissions : allSubmissions.filter(s => s.type === filter);
            
            // Sort by timestamp descending
            filtered.sort((a, b) => {
                const timeA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : a.timestamp) : 0;
                const timeB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : b.timestamp) : 0;
                return timeB - timeA;
            });
            
            if (filtered.length === 0) {
                submissionsEl.innerHTML = '<p class="text-center text-slate-500 text-sm py-4">No submissions yet</p>';
                return;
            }
            
            submissionsEl.innerHTML = filtered.slice(0, 10).map(sub => {
                const date = sub.timestamp ? new Date(sub.timestamp.toMillis ? sub.timestamp.toMillis() : sub.timestamp).toLocaleDateString() : 'Unknown';
                const icon = sub.type === 'quiz' ? 'fa-puzzle-piece' : sub.type === 'form' ? 'fa-file-alt' : 'fa-tasks';
                const color = sub.type === 'quiz' ? 'text-purple-600' : sub.type === 'form' ? 'text-blue-600' : 'text-orange-600';
                
                return `
                    <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                        <i class="fas ${icon} ${color}"></i>
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-bold text-slate-800 truncate">${this.escapeHtml(sub.title)}</div>
                            <div class="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                ${sub.points ? `<span class="font-bold text-rota-orange">${sub.points} pts</span>` : ''}
                                ${sub.status ? `<span class="px-2 py-0.5 rounded ${sub.status === 'approved' ? 'bg-green-100 text-green-700' : sub.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${sub.status}</span>` : ''}
                                <span>${date}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading submission history:', error);
            submissionsEl.innerHTML = '<p class="text-center text-slate-500 text-sm py-4">Failed to load submissions</p>';
        }
    },
    
    /**
     * Filter submission history
     */
    filterSubmissionHistory(filter) {
        // Update active filter button
        document.querySelectorAll('.submission-filter-btn').forEach(btn => {
            btn.classList.remove('active', 'bg-rota-pink', 'text-white');
            btn.classList.add('bg-slate-100', 'text-slate-600');
        });
        event.target.classList.add('active', 'bg-rota-pink', 'text-white');
        event.target.classList.remove('bg-slate-100', 'text-slate-600');
        
        // Re-render submissions
        this.renderProfileSubmissionHistory(filter);
    },
    
    async showLeaderboardModal() {
        const listEl = document.getElementById('modal-leaderboard-list');
        if (!listEl) return;
        
        // Show loading state
        listEl.innerHTML = '<div class="text-center text-slate-500 py-8">Loading leaderboard...</div>';
        
        try {
            // Use cached leaderboard from RTDB (cheaper)
            const leaderboard = await DB.getLeaderboard(50);
            
            if (!leaderboard || leaderboard.length === 0) {
                listEl.innerHTML = `
                    <div class="text-center py-8">
                        <p class="text-slate-500 text-sm mb-2">Leaderboard is empty</p>
                        <p class="text-xs text-slate-400">The leaderboard cache may not be populated yet.</p>
                        <p class="text-xs text-slate-400 mt-2">Try running the cache initialization function from admin dashboard.</p>
                    </div>
                `;
                document.getElementById('modal-leaderboard').classList.remove('hidden');
                return;
            }
            
            listEl.innerHTML = '';
            
            leaderboard.forEach((u, idx) => {
                if (!u || !u.uid) return; // Skip invalid entries
                
                const isMe = u.uid === Auth.currentUser.uid;
                const rankStyle = idx < 3 ? 'text-amber-500' : 'text-slate-400';
                
                listEl.innerHTML += `
                    <div class="flex items-center gap-4 p-3 rounded-xl ${isMe ? 'bg-rose-50 border border-rose-100' : 'bg-slate-50 border border-slate-100'}">
                        <span class="font-bold w-6 text-center ${rankStyle}">${idx + 1}</span>
                        <img src="${this.getUserPhoto(u)}" class="w-8 h-8 rounded-full object-cover border border-white shadow-sm" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || 'User')}&background=D71947&color=fff'">
                        <div class="flex-1 min-w-0">
                            <p class="font-bold text-sm text-slate-800 truncate">${this.escapeHtml(u.name || 'Unknown')} ${isMe ? '(You)' : ''}</p>
                            <p class="text-[10px] text-slate-500 truncate">${this.escapeHtml((u.district || 'N/A') + ' - ' + (u.designation || 'N/A'))}</p>
                        </div>
                        <span class="font-bold text-sm text-rota-pink">${u.points || 0}</span>
                    </div>
                `;
            });
        } catch (error) {
            console.error('Error loading leaderboard:', error);
            listEl.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-slate-500 text-sm mb-2">Failed to load leaderboard</p>
                    <button onclick="UI.showLeaderboardModal()" class="mt-2 text-rota-pink text-sm font-bold">Retry</button>
                </div>
            `;
        }
        
        document.getElementById('modal-leaderboard').classList.remove('hidden');
    },
    
    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('hidden');
            
            // Reset form state if it's a form modal
            if (id === 'modal-task-form' || id === 'modal-survey-form') {
                const form = modal.querySelector('form');
                if (form) {
                    form.reset();
                    // Re-enable all form fields
                    const formFields = form.querySelectorAll('input, select, textarea, button');
                    formFields.forEach(field => {
                        field.disabled = false;
                        if (field.type === 'submit') {
                            field.innerHTML = field.getAttribute('data-original-text') || 'Submit';
                        }
                    });
                }
                
                // CRITICAL: Re-enable close button (it might have been disabled during submission)
                const closeBtn = modal.querySelector('button[onclick*="closeModal"]');
                if (closeBtn) {
                    closeBtn.style.pointerEvents = 'auto';
                }
                
                // ALWAYS reset submission state when modal is closed (force close)
                // This prevents stuck modals if async handler fails or is slow
                if (id === 'modal-task-form' && Task) {
                    Task._submitting = false;
                    Task.currentTask = null;
                } else if (id === 'modal-survey-form' && Forms) {
                    Forms._submitting = false;
                    Forms.currentForm = null;
                }
            }
            
            // Also handle modal-upload close button
            if (id === 'modal-upload') {
                const closeBtn = modal.querySelector('button[onclick*="closeModal"]');
                if (closeBtn) {
                    closeBtn.style.pointerEvents = 'auto';
                }
                if (Task) {
                    Task._submitting = false;
                }
            }
        }
    },
    
    /**
     * Clean up real-time listeners to prevent duplicates
     */
    cleanupRealtimeListeners() {
        if (!this._realtimeListeners) return;
        
        Object.values(this._realtimeListeners).forEach(({ ref, listener }) => {
            if (ref && listener) {
                ref.off('value', listener);
            }
        });
        
        this._realtimeListeners = null;
    },
    
    showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const icon = toast.querySelector('i');
        const msgEl = document.getElementById('toast-msg');
        
        msgEl.innerText = msg;
        
        // Update icon based on type
        icon.className = 'fas ' + (
            type === 'error' ? 'fa-exclamation-circle text-red-400' :
            type === 'info' ? 'fa-info-circle text-blue-400' :
            'fa-check-circle text-green-400'
        );
        
        toast.style.top = '20px';
        setTimeout(() => {
            toast.style.top = '-100px';
        }, 3000);
    },
    
    switchActivityTab(tab) {
        const tabs = ['quizzes', 'tasks', 'forms', 'all'];
        tabs.forEach(t => {
            const content = document.getElementById(`activity-content-${t}`);
            const btn = document.getElementById(`tab-btn-${t}`);
            
            if (t === tab) {
                if (content) content.classList.remove('hidden');
                if (btn) {
                    btn.classList.remove('text-slate-500', 'hover:bg-slate-50');
                    btn.classList.add('bg-rota-pink', 'text-white', 'shadow-sm');
                }
            } else {
                if (content) content.classList.add('hidden');
                if (btn) {
                    btn.classList.add('text-slate-500', 'hover:bg-slate-50');
                    btn.classList.remove('bg-rota-pink', 'text-white', 'shadow-sm');
                }
            }
        });
        
        // Load data when switching tabs
        if (tab === 'forms') {
            this.renderForms().catch(err => {
                console.error('Error rendering forms:', err);
                const formsList = document.getElementById('forms-list');
                if (formsList) formsList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load forms</p>';
            });
        } else if (tab === 'all') {
            this.renderAllActivities().catch(err => {
                console.error('Error rendering all activities:', err);
                const allList = document.getElementById('all-activities-list');
                if (allList) allList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load activities</p>';
            });
        } else if (tab === 'quizzes') {
            this.renderQuizzes().catch(err => {
                console.error('Error rendering quizzes:', err);
            });
        } else if (tab === 'tasks') {
            this.renderTasks().catch(err => {
                console.error('Error rendering tasks:', err);
            });
        }
    },
    
    
    /**
     * Render completed activities
     */
    async renderCompletedActivities() {
        const completedList = document.getElementById('completed-list');
        if (!completedList || !Auth.currentUser) return;
        
        try {
            completedList.innerHTML = '<div class="text-center text-slate-500 py-8">Loading completed activities...</div>';
            
            const [activities, completionStatus] = await Promise.all([
                DB.getAttendeeActivities(true, true).catch(err => {
                    console.error('Error loading activities:', err);
                    return { quizzes: [], tasks: [], forms: [] };
                }),
                DB.getUserCompletionStatus(Auth.currentUser.uid, true, true).catch(err => {
                    console.error('Error loading completion status:', err);
                    return { quizzes: {}, tasks: {}, forms: {} };
                })
            ]);
        
        const completed = [];
        const completedQuizIds = Object.keys(completionStatus.quizzes || {});
        const completedTaskIds = Object.keys(completionStatus.tasks || {});
        const completedFormIds = Object.keys(completionStatus.forms || {});
        
        // Add completed quizzes - fetch from Firestore if not in activities list
        for (const quizId of completedQuizIds) {
            let quiz = activities.quizzes.find(q => q.id === quizId);
            
            // If not found in active activities, fetch directly from Firestore (might be inactive)
            if (!quiz) {
                try {
                    quiz = await DB.getQuiz(quizId);
                } catch (err) {
                    continue;
                }
            }
            
            if (quiz) {
                const completion = completionStatus.quizzes[quizId];
                completed.push({
                    ...quiz,
                    itemType: 'quiz',
                    score: completion.score,
                    totalScore: completion.totalScore,
                    submittedAt: completion.submittedAt
                });
            }
        }
        
        // Add completed tasks - fetch from Firestore if not in activities list
        for (const taskId of completedTaskIds) {
            let task = activities.tasks.find(t => t.id === taskId);
            
            // If not found in active activities, fetch directly from Firestore (might be inactive)
            if (!task) {
                try {
                    task = await DB.getTask(taskId);
                } catch (err) {
                    continue;
                }
            }
            
            if (task) {
                const completion = completionStatus.tasks[taskId];
                completed.push({
                    ...task,
                    itemType: 'task',
                    status: completion.status,
                    submittedAt: completion.submittedAt
                });
            }
        }
        
        // Add completed forms - fetch from Firestore if not in activities list
        for (const formId of completedFormIds) {
            let form = activities.forms.find(f => f.id === formId);
            
            // If not found in active activities, fetch directly from Firestore (might be inactive)
            if (!form) {
                try {
                    form = await DB.getForm(formId);
                } catch (err) {
                    continue;
                }
            }
            
            if (form) {
                const completion = completionStatus.forms[formId];
                completed.push({
                    ...form,
                    itemType: 'form',
                    submittedAt: completion.submittedAt
                });
            }
        }
        
        // Sort by submittedAt descending
        completed.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
        
        if (completed.length === 0) {
            completedList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">No completed activities yet</p>';
            return;
        }
        
        completed.forEach(item => {
            const icon = item.itemType === 'quiz' ? 'fa-puzzle-piece' : item.itemType === 'form' ? 'fa-file-alt' : 'fa-tasks';
            const gradient = item.itemType === 'quiz' ? 'gradient-quiz' : item.itemType === 'form' ? 'gradient-form' : 'gradient-task';
            const date = item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : 'Unknown';
            
            completedList.innerHTML += `
                <div class="bg-gradient-to-r ${gradient} text-white p-4 rounded-2xl shadow-lg">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <i class="fas ${icon}"></i>
                            <h4 class="font-bold">${item.title}</h4>
                        </div>
                        ${item.score !== undefined ? `<span class="bg-white/20 backdrop-blur-md px-2 py-1 rounded-full text-xs font-bold">${item.score}/${item.totalScore} pts</span>` : ''}
                    </div>
                    ${item.status ? `<p class="text-xs text-white/80 mb-2">Status: <span class="font-bold">${item.status}</span></p>` : ''}
                    <p class="text-xs text-white/60">Completed: ${date}</p>
                    ${item.status === 'rejected' ? `
                        <button onclick="${item.itemType === 'quiz' ? `Quiz.startQuiz('${item.id}')` : item.itemType === 'form' ? `Forms.openForm('${item.id}')` : item.type === 'form' ? `Task.openFormModal('${item.id}')` : `Task.openUploadModal('${item.id}')`}" 
                                class="mt-2 w-full bg-white text-slate-900 font-bold py-2 rounded-lg text-sm hover:bg-slate-100 transition-colors">
                            Resubmit
                        </button>
                    ` : ''}
                </div>
            `;
            });
        } catch (error) {
            console.error('Error rendering completed activities:', error);
            completedList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load completed activities. Please try again.</p>';
        }
    },
    
    /**
     * Render all activities (quizzes, tasks, forms) together
     */
    async renderAllActivities() {
        const allList = document.getElementById('all-activities-list');
        if (!allList || !Auth.currentUser) return;
        
        try {
            allList.innerHTML = '';
            
            // Fetch pre-computed combined list
            const all = await DB.getPendingActivities(Auth.currentUser.uid);
            
            // Get completed if needed
            const showCompleted = document.getElementById('show-completed-toggle')?.checked || false;
            let allItems = all;
            
            if (showCompleted) {
                try {
                    const completed = await DB.getCompletedActivities(Auth.currentUser.uid);
                    if (completed && completed.length > 0) {
                        // Ensure proper structure
                        const completedWithStructure = completed.map(a => ({
                            ...a,
                            id: a.id || a.quizId || a.taskId || a.formId,
                            itemType: a.itemType || (a.quizId ? 'quiz' : a.taskId ? 'task' : a.formId ? 'form' : 'unknown')
                        }));
                        allItems = [...all, ...completedWithStructure];
                    }
                } catch (error) {
                    console.error('Error loading completed activities:', error);
                }
            }
            
            // Get completion status for filtering
            const completionStatus = await DB.getUserCompletionStatus(Auth.currentUser.uid, false, true).catch(() => ({ quizzes: {}, tasks: {}, forms: {} }));
            
            // CRITICAL: Filter out completed items from pending list when showCompleted is false
            if (!showCompleted) {
                allItems = allItems.filter(item => {
                    const itemId = item.id || item.quizId || item.taskId || item.formId;
                    if (!itemId) return false;
                    
                    const itemType = item.itemType || (item.quizId ? 'quiz' : item.taskId ? 'task' : item.formId ? 'form' : null);
                    if (!itemType) return false;
                    
                    // Fix pluralization: quiz -> quizzes, task -> tasks, form -> forms
                    const typeKey = itemType === 'quiz' ? 'quizzes' : `${itemType}s`;
                    const isCompleted = !!completionStatus[typeKey]?.[itemId];
                    
                    if (isCompleted) {
                    }
                    
                    return !isCompleted;
                });
            }
            
            if (showCompleted) {
                // When showing completed, we need to also include tasks with status 'pending' from the indexed cache
                // because they're not in the completed list (only 'approved' tasks are in completed)
                
                // First, update existing tasks with their status from completion status
                allItems = allItems.map(item => {
                    if (item.itemType === 'task') {
                        const taskId = item.id || item.taskId;
                        const taskCompletion = completionStatus.tasks?.[taskId];
                        if (taskCompletion && !item.status) {
                            return {
                                ...item,
                                status: taskCompletion.status,
                                completed: taskCompletion.status === 'approved'
                            };
                        }
                    }
                    return item;
                });
                
                try {
                    // Fetch all tasks from indexed cache
                    const tasksListResult = await DB.readFromCache('activities/tasks/list', {
                        useLocalStorage: false,
                        ttl: 10 * 60 * 1000
                    }).catch(() => ({ data: [] }));
                    
                    if (tasksListResult.data && Array.isArray(tasksListResult.data)) {
                        // Create a set of existing task IDs for quick lookup
                        const existingTaskIds = new Set();
                        allItems.forEach(item => {
                            if (item.itemType === 'task') {
                                const taskId = item.id || item.taskId;
                                if (taskId) {
                                    existingTaskIds.add(taskId);
                                }
                            }
                        });
                        
                        // Fetch tasks that have completion status but aren't already in the list
                        for (const taskId of tasksListResult.data) {
                            const taskCompletion = completionStatus.tasks?.[taskId];
                            
                            // Only add tasks that have a completion status (pending, approved, or rejected)
                            if (taskCompletion && !existingTaskIds.has(taskId)) {
                                // Task has a completion status, fetch its full data
                                const taskResult = await DB.readFromCache(`activities/tasks/byId/${taskId}`, {
                                    useLocalStorage: false,
                                    ttl: 10 * 60 * 1000
                                }).catch(() => ({ data: null }));
                                
                                if (taskResult.data) {
                                    allItems.push({
                                        ...taskResult.data,
                                        id: taskId,
                                        itemType: 'task',
                                        status: taskCompletion.status,
                                        completed: taskCompletion.status === 'approved'
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error loading all tasks for All tab completed view:', error);
                }
            }
            
            // CRITICAL: Final filter to ensure no completed items when showCompleted is false
            // This is a safety check after all processing
            if (!showCompleted) {
                allItems = allItems.filter(item => {
                    const itemId = item.id || item.quizId || item.taskId || item.formId;
                    if (!itemId) {
                        return false;
                    }
                    
                    const itemType = item.itemType || (item.quizId ? 'quiz' : item.taskId ? 'task' : item.formId ? 'form' : null);
                    if (!itemType) {
                        return false;
                    }
                    
                    // Fix pluralization: quiz -> quizzes
                    const typeKey = itemType === 'quiz' ? 'quizzes' : `${itemType}s`;
                    const isCompleted = !!completionStatus[typeKey]?.[itemId];
                    
                    if (isCompleted) {
                        return false;
                    }
                    
                    return true;
                });
            }
            
            // Filter by search only
            const searchTerm = document.getElementById('activity-search')?.value || '';
            const filteredItems = DB.filterBySearch(allItems, searchTerm);
            
            if (filteredItems.length === 0) {
                const message = showCompleted 
                    ? 'No activities available' 
                    : 'No pending activities available. Check "Show Completed" to see completed activities.';
                allList.innerHTML = `<p class="text-center text-slate-500 text-sm py-8">${message}</p>`;
                return;
            }
            
            // Render all items - match styling from quizzes and tasks tabs
            // Check completion status for all items to ensure accurate display
            // Use DocumentFragment for efficient DOM manipulation
            const fragment = document.createDocumentFragment();
            
            filteredItems.forEach(item => {
                const icon = item.itemType === 'quiz' ? 'fa-puzzle-piece' : item.itemType === 'form' ? 'fa-file-alt' : 'fa-tasks';
                const gradientClass = item.itemType === 'quiz' ? 'gradient-quiz' : item.itemType === 'form' ? 'gradient-form' : 'gradient-task';
                const typeLabel = item.itemType === 'quiz' ? 'Quiz' : item.itemType === 'form' ? 'Form' : 'Task';
                
                // Check completion status from completion cache (source of truth)
                const itemId = item.id || item.quizId || item.taskId || item.formId;
                if (!itemId) {
                    return; // Skip invalid items
                }
                
                // Get completion status directly (source of truth)
                let taskCompletion = null;
                let quizCompletion = null;
                let formCompletion = null;
                let status = null;
                let isCompleted = false;
                
                if (item.itemType === 'task') {
                    taskCompletion = completionStatus.tasks?.[itemId];
                    status = taskCompletion?.status || item.status || null;
                    isCompleted = status === 'approved' || item.completed;
                } else if (item.itemType === 'quiz') {
                    quizCompletion = completionStatus.quizzes?.[itemId];
                    isCompleted = !!quizCompletion;
                    if (quizCompletion) {
                    }
                } else if (item.itemType === 'form') {
                    formCompletion = completionStatus.forms?.[itemId];
                    isCompleted = !!formCompletion;
                }
                
                // Determine button/status display based on completion status
                let buttonHtml = '';
                
                if (item.itemType === 'task') {
                    // Task-specific button logic
                    if (!taskCompletion || !status) {
                        // Task has not been submitted yet - show action button
                        const taskType = item.type === 'form' ? 'Form' : 'Upload';
                        const taskIcon = item.type === 'form' ? 'file-alt' : 'camera';
                        const taskText = item.type === 'form' ? 'Fill Form' : 'Upload Proof';
                        buttonHtml = `<button onclick="Task.open${taskType}Modal('${itemId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-${taskIcon}"></i> ${taskText}
                        </button>`;
                    } else if (status === 'rejected') {
                        // Task was rejected - show redo button
                        const taskType = item.type === 'form' ? 'Form' : 'Upload';
                        const taskIcon = item.type === 'form' ? 'file-alt' : 'camera';
                        const taskText = item.type === 'form' ? 'Fill Form' : 'Upload Proof';
                        buttonHtml = `<button onclick="Task.open${taskType}Modal('${itemId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-${taskIcon}"></i> ${taskText} (Redo)
                        </button>`;
                    } else if (status === 'approved') {
                        // Task was approved - show approved message
                        buttonHtml = `<div class="w-full py-3 rounded-xl bg-green-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                            <i class="fas fa-check-circle"></i> Approved - Points Awarded
                        </div>`;
                    } else if (status === 'pending') {
                        // Task is pending review - show pending message
                        buttonHtml = `<div class="w-full py-3 rounded-xl bg-amber-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                            <i class="fas fa-clock"></i> Pending Review - Cannot Resubmit
                        </div>`;
                    } else {
                        // Fallback: if status is unknown but task exists in completion status, show action button
                        const taskType = item.type === 'form' ? 'Form' : 'Upload';
                        const taskIcon = item.type === 'form' ? 'file-alt' : 'camera';
                        const taskText = item.type === 'form' ? 'Fill Form' : 'Upload Proof';
                        buttonHtml = `<button onclick="Task.open${taskType}Modal('${itemId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-${taskIcon}"></i> ${taskText}
                        </button>`;
                    }
                } else if (item.itemType === 'quiz') {
                    // Quiz-specific button logic
                    if (!isCompleted) {
                        buttonHtml = `<button onclick="Quiz.startQuiz('${itemId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-puzzle-piece"></i> Start Quiz
                        </button>`;
                    } else {
                        buttonHtml = `<div class="w-full py-3 rounded-xl bg-green-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                            <i class="fas fa-check-circle"></i> Completed
                        </div>`;
                    }
                } else if (item.itemType === 'form') {
                    // Form-specific button logic
                    if (!isCompleted) {
                        buttonHtml = `<button onclick="Forms.openForm('${itemId}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-file-alt"></i> Fill Form
                        </button>`;
                    } else {
                        buttonHtml = `<div class="w-full py-3 rounded-xl bg-green-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                            <i class="fas fa-check-circle"></i> Completed
                        </div>`;
                    }
                }
                
                const itemEl = document.createElement('div');
                itemEl.className = `${gradientClass} text-white p-4 rounded-2xl shadow-lg`;
                itemEl.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-bold">${this.escapeHtml(item.title)}</h4>
                        ${(item.points || item.totalPoints) > 0 ? `<span class="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-lg">+${item.points || item.totalPoints || 0}</span>` : ''}
                    </div>
                    ${item.description ? `<p class="text-xs text-white/80 mb-4 leading-relaxed">${this.escapeHtml(item.description)}</p>` : ''}
                    ${buttonHtml}
                `;
                fragment.appendChild(itemEl);
            });
            
            allList.appendChild(fragment);
        } catch (error) {
            console.error('Error rendering all activities:', error);
            allList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load activities. Please try again.</p>';
        }
    },
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Get time ago string
     */
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    },
    
    /**
     * Initialize directory view event listeners
     */
    initDirectoryViewListeners() {
        // Search input
        const searchInput = document.getElementById('directory-search');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.directoryCurrentPage = 1;
                    this.renderDirectory();
                }, 300);
            });
        }
        
        // Filter dropdowns
    },
    
    /**
     * Initialize activity view event listeners
     */
    initActivityViewListeners() {
        // Search input
        const searchInput = document.getElementById('activity-search');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const activeTab = document.querySelector('#view-activities .bg-rota-pink.text-white')?.id?.replace('tab-btn-', '');
                    if (activeTab === 'quizzes') this.renderQuizzes();
                    else if (activeTab === 'tasks') this.renderTasks();
                    else if (activeTab === 'forms') this.renderForms();
                    else if (activeTab === 'all') this.renderAllActivities();
                }, 300);
            });
        }
        
        // Sort dropdown
        // Show completed toggle
        const completedToggle = document.getElementById('show-completed-toggle');
        if (completedToggle) {
            completedToggle.addEventListener('change', () => {
                const activeTab = document.querySelector('#view-activities .bg-rota-pink.text-white')?.id?.replace('tab-btn-', '');
                if (activeTab === 'quizzes') this.renderQuizzes();
                else if (activeTab === 'tasks') this.renderTasks();
                else if (activeTab === 'forms') this.renderForms();
                else if (activeTab === 'all') this.renderAllActivities();
            });
        }
    },
    
    async renderForms() {
        const formsList = document.getElementById('forms-list');
        if (!formsList || !Auth.currentUser) return;
        
        try {
            formsList.innerHTML = '';
            
            // Fetch pre-computed list
            const forms = await DB.getPendingForms(Auth.currentUser.uid);
            
            // Get completed if "show completed" is checked
            const showCompleted = document.getElementById('show-completed-toggle')?.checked || false;
            let allForms = forms;
            
            if (showCompleted) {
                const completed = await DB.getCompletedForms(Auth.currentUser.uid);
                allForms = [...forms, ...completed];
            }
            
            // Filter by search only
            const searchTerm = document.getElementById('activity-search')?.value || '';
            const filtered = DB.filterBySearch(allForms, searchTerm);
        
            if (filtered.length === 0) {
                const message = showCompleted 
                    ? 'No forms available' 
                    : 'No pending forms available. Check "Show Completed" to see completed forms.';
                formsList.innerHTML = `<p class="text-center text-slate-500 py-8">${message}</p>`;
                return;
            }
        
            filtered.forEach(form => {
                const isCompleted = form.completed || form.submittedAt;
            
            formsList.innerHTML += `
                <div class="gradient-form text-white p-4 rounded-2xl shadow-lg">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex-1">
                            <h4 class="font-bold">${form.title}</h4>
                            ${form.description ? `<p class="text-xs text-white/80 mt-1">${form.description}</p>` : ''}
                        </div>
                        ${form.points > 0 ? `<span class="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-lg">+${form.points}</span>` : ''}
                    </div>
                    <div class="flex items-center gap-2 text-xs text-white/70 mb-4">
                        <span><i class="fas fa-list"></i> ${form.formFieldsCount || 0} questions</span>
                        ${isCompleted ? '<span class="text-green-300"><i class="fas fa-check-circle"></i> Completed</span>' : ''}
                    </div>
                    ${!isCompleted ? `
                        <button onclick="Forms.openForm('${form.id}')" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            <i class="fas fa-file-alt"></i> Fill Form
                        </button>
                    ` : `
                        <div class="w-full py-3 rounded-xl bg-green-500/30 backdrop-blur-md text-white font-bold text-sm flex items-center justify-center gap-2 border border-white/20">
                            <i class="fas fa-check-circle"></i> Completed
                        </div>
                    `}
                </div>
            `;
            });
        } catch (error) {
            console.error('Error rendering forms:', error);
            formsList.innerHTML = '<p class="text-center text-slate-500 text-sm py-8">Failed to load forms. Please try again.</p>';
        }
    },
    
    /**
     * Load and display notification settings in profile
     */
    async loadNotificationSettings() {
        try {
            if (typeof FCMNotifications === 'undefined') {
                return;
            }
            
            const isEnabled = await FCMNotifications.isEnabled();
            const toggle = document.getElementById('notification-toggle');
            const statusText = document.getElementById('notification-status-text');
            const enableBtn = document.getElementById('enable-notifications-btn');
            
            if (toggle) {
                toggle.checked = isEnabled;
            }
            
            if (statusText) {
                if (isEnabled) {
                    statusText.textContent = 'Notifications are enabled. You will receive push notifications even when the app is closed.';
                    statusText.classList.remove('text-slate-500');
                    statusText.classList.add('text-green-600');
                } else {
                    statusText.textContent = 'Notifications are disabled. Enable to receive push notifications.';
                    statusText.classList.remove('text-green-600');
                    statusText.classList.add('text-slate-500');
                }
            }
            
            // Show enable button if notifications are not enabled
            if (enableBtn) {
                if (!isEnabled) {
                    enableBtn.classList.remove('hidden');
                } else {
                    enableBtn.classList.add('hidden');
                }
            }
        } catch (error) {
            console.error('Error loading notification settings:', error);
        }
    }
};

// Global functions for onclick handlers
function navigateTo(viewId) {
    UI.navigateTo(viewId);
}

function showLeaderboardModal() {
    UI.showLeaderboardModal();
}

function closeModal(id, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    UI.closeModal(id);
    return false;
}

// Toast is now handled by Toast module (toast.js)

function filterDirectory() {
    UI.filterDirectory();
}

function switchActivityTab(tab) {
    UI.switchActivityTab(tab);
}

function showAccessDeniedModal() {
    document.getElementById('modal-access-denied').classList.remove('hidden');
}

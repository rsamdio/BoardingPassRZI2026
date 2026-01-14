// Admin Authentication Module
// Handles admin authentication and access control

const AdminAuth = {
    currentAdmin: null,
    auth: null,
    initialized: false,
    
    /**
     * Initialize admin authentication
     */
    init() {
        if (this.initialized) {
            return;
        }
        
        try {
            this.auth = firebase.auth();
            this.auth.onAuthStateChanged((user) => {
                this.handleAuthStateChange(user);
            });
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing AdminAuth:', error);
            Toast.error('Failed to initialize authentication');
        }
    },
    
    /**
     * Handle authentication state changes
     * @param {Object|null} user - Firebase user object
     */
    async handleAuthStateChange(user) {
        try {
            if (user) {
                await this.checkAdminAccess(user);
            } else {
                this.showLogin();
            }
        } catch (error) {
            console.error('Error handling auth state change:', error);
            Toast.error('Authentication error: ' + error.message);
            this.showLogin();
        }
    },
    
    /**
     * Check if user has admin access
     * @param {Object} user - Firebase user object
     */
    async checkAdminAccess(user) {
        try {
            // Check if user is in admins collection
            const isAdmin = await DB.checkIfAdmin(user.uid);
            
            if (!isAdmin) {
                Toast.error('Access denied. Admin privileges required.');
                await this.signOut();
                return;
            }
            
            // Get admin data
            const [adminData, userData] = await Promise.all([
                DB.getAdmin(user.uid).catch(() => null),
                DB.getUser(user.uid).catch(() => null)
            ]);
            
            // Combine admin data with user data
            this.currentAdmin = {
                uid: user.uid,
                email: user.email,
                name: user.displayName || adminData?.name || userData?.name || 'Admin',
                photoURL: user.photoURL || adminData?.photoURL || userData?.photoURL || null,
                role: 'admin',
                ...adminData,
                ...userData
            };
            
            // Sync admins to RTDB to ensure RTDB security rules work
            // This is critical for adminCache access - must complete before app init
            try {
                await this.syncAdminsToRTDB();
                console.log('Admins synced to RTDB successfully');
            } catch (err) {
                console.error('Failed to sync admins to RTDB:', err);
                // Show warning but don't block login
                Toast.warning('Admin sync failed. Some features may not work. Please refresh the page.');
            }
            
            this.hideLogin();
            
            // Initialize admin app (after sync completes)
            if (typeof AdminApp !== 'undefined') {
                AdminApp.init();
            }
        } catch (error) {
            console.error('Error checking admin access:', error);
            Toast.error('Failed to verify admin access: ' + error.message);
            await this.signOut();
        }
    },
    
    /**
     * Show login screen
     */
    showLogin() {
        const loginScreen = document.getElementById('login-screen');
        const mainContent = document.getElementById('main-content');
        
        if (loginScreen) {
            loginScreen.classList.remove('hidden');
        }
        if (mainContent) {
            mainContent.classList.add('hidden');
        }
        
        this.currentAdmin = null;
    },
    
    /**
     * Hide login screen
     */
    hideLogin() {
        const loginScreen = document.getElementById('login-screen');
        const mainContent = document.getElementById('main-content');
        
        if (loginScreen) {
            loginScreen.classList.add('hidden');
        }
        if (mainContent) {
            mainContent.classList.remove('hidden');
        }
    },
    
    /**
     * Sign in with Google
     */
    async signInWithGoogle() {
        if (!this.auth) {
            Toast.error('Authentication not initialized');
            return;
        }
        
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            Toast.info('Signing in...');
            await this.auth.signInWithPopup(provider);
            // Auth state change handler will take over
        } catch (error) {
            console.error('Sign in error:', error);
            
            let errorMessage = 'Login failed';
            if (error.code === 'auth/popup-closed-by-user') {
                errorMessage = 'Sign-in cancelled';
            } else if (error.code === 'auth/popup-blocked') {
                errorMessage = 'Popup blocked. Please allow popups for this site.';
            } else {
                errorMessage = 'Login failed: ' + error.message;
            }
            
            Toast.error(errorMessage);
        }
    },
    
    /**
     * Sign out
     */
    async signOut() {
        try {
            if (this.auth) {
                await this.auth.signOut();
            }
            this.currentAdmin = null;
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Sign out error:', error);
            Toast.error('Logout failed: ' + error.message);
            // Force redirect anyway
            window.location.href = 'index.html';
        }
    },
    
    /**
     * Logout with confirmation
     */
    logout() {
        if (confirm('Are you sure you want to logout?')) {
            this.signOut();
        }
    },
    
    /**
     * Sync admins from Firestore to RTDB
     * This ensures RTDB security rules can check admin status
     */
    async syncAdminsToRTDB() {
        try {
            // Try callable function first (more secure, requires auth)
            const functions = firebase.functions();
            const syncAdminsCallable = functions.httpsCallable('syncAdminsCallable');
            
            try {
                const result = await syncAdminsCallable();
                console.log('Admins synced to RTDB:', result.data.message);
                return;
            } catch (callableError) {
                // If callable fails, try HTTP endpoint as fallback
                console.log('Callable function failed, trying HTTP endpoint...', callableError);
            }
            
            // Fallback: Use HTTP request to syncAdmins endpoint
            const region = 'us-central1'; // Match functions/index.js
            const projectId = firebase.app().options.projectId;
            const url = `https://${region}-${projectId}.cloudfunctions.net/syncAdmins`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.text();
            console.log('Admins synced to RTDB:', result);
        } catch (error) {
            console.error('Error syncing admins to RTDB:', error);
            // Don't throw - this is non-critical for login
            // Cloud Functions should handle syncing on admin create/update/delete
            // But we'll show a warning if it fails
            Toast.warning('Admin sync to RTDB failed. Some features may not work. Please refresh the page.');
        }
    }
};

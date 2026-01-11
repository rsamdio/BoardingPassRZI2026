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
            
            this.hideLogin();
            
            // Initialize admin app
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
    }
};

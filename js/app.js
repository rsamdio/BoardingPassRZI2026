// Main Application Module
const App = {
    async init() {
        // Initialize modules
        DB.init();
        
        // Initialize offline detection
        this.initOfflineDetection();
        
        // Set initial view state - hide all views initially
        // Auth.init() will trigger onAuthStateChanged which calls initializeDashboard
        // to show the appropriate view based on auth state
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
        });
        
        // Initialize auth - this will trigger onAuthStateChanged which calls initializeDashboard
        try {
            Auth.init();
        } catch (error) {
            console.error('Error initializing auth:', error);
            // Still hide loader even if auth fails
            this.hideLoader();
        }
        
        // Hide loader after a short delay (fallback in case auth doesn't trigger)
        setTimeout(() => {
            this.hideLoader();
        }, 2000);
        
        // Log cache metrics periodically (every 5 minutes)
        setInterval(() => {
            if (typeof DB !== 'undefined' && DB.logCacheMetrics) {
                DB.logCacheMetrics();
            }
        }, 5 * 60 * 1000);
    },
    
    /**
     * Hide app loader
     */
    hideLoader() {
        const loader = document.getElementById('app-loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.display = 'none';
            }, 500);
        }
    },
    
    /**
     * Initialize offline detection
     */
    initOfflineDetection() {
        // Show offline indicator
        const showOfflineIndicator = () => {
            if (!document.getElementById('offline-indicator')) {
                const indicator = document.createElement('div');
                indicator.id = 'offline-indicator';
                indicator.className = 'fixed top-0 left-0 right-0 bg-red-500 text-white text-center py-2 text-sm font-bold z-50';
                indicator.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i> You are offline. Changes will be synced when you reconnect.';
                document.body.appendChild(indicator);
            }
        };
        
        // Hide offline indicator
        const hideOfflineIndicator = () => {
            const indicator = document.getElementById('offline-indicator');
            if (indicator) {
                indicator.remove();
            }
        };
        
        // Listen to online/offline events
        window.addEventListener('online', () => {
            hideOfflineIndicator();
            Toast.success('Back online! Syncing changes...');
        });
        
        window.addEventListener('offline', () => {
            showOfflineIndicator();
            Toast.warning('You are offline');
        });
        
        // Check initial state
        if (!navigator.onLine) {
            showOfflineIndicator();
        }
    },
    
    async handleLogin() {
        await Auth.signInWithGoogle();
    },
    
    async handleOnboarding(event) {
        event.preventDefault();
        
        const name = document.getElementById('input-name').value.trim();
        const district = document.getElementById('input-district').value.trim();
        const designation = document.getElementById('input-designation').value.trim();
        
        if (!name || !district || !designation) {
            showToast('Please fill in all fields', 'error');
            return;
        }
        
        try {
            // Update user profile
            await Auth.updateProfile({
                name,
                district,
                designation
            });
            
            // Refresh currentUser with updated data
            Auth.currentUser = await DB.getUser(Auth.currentUser.uid);
            
            showToast('Profile updated successfully!', 'success');
            // Show main app after onboarding
            this.showMainApp();
        } catch (error) {
            showToast('Failed to update profile: ' + error.message, 'error');
        }
    },
    
    async handleLogout() {
        await Auth.signOut();
    },
    
    async initializeDashboard() {
        if (!Auth.currentUser) {
            // User not authenticated, show login
            this.showLoginView();
            return;
        }
        
        // Check if user needs onboarding
        if (!Auth.currentUser.district || !Auth.currentUser.designation) {
            this.showOnboardingView();
            return;
        }
        
        // User is authenticated and onboarded, show main app
        this.showMainApp();
    },
    
    /**
     * Show login view and hide app UI
     */
    showLoginView() {
        // Hide loader when showing login
        this.hideLoader();
        
        // Hide header and nav
        document.getElementById('app-header').classList.add('hidden');
        document.getElementById('app-header').classList.remove('flex');
        document.getElementById('bottom-nav').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('flex');
        
        // Show login view, hide all other views
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
        });
        const loginView = document.getElementById('view-login');
        if (loginView) {
            loginView.classList.add('active');
        }
    },
    
    /**
     * Show onboarding view
     */
    showOnboardingView() {
        // Hide loader when showing onboarding
        this.hideLoader();
        
        // Hide header and nav
        document.getElementById('app-header').classList.add('hidden');
        document.getElementById('app-header').classList.remove('flex');
        document.getElementById('bottom-nav').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('flex');
        
        // Show onboarding view, hide all other views
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
        });
        const onboardingView = document.getElementById('view-onboarding');
        if (onboardingView) {
            onboardingView.classList.add('active');
        }
    },
    
    /**
     * Show main app (authenticated and onboarded)
     */
    async showMainApp() {
        // Show header and nav immediately
        document.getElementById('app-header').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        document.getElementById('app-header').classList.add('flex');
        document.getElementById('bottom-nav').classList.add('flex');
        
        // Hide login and onboarding views immediately
        const loginView = document.getElementById('view-login');
        const onboardingView = document.getElementById('view-onboarding');
        if (loginView) loginView.classList.remove('active');
        if (onboardingView) onboardingView.classList.remove('active');
        
        // Render header immediately (synchronous, uses currentUser data)
        UI.renderHeader();
        
        // Navigate to home immediately - don't wait for data
        navigateTo('home');
        
        // Initialize event listeners immediately
        UI.initActivityViewListeners();
        UI.initDirectoryViewListeners();
        UI.initKeyboardShortcuts();
        
        // Show welcome toast immediately
        showToast(`Welcome, ${Auth.currentUser.name.split(' ')[0]}!`);
        
        // Load data progressively in parallel - don't block UI
        // Home view will show skeleton loaders while data loads
        Promise.all([
            UI.renderHome().catch(err => console.error('Error rendering home:', err)),
            UI.renderProfile().catch(err => console.error('Error rendering profile:', err))
        ]).then(() => {
            // Home and profile loaded
        });
        
        // Load directory and activities in background (user can navigate to them later)
        // These will load when user navigates to those views, or we can preload them
        Promise.all([
            UI.renderDirectory().catch(err => console.error('Error rendering directory:', err)),
            UI.renderActivities().catch(err => console.error('Error rendering activities:', err))
        ]).then(() => {
            // Directory and activities preloaded
        });
    }
};

// Initialize app on load
window.onload = function() {
    App.init();
};

// Global functions for onclick handlers
function handleLogin() {
    App.handleLogin();
}

function handleOnboarding(event) {
    App.handleOnboarding(event);
}

function handleLogout() {
    App.handleLogout();
}

// Show Privacy Policy modal
function showPrivacyPolicy(event) {
    if (event) event.preventDefault();
    const modal = document.getElementById('modal-privacy-policy');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

// Show Terms of Service modal
function showTermsOfService(event) {
    if (event) event.preventDefault();
    const modal = document.getElementById('modal-terms-of-service');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

// Authentication Module
const Auth = {
    currentUser: null,
    auth: null,
    
    init() {
        this.auth = firebase.auth();
        this.auth.onAuthStateChanged((user) => {
            if (user) {
                this.handleAuthStateChange(user);
            } else {
                this.handleLogout();
            }
        });
    },
    
    async handleAuthStateChange(user) {
        try {
            if (!user || !user.email) {
                // Hide loader before showing access denied
                if (typeof App !== 'undefined' && App.hideLoader) {
                    App.hideLoader();
                }
                showAccessDeniedModal();
                this.signOut();
                return;
            }
            
            // Check if user is a registered participant (in users or pendingUsers)
            const isParticipant = await DB.checkIfParticipant(user.uid, user.email);
            
            if (!isParticipant) {
                // Hide loader before showing access denied
                if (typeof App !== 'undefined' && App.hideLoader) {
                    App.hideLoader();
                }
                showAccessDeniedModal();
                this.signOut();
                return;
            }
        
        // Get user data (check if already in users collection)
        let userData = await DB.getUser(user.uid);
        
        // If user doesn't exist in users collection, check pendingUsers and migrate
        if (!userData) {
            const normalizedEmail = user.email.toLowerCase().trim();
            // Use checkIfParticipant logic to get pending user data
            const pendingUserRef = firebase.firestore().collection('pendingUsers').doc(normalizedEmail);
            const pendingSnap = await pendingUserRef.get();
            
            if (pendingSnap.exists) {
                // Migrate pending user to active user
                const pendingData = pendingSnap.data();
                userData = await DB.migratePendingUser(user.uid, normalizedEmail, pendingData);
            } else {
                // User should exist but doesn't - this shouldn't happen if checkIfParticipant worked
                showToast('Error: User not found. Please contact admin.', 'error');
                this.signOut();
                return;
            }
        }
        
        // Update user with auth data (displayName, photoURL, lastLoginAt) - do this in parallel with setting currentUser
        // We'll update the database but use the existing userData immediately for better UX
        const updatePromise = DB.updateUserOnLogin(user.uid, {
            displayName: user.displayName,
            photoURL: user.photoURL,
            email: user.email
        });
        
        // Set currentUser immediately with existing data + auth data (don't wait for DB update)
        // This allows the UI to show immediately while the update happens in background
        this.currentUser = { 
            ...userData, 
            uid: user.uid, 
            email: user.email,
            displayName: user.displayName || userData?.displayName || userData?.name,
            photoURL: user.photoURL || userData?.photoURL || userData?.photo // Use photoURL (fallback to photo for backward compatibility)
        };
        
        // Initialize dashboard immediately - don't wait for update
        App.initializeDashboard();
        
        // Update user data in background after UI is shown
        updatePromise.then(async () => {
            // Refresh user data after update completes
            const refreshedData = await DB.getUser(user.uid);
            if (refreshedData) {
                this.currentUser = { 
                    ...refreshedData, 
                    uid: user.uid, 
                    email: user.email,
                    photoURL: user.photoURL || refreshedData?.photoURL || refreshedData?.photo
                };
                // Update header with fresh data
                if (typeof UI !== 'undefined' && UI.renderHeader) {
                    UI.renderHeader();
                }
            }
        }).catch(err => {
            // Non-critical error, user can still use the app
        });
        } catch (error) {
            console.error('Error in handleAuthStateChange:', error);
            // Hide loader even if there's an error
            if (typeof App !== 'undefined' && App.hideLoader) {
                App.hideLoader();
            }
            // Show error to user
            showToast('Error loading app. Please refresh the page.', 'error');
        }
    },
    
    async signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await this.auth.signInWithPopup(provider);
        } catch (error) {
            showToast('Login failed: ' + error.message, 'error');
        }
    },
    
    async signOut() {
        try {
            await this.auth.signOut();
        } catch (error) {
            showToast('Logout failed: ' + error.message, 'error');
        }
    },
    
    handleLogout() {
        this.currentUser = null;
        // Use App.showLoginView to properly manage state
        if (typeof App !== 'undefined' && App.showLoginView) {
            App.showLoginView();
        } else {
            // Fallback if App is not available
            document.getElementById('app-header').classList.add('hidden');
            document.getElementById('app-header').classList.remove('flex');
            document.getElementById('bottom-nav').classList.add('hidden');
            document.getElementById('bottom-nav').classList.remove('flex');
            document.querySelectorAll('.view-section').forEach(el => {
                el.classList.remove('active');
            });
            const loginView = document.getElementById('view-login');
            if (loginView) {
                loginView.classList.add('active');
            }
        }
    },
    
    async updateProfile(data) {
        try {
            await DB.updateUser(this.currentUser.uid, data);
            this.currentUser = { ...this.currentUser, ...data };
            return this.currentUser;
        } catch (error) {
            showToast('Update failed: ' + error.message, 'error');
            throw error;
        }
    }
};

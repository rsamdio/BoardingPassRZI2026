// Admin UI Module
// Handles UI navigation, modals, and view switching

const AdminUI = {
    currentView: 'dashboard',
    keyboardShortcuts: {
        'ctrl+k': () => this.showCommandPalette(),
        'ctrl+/': () => this.showShortcutsHelp(),
        'g d': () => this.switchView('dashboard'),
        'g a': () => this.switchView('attendees'),
        'g q': () => this.switchView('quizzes'),
        'g t': () => this.switchView('tasks'),
        'g f': () => this.switchView('forms'),
        'g r': () => this.switchView('reviews'),
        'g l': () => this.switchView('leaderboard'),
        'escape': () => this.closeAllModals()
    },
    commandPaletteOpen: false,
    
    /**
     * Switch to a different view
     * @param {string} viewId - View ID to switch to
     */
    switchView(viewId) {
        if (!viewId) {
            console.error('View ID is required');
            return;
        }
        
        try {
            // Cleanup listeners for previous view
            if (this.currentView === 'submissions' && typeof AdminSubmissions !== 'undefined') {
                AdminSubmissions.cleanupListeners();
            }
            if (this.currentView === 'tasks' && typeof AdminTasks !== 'undefined') {
                AdminTasks.cleanup();
            }
            if (this.currentView === 'quizzes' && typeof AdminQuizzes !== 'undefined') {
                AdminQuizzes.cleanup();
            }
            if (this.currentView === 'forms' && typeof AdminForms !== 'undefined') {
                AdminForms.cleanup();
            }
            
            // Hide all views
            document.querySelectorAll('.view-content').forEach(el => {
                el.classList.add('hidden');
            });
            
            // Remove active state from nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('bg-rota-pink', 'text-white');
                item.classList.add('text-slate-700');
                const icon = item.querySelector('i');
                if (icon) {
                    icon.classList.remove('text-white');
                    icon.classList.add('text-slate-400');
                }
            });
            
            // Show selected view
            const view = document.getElementById(`view-${viewId}`);
            if (view) {
                view.classList.remove('hidden');
            } else {
            }
            
            // Update nav item
            const navItem = document.querySelector(`[data-view="${viewId}"]`);
            if (navItem) {
                navItem.classList.add('bg-rota-pink', 'text-white');
                navItem.classList.remove('text-slate-700');
                const icon = navItem.querySelector('i');
                if (icon) {
                    icon.classList.add('text-white');
                    icon.classList.remove('text-slate-400');
                }
            }
            
            // Update page title
            this.updatePageTitle(viewId);
            
            this.currentView = viewId;
            
            // Load view data
            this.loadViewData(viewId);
        } catch (error) {
            console.error('Error switching view:', error);
            Toast.error('Failed to switch view');
        }
    },
    
    /**
     * Update page title and subtitle
     * @param {string} viewId - View ID
     */
    updatePageTitle(viewId) {
        const titles = {
            dashboard: { title: 'Dashboard', subtitle: 'Overview and statistics' },
            attendees: { title: 'Attendees', subtitle: 'Manage event participants' },
            quizzes: { title: 'Quizzes', subtitle: 'Create and manage quizzes' },
            'quiz-creator': { title: 'Quiz Creator', subtitle: 'Create or edit quiz' },
            'quiz-submissions': { title: 'Quiz Submissions', subtitle: 'Review quiz responses' },
            'submission-detail': { title: 'Submission Details', subtitle: 'Review submission details' },
            tasks: { title: 'Tasks', subtitle: 'Create and manage tasks' },
            'task-creator': { title: 'Task Creator', subtitle: 'Create or edit task' },
            'task-submissions': { title: 'Task Submissions', subtitle: 'Review task submissions' },
            forms: { title: 'Forms/Surveys', subtitle: 'Create and manage data collection forms' },
            'form-detail': { title: 'Form Details', subtitle: 'View form information' },
            'form-submissions': { title: 'Form Responses', subtitle: 'Review form responses' },
            submissions: { title: 'Reviews', subtitle: 'Review and approve task submissions' },
            leaderboard: { title: 'Leaderboard', subtitle: 'View rankings and points' }
        };
        
        const titleInfo = titles[viewId];
        if (titleInfo) {
            const titleEl = document.getElementById('page-title');
            const subtitleEl = document.getElementById('page-subtitle');
            
            if (titleEl) {
                titleEl.textContent = titleInfo.title;
            }
            if (subtitleEl) {
                subtitleEl.textContent = titleInfo.subtitle;
            }
        }
    },
    
    /**
     * Load data for a specific view
     * @param {string} viewId - View ID
     */
    async loadViewData(viewId) {
        try {
            // Views that handle their own data loading (no warning needed)
            const selfManagedViews = [
                'quiz-creator',
                'quiz-submissions',
                'task-creator',
                'task-submissions',
                'form-detail',
                'form-submissions',
                'submission-detail'
            ];
            
            if (selfManagedViews.includes(viewId)) {
                // These views handle their own data loading, no action needed
                return;
            }
            
            switch(viewId) {
                case 'dashboard':
                    if (typeof AdminDashboard !== 'undefined') {
                        await AdminDashboard.load();
                    }
                    break;
                case 'attendees':
                    if (typeof AdminAttendees !== 'undefined') {
                        await AdminAttendees.load();
                    }
                    break;
                case 'quizzes':
                    if (typeof AdminQuizzes !== 'undefined') {
                        await AdminQuizzes.load();
                    }
                    break;
                case 'tasks':
                    if (typeof AdminTasks !== 'undefined') {
                        await AdminTasks.load();
                    }
                    break;
                case 'forms':
                    if (typeof AdminForms !== 'undefined') {
                        await AdminForms.load();
                    }
                    break;
                case 'submissions':
                    if (typeof AdminSubmissions !== 'undefined') {
                        // Initialize tabs UI on first load (default to pending)
                        AdminSubmissions.activeTab = 'pending';
                        const pendingTab = document.getElementById('tab-pending');
                        const allTab = document.getElementById('tab-all');
                        const statusFilterContainer = document.getElementById('status-filter-container');
                        
                        if (pendingTab && allTab && statusFilterContainer) {
                            pendingTab.classList.add('border-rota-pink', 'text-rota-pink');
                            pendingTab.classList.remove('border-transparent', 'text-slate-500');
                            allTab.classList.remove('border-rota-pink', 'text-rota-pink');
                            allTab.classList.add('border-transparent', 'text-slate-500');
                            statusFilterContainer.classList.add('hidden');
                        }
                        await AdminSubmissions.load();
                    }
                    break;
                case 'leaderboard':
                    if (typeof AdminLeaderboard !== 'undefined') {
                        await AdminLeaderboard.load();
                    }
                    break;
                default:
                    // Only warn for views that aren't self-managed
            }
        } catch (error) {
            console.error(`Error loading data for view ${viewId}:`, error);
            Toast.error(`Failed to load ${viewId} data`);
        }
    },
    
    /**
     * Close a modal
     * @param {string} modalId - Modal ID
     */
    closeModal(modalId) {
        if (!modalId) {
            console.error('Modal ID is required');
            return;
        }
        
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
        } else {
        }
    },
    
    /**
     * Show a modal
     * @param {string} modalId - Modal ID
     */
    showModal(modalId) {
        if (!modalId) {
            console.error('Modal ID is required');
            return;
        }
        
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
        } else {
        }
    },
    
    /**
     * Set loading state for a view
     * @param {string} viewId - View ID
     * @param {boolean} isLoading - Loading state
     */
    setLoading(viewId, isLoading) {
        // Placeholder for loading state management
        // Can be extended to show loading indicators
    },
    
    /**
     * Show skeleton loader
     * @param {string} containerId - Container element ID
     * @param {string} type - Skeleton type ('list', 'card', etc.)
     */
    showSkeleton(containerId, type = 'list') {
        const container = document.getElementById(containerId);
        if (!container) {
            return;
        }
        
        // Create skeleton HTML based on type
        let skeletonHTML = '';
        
        if (type === 'list') {
            skeletonHTML = Array(5).fill(0).map(() => `
                <div class="bg-white rounded-lg p-4 border border-slate-200 animate-pulse">
                    <div class="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                    <div class="h-3 bg-slate-200 rounded w-1/2"></div>
                </div>
            `).join('');
        } else if (type === 'card') {
            skeletonHTML = `
                <div class="bg-white rounded-lg p-6 border border-slate-200 animate-pulse">
                    <div class="h-6 bg-slate-200 rounded w-1/2 mb-4"></div>
                    <div class="h-4 bg-slate-200 rounded w-full mb-2"></div>
                    <div class="h-4 bg-slate-200 rounded w-5/6"></div>
                </div>
            `;
        }
        
        container.innerHTML = skeletonHTML;
    },
    
    /**
     * Close all modals
     */
    closeAllModals() {
        document.querySelectorAll('[id^="modal-"]').forEach(modal => {
            modal.classList.add('hidden');
        });
    },
    
    /**
     * Show command palette (placeholder)
     */
    showCommandPalette() {
        // TODO: Implement command palette
    },
    
    /**
     * Show shortcuts help (placeholder)
     */
    showShortcutsHelp() {
    }
};

// Note: Toast notifications are now handled by the Toast module (toast.js)
// This module no longer includes showToast as it's been moved to toast.js

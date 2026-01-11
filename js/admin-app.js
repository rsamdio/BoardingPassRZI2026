// Admin App Module
// Main application controller for admin dashboard

const AdminApp = {
    initialized: false,
    
    /**
     * Initialize admin application
     */
    async init() {
        if (this.initialized) {
            return;
        }
        
        if (!AdminAuth.currentAdmin) {
            AdminAuth.showLogin();
            return;
        }
        
        try {
            // Set admin name and photo
            const adminNameEl = document.getElementById('admin-name');
            const adminPhotoEl = document.getElementById('admin-photo');
            const adminIconEl = document.getElementById('admin-icon');
            
            if (adminNameEl) {
                adminNameEl.textContent = AdminAuth.currentAdmin.name || 'Admin';
            }
            
            // Set admin photo if available
            if (adminPhotoEl && AdminAuth.currentAdmin.photoURL) {
                adminPhotoEl.src = AdminAuth.currentAdmin.photoURL;
                adminPhotoEl.classList.remove('hidden');
                if (adminIconEl) {
                    adminIconEl.style.display = 'none';
                }
            } else if (adminIconEl) {
                adminIconEl.style.display = 'block';
            }
            
            // Initialize UI
            AdminUI.switchView('dashboard');
            
            // Initialize dashboard
            await AdminDashboard.load();
            
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing AdminApp:', error);
            Toast.error('Failed to initialize admin dashboard: ' + error.message);
        }
    }
};

// Admin Dashboard Module
// Handles dashboard statistics and recent activity

const AdminDashboard = {
    allActivities: [],
    filteredActivities: [],
    recentActivityListener: null,
    
    /**
     * Load dashboard data
     */
    async load() {
        try {
            await Promise.all([
                this.loadStats(),
                this.loadRecentActivity()
            ]);
        } catch (error) {
            console.error('Error loading dashboard:', error);
            Toast.error('Failed to load dashboard data');
        }
    },
    
    /**
     * Load and display statistics
     * Uses RTDB cache for cost optimization
     */
    async loadStats() {
        try {
            // Use cached stats from RTDB (much cheaper than Firestore reads)
            const stats = await DB.getAdminStats();
            
            // Update UI with current stats
            this.updateStatCard('stat-total-users', stats.totalUsers || 0, null, stats.lastUpdated);
            this.updateStatCard('stat-active-users', stats.activeUsers || 0, null, stats.lastUpdated);
            this.updateStatCard('stat-pending', stats.pendingSubmissions || 0, null, stats.lastUpdated);
            this.updateStatCard('stat-total-points', stats.totalPoints || 0, null, stats.lastUpdated);
        } catch (error) {
            console.error('Error loading stats:', error);
            Toast.error('Failed to load statistics');
        }
    },
    
    /**
     * Refresh statistics manually
     */
    async refreshStats() {
        try {
            // Clear previous stats to force fresh calculation
            localStorage.removeItem('admin_previous_stats');
            await this.loadStats();
            Toast.success('Statistics refreshed');
        } catch (error) {
            console.error('Error refreshing stats:', error);
            Toast.error('Failed to refresh statistics');
        }
    },
    
    /**
     * Update a stat card with value and timestamp
     * @param {string} statId - Base stat ID (e.g., 'stat-total-users')
     * @param {number} currentValue - Current value
     * @param {number} lastUpdated - Timestamp of last update
     */
    updateStatCard(statId, currentValue, previousValue, lastUpdated) {
        // Update main value
        const valueEl = document.getElementById(statId);
        if (valueEl) {
            valueEl.textContent = this.formatNumber(currentValue || 0);
        }
        
        // Update timestamp (only show if data is stale - more than 5 minutes old)
        const updatedEl = document.getElementById(`${statId}-updated`);
        if (updatedEl && lastUpdated) {
            const date = new Date(lastUpdated);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            
            // Only show timestamp if data is more than 5 minutes old (indicates potential staleness)
            if (diffMins > 5) {
                if (diffMins < 60) {
                    updatedEl.textContent = `Updated ${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
                } else {
                    const diffHours = Math.floor(diffMins / 60);
                    updatedEl.textContent = `Updated ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                }
                updatedEl.classList.remove('hidden');
            } else {
                // Hide timestamp if data is fresh (less than 5 minutes old)
                updatedEl.textContent = '';
                updatedEl.classList.add('hidden');
            }
        }
        
        // Update card color based on value (for pending submissions)
        if (statId === 'stat-pending') {
            const cardEl = document.querySelector(`[data-stat="pending"]`);
            if (cardEl) {
                if (currentValue > 10) {
                    cardEl.classList.add('border-amber-300', 'bg-amber-50');
                    cardEl.classList.remove('border-slate-200');
                } else if (currentValue === 0) {
                    cardEl.classList.add('border-green-300', 'bg-green-50');
                    cardEl.classList.remove('border-slate-200', 'border-amber-300', 'bg-amber-50');
                } else {
                    cardEl.classList.remove('border-amber-300', 'bg-amber-50', 'border-green-300', 'bg-green-50');
                    cardEl.classList.add('border-slate-200');
                }
            }
        }
    },
    
    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    
    
    /**
     * Navigate to relevant view when stat card is clicked
     */
    navigateToStat(statType) {
        if (statType === 'attendees') {
            AdminUI.switchView('attendees');
        } else if (statType === 'reviews') {
            AdminUI.switchView('submissions');
            // Switch to pending tab
            if (AdminSubmissions && typeof AdminSubmissions.switchTab === 'function') {
                AdminSubmissions.switchTab('pending');
            }
        } else if (statType === 'leaderboard') {
            AdminUI.switchView('leaderboard');
        }
    },
    
    /**
     * Update a stat element safely (legacy method for compatibility)
     * @param {string} elementId - Element ID
     * @param {number} value - Value to display
     */
    updateStatElement(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = this.formatNumber(value || 0);
        }
    },
    
    /**
     * Load and display recent activity
     * Uses RTDB cache for cost optimization, with real-time listener support
     */
    async loadRecentActivity() {
        const activityEl = document.getElementById('recent-activity');
        if (!activityEl) return;
        
        activityEl.innerHTML = '<p class="text-sm text-slate-500 text-center py-4">Loading...</p>';
        
        try {
            // Use cached recent activity from RTDB (much cheaper than Firestore reads)
            const recentActivities = await DB.getRecentActivity(20); // Get more for filtering
            
            // Store all activities
            this.allActivities = recentActivities;
            
            // Apply current filters
            this.filterActivity();
            
            // Set up real-time listener for updates
            this.setupRecentActivityListener();
            
        } catch (error) {
            console.error('Error loading recent activity:', error);
            activityEl.innerHTML = '<p class="text-sm text-red-500 text-center py-4">Error loading recent activity</p>';
        }
    },
    
    /**
     * Filter recent activity by type and status
     */
    filterActivity() {
        const typeFilter = document.getElementById('activity-filter-type')?.value || 'all';
        const statusFilter = document.getElementById('activity-filter-status')?.value || 'all';
        
        // Filter activities
        let filtered = [...this.allActivities];
        
        if (typeFilter !== 'all') {
            filtered = filtered.filter(a => a.type === typeFilter);
        }
        
        if (statusFilter !== 'all') {
            filtered = filtered.filter(a => a.status === statusFilter);
        }
        
        // Sort by submittedAt descending and limit to 8
        filtered.sort((a, b) => b.submittedAt - a.submittedAt);
        this.filteredActivities = filtered.slice(0, 8);
        
        // Render filtered activities
        this.renderRecentActivity(this.filteredActivities);
    },
    
    /**
     * Set up RTDB listener for real-time recent activity updates
     */
    setupRecentActivityListener() {
        // Remove existing listener if any
        if (this.recentActivityListener) {
            DB.rtdb.ref('adminCache/recentActivity').off('value', this.recentActivityListener);
        }
        
        // Set up new listener
        this.recentActivityListener = (snapshot) => {
            if (snapshot.exists()) {
                const cacheData = snapshot.val();
                if (cacheData.items) {
                    // Convert object to array
                    const activities = Object.values(cacheData.items)
                        .filter(item => item !== null)
                        .sort((a, b) => b.submittedAt - a.submittedAt);
                    
                    // Store all activities and apply filters
                    this.allActivities = activities;
                    this.filterActivity();
                }
            }
        };
        
        DB.rtdb.ref('adminCache/recentActivity').on('value', this.recentActivityListener);
    },
    
    /**
     * Render recent activity items
     */
    renderRecentActivity(activities) {
        const activityEl = document.getElementById('recent-activity');
        if (!activityEl) return;
        
        if (activities.length === 0) {
            activityEl.innerHTML = '<p class="text-sm text-slate-500 text-center py-4">No recent activity</p>';
            return;
        }
        
        activityEl.innerHTML = '';
        activities.forEach(activity => {
            const userName = activity.userName || activity.name || 'Unknown';
            const taskTitle = activity.taskTitle || activity.title || 'Untitled';
            const status = activity.status || 'pending';
            const type = activity.type || 'task';
            
            let icon = 'file-upload';
            if (type === 'form') {
                icon = 'file-alt';
            } else if (type === 'quiz') {
                icon = 'puzzle-piece';
            }
            
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer';
            item.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-${status === 'approved' || status === 'completed' ? 'green' : status === 'rejected' ? 'red' : 'amber'}-100 flex items-center justify-center">
                    <i class="fas fa-${icon} text-${status === 'approved' || status === 'completed' ? 'green' : status === 'rejected' ? 'red' : 'amber'}-600"></i>
                </div>
                <div class="flex-1">
                    <p class="text-sm font-medium text-slate-800">${this.escapeHtml(userName)}</p>
                    <p class="text-xs text-slate-500">${this.escapeHtml(taskTitle)}</p>
                </div>
                <span class="text-xs px-2 py-1 rounded-full bg-white ${status === 'approved' || status === 'completed' ? 'text-green-700' : status === 'rejected' ? 'text-red-700' : 'text-amber-700'}">${status}</span>
            `;
            activityEl.appendChild(item);
        });
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
     * Handle quick search
     */
    handleQuickSearch(event) {
        if (event.key === 'Enter') {
            const query = event.target.value.trim().toLowerCase();
            if (query) {
                // Navigate to attendees and trigger search
                AdminUI.switchView('attendees');
                // Trigger search in attendees view if available
                setTimeout(() => {
                    const searchInput = document.querySelector('#attendees-view input[type="search"]');
                    if (searchInput) {
                        searchInput.value = query;
                        searchInput.dispatchEvent(new Event('input'));
                    }
                }, 100);
            }
        }
    },
    
    /**
     * Update pending reviews badge
     */
    async updatePendingBadge() {
        try {
            const counts = await DB.getSubmissionCounts();
            const badgeEl = document.getElementById('pending-reviews-badge');
            if (badgeEl) {
                const pending = counts.pending || 0;
                if (pending > 0) {
                    badgeEl.textContent = `${pending} pending`;
                    badgeEl.classList.remove('hidden');
                } else {
                    badgeEl.classList.add('hidden');
                }
            }
        } catch (error) {
        }
    }
};

// Initialize on load
window.addEventListener('DOMContentLoaded', function() {
    try {
        if (typeof DB !== 'undefined' && typeof AdminAuth !== 'undefined') {
            // DB.init() is synchronous, no need for .then()
            DB.init();
            AdminAuth.init();
        } else {
            console.error('DB or AdminAuth modules not loaded');
            if (typeof Toast !== 'undefined') {
                Toast.error('Application modules failed to load');
            }
        }
    } catch (error) {
        console.error('Failed to initialize application:', error);
        if (typeof Toast !== 'undefined') {
            Toast.error('Failed to initialize application');
        }
    }
});

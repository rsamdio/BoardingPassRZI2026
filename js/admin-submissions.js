// Admin Submissions Module
// Handles submission review, approval, and rejection

const AdminSubmissions = {
    submissions: [],
    loading: false,
    activeTab: 'pending', // 'pending' or 'all'
    currentSubmissions: {
        submissions: [],
        currentIndex: 0,
        filteredSubmissions: []
    },
    statusListeners: {}, // Track RTDB listeners for status paths
    processingSubmissions: new Set(), // Track submissions being processed
    _settingUpListeners: false, // Flag to prevent listener callbacks during setup
    _justLoaded: false, // Flag to prevent immediate listener-triggered reload after load
    _lastLoadTime: 0, // Timestamp of last load to prevent rapid reloads
    
    /**
     * Load submissions
     * @param {string} statusFilter - Optional status filter ('pending', 'all', etc.)
     */
    async load(statusFilter = null) {
        if (this.loading) {
            return;
        }
        
        try {
            this.loading = true;
            // Use activeTab if no filter provided
            const filter = statusFilter || this.activeTab;
            
            await this.fetchSubmissions(filter);
            await this.render();
            
            // Update last known counts after successful load
            if (!this._lastSubmissionCounts) {
                this._lastSubmissionCounts = {};
            }
            if (filter === 'all') {
                // Update counts for all statuses
                ['pending', 'approved', 'rejected'].forEach(status => {
                    const statusSubmissions = this.submissions.filter(s => s.status === status);
                    this._lastSubmissionCounts[status] = statusSubmissions.length;
                });
            } else {
                this._lastSubmissionCounts[filter] = this.submissions.length;
            }
            
            // Set up real-time listeners after initial load (only if not already set up)
            // Don't re-setup if listeners are already active for this filter
            if (!this._listenersSetup || this._lastFilter !== filter) {
                this._settingUpListeners = true; // Prevent listener callbacks during setup
                this._justLoaded = true; // Prevent immediate listener-triggered reload
                this.setupRealtimeListeners(filter);
                this._listenersSetup = true;
                this._lastFilter = filter;
                // Allow listener callbacks after a delay (after setup completes and initial listener fires are ignored)
                setTimeout(() => {
                    this._settingUpListeners = false;
                    this._justLoaded = false;
                }, 2000); // Increased to 2 seconds to ensure initial listener fires are ignored
            }
        } catch (error) {
            console.error('Error loading submissions:', error);
            Toast.error('Failed to load submissions');
        } finally {
            this.loading = false;
            this._lastLoadTime = Date.now();
        }
    },
    
    /**
     * Set up real-time listeners for submission status changes
     * @param {string} statusFilter - Current status filter
     */
    setupRealtimeListeners(statusFilter) {
        // Remove existing listeners
        this.cleanupListeners();
        
        if (statusFilter === 'all') {
            // Listen to all status paths
            ['pending', 'approved', 'rejected'].forEach(status => {
                this.setupStatusListener(status);
            });
        } else {
            // Listen only to the current status path
            this.setupStatusListener(statusFilter);
        }
    },
    
    /**
     * Set up listener for a specific status path
     * @param {string} status - Status to listen to
     */
    setupStatusListener(status) {
        const path = `cache/admin/submissions/byStatus/${status}`;
        const ref = DB.rtdb.ref(path);
        
        // Remove existing listener for this path if any
        if (this.statusListeners[status]) {
            ref.off('value', this.statusListeners[status]);
            delete this.statusListeners[status];
        }
        
        // Track last known submission count to prevent unnecessary refreshes
        if (!this._lastSubmissionCounts) {
            this._lastSubmissionCounts = {};
        }
        
        // Create new listener
        this.statusListeners[status] = (snapshot) => {
            // Don't update while loading or if not viewing this tab
            if (this.loading) {
                return;
            }
            
            // Only update if we're viewing this status or 'all'
            if (this.activeTab !== status && this.activeTab !== 'all') {
                return;
            }
            
            // Check if data actually changed
            const currentData = snapshot.val();
            const currentCount = currentData ? Object.keys(currentData).length : 0;
            const lastCount = this._lastSubmissionCounts[status] || 0;
            
            if (currentCount === lastCount) {
                // Count hasn't changed, might be a false trigger
                return;
            }
            
            // Update last known count
            this._lastSubmissionCounts[status] = currentCount;
            
            
            // Debounce: Small delay to batch rapid updates
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = setTimeout(() => {
                // Prevent refresh if:
                // 1. Already loading
                // 2. Setting up listeners (initial setup)
                // 3. Just loaded (within last 2 seconds - prevents immediate reload after initial load)
                // 4. Processing a submission (optimistic update in progress)
                // 5. Not on the right tab
                const timeSinceLastLoad = Date.now() - this._lastLoadTime;
                if (!this.loading && 
                    !this._settingUpListeners &&
                    !this._justLoaded &&
                    timeSinceLastLoad > 2000 && // At least 2 seconds since last load
                    this.processingSubmissions.size === 0 && 
                    (this.activeTab === status || this.activeTab === 'all')) {
                    this.load(this.activeTab).catch(err => {
                        console.error('Error refreshing after real-time update:', err);
                    });
                }
            }, 1500); // Increased debounce to 1500ms to allow processing to complete
        };
        
        // Get initial count and set up listener
        // Use once() first to get initial state without triggering the listener callback
        ref.once('value', (snapshot) => {
            const data = snapshot.val();
            const initialCount = data ? Object.keys(data).length : 0;
            this._lastSubmissionCounts[status] = initialCount;
            
            // Now set up the listener - it will fire immediately, but we'll ignore it if _justLoaded is true
            // Use a small delay to ensure _justLoaded flag is set before listener fires
            setTimeout(() => {
                ref.on('value', this.statusListeners[status], (error) => {
                    console.error(`Error listening to ${status} submissions:`, error);
                });
            }, 100);
        });
    },
    
    /**
     * Clean up all RTDB listeners
     */
    cleanupListeners() {
        Object.keys(this.statusListeners).forEach(status => {
            const path = `cache/admin/submissions/byStatus/${status}`;
            const ref = DB.rtdb.ref(path);
            if (this.statusListeners[status]) {
                ref.off('value', this.statusListeners[status]);
            }
        });
        this.statusListeners = {};
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }
        this._listenersSetup = false;
        this._lastFilter = null;
    },
    
    /**
     * Fetch submissions using pre-computed metadata (fast, no Firestore reads for list view)
     */
    async fetchSubmissions(statusFilter = 'all') {
        try {
            // Fetch pre-computed submission IDs by status
            let submissionIds = [];
            
            if (statusFilter === 'all') {
                // Combine IDs from all statuses
                const [pendingResult, approvedResult, rejectedResult] = await Promise.all([
                    DB.readFromCache('admin/submissions/byStatus/pending'),
                    DB.readFromCache('admin/submissions/byStatus/approved'),
                    DB.readFromCache('admin/submissions/byStatus/rejected')
                ]);
                
                submissionIds = [
                    ...(pendingResult.data ? Object.keys(pendingResult.data) : []),
                    ...(approvedResult.data ? Object.keys(approvedResult.data) : []),
                    ...(rejectedResult.data ? Object.keys(rejectedResult.data) : [])
                ];
            } else {
                const result = await DB.readFromCache(`admin/submissions/byStatus/${statusFilter}`);
                submissionIds = result.data ? Object.keys(result.data) : [];
            }
            
            if (submissionIds.length === 0) {
                this.submissions = [];
                return;
            }
            
            // Fetch submission metadata (pre-computed, fast)
            const metadataPromises = submissionIds.map(id => 
                DB.readFromCache(`admin/submissions/metadata/${id}`)
            );
            const metadataResults = await Promise.all(metadataPromises);
            
            // Use metadata for list view (no Firestore reads!)
            let submissionsMetadata = metadataResults
                .map(r => r.data)
                .filter(s => s !== null)
                .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
            
            // Client-side filtering: If filtering by status, ensure we only show items with that status
            // This is a safety measure in case the cache is stale
            // Note: The byStatus path should already be filtered correctly, but we double-check here
            if (statusFilter !== 'all') {
                const beforeFilter = submissionsMetadata.length;
                submissionsMetadata = submissionsMetadata.filter(s => {
                    const submissionStatus = s.status || 'pending';
                    return submissionStatus === statusFilter;
                });
                
                // Only log if there's a significant mismatch (indicates cache sync issue)
                if (beforeFilter > submissionsMetadata.length && beforeFilter > 0) {
                    const filteredCount = beforeFilter - submissionsMetadata.length;
                }
            }
            
            this.submissions = submissionsMetadata;
            
        } catch (error) {
            console.error('Error fetching submissions:', error);
            this.submissions = [];
            throw error;
        }
    },
    
    /**
     * Load full submission from Firestore (only when viewing details)
     */
    async loadFullSubmission(submissionId) {
        try {
            // Try to find in submissions collection first
            let doc = await DB.db.collection('submissions').doc(submissionId).get();
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            
            // Try formSubmissions
            doc = await DB.db.collection('formSubmissions').doc(submissionId).get();
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            
            // Try quizSubmissions
            doc = await DB.db.collection('quizSubmissions').doc(submissionId).get();
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            
            return null;
        } catch (error) {
            console.error(`Error loading full submission ${submissionId}:`, error);
            return null;
        }
    },
    
    /**
     * Switch between tabs
     * @param {string} tab - Tab name ('pending' or 'all')
     */
    async switchTab(tab) {
        if (tab === this.activeTab) return;
        
        this.activeTab = tab;
        
        // Update tab UI
        const pendingTab = document.getElementById('tab-pending');
        const allTab = document.getElementById('tab-all');
        const statusFilterContainer = document.getElementById('status-filter-container');
        
        if (pendingTab && allTab && statusFilterContainer) {
            if (tab === 'pending') {
                pendingTab.classList.add('border-rota-pink', 'text-rota-pink');
                pendingTab.classList.remove('border-transparent', 'text-slate-500');
                allTab.classList.remove('border-rota-pink', 'text-rota-pink');
                allTab.classList.add('border-transparent', 'text-slate-500');
                statusFilterContainer.classList.add('hidden');
            } else {
                allTab.classList.add('border-rota-pink', 'text-rota-pink');
                allTab.classList.remove('border-transparent', 'text-slate-500');
                pendingTab.classList.remove('border-rota-pink', 'text-rota-pink');
                pendingTab.classList.add('border-transparent', 'text-slate-500');
                statusFilterContainer.classList.remove('hidden');
            }
        }
        
        // Reload submissions with the new filter (this will also set up listeners)
        await this.load(tab);
    },
    
    /**
     * Filter submissions by form
     * @param {string} formId - Form ID
     */
    async filterByForm(formId) {
        if (!formId) {
            await this.load();
            return;
        }
        
        const filtered = this.submissions.filter(s => 
            (s.submissionType === 'form' && s.formId === formId) ||
            (s.taskId === formId && s.type === 'form')
        );
        
        const original = this.submissions;
        this.submissions = filtered;
        await this.render();
        this.submissions = original;
    },
    
    /**
     * Render submissions list
     */
    async render() {
        const list = document.getElementById('submissions-list');
        if (!list) {
            console.error('Submissions list element not found');
            return;
        }
        
        list.innerHTML = '';
        
        if (this.submissions.length === 0) {
            list.innerHTML = '<p class="text-center text-slate-500 py-8">No submissions found</p>';
            return;
        }
        
        try {
            // Process all submissions in parallel
            const submissionCards = await Promise.all(
                this.submissions.map(async (submission) => {
                    return await this.renderSubmissionCard(submission);
                })
            );
            
            // Append all cards to the list
            submissionCards.forEach(html => {
                if (html) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = html;
                    list.appendChild(tempDiv.firstElementChild);
                }
            });
        } catch (error) {
            console.error('Error rendering submissions:', error);
            list.innerHTML = '<p class="text-center text-red-500 py-8">Error rendering submissions</p>';
        }
    },
    
    /**
     * Render a single submission card
     * @param {Object} submission - Submission object
     * @returns {string} HTML string
     */
    async renderSubmissionCard(submission) {
        try {
            // Format date properly
            const formattedDate = Utils.formatDate(submission.submittedAt);
            
            // Get task definition to map form field IDs to labels (only for task-type forms)
            let fieldLabelsMap = {};
            let task = null;
            try {
                if (submission.type === 'form' && submission.taskId) {
                    // This is a task-type form
                    task = await DB.getTask(submission.taskId);
                    if (task) {
                        if (task.formFields && Array.isArray(task.formFields)) {
                            task.formFields.forEach(field => {
                                if (field.id && field.label) {
                                    fieldLabelsMap[field.id] = field.label;
                                }
                            });
                        }
                    } else {
                    }
                }
            } catch (e) {
                console.error('Error fetching task for field labels:', e, submission);
            }
            
            // Format form data with proper labels (only for task-type forms)
            let formDataHTML = '';
            if (submission.type === 'form' && submission.formData) {
                formDataHTML = '<div class="mb-4 bg-slate-50 rounded-lg p-4"><h5 class="font-bold text-slate-800 mb-3 text-sm">Form Responses:</h5>';
                
                // Only show fields that have proper labels from the task definition
                // Filter out any entries that don't have a label in fieldLabelsMap
                const entriesWithLabels = Object.entries(submission.formData)
                    .filter(([key]) => {
                        // Only include if we have a label from the task definition
                        return fieldLabelsMap[key];
                    })
                    .map(([key, value]) => {
                        return {
                            label: fieldLabelsMap[key],
                            value: value
                        };
                    });
                
                if (entriesWithLabels.length > 0) {
                    entriesWithLabels.forEach(({ label, value }) => {
                        const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
                        formDataHTML += `
                            <div class="mb-2 pb-2 border-b border-slate-200 last:border-0">
                                <span class="font-medium text-slate-700 text-sm">${this.escapeHtml(label)}:</span>
                                <span class="text-slate-600 ml-2 text-sm">${this.escapeHtml(displayValue)}</span>
                            </div>
                        `;
                    });
                } else {
                    // Fallback: if task definition not found or no labels match, show responses
                    // Just show the answers directly (no labels needed for single input forms)
                    const allEntries = Object.entries(submission.formData).filter(([key, value]) => {
                        // Only show entries with actual values
                        return value !== null && value !== undefined && String(value).trim() !== '';
                    });
                    
                    if (allEntries.length > 0) {
                        // Show responses directly without labels
                        allEntries.forEach(([key, value]) => {
                            const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
                            formDataHTML += `
                                <div class="mb-2 pb-2 border-b border-slate-200 last:border-0">
                                    <span class="text-slate-700 text-sm">${this.escapeHtml(displayValue)}</span>
                                </div>
                            `;
                        });
                    } else {
                        formDataHTML += '<p class="text-sm text-slate-500 italic">No responses provided</p>';
                    }
                }
                formDataHTML += '</div>';
            }
            
            const statusDisplay = SubmissionHelpers.getStatusDisplay(submission.status || 'pending');
            
            // Show form data inline if it's a form submission
            const formDataDisplay = formDataHTML || '';
            
            // Action buttons based on status
            let actionButtons = '';
            if (submission.status === 'pending') {
                actionButtons = `
                    <div class="flex gap-2 mt-4 pt-4 border-t border-slate-200">
                        <button onclick="AdminSubmissions.handleApprove('${submission.id}', 'task')" class="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center gap-2">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button onclick="AdminSubmissions.handleReject('${submission.id}', 'task')" class="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium flex items-center justify-center gap-2">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                `;
            } else if (submission.status === 'rejected' && submission.rejectionReason) {
                actionButtons = `
                    <div class="mt-4 pt-4 border-t border-slate-200">
                        <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                            <p class="text-xs font-medium text-red-800 mb-1">Rejection Reason:</p>
                            <p class="text-sm text-red-700">${this.escapeHtml(submission.rejectionReason)}</p>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div class="bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex-1">
                            <h4 class="font-bold text-lg text-slate-800 mb-1">${this.escapeHtml(submission.taskTitle || submission.title || 'Untitled')}</h4>
                            <p class="text-sm text-slate-500">Submitted by: ${this.escapeHtml(submission.userName || submission.name || 'Unknown')}</p>
                            <p class="text-xs text-slate-400 mt-1">${formattedDate}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="px-3 py-1 rounded-full text-xs font-bold ${statusDisplay.className}">${submission.status || 'pending'}</span>
                        </div>
                    </div>
                    
                    ${submission.type === 'upload' && submission.fileURL ? `
                        <div class="mb-4">
                            <a href="${submission.fileURL}" target="_blank" class="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm font-medium">
                                <i class="fas fa-external-link-alt"></i> View File
                            </a>
                        </div>
                    ` : ''}
                    
                    ${formDataDisplay}
                    
                    ${actionButtons}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering submission card:', error, submission);
            return null;
        }
    },
    
    /**
     * Filter submissions by status
     */
    async filterSubmissions() {
        const filterEl = document.getElementById('submission-filter');
        if (!filterEl) return;
        
        const statusFilter = filterEl.value;
        const filtered = statusFilter === 'all' 
            ? this.submissions 
            : this.submissions.filter(s => s.status === statusFilter);
        
        const original = this.submissions;
        this.submissions = filtered;
        await this.render();
        this.submissions = original;
    },
    
    /**
     * View submission detail in step flow
     * @param {string} submissionId - Submission ID
     */
    async viewSubmissionDetail(submissionId) {
        if (!submissionId) {
            Toast.error('Invalid submission ID');
            return;
        }
        
        const submission = this.submissions.find(s => s.id === submissionId);
        if (!submission) {
            Toast.error('Submission not found');
            return;
        }
        
        // Find index in current filtered list
        const currentIndex = this.submissions.findIndex(s => s.id === submissionId);
        
        // Store current submissions for navigation
        this.currentSubmissions = {
            submissions: [...this.submissions], // Copy of current filtered list
            currentIndex: currentIndex >= 0 ? currentIndex : 0,
            filteredSubmissions: [...this.submissions]
        };
        
        // Render detail view
        await this.renderSubmissionDetailView();
    },
    
    /**
     * Render submission detail view (step flow)
     */
    async renderSubmissionDetailView() {
        const { submissions, currentIndex } = this.currentSubmissions;
        
        const titleEl = document.getElementById('submission-detail-title');
        const typeEl = document.getElementById('submission-detail-type');
        const contentEl = document.getElementById('submission-detail-content');
        const currentEl = document.getElementById('submission-detail-current');
        const totalEl = document.getElementById('submission-detail-total');
        const progressEl = document.getElementById('submission-detail-progress');
        const prevBtn = document.getElementById('submission-detail-prev');
        const nextBtn = document.getElementById('submission-detail-next');
        const downloadBtn = document.getElementById('submission-detail-download');
        
        if (!titleEl || !typeEl || !contentEl || !currentEl || !totalEl || !progressEl || !prevBtn || !nextBtn || !downloadBtn) {
            Toast.error('Submission detail view elements not found');
            return;
        }
        
        // Update navigation
        currentEl.textContent = submissions.length > 0 ? currentIndex + 1 : 0;
        totalEl.textContent = submissions.length;
        const progress = submissions.length > 0 ? ((currentIndex + 1) / submissions.length) * 100 : 0;
        progressEl.style.width = progress + '%';
        
        // Update button states
        prevBtn.disabled = currentIndex === 0;
        prevBtn.classList.toggle('opacity-50', currentIndex === 0);
        prevBtn.classList.toggle('cursor-not-allowed', currentIndex === 0);
        nextBtn.disabled = currentIndex >= submissions.length - 1;
        nextBtn.classList.toggle('opacity-50', currentIndex >= submissions.length - 1);
        nextBtn.classList.toggle('cursor-not-allowed', currentIndex >= submissions.length - 1);
        
        // Render current submission
        contentEl.innerHTML = '';
        
        if (submissions.length === 0) {
            contentEl.innerHTML = '<div class="text-center text-slate-500 py-16"><p class="text-lg">No submissions to display</p></div>';
            return;
        }
        
        const submission = submissions[currentIndex];
        
        // Update title and type
        titleEl.textContent = submission.taskTitle || submission.title || 'Untitled Submission';
        typeEl.textContent = submission.submissionType === 'form' ? 'Form Submission' : 'Task Submission';
        
        // Get form/task definition for field labels
        let fieldLabelsMap = {};
        let taskOrForm = null;
        try {
            if (submission.type === 'form' && submission.taskId) {
                taskOrForm = await DB.getTask(submission.taskId);
                if (taskOrForm && taskOrForm.formFields) {
                    taskOrForm.formFields.forEach(field => {
                        fieldLabelsMap[field.id] = field.label;
                    });
                }
            } else if (submission.submissionType === 'form' && submission.formId) {
                taskOrForm = await DB.getForm(submission.formId);
                if (taskOrForm && taskOrForm.formFields) {
                    taskOrForm.formFields.forEach(field => {
                        fieldLabelsMap[field.id] = field.label;
                    });
                }
            } else if (submission.taskId) {
                taskOrForm = await DB.getTask(submission.taskId);
            }
        } catch (e) {
        }
        
        // Format date
        const formattedDate = Utils.formatDate(submission.submittedAt);
        const statusDisplay = SubmissionHelpers.getStatusDisplay(submission.status || 'pending');
        
        // Get user details
        let user = { name: submission.userName || submission.name || 'Unknown', email: 'N/A' };
        try {
            const userData = await DB.getUser(submission.userId, false);
            if (userData) {
                user = { name: userData.name || user.name, email: userData.email || 'N/A' };
            }
        } catch (e) {
        }
        
        // Build form data HTML
        let formDataHTML = '';
        if ((submission.type === 'form' || submission.submissionType === 'form') && submission.formData) {
            formDataHTML = '<div class="bg-slate-50 rounded-lg p-4 mb-4"><h5 class="font-bold text-slate-800 mb-3">Form Responses:</h5>';
            Object.entries(submission.formData).forEach(([key, value]) => {
                const label = fieldLabelsMap[key] || Utils.cleanFieldId(key) || key;
                const displayValue = Array.isArray(value) ? value.join(', ') : value;
                formDataHTML += `
                    <div class="mb-3 pb-3 border-b border-slate-200 last:border-0">
                        <span class="font-medium text-slate-700">${this.escapeHtml(label)}:</span>
                        <span class="text-slate-600 ml-2">${this.escapeHtml(String(displayValue || '(empty)'))}</span>
                    </div>
                `;
            });
            formDataHTML += '</div>';
        }
        
        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200 rounded-xl p-6 max-w-3xl mx-auto';
        card.innerHTML = `
            <div class="flex justify-between items-start mb-6 pb-4 border-b border-slate-200">
                <div>
                    <h4 class="font-bold text-xl text-slate-800 mb-1">${this.escapeHtml(submission.taskTitle || submission.title || 'Untitled')}</h4>
                    <p class="text-sm text-slate-500">${this.escapeHtml(user.name)}</p>
                    <p class="text-xs text-slate-400 mt-1">${this.escapeHtml(user.email)}</p>
                </div>
                <div class="text-right">
                    <span class="px-3 py-1 rounded-full text-xs font-bold ${statusDisplay.className} mb-2 block">${submission.status || 'pending'}</span>
                    <p class="text-xs text-slate-400">${formattedDate}</p>
                </div>
            </div>
            
            ${submission.type === 'upload' && submission.fileURL ? `
                <div class="mb-6">
                    <h5 class="font-bold text-slate-800 mb-2">Uploaded File:</h5>
                    <a href="${submission.fileURL}" target="_blank" class="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors">
                        <i class="fas fa-external-link-alt"></i> View File
                    </a>
                </div>
            ` : ''}
            
            ${formDataHTML}
            
            ${submission.rejectionReason ? `
                <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <h5 class="font-bold text-red-800 mb-2">Rejection Reason:</h5>
                    <p class="text-red-700">${this.escapeHtml(submission.rejectionReason)}</p>
                </div>
            ` : ''}
            
            ${submission.status === 'pending' && submission.submissionType !== 'form' ? `
                <div class="flex gap-3 mt-6 pt-4 border-t border-slate-200">
                    <button onclick="AdminSubmissions.handleApprove('${submission.id}', '${submission.submissionType || 'task'}')" class="flex-1 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button onclick="AdminSubmissions.handleReject('${submission.id}', '${submission.submissionType || 'task'}')" class="flex-1 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium">
                        <i class="fas fa-times"></i> Reject
                    </button>
                </div>
            ` : submission.submissionType === 'form' ? `
                <div class="mt-6 pt-4 border-t border-slate-200">
                    <div class="text-sm text-slate-500 bg-blue-50 p-3 rounded-lg">
                        <i class="fas fa-info-circle"></i> Form submissions are automatically recorded
                    </div>
                </div>
            ` : ''}
        `;
        contentEl.appendChild(card);
        
        // Setup download button
        downloadBtn.onclick = () => this.downloadSubmission(submission, user);
        
        // Switch to detail view
        AdminUI.switchView('submission-detail');
    },
    
    /**
     * Navigate to previous submission
     */
    previousSubmission() {
        if (this.currentSubmissions.currentIndex > 0) {
            this.currentSubmissions.currentIndex--;
            this.renderSubmissionDetailView();
        }
    },
    
    /**
     * Navigate to next submission
     */
    nextSubmission() {
        if (this.currentSubmissions.currentIndex < this.currentSubmissions.submissions.length - 1) {
            this.currentSubmissions.currentIndex++;
            this.renderSubmissionDetailView();
        }
    },
    
    /**
     * Back to submissions list
     */
    backToSubmissions() {
        this.currentSubmissions = {
            submissions: [],
            currentIndex: 0,
            filteredSubmissions: []
        };
        AdminUI.switchView('submissions');
    },
    
    /**
     * Download single submission
     * @param {Object} submission - Submission object
     * @param {Object} user - User object
     */
    downloadSubmission(submission, user) {
        try {
            const formattedDate = Utils.formatDate(submission.submittedAt);
            
            let csv = '';
            
            if (submission.type === 'upload') {
                // File upload submission
                csv = [
                    ['Field', 'Value'],
                    ['Participant Name', user.name || 'Unknown'],
                    ['Email', user.email || 'N/A'],
                    ['Task/Form Title', submission.taskTitle || submission.title || 'Untitled'],
                    ['Type', 'File Upload'],
                    ['File URL', submission.fileURL || 'N/A'],
                    ['Status', submission.status || 'pending'],
                    ['Submitted Date', formattedDate],
                    ['Rejection Reason', submission.rejectionReason || '']
                ];
            } else if (submission.formData) {
                // Form submission
                const headers = ['Field', 'Value'];
                const rows = [
                    ['Participant Name', user.name || 'Unknown'],
                    ['Email', user.email || 'N/A'],
                    ['Task/Form Title', submission.taskTitle || submission.title || 'Untitled'],
                    ['Type', 'Form Submission'],
                    ['Status', submission.status || 'pending'],
                    ['Submitted Date', formattedDate],
                    ['Rejection Reason', submission.rejectionReason || ''],
                    ['', ''], // Separator
                    ['Form Responses', '']
                ];
                
                Object.entries(submission.formData).forEach(([key, value]) => {
                    const displayValue = Array.isArray(value) ? value.join(', ') : value;
                    rows.push([key, displayValue || '(empty)']);
                });
                
                csv = [headers, ...rows];
            } else {
                csv = [
                    ['Field', 'Value'],
                    ['Participant Name', user.name || 'Unknown'],
                    ['Email', user.email || 'N/A'],
                    ['Task/Form Title', submission.taskTitle || submission.title || 'Untitled'],
                    ['Status', submission.status || 'pending'],
                    ['Submitted Date', formattedDate]
                ];
            }
            
            const csvString = csv.map(row => row.map(cell => {
                const cellStr = String(cell || '').replace(/"/g, '""');
                return `"${cellStr}"`;
            }).join(',')).join('\n');
            
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `submission-${(submission.taskTitle || submission.title || 'submission').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Toast.success('Submission downloaded successfully');
        } catch (error) {
            console.error('Error downloading submission:', error);
            Toast.error('Failed to download submission: ' + error.message);
        }
    },
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Handle approve from card or detail view
     * @param {string} submissionId - Submission ID
     * @param {string} submissionType - Submission type
     */
    async handleApprove(submissionId, submissionType) {
        // Prevent double-processing
        if (this.processingSubmissions.has(submissionId)) {
            Toast.info('Processing... Please wait');
            return;
        }
        
        this.processingSubmissions.add(submissionId);
        
        // Show loading state on buttons
        this.setButtonLoading(submissionId, 'approve', true);
        
        try {
            // CRITICAL: Get submission data BEFORE optimistic update
            // This ensures we have the data even after removing it from the array
            const submission = this.submissions.find(s => s.id === submissionId);
            if (!submission) {
                Toast.error('Submission not found in current list');
                this.processingSubmissions.delete(submissionId);
                this.setButtonLoading(submissionId, 'approve', false);
                return;
            }
            
            // Store submission data for use in approveSubmission
            const submissionData = { ...submission };
            
            // Optimistic update: Remove from pending list immediately
            if (this.activeTab === 'pending') {
                const submissionIndex = this.submissions.findIndex(s => s.id === submissionId);
                if (submissionIndex >= 0) {
                    this.submissions = this.submissions.filter(s => s.id !== submissionId);
                    await this.render();
                }
            }
            
            // Update submission in Firestore (pass stored submission data)
            await this.approveSubmission(submissionId, submissionType, submissionData);
            
            // Real-time listener will handle the refresh automatically
            // Only refresh detail view if we're viewing it (don't reload entire list)
            if (this.currentSubmissions.submissions.length > 0) {
                const currentId = this.currentSubmissions.submissions[this.currentSubmissions.currentIndex]?.id;
                if (currentId === submissionId) {
                    // Current submission was approved, refresh detail view after a delay
                    // Don't reload the entire list - let the real-time listener handle it
                    setTimeout(async () => {
                        // Just refresh the detail view, don't reload the entire list
                        const updatedSubmission = this.submissions.find(s => s.id === submissionId);
                        if (!updatedSubmission) {
                            // Submission was removed from list, go back
                            this.backToSubmissions();
                        } else {
                            await this.renderSubmissionDetailView();
                        }
                    }, 1000);
                }
            }
        } catch (error) {
            console.error('Error in handleApprove:', error);
            Toast.error('Failed to approve submission: ' + (error.message || 'Unknown error'));
            
            // On error, revert optimistic update by reloading
            // But only if we're not already loading and enough time has passed
            const timeSinceLastLoad = Date.now() - this._lastLoadTime;
            if (!this.loading && timeSinceLastLoad > 1000) {
                // Temporarily disable listener to prevent double refresh
                const wasJustLoaded = this._justLoaded;
                this._justLoaded = true;
                await this.load(this.activeTab);
                setTimeout(() => {
                    this._justLoaded = wasJustLoaded;
                }, 2000);
            }
        } finally {
            this.processingSubmissions.delete(submissionId);
            this.setButtonLoading(submissionId, 'approve', false);
        }
    },
    
    /**
     * Handle reject from card or detail view
     * @param {string} submissionId - Submission ID
     * @param {string} submissionType - Submission type
     */
    async handleReject(submissionId, submissionType) {
        // Prevent double-processing
        if (this.processingSubmissions.has(submissionId)) {
            Toast.info('Processing... Please wait');
            return;
        }
        
        this.processingSubmissions.add(submissionId);
        
        // Show loading state on buttons
        this.setButtonLoading(submissionId, 'reject', true);
        
        try {
            // CRITICAL: Get submission data BEFORE optimistic update
            // This ensures we have the data even after removing it from the array
            const submission = this.submissions.find(s => s.id === submissionId);
            if (!submission) {
                Toast.error('Submission not found in current list');
                this.processingSubmissions.delete(submissionId);
                this.setButtonLoading(submissionId, 'reject', false);
                return;
            }
            
            // Store submission data for use in rejectSubmission
            const submissionData = { ...submission };
            
            // Optimistic update: Remove from pending list immediately
            if (this.activeTab === 'pending') {
                const submissionIndex = this.submissions.findIndex(s => s.id === submissionId);
                if (submissionIndex >= 0) {
                    this.submissions = this.submissions.filter(s => s.id !== submissionId);
                    await this.render();
                }
            }
            
            // Update submission in Firestore (pass stored submission data)
            await this.rejectSubmission(submissionId, submissionType, submissionData);
            
            // Real-time listener will handle the refresh automatically
            // Only refresh detail view if we're viewing it (don't reload entire list)
            if (this.currentSubmissions.submissions.length > 0) {
                const currentId = this.currentSubmissions.submissions[this.currentSubmissions.currentIndex]?.id;
                if (currentId === submissionId) {
                    // Current submission was rejected, refresh detail view after a delay
                    // Don't reload the entire list - let the real-time listener handle it
                    setTimeout(async () => {
                        // Just refresh the detail view, don't reload the entire list
                        const updatedSubmission = this.submissions.find(s => s.id === submissionId);
                        if (!updatedSubmission) {
                            // Submission was removed from list, go back
                            this.backToSubmissions();
                        } else {
                            await this.renderSubmissionDetailView();
                        }
                    }, 1000);
                }
            }
        } catch (error) {
            console.error('Error in handleReject:', error);
            Toast.error('Failed to reject submission: ' + (error.message || 'Unknown error'));
            
            // On error, revert optimistic update by reloading
            // But only if we're not already loading and enough time has passed
            const timeSinceLastLoad = Date.now() - this._lastLoadTime;
            if (!this.loading && timeSinceLastLoad > 1000) {
                // Temporarily disable listener to prevent double refresh
                const wasJustLoaded = this._justLoaded;
                this._justLoaded = true;
                await this.load(this.activeTab);
                setTimeout(() => {
                    this._justLoaded = wasJustLoaded;
                }, 2000);
            }
        } finally {
            this.processingSubmissions.delete(submissionId);
            this.setButtonLoading(submissionId, 'reject', false);
        }
    },
    
    /**
     * Set loading state on approve/reject buttons
     * @param {string} submissionId - Submission ID
     * @param {string} action - 'approve' or 'reject'
     * @param {boolean} isLoading - Loading state
     */
    setButtonLoading(submissionId, action, isLoading) {
        // Find all buttons for this submission
        const buttons = document.querySelectorAll(`[onclick*="handleApprove('${submissionId}'"],[onclick*="handleReject('${submissionId}'"]`);
        buttons.forEach(btn => {
            if (isLoading) {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
                const originalHTML = btn.innerHTML;
                btn.dataset.originalHTML = originalHTML;
                if (action === 'approve' && btn.textContent.includes('Approve')) {
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...';
                } else if (action === 'reject' && btn.textContent.includes('Reject')) {
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rejecting...';
                }
            } else {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                if (btn.dataset.originalHTML) {
                    btn.innerHTML = btn.dataset.originalHTML;
                    delete btn.dataset.originalHTML;
                }
            }
        });
    },
    
    /**
     * Approve a submission
     * @param {string} submissionId - Submission ID
     * @param {string} submissionType - Submission type ('task' or 'form')
     * @param {Object} submissionData - Optional submission data (if already fetched)
     */
    async approveSubmission(submissionId, submissionType = 'task', submissionData = null) {
        if (!submissionId) {
            Toast.error('Invalid submission ID');
            return;
        }
        
        // Use provided submission data, or try to find it in the array
        // Note: After optimistic update, it might not be in the array anymore
        let submission = submissionData;
        if (!submission) {
            submission = this.submissions.find(s => s.id === submissionId);
        }
        
        // If still not found, try to get it from Firestore directly
        if (!submission) {
            try {
                const submissionRef = DB.db.collection('submissions').doc(submissionId);
                const doc = await submissionRef.get();
                if (doc.exists) {
                    submission = { id: doc.id, ...doc.data() };
                } else {
                    Toast.error('Submission not found in database');
                    return;
                }
            } catch (error) {
                console.error('[approveSubmission] Error fetching submission from Firestore:', error);
                Toast.error('Failed to fetch submission data');
                return;
            }
        }
        
        // Check if submission can be approved
        const canApprove = SubmissionHelpers.canApproveSubmission(submission);
        if (!canApprove.canApprove) {
            Toast.info(canApprove.reason);
            return;
        }
        
        try {
            if (submissionType === 'task') {
                const submissionRef = DB.db.collection('submissions').doc(submissionId);
                
                // Check current status before updating
                const currentDoc = await submissionRef.get();
                if (!currentDoc.exists) {
                    Toast.error('Submission not found in database');
                    // Don't reload here - let the real-time listener handle it
                    return;
                }
                
                const currentStatus = currentDoc.data().status;
                if (currentStatus === 'approved') {
                    Toast.info('This submission has already been approved');
                    // Don't reload here - let the real-time listener handle it
                    return;
                }
                
                // Get task details before updating
                const task = await DB.getTask(submission.taskId);
                if (!task) {
                    Toast.error('Task not found. Cannot award points.');
                    return;
                }
                
                // Verify admin is authenticated
                if (!AdminAuth.currentAdmin || !AdminAuth.currentAdmin.uid) {
                    throw new Error('Admin authentication required. Please refresh the page and try again.');
                }
                
                // Prepare update data
                const updateData = {
                    status: 'approved',
                    reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: AdminAuth.currentAdmin.uid
                };
                
                // Update status first to prevent double approval
                await submissionRef.update(updateData);
                
                // Verify the update was successful
                const verifyDoc = await submissionRef.get();
                if (!verifyDoc.exists) {
                    throw new Error('Submission was deleted during approval');
                }
                const verifyStatus = verifyDoc.data().status;
                if (verifyStatus !== 'approved') {
                    throw new Error(`Submission status update failed. Current status: ${verifyStatus}`);
                }
                
                // Award points with error handling
                try {
                    if (task.points && task.points > 0) {
                        // Award points to user
                        await DB.addPoints(submission.userId, task.points, `Task: ${submission.taskTitle || task.title}`);
                        
                        // Update submission document with pointsAwarded field
                        // This is important for Cloud Functions to track points changes
                        await submissionRef.update({
                            pointsAwarded: task.points
                        });
                        
                        Toast.success(`Submission approved and ${task.points} points awarded`);
                    } else {
                        Toast.success('Submission approved (no points to award)');
                    }
                } catch (pointsError) {
                    console.error('[approveSubmission] Error awarding points:', pointsError);
                    Toast.error('Submission approved but failed to award points: ' + pointsError.message);
                }
            } else {
                // Form submissions don't need approval
                Toast.info('Form submissions are automatically recorded');
            }
            
            // Don't reload here - real-time listener will handle it automatically
            // This prevents double-loading and makes the flow smoother
        } catch (error) {
            console.error('[approveSubmission] Error approving submission:', error);
            console.error('[approveSubmission] Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack,
                submissionId: submissionId,
                submissionType: submissionType,
                adminUid: AdminAuth.currentAdmin?.uid
            });
            
            // Provide more specific error messages
            let errorMessage = 'Failed to approve submission';
            if (error.code === 'permission-denied') {
                errorMessage = 'Permission denied. Please ensure you are logged in as an admin.';
            } else if (error.code === 'not-found') {
                errorMessage = 'Submission not found in database. It may have been deleted.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            Toast.error(errorMessage);
            throw error; // Re-throw so handleApprove can handle it
        }
    },
    
    /**
     * Reject a submission
     * @param {string} submissionId - Submission ID
     * @param {string} submissionType - Submission type ('task' or 'form')
     * @param {Object} submissionData - Optional submission data (if already fetched)
     */
    async rejectSubmission(submissionId, submissionType = 'task', submissionData = null) {
        if (!submissionId) {
            Toast.error('Invalid submission ID');
            return;
        }
        
        // Use provided submission data, or try to find it in the array
        // Note: After optimistic update, it might not be in the array anymore
        let submission = submissionData;
        if (!submission) {
            submission = this.submissions.find(s => s.id === submissionId);
        }
        
        // If still not found, try to get it from Firestore directly
        if (!submission) {
            try {
                const submissionRef = DB.db.collection('submissions').doc(submissionId);
                const doc = await submissionRef.get();
                if (doc.exists) {
                    submission = { id: doc.id, ...doc.data() };
                } else {
                    Toast.error('Submission not found in database');
                    return;
                }
            } catch (error) {
                console.error('[rejectSubmission] Error fetching submission from Firestore:', error);
                Toast.error('Failed to fetch submission data');
                return;
            }
        }
        
        if (submissionType === 'form') {
            Toast.info('Form submissions cannot be rejected');
            return;
        }
        
        // Show rejection reason modal
        const reason = await this.showRejectionReasonModal();
        if (reason === null) {
            // User cancelled - remove from processing set
            this.processingSubmissions.delete(submissionId);
            this.setButtonLoading(submissionId, 'reject', false);
            return;
        }
        
        try {
            const submissionRef = DB.db.collection('submissions').doc(submissionId);
            
            // Verify submission exists
            const currentDoc = await submissionRef.get();
            if (!currentDoc.exists) {
                Toast.error('Submission not found in database');
                // Don't reload here - let the real-time listener handle it
                return;
            }
            
            // Verify admin is authenticated
            if (!AdminAuth.currentAdmin || !AdminAuth.currentAdmin.uid) {
                throw new Error('Admin authentication required. Please refresh the page and try again.');
            }
            
            // Prepare update data
            const updateData = {
                status: 'rejected',
                rejectionReason: reason || '',
                reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                reviewedBy: AdminAuth.currentAdmin.uid
            };
            
            await submissionRef.update(updateData);
            
            // Verify the update was successful
            const verifyDoc = await submissionRef.get();
            if (!verifyDoc.exists) {
                throw new Error('Submission was deleted during rejection');
            }
            const verifyStatus = verifyDoc.data().status;
            if (verifyStatus !== 'rejected') {
                throw new Error(`Submission status update failed. Current status: ${verifyStatus}`);
            }
            
            Toast.success('Submission rejected. User can resubmit.');
            
            // Don't reload here - real-time listener will handle it automatically
        } catch (error) {
            console.error('[rejectSubmission] Error rejecting submission:', error);
            console.error('[rejectSubmission] Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack,
                submissionId: submissionId,
                submissionType: submissionType,
                adminUid: AdminAuth.currentAdmin?.uid
            });
            
            // Provide more specific error messages
            let errorMessage = 'Failed to reject submission';
            if (error.code === 'permission-denied') {
                errorMessage = 'Permission denied. Please ensure you are logged in as an admin.';
            } else if (error.code === 'not-found') {
                errorMessage = 'Submission not found in database. It may have been deleted.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            Toast.error(errorMessage);
            throw error; // Re-throw so handleReject can handle it
        }
    },
    
    /**
     * Show modal for rejection reason input
     * @returns {Promise<string|null>} - Rejection reason or null if cancelled
     */
    showRejectionReasonModal() {
        return new Promise((resolve) => {
            // Create modal if it doesn't exist
            let modal = document.getElementById('rejection-reason-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'rejection-reason-modal';
                modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden';
                modal.innerHTML = `
                    <div class="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                        <h3 class="font-bold text-lg text-slate-800 mb-4">Reject Submission</h3>
                        <p class="text-sm text-slate-600 mb-4">Please provide a reason for rejection (optional):</p>
                        <textarea id="rejection-reason-input" class="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rota-pink focus:border-rota-pink outline-none resize-none" rows="4" placeholder="Enter rejection reason..."></textarea>
                        <div class="flex gap-3 mt-4">
                            <button id="rejection-reason-cancel" class="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium">
                                Cancel
                            </button>
                            <button id="rejection-reason-submit" class="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium">
                                Reject
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            
            const input = document.getElementById('rejection-reason-input');
            const cancelBtn = document.getElementById('rejection-reason-cancel');
            const submitBtn = document.getElementById('rejection-reason-submit');
            
            // Clear previous value
            if (input) input.value = '';
            
            // Show modal
            modal.classList.remove('hidden');
            
            // Focus input
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
            
            // Handle cancel
            const handleCancel = () => {
                modal.classList.add('hidden');
                resolve(null);
            };
            
            // Handle submit
            const handleSubmit = () => {
                const reason = input ? input.value.trim() : '';
                modal.classList.add('hidden');
                resolve(reason);
            };
            
            // Remove old listeners and add new ones
            const newCancelBtn = cancelBtn.cloneNode(true);
            const newSubmitBtn = submitBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
            
            newCancelBtn.addEventListener('click', handleCancel);
            newSubmitBtn.addEventListener('click', handleSubmit);
            
            // Handle Escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                    handleCancel();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
            
            // Handle Enter key in textarea (Ctrl+Enter to submit)
            if (input) {
                const handleKeyDown = (e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        handleSubmit();
                    }
                };
                input.addEventListener('keydown', handleKeyDown);
            }
        });
    }
};

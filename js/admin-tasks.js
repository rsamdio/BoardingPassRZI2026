// Admin Tasks Module
// Handles task creation, editing, and management

const AdminTasks = {
    tasks: [],
    fieldCounter: 0,
    loading: false,
    draftAutoSaveInterval: null,
    currentTasks: {
        tasks: [],
        currentIndex: 0
    },
    currentStep: 1,
    currentTaskSubmissions: {
        task: null,
        submissions: [],
        usersMap: new Map(),
        currentIndex: 0
    },
    
    /**
     * Load tasks
     */
    async load() {
        if (this.loading) {
            return;
        }
        
        try {
            this.loading = true;
            AdminUI.setLoading('tasks', true);
            AdminUI.showSkeleton('tasks-list', 'list');
            
            // Use getAllTasks for admin (includes inactive, uses RTDB cache)
            this.tasks = await DB.getAllTasks();
            
            // Ensure tasks have timestamps for sorting
            // Note: Tasks without timestamps will sort to the bottom
            // To fix this, edit any task to trigger a cache refresh with timestamps
            this.tasks = this.tasks.map(task => {
                // Normalize timestamps - ensure they're numbers
                if (task.updatedAt && typeof task.updatedAt !== 'number') {
                    // Handle Firestore Timestamp objects
                    if (typeof task.updatedAt.toMillis === 'function') {
                        task.updatedAt = task.updatedAt.toMillis();
                    } else if (task.updatedAt.seconds !== undefined) {
                        task.updatedAt = task.updatedAt.seconds * 1000 + (task.updatedAt.nanoseconds || 0) / 1000000;
                    }
                }
                if (task.createdAt && typeof task.createdAt !== 'number') {
                    // Handle Firestore Timestamp objects
                    if (typeof task.createdAt.toMillis === 'function') {
                        task.createdAt = task.createdAt.toMillis();
                    } else if (task.createdAt.seconds !== undefined) {
                        task.createdAt = task.createdAt.seconds * 1000 + (task.createdAt.nanoseconds || 0) / 1000000;
                    }
                }
                // If timestamps are missing, set to 0 (will sort to bottom)
                if (!task.updatedAt && !task.createdAt) {
                    task.createdAt = 0;
                }
                return task;
            });
            
            this.render();
        } catch (error) {
            console.error('Error loading tasks:', error);
            Toast.error('Failed to load tasks');
            this.tasks = [];
        } finally {
            this.loading = false;
            AdminUI.setLoading('tasks', false);
        }
    },
    
    /**
     * Render tasks list
     */
    render() {
        const list = document.getElementById('tasks-list');
        if (!list) {
            console.error('Tasks list element not found');
            return;
        }
        
        list.innerHTML = '';
        
        if (this.tasks.length === 0) {
            list.innerHTML = '<p class="text-center text-slate-500 py-8">No tasks created yet</p>';
            return;
        }
        
        // Sort by most recent first (by updatedAt or createdAt)
        const sortedTasks = [...this.tasks].sort((a, b) => {
            // Get timestamp - prefer updatedAt, fallback to createdAt
            let aTime = a.updatedAt || a.createdAt || 0;
            let bTime = b.updatedAt || b.createdAt || 0;
            
            // Handle Firestore Timestamp objects
            if (aTime && typeof aTime.toMillis === 'function') {
                aTime = aTime.toMillis();
            } else if (aTime && typeof aTime === 'object' && aTime.seconds !== undefined) {
                // Handle Firestore Timestamp-like objects with seconds property
                aTime = aTime.seconds * 1000 + (aTime.nanoseconds || 0) / 1000000;
            } else if (typeof aTime !== 'number') {
                aTime = 0;
            }
            
            if (bTime && typeof bTime.toMillis === 'function') {
                bTime = bTime.toMillis();
            } else if (bTime && typeof bTime === 'object' && bTime.seconds !== undefined) {
                // Handle Firestore Timestamp-like objects with seconds property
                bTime = bTime.seconds * 1000 + (bTime.nanoseconds || 0) / 1000000;
            } else if (typeof bTime !== 'number') {
                bTime = 0;
            }
            
            // Descending order (most recent first)
            // If both have timestamps, sort by timestamp
            if (aTime > 0 && bTime > 0) {
                return bTime - aTime;
            }
            // If only one has a timestamp, prioritize it
            if (aTime > 0 && bTime === 0) {
                return -1; // a comes first
            }
            if (aTime === 0 && bTime > 0) {
                return 1; // b comes first
            }
            // If neither has a timestamp (both are 0), maintain original order
            // But we can use ID as a fallback to ensure consistent ordering
            return (b.id || '').localeCompare(a.id || '');
        });
        
        sortedTasks.forEach(task => {
            const card = document.createElement('div');
            card.className = 'bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow';
            card.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h4 class="font-bold text-lg text-slate-800 mb-1">${this.escapeHtml(task.title)}</h4>
                        <p class="text-sm text-slate-500">${this.escapeHtml(task.description || '')}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${
                            task.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                        }">${task.status || 'inactive'}</span>
                        <span class="text-xs text-slate-500">${task.type === 'upload' ? 'File Upload' : 'Form'}</span>
                    </div>
                </div>
                <div class="flex items-center gap-4 text-sm text-slate-600 mb-4">
                    <span><i class="fas fa-star"></i> ${task.points || 0} Points</span>
                </div>
                <div class="flex gap-2">
                    <button onclick="AdminTasks.viewTaskSubmissions('${task.id}')" class="flex-1 px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors">
                        <i class="fas fa-list"></i> View Submissions
                    </button>
                    <button onclick="AdminTasks.editTask('${task.id}')" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button onclick="AdminTasks.deleteTask('${task.id}')" class="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            list.appendChild(card);
        });
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
     * Show create task modal (now uses step flow)
     */
    showCreateModal() {
        // Check for draft
        const draft = this.loadDraft();
        if (draft && confirm('You have a saved draft. Would you like to resume editing?')) {
            this.loadDraftIntoForm(draft);
        }
        this.startAutoSave();
        const titleEl = document.getElementById('task-creator-title');
        const formEl = document.getElementById('task-form');
        const idEl = document.getElementById('task-id');
        const fieldsListEl = document.getElementById('task-form-fields-list');
        
        if (!titleEl || !formEl || !idEl || !fieldsListEl) {
            Toast.error('Task creator elements not found');
            return;
        }
        
        titleEl.textContent = 'Create Task';
        formEl.reset();
        idEl.value = '';
        fieldsListEl.innerHTML = '';
        this.fieldCounter = 0;
        this.currentStep = 1;
        this.handleTypeChange();
        this.updateTaskStepUI();
        AdminUI.switchView('task-creator');
    },
    
    /**
     * Update task step UI indicators
     */
    updateTaskStepUI() {
        const step1Indicator = document.getElementById('task-step-1-indicator');
        const step2Indicator = document.getElementById('task-step-2-indicator');
        const step1Content = document.getElementById('task-step-1');
        const step2Content = document.getElementById('task-step-2');
        const prevBtn = document.getElementById('task-prev-btn');
        const nextBtn = document.getElementById('task-next-btn');
        const saveBtn = document.getElementById('task-save-btn');
        const typeSelect = document.getElementById('task-type');
        const type = typeSelect?.value || 'upload';
        
        if (this.currentStep === 1) {
            // Step 1 active
            step1Indicator.classList.remove('bg-slate-200', 'text-slate-500');
            step1Indicator.classList.add('bg-rota-pink', 'text-white');
            
            // Only update step 2 indicator if it's visible (form type)
            if (step2Indicator && !step2Indicator.classList.contains('hidden')) {
                step2Indicator.classList.remove('bg-rota-pink', 'text-white');
                step2Indicator.classList.add('bg-slate-200', 'text-slate-500');
            }
            
            step1Content.classList.remove('hidden');
            step2Content.classList.add('hidden');
            
            prevBtn.classList.add('hidden');
            
            // For upload type, show save button; for form type, show next button
            if (type === 'upload') {
                nextBtn.classList.add('hidden');
                saveBtn.classList.remove('hidden');
            } else {
                nextBtn.classList.remove('hidden');
                saveBtn.classList.add('hidden');
            }
        } else {
            // Step 2 active (only for form type)
            step1Indicator.classList.remove('bg-rota-pink', 'text-white');
            step1Indicator.classList.add('bg-green-500', 'text-white');
            
            if (step2Indicator && !step2Indicator.classList.contains('hidden')) {
                step2Indicator.classList.remove('bg-slate-200', 'text-slate-500');
                step2Indicator.classList.add('bg-rota-pink', 'text-white');
            }
            
            step1Content.classList.add('hidden');
            step2Content.classList.remove('hidden');
            
            prevBtn.classList.remove('hidden');
            nextBtn.classList.add('hidden');
            saveBtn.classList.remove('hidden');
        }
    },
    
    /**
     * Go to next step
     */
    nextTaskStep() {
        if (this.currentStep === 1) {
            // Validate step 1
            const title = document.getElementById('task-title')?.value?.trim();
            const description = document.getElementById('task-description')?.value?.trim();
            const points = document.getElementById('task-points')?.value;
            const type = document.getElementById('task-type')?.value;
            
            if (!title) {
                Toast.error('Task title is required');
                return;
            }
            
            if (!description) {
                Toast.error('Task description is required');
                return;
            }
            
            if (!points || parseInt(points) < 1) {
                Toast.error('Points must be at least 1');
                return;
            }
            
            // If upload type, skip to save (no step 2)
            if (type === 'upload') {
                // Directly save for upload type
                const form = document.getElementById('task-form');
                if (form) {
                    form.requestSubmit();
                }
                return;
            }
            
            // For form type, go to step 2
            this.currentStep = 2;
            this.updateTaskStepUI();
        }
    },
    
    /**
     * Go to previous step
     */
    previousTaskStep() {
        if (this.currentStep === 2) {
            this.currentStep = 1;
            this.updateTaskStepUI();
        }
    },
    
    /**
     * Save draft to localStorage
     */
    saveDraft() {
        try {
            const title = document.getElementById('task-title')?.value?.trim();
            const description = document.getElementById('task-description')?.value?.trim();
            const type = document.getElementById('task-type')?.value;
            const points = parseInt(document.getElementById('task-points')?.value || '0');
            const status = document.getElementById('task-status')?.value || 'active';
            const maxFileSize = parseInt(document.getElementById('task-max-size')?.value || '5');
            const fieldsList = document.getElementById('task-form-fields-list');
            
            if (!title && (!fieldsList || fieldsList.children.length === 0)) {
                // Nothing to save
                return;
            }
            
            const draft = {
                title: title || '',
                description: description || '',
                type: type || 'upload',
                points: points || 0,
                status: status,
                maxFileSize: maxFileSize,
                formFields: [],
                savedAt: Date.now()
            };
            
            // Save form fields if type is 'form'
            if (type === 'form' && fieldsList) {
                Array.from(fieldsList.children).forEach(fieldEl => {
                    const fieldId = fieldEl.querySelector('.field-id')?.value;
                    const fieldLabel = fieldEl.querySelector('.field-label')?.value?.trim();
                    const fieldType = fieldEl.querySelector('.field-type')?.value;
                    const fieldRequired = fieldEl.querySelector('.field-required')?.checked;
                    const fieldOptions = fieldEl.querySelector('.field-options')?.value?.trim();
                    
                    if (fieldLabel) {
                        const field = {
                            id: fieldId || `f${Date.now()}.${Math.random().toString(36).substr(2, 9)}`,
                            label: fieldLabel,
                            type: fieldType || 'text',
                            required: fieldRequired || false
                        };
                        
                        if (fieldOptions && (fieldType === 'dropdown' || fieldType === 'checkbox')) {
                            field.options = fieldOptions.split('\n').filter(o => o.trim());
                        }
                        
                        draft.formFields.push(field);
                    }
                });
            }
            
            localStorage.setItem('task_draft', JSON.stringify(draft));
        } catch (error) {
        }
    },
    
    /**
     * Load draft from localStorage
     */
    loadDraft() {
        try {
            const draftStr = localStorage.getItem('task_draft');
            if (draftStr) {
                const draft = JSON.parse(draftStr);
                // Check if draft is not too old (24 hours)
                const draftAge = Date.now() - (draft.savedAt || 0);
                if (draftAge < 24 * 60 * 60 * 1000) {
                    return draft;
                } else {
                    localStorage.removeItem('task_draft');
                }
            }
        } catch (error) {
            localStorage.removeItem('task_draft');
        }
        return null;
    },
    
    /**
     * Load draft into form
     */
    loadDraftIntoForm(draft) {
        const titleInput = document.getElementById('task-title');
        const descInput = document.getElementById('task-description');
        const typeSelect = document.getElementById('task-type');
        const pointsInput = document.getElementById('task-points');
        const statusSelect = document.getElementById('task-status');
        const maxSizeInput = document.getElementById('task-max-size');
        const fieldsList = document.getElementById('task-form-fields-list');
        
        if (titleInput) titleInput.value = draft.title || '';
        if (descInput) descInput.value = draft.description || '';
        if (typeSelect) typeSelect.value = draft.type || 'upload';
        if (pointsInput) pointsInput.value = draft.points || 0;
        if (statusSelect) statusSelect.value = draft.status || 'active';
        if (maxSizeInput) maxSizeInput.value = draft.maxFileSize || 5;
        
        // Load form fields
        if (draft.formFields && draft.formFields.length > 0 && fieldsList) {
            fieldsList.innerHTML = '';
            this.fieldCounter = 0;
            draft.formFields.forEach(field => {
                this.addFormField(field);
            });
        }
        
        this.handleTypeChange();
        this.updateTaskStepUI();
    },
    
    /**
     * Start auto-save for draft
     */
    startAutoSave() {
        // Clear existing interval
        this.stopAutoSave();
        
        // Auto-save every 30 seconds
        this.draftAutoSaveInterval = setInterval(() => {
            this.saveDraft();
        }, 30000);
    },
    
    /**
     * Stop auto-save
     */
    stopAutoSave() {
        if (this.draftAutoSaveInterval) {
            clearInterval(this.draftAutoSaveInterval);
            this.draftAutoSaveInterval = null;
        }
    },
    
    /**
     * Cancel task creation
     */
    cancelTask() {
        // Save draft before canceling
        this.saveDraft();
        
        if (confirm('Are you sure you want to cancel? Your progress has been saved as a draft.')) {
            this.stopAutoSave();
            // Clear draft after confirming cancel
            localStorage.removeItem('task_draft');
            AdminUI.switchView('tasks');
            this.currentStep = 1;
        }
    },
    
    /**
     * Edit task
     * @param {string} taskId - Task ID
     */
    async editTask(taskId) {
        if (!taskId) {
            Toast.error('Invalid task ID');
            return;
        }
        
        try {
            // Fetch task directly from Firestore to ensure we have the latest data
            const task = await DB.getTask(taskId);
            if (!task) {
                Toast.error('Task not found');
                return;
            }
            
            const titleEl = document.getElementById('task-creator-title');
            const idEl = document.getElementById('task-id');
            const titleInput = document.getElementById('task-title');
            const descInput = document.getElementById('task-description');
            const typeSelect = document.getElementById('task-type');
            const pointsInput = document.getElementById('task-points');
            const statusSelect = document.getElementById('task-status');
            const maxSizeInput = document.getElementById('task-max-size');
            const fieldsListEl = document.getElementById('task-form-fields-list');
            
            if (!titleEl || !idEl || !titleInput || !descInput || !typeSelect || !pointsInput || !statusSelect || !fieldsListEl) {
                Toast.error('Task form elements not found');
                return;
            }
            
            titleEl.textContent = 'Edit Task';
            idEl.value = task.id;
            titleInput.value = task.title || '';
            descInput.value = task.description || '';
            typeSelect.value = task.type || 'upload';
            pointsInput.value = task.points || 0;
            statusSelect.value = task.status || 'inactive';
            
            if (task.type === 'upload' && task.maxFileSize && maxSizeInput) {
                maxSizeInput.value = task.maxFileSize;
            }
            
            fieldsListEl.innerHTML = '';
            this.fieldCounter = 0;
            this.currentStep = 1;
            
            if (task.type === 'form' && task.formFields) {
                task.formFields.forEach(field => {
                    this.addFormField(field);
                });
            }
            
            this.handleTypeChange();
            this.updateTaskStepUI();
            AdminUI.switchView('task-creator');
        } catch (error) {
            console.error('Error editing task:', error);
            Toast.error('Failed to load task for editing');
        }
    },
    
    /**
     * Handle task type change
     */
    handleTypeChange() {
        const type = document.getElementById('task-type')?.value;
        const uploadFields = document.getElementById('task-upload-fields');
        const step2Container = document.getElementById('task-step-2-container');
        const step2Connector = document.getElementById('task-step-connector');
        
        if (!type) return;
        
        // Show/hide upload-specific fields
        if (uploadFields) {
            if (type === 'upload') {
                uploadFields.classList.remove('hidden');
            } else {
                uploadFields.classList.add('hidden');
            }
        }
        
        // Show/hide step 2 indicator and connector based on type
        if (type === 'upload') {
            // Hide step 2 for upload type
            if (step2Container) {
                step2Container.classList.add('hidden');
            }
            if (step2Connector) {
                step2Connector.classList.add('hidden');
            }
        } else {
            // Show step 2 for form type
            if (step2Container) {
                step2Container.classList.remove('hidden');
            }
            if (step2Connector) {
                step2Connector.classList.remove('hidden');
            }
        }
        
        // Update step UI if we're on step 1
        if (this.currentStep === 1) {
            this.updateTaskStepUI();
        }
    },
    
    /**
     * Add form field to task
     * @param {Object} existingField - Existing field data (optional)
     */
    addFormField(existingField = null) {
        const fieldsList = document.getElementById('task-form-fields-list');
        if (!fieldsList) {
            Toast.error('Form fields list not found');
            return;
        }
        
        const fieldId = existingField?.id || 'f' + Date.now() + '.' + this.fieldCounter++;
        
        const fieldEl = document.createElement('div');
        fieldEl.className = 'border border-slate-200 rounded-lg p-4';
        fieldEl.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <span class="font-bold text-slate-700">Field ${fieldsList.children.length + 1}</span>
                <button type="button" onclick="this.parentElement.parentElement.remove()" class="text-red-500 hover:text-red-700">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="space-y-3">
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Label *</label>
                    <input type="text" class="field-label w-full px-3 py-2 border border-slate-200 rounded-lg" value="${this.escapeHtml(existingField?.label || '')}" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Type *</label>
                    <select class="field-type w-full px-3 py-2 border border-slate-200 rounded-lg" onchange="AdminTasks.handleFieldTypeChange(this)" required>
                        <option value="text" ${existingField?.type === 'text' ? 'selected' : ''}>Text</option>
                        <option value="number" ${existingField?.type === 'number' ? 'selected' : ''}>Number</option>
                        <option value="date" ${existingField?.type === 'date' ? 'selected' : ''}>Date</option>
                        <option value="dropdown" ${existingField?.type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
                        <option value="checkbox" ${existingField?.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                    </select>
                </div>
                <div class="field-options ${existingField?.type === 'dropdown' ? '' : 'hidden'}">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Options (one per line) *</label>
                    <textarea class="field-options-text w-full px-3 py-2 border border-slate-200 rounded-lg" rows="3" ${existingField?.type === 'dropdown' ? 'required' : ''}>${this.escapeHtml(existingField?.options?.join('\n') || '')}</textarea>
                </div>
                <div>
                    <label class="flex items-center gap-2">
                        <input type="checkbox" class="field-required" ${existingField?.required ? 'checked' : ''}>
                        <span class="text-sm font-medium text-slate-700">Required</span>
                    </label>
                </div>
            </div>
        `;
        fieldsList.appendChild(fieldEl);
    },
    
    /**
     * Handle field type change
     * @param {HTMLElement} select - Select element
     */
    handleFieldTypeChange(select) {
        const fieldEl = select.closest('.border');
        if (!fieldEl) return;
        
        const optionsDiv = fieldEl.querySelector('.field-options');
        const optionsTextarea = fieldEl.querySelector('.field-options-text');
        
        if (!optionsDiv || !optionsTextarea) return;
        
        if (select.value === 'dropdown') {
            optionsDiv.classList.remove('hidden');
            optionsTextarea.required = true;
        } else {
            optionsDiv.classList.add('hidden');
            optionsTextarea.required = false;
        }
    },
    
    /**
     * Save task
     * @param {Event} event - Form submit event
     */
    async saveTask(event) {
        event.preventDefault();
        
        try {
            const taskId = document.getElementById('task-id')?.value;
            const type = document.getElementById('task-type')?.value;
            const title = document.getElementById('task-title')?.value?.trim();
            const description = document.getElementById('task-description')?.value?.trim();
            const points = parseInt(document.getElementById('task-points')?.value || '0');
            const status = document.getElementById('task-status')?.value;
            
            // Validation
            if (!title) {
                Toast.error('Task title is required');
                return;
            }
            
            if (!points || points < 0) {
                Toast.error('Points must be a positive number');
                return;
            }
            
            const data = {
                title,
                description,
                type: type || 'upload',
                points,
                status: status || 'inactive'
            };
            
            if (type === 'upload') {
                const maxFileSize = parseInt(document.getElementById('task-max-size')?.value || '5');
                data.maxFileSize = maxFileSize;
                data.allowedFileTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
            } else {
                const formFields = [];
                const fieldsList = document.getElementById('task-form-fields-list');
                
                if (!fieldsList || fieldsList.children.length === 0) {
                    Toast.error('Please add at least one form field');
                    return;
                }
                
                // Use children instead of querySelectorAll with invalid selector
                Array.from(fieldsList.children).forEach((fieldEl, index) => {
                    const label = fieldEl.querySelector('.field-label')?.value?.trim();
                    const fieldType = fieldEl.querySelector('.field-type')?.value;
                    const required = fieldEl.querySelector('.field-required')?.checked || false;
                    
                    if (!label) {
                        Toast.error(`Field ${index + 1} label is required`);
                        return;
                    }
                    
                    const field = {
                        id: 'f' + Date.now() + '.' + index + '.' + Math.random(),
                        label,
                        type: fieldType || 'text',
                        required
                    };
                    
                    if (fieldType === 'dropdown') {
                        const optionsText = fieldEl.querySelector('.field-options-text')?.value?.trim();
                        if (!optionsText) {
                            Toast.error(`Field ${index + 1} options are required for dropdown type`);
                            return;
                        }
                        field.options = optionsText.split('\n').filter(o => o.trim());
                    }
                    
                    formFields.push(field);
                });
                
                if (formFields.length === 0) {
                    Toast.error('Please add at least one valid form field');
                    return;
                }
                
                data.formFields = formFields;
            }
            
            // Save to database
            let savedTaskId = taskId;
            if (taskId) {
                // Update: set updatedAt timestamp
                data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                await DB.db.collection('tasks').doc(taskId).update(data);
                Toast.success('Task updated successfully');
            } else {
                // Create: set both createdAt and updatedAt timestamps
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                const docRef = await DB.db.collection('tasks').add(data);
                savedTaskId = docRef.id;
                Toast.success('Task created successfully');
            }
            
            // Stop auto-save after successful save
            this.stopAutoSave();
            // Clear draft after successful save
            localStorage.removeItem('task_draft');
            
            // Invalidate cache
            DB.invalidateCache('task');
            Cache.clear(Cache.keys.taskList());
            
            // Wait briefly for Cloud Function to update RTDB cache (usually <1 second)
            // This allows the cache to be populated before we read from it
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Use RTDB cache instead of Firestore (cost optimization)
            // Cloud Function already updates the cache, so we can read from it
            try {
                this.tasks = await DB.getAllTasks();
            } catch (error) {
                // Fallback to Firestore if RTDB cache read fails
                const snapshot = await DB.db.collection('tasks').get();
                this.tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
            
            // Return to tasks view
            // Temporarily set loading to true to prevent load() from overwriting our fresh data
            const wasLoading = this.loading;
            this.loading = true;
            
            AdminUI.switchView('tasks');
            // Render immediately with the fresh data we just fetched
            this.render();
            
            // Reset loading state after a brief delay to allow render
            setTimeout(() => {
                this.loading = wasLoading;
            }, 500);
            
            this.currentStep = 1;
        } catch (error) {
            console.error('Error saving task:', error);
            Toast.error('Failed to save task: ' + error.message);
        }
    },
    
    /**
     * View task submissions in step flow
     * @param {string} taskId - Task ID
     */
    async viewTaskSubmissions(taskId) {
        if (!taskId) {
            Toast.error('Invalid task ID');
            return;
        }
        
        try {
            // Fetch task directly from Firestore to ensure we have complete data
            const task = await DB.getTask(taskId);
            if (!task) {
                Toast.error('Task not found');
                return;
            }
            
            // Fetch pre-computed submission IDs (quick check)
            const submissionIdsResult = await DB.readFromCache(`admin/submissions/byTask/${taskId}`);
            const submissionIds = submissionIdsResult.data ? Object.keys(submissionIdsResult.data) : [];
            
            if (!submissionIds || submissionIds.length === 0) {
                Toast.info(`No submissions yet for "${task.title}". Check back later when participants submit this task.`);
                return;
            }
            
            // Fetch full submissions from Firestore (needed for detailed view)
            let submissionsSnapshot;
            try {
                submissionsSnapshot = await DB.db.collection('submissions')
                    .where('taskId', '==', taskId)
                    .orderBy('submittedAt', 'desc')
                    .get();
            } catch (orderError) {
                // OrderBy failed, sorting in memory
                submissionsSnapshot = await DB.db.collection('submissions')
                    .where('taskId', '==', taskId)
                    .get();
            }
            
            let submissions = submissionsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // Sort by submittedAt if not already sorted
            submissions.sort((a, b) => {
                const aTime = Utils.timestampToMillis(a.submittedAt);
                const bTime = Utils.timestampToMillis(b.submittedAt);
                return bTime - aTime;
            });
            
            // Get user details for submissions (from directory cache)
            const userIds = [...new Set(submissions.map(s => s.userId))];
            const usersMap = new Map();
            
            // Try attendeeCache/directory first (correct path)
            let directoryResult = await DB.readFromCache('attendeeCache/directory');
            let directory = directoryResult?.data || {};
            
            // Fallback to cache/users/directory if attendeeCache is empty
            if (!directory || Object.keys(directory).length === 0) {
                directoryResult = await DB.readFromCache('cache/users/directory');
                directory = directoryResult?.data || {};
            }
            
            // Fetch user data for all userIds
            await Promise.all(userIds.map(async (userId) => {
                if (directory[userId]) {
                    usersMap.set(userId, directory[userId]);
                } else {
                    // Fallback: fetch from Firestore if not in cache
                    try {
                        const user = await DB.getUser(userId, false);
                        if (user) {
                            usersMap.set(userId, user);
                        }
                    } catch (error) {
                    }
                }
            }));
            
            // Store submissions data
            this.currentTaskSubmissions = {
                task,
                submissions,
                usersMap,
                currentIndex: 0
            };
            
            // Render submissions view
            this.renderTaskSubmissionsView();
        } catch (error) {
            console.error('Error fetching task submissions:', error);
            Toast.error('Failed to load submissions: ' + error.message);
        }
    },
    
    /**
     * Render task submissions view (step flow)
     */
    renderTaskSubmissionsView() {
        const { task, submissions, usersMap, currentIndex } = this.currentTaskSubmissions;
        
        const titleEl = document.getElementById('task-submissions-view-title');
        const countEl = document.getElementById('task-submissions-view-count');
        const contentEl = document.getElementById('task-submissions-content');
        const currentEl = document.getElementById('task-submissions-current');
        const totalEl = document.getElementById('task-submissions-total');
        const progressEl = document.getElementById('task-submissions-progress');
        const prevBtn = document.getElementById('task-submissions-prev');
        const nextBtn = document.getElementById('task-submissions-next');
        const downloadBtn = document.getElementById('task-submissions-view-download');
        
        if (!titleEl || !countEl || !contentEl || !currentEl || !totalEl || !progressEl || !prevBtn || !nextBtn || !downloadBtn) {
            Toast.error('Task submissions view elements not found');
            return;
        }
        
        titleEl.textContent = `Submissions: ${this.escapeHtml(task.title)}`;
        countEl.textContent = `${submissions.length} submission${submissions.length !== 1 ? 's' : ''}`;
        
        // Store data for download
        downloadBtn.onclick = () => this.downloadTaskSubmissions(task, submissions, usersMap);
        
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
            contentEl.innerHTML = '<div class="text-center text-slate-500 py-16"><p class="text-lg">No submissions yet</p></div>';
            return;
        }
        
        const submission = submissions[currentIndex];
        const userData = usersMap.get(submission.userId);
        
        // Build user info with fallbacks
        const userName = userData?.name || userData?.displayName || submission.userName || 'Unknown User';
        const userEmail = userData?.email || 'N/A';
        const userDistrict = userData?.district || null;
        const userDesignation = userData?.designation || null;
        
        // Build user info display (show district/designation if available, otherwise email)
        let userInfoDisplay = '';
        if (userDistrict || userDesignation) {
            const parts = [];
            if (userDistrict) parts.push(userDistrict);
            if (userDesignation) parts.push(userDesignation);
            userInfoDisplay = parts.join(' • ');
        } else {
            userInfoDisplay = userEmail;
        }
        
        const submittedDate = submission.submittedAt 
            ? (submission.submittedAt.toDate ? submission.submittedAt.toDate() : new Date(submission.submittedAt))
            : null;
        const formattedDate = submittedDate ? Utils.formatDate(submittedDate) : 'Date not available';
        const statusDisplay = SubmissionHelpers.getStatusDisplay(submission.status || 'pending');
        
        // Get form/task definition for field labels if it's a form submission
        let fieldLabelsMap = {};
        let formDataHTML = '';
        if (submission.type === 'form' && submission.formData) {
            // Try to get field labels from task
            if (task.formFields) {
                task.formFields.forEach(field => {
                    fieldLabelsMap[field.id] = field.label;
                });
            }
            
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
                    <h4 class="font-bold text-xl text-slate-800 mb-1">${this.escapeHtml(userName)}</h4>
                    <p class="text-sm text-slate-500">${this.escapeHtml(userInfoDisplay)}</p>
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
            
            ${submission.status === 'pending' ? `
                <div class="flex gap-3 mt-6 pt-4 border-t border-slate-200">
                    <button onclick="AdminSubmissions.handleApprove('${submission.id}', 'task')" class="flex-1 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button onclick="AdminSubmissions.handleReject('${submission.id}', 'task')" class="flex-1 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium">
                        <i class="fas fa-times"></i> Reject
                    </button>
                </div>
            ` : ''}
        `;
        contentEl.appendChild(card);
        
        // Switch to submissions view
        AdminUI.switchView('task-submissions');
    },
    
    /**
     * Navigate to previous task submission
     */
    previousTaskSubmission() {
        if (this.currentTaskSubmissions.currentIndex > 0) {
            this.currentTaskSubmissions.currentIndex--;
            this.renderTaskSubmissionsView();
        }
    },
    
    /**
     * Navigate to next task submission
     */
    nextTaskSubmission() {
        if (this.currentTaskSubmissions.currentIndex < this.currentTaskSubmissions.submissions.length - 1) {
            this.currentTaskSubmissions.currentIndex++;
            this.renderTaskSubmissionsView();
        }
    },
    
    /**
     * Download task submissions as CSV
     * @param {Object} task - Task object
     * @param {Array} submissions - Array of submissions
     * @param {Map} usersMap - Map of userId to user data
     */
    downloadTaskSubmissions(task, submissions, usersMap) {
        try {
            if (submissions.length === 0) {
                Toast.error('No submissions to download');
                return;
            }
            
            // Build CSV header
            const headers = ['Participant Name', 'Email', 'Status', 'Submitted Date'];
            
            // Add task-specific columns
            if (task.type === 'upload') {
                headers.push('File URL');
            } else if (task.type === 'form' && task.formFields) {
                task.formFields.forEach(field => {
                    headers.push(field.label || field.id);
                });
            }
            
            // Build CSV rows
            const rows = submissions.map(submission => {
                const user = usersMap.get(submission.userId) || { name: submission.userName || 'Unknown', email: 'N/A' };
                const submittedDate = submission.submittedAt 
                    ? (submission.submittedAt.toDate ? submission.submittedAt.toDate() : new Date(submission.submittedAt))
                    : null;
                const formattedDate = submittedDate ? Utils.formatDate(submittedDate) : 'N/A';
                
                const row = [
                    user.name || 'Unknown',
                    user.email || 'N/A',
                    submission.status || 'pending',
                    formattedDate
                ];
                
                // Add task-specific data
                if (task.type === 'upload') {
                    row.push(submission.fileURL || 'N/A');
                } else if (task.type === 'form' && task.formFields && submission.formData) {
                    task.formFields.forEach(field => {
                        const value = submission.formData[field.id];
                        const displayValue = Array.isArray(value) ? value.join(', ') : (value || '(empty)');
                        row.push(displayValue);
                    });
                }
                
                return row;
            });
            
            // Create CSV
            const csv = [
                headers,
                ...rows
            ].map(row => row.map(cell => {
                const cellStr = String(cell || '').replace(/"/g, '""');
                return `"${cellStr}"`;
            }).join(',')).join('\n');
            
            // Download
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `task-submissions-${task.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Toast.success(`Downloaded ${submissions.length} submissions successfully`);
        } catch (error) {
            console.error('Error downloading task submissions:', error);
            Toast.error('Failed to download submissions: ' + error.message);
        }
    },
    
    /**
     * Back to tasks list
     */
    backToTasks() {
        this.currentTaskSubmissions = {
            task: null,
            submissions: [],
            usersMap: new Map(),
            currentIndex: 0
        };
        AdminUI.switchView('tasks');
    },
    
    /**
     * Delete task
     * @param {string} taskId - Task ID
     */
    async deleteTask(taskId) {
        if (!taskId) {
            Toast.error('Invalid task ID');
            return;
        }
        
        if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) {
            return;
        }
        
        try {
            await DB.db.collection('tasks').doc(taskId).delete();
            Toast.success('Task deleted successfully');
            DB.invalidateCache('task');
            Cache.clear(Cache.keys.taskList());
            
            // Force refresh from Firestore to see updated list immediately
            const snapshot = await DB.db.collection('tasks').get();
            this.tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.render();
        } catch (error) {
            console.error('Error deleting task:', error);
            Toast.error('Failed to delete task: ' + error.message);
        }
    }
};

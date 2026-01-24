// Admin Forms/Surveys Module
// Handles form/survey creation, editing, and management

const AdminForms = {
    forms: [],
    fieldCounter: 0,
    loading: false,
    draftAutoSaveInterval: null,
    currentStep: 1,
    totalSteps: 2,
    formsListener: null, // Real-time listener for forms cache
    currentFormSubmissions: {
        form: null,
        submissions: [],
        usersMap: new Map(),
        currentIndex: 0
    },
    
    /**
     * Load forms
     */
    async load() {
        if (this.loading) {
            return;
        }
        
        try {
            this.loading = true;
            AdminUI.setLoading('forms', true);
            AdminUI.showSkeleton('forms-list', 'list');
            
            // Use getAllForms for admin (includes inactive, uses RTDB cache)
            this.forms = await DB.getAllForms();
            
            // Ensure forms have timestamps for sorting
            this.forms = this.forms.map(form => {
                if (form.updatedAt && typeof form.updatedAt !== 'number') {
                    if (typeof form.updatedAt.toMillis === 'function') {
                        form.updatedAt = form.updatedAt.toMillis();
                    } else if (form.updatedAt.seconds !== undefined) {
                        form.updatedAt = form.updatedAt.seconds * 1000 + (form.updatedAt.nanoseconds || 0) / 1000000;
                    }
                }
                if (form.createdAt && typeof form.createdAt !== 'number') {
                    if (typeof form.createdAt.toMillis === 'function') {
                        form.createdAt = form.createdAt.toMillis();
                    } else if (form.createdAt.seconds !== undefined) {
                        form.createdAt = form.createdAt.seconds * 1000 + (form.createdAt.nanoseconds || 0) / 1000000;
                    }
                }
                if (!form.updatedAt && !form.createdAt) {
                    form.createdAt = 0;
                }
                return form;
            });
            
            this.render();
            
            // Setup real-time listener for forms cache updates
            this.setupRealtimeListener();
        } catch (error) {
            console.error('Error loading forms:', error);
            Toast.error('Failed to load forms');
            this.forms = [];
        } finally {
            this.loading = false;
            AdminUI.setLoading('forms', false);
        }
    },
    
    /**
     * Setup real-time listener for forms cache
     * Automatically refreshes the list when forms are created/updated/deleted
     */
    setupRealtimeListener() {
        // Remove existing listener if any
        if (this.formsListener) {
            DB.rtdb.ref('adminCache/forms').off('value', this.formsListener);
            this.formsListener = null;
        }
        
        // Create new listener
        this.formsListener = (snapshot) => {
            if (snapshot.exists()) {
                const cacheData = snapshot.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                
                // Convert object to array, exclude lastUpdated
                const forms = Object.keys(cacheData)
                    .filter(key => key !== 'lastUpdated')
                    .map(key => {
                        const form = cacheData[key];
                        return {
                            ...form,
                            id: key,
                            formFieldsCount: form.formFieldsCount || form.formFields?.length || 0
                        };
                    });
                
                // Sort by updatedAt or createdAt (newest first)
                forms.sort((a, b) => {
                    const aTime = a.updatedAt || a.createdAt || 0;
                    const bTime = b.updatedAt || b.createdAt || 0;
                    return bTime - aTime;
                });
                
                // Update local state and render
                this.forms = forms;
                this.render();
            }
        };
        
        // Attach listener
        DB.rtdb.ref('adminCache/forms').on('value', this.formsListener);
    },
    
    /**
     * Cleanup: Remove real-time listener
     */
    cleanup() {
        if (this.formsListener) {
            DB.rtdb.ref('adminCache/forms').off('value', this.formsListener);
            this.formsListener = null;
        }
    },
    
    /**
     * Render forms list
     */
    render() {
        const list = document.getElementById('forms-list');
        if (!list) {
            console.error('Forms list element not found');
            return;
        }
        
        list.innerHTML = '';
        
        if (this.forms.length === 0) {
            list.innerHTML = '<p class="text-center text-slate-500 py-8">No forms created yet</p>';
            return;
        }
        
        // Sort by most recent first (by updatedAt or createdAt)
        const sortedForms = [...this.forms].sort((a, b) => {
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
            
            // Descending order (most recent first) - if timestamps are equal or 0, maintain original order
            return bTime - aTime;
        });
        
        sortedForms.forEach(form => {
            const card = document.createElement('div');
            card.className = 'bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-all duration-300';
            card.setAttribute('data-form-id', form.id);
            card.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h4 class="font-bold text-lg text-slate-800 mb-1">${this.escapeHtml(form.title)}</h4>
                        <p class="text-sm text-slate-500">${this.escapeHtml(form.description || 'No description')}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${
                            form.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                        }">${form.status || 'inactive'}</span>
                        ${form.points > 0 ? `<span class="text-xs text-amber-600"><i class="fas fa-star"></i> ${form.points} pts</span>` : '<span class="text-xs text-slate-400">No points</span>'}
                    </div>
                </div>
                <div class="flex items-center gap-4 text-sm text-slate-600 mb-4">
                    <span><i class="fas fa-list"></i> ${form.formFieldsCount || form.formFields?.length || 0} Fields</span>
                    <span><i class="fas fa-file-alt"></i> ${form.submissionsCount || form.submissionCount || 0} Submissions</span>
                </div>
                <div class="flex gap-2">
                    <button onclick="AdminForms.viewFormDetail('${form.id}')" class="flex-1 px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                    <button onclick="AdminForms.viewFormSubmissions('${form.id}')" class="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors">
                        <i class="fas fa-list"></i> View Responses
                    </button>
                    <button onclick="AdminForms.editForm('${form.id}')" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="AdminForms.deleteForm('${form.id}')" class="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors">
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
     * Show create form (step-by-step flow)
     */
    showCreateModal() {
        // Check for draft
        const draft = this.loadDraft();
        if (draft && confirm('You have a saved draft. Would you like to resume editing?')) {
            this.loadDraftIntoForm(draft);
        } else {
            // Reset form if no draft
            const formEl = document.getElementById('form-form');
            const idEl = document.getElementById('form-id');
            const titleInput = document.getElementById('form-title');
            const descInput = document.getElementById('form-description');
            const statusSelect = document.getElementById('form-status');
            const pointsInput = document.getElementById('form-points');
            const fieldsListEl = document.getElementById('form-fields-list');
            
            if (formEl) formEl.reset();
            if (idEl) idEl.value = '';
            if (titleInput) titleInput.value = '';
            if (descInput) descInput.value = '';
            if (statusSelect) statusSelect.value = 'active';
            if (pointsInput) pointsInput.value = '0';
            if (fieldsListEl) {
                fieldsListEl.innerHTML = '';
                this.fieldCounter = 0;
            }
        }
        
        // Reset to step 1
        this.currentStep = 1;
        this.updateFormStepUI();
        this.startAutoSave();
        
        // Update title
        const titleEl = document.getElementById('form-creator-title');
        if (titleEl) {
            titleEl.textContent = 'Create Form/Survey';
        }
        
        // Switch to form creator view
        AdminUI.switchView('form-creator');
    },
    
    /**
     * Save draft to localStorage
     */
    saveDraft() {
        try {
            const title = document.getElementById('form-title')?.value?.trim();
            const description = document.getElementById('form-description')?.value?.trim();
            const status = document.getElementById('form-status')?.value || 'active';
            const points = parseInt(document.getElementById('form-points')?.value || '0');
            const fieldsList = document.getElementById('form-fields-list');
            
            if (!title && (!fieldsList || fieldsList.children.length === 0)) {
                // Nothing to save
                return;
            }
            
            const draft = {
                title: title || '',
                description: description || '',
                status: status,
                points: points || 0,
                formFields: [],
                savedAt: Date.now()
            };
            
            // Save form fields
            if (fieldsList) {
                Array.from(fieldsList.children).forEach(fieldEl => {
                    const fieldId = fieldEl.querySelector('.field-id')?.value || fieldEl.querySelector('input[type="hidden"]')?.value;
                    const fieldLabel = fieldEl.querySelector('.field-label')?.value?.trim();
                    const fieldType = fieldEl.querySelector('.field-type')?.value;
                    const fieldRequired = fieldEl.querySelector('.field-required')?.checked;
                    const fieldOptions = fieldEl.querySelector('.field-options-text')?.value?.trim();
                    
                    if (fieldLabel) {
                        const field = {
                            id: fieldId || `f${Date.now()}.${Math.random().toString(36).substr(2, 9)}`,
                            label: fieldLabel,
                            type: fieldType || 'text',
                            required: fieldRequired || false
                        };
                        
                        if (fieldOptions && (fieldType === 'dropdown' || fieldType === 'radio' || fieldType === 'checkbox')) {
                            field.options = fieldOptions.split('\n').filter(o => o.trim());
                        }
                        
                        draft.formFields.push(field);
                    }
                });
            }
            
            localStorage.setItem('form_draft', JSON.stringify(draft));
        } catch (error) {
        }
    },
    
    /**
     * Load draft from localStorage
     */
    loadDraft() {
        try {
            const draftStr = localStorage.getItem('form_draft');
            if (draftStr) {
                const draft = JSON.parse(draftStr);
                // Check if draft is not too old (24 hours)
                const draftAge = Date.now() - (draft.savedAt || 0);
                if (draftAge < 24 * 60 * 60 * 1000) {
                    return draft;
                } else {
                    localStorage.removeItem('form_draft');
                }
            }
        } catch (error) {
            localStorage.removeItem('form_draft');
        }
        return null;
    },
    
    /**
     * Load draft into form
     */
    loadDraftIntoForm(draft) {
        const titleInput = document.getElementById('form-title');
        const descInput = document.getElementById('form-description');
        const statusSelect = document.getElementById('form-status');
        const pointsInput = document.getElementById('form-points');
        const fieldsList = document.getElementById('form-fields-list');
        
        if (titleInput) titleInput.value = draft.title || '';
        if (descInput) descInput.value = draft.description || '';
        if (statusSelect) statusSelect.value = draft.status || 'active';
        if (pointsInput) pointsInput.value = draft.points || 0;
        
        // Load form fields
        if (draft.formFields && draft.formFields.length > 0 && fieldsList) {
            fieldsList.innerHTML = '';
            this.fieldCounter = 0;
            draft.formFields.forEach(field => {
                this.addFormField(field);
            });
        }
    },
    
    /**
     * Update step UI indicators
     */
    updateFormStepUI() {
        const step1Indicator = document.getElementById('form-step-1-indicator');
        const step2Indicator = document.getElementById('form-step-2-indicator');
        const step1Container = step1Indicator?.parentElement;
        const step2Container = document.getElementById('form-step-2-container');
        const connector = document.getElementById('form-step-connector');
        const step1Div = document.getElementById('form-step-1');
        const step2Div = document.getElementById('form-step-2');
        const prevBtn = document.getElementById('form-prev-btn');
        const nextBtn = document.getElementById('form-next-btn');
        const saveBtn = document.getElementById('form-save-btn');
        
        // Update step indicators
        if (this.currentStep === 1) {
            if (step1Indicator) {
                step1Indicator.className = 'w-10 h-10 rounded-full bg-rota-pink text-white flex items-center justify-center font-bold';
            }
            if (step1Container) {
                step1Container.querySelector('span').className = 'text-sm font-medium text-slate-700';
            }
            if (step2Indicator) {
                step2Indicator.className = 'w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-bold';
            }
            if (step2Container) {
                step2Container.querySelector('span').className = 'text-sm font-medium text-slate-500';
            }
            if (connector) {
                connector.className = 'w-16 h-1 bg-slate-200';
            }
            
            // Show step 1, hide step 2
            if (step1Div) step1Div.classList.remove('hidden');
            if (step2Div) step2Div.classList.add('hidden');
            
            // Navigation buttons
            if (prevBtn) prevBtn.classList.add('hidden');
            if (nextBtn) nextBtn.classList.remove('hidden');
            if (saveBtn) saveBtn.classList.add('hidden');
        } else if (this.currentStep === 2) {
            if (step1Indicator) {
                step1Indicator.className = 'w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-bold';
            }
            if (step1Container) {
                step1Container.querySelector('span').className = 'text-sm font-medium text-slate-600';
            }
            if (step2Indicator) {
                step2Indicator.className = 'w-10 h-10 rounded-full bg-rota-pink text-white flex items-center justify-center font-bold';
            }
            if (step2Container) {
                step2Container.querySelector('span').className = 'text-sm font-medium text-slate-700';
            }
            if (connector) {
                connector.className = 'w-16 h-1 bg-green-500';
            }
            
            // Show step 2, hide step 1
            if (step1Div) step1Div.classList.add('hidden');
            if (step2Div) step2Div.classList.remove('hidden');
            
            // Navigation buttons
            if (prevBtn) prevBtn.classList.remove('hidden');
            if (nextBtn) nextBtn.classList.add('hidden');
            if (saveBtn) saveBtn.classList.remove('hidden');
        }
    },
    
    /**
     * Navigate to next step
     */
    nextFormStep() {
        if (this.currentStep === 1) {
            // Validate step 1
            const title = document.getElementById('form-title')?.value?.trim();
            if (!title) {
                Toast.error('Form title is required');
                return;
            }
            
            // Move to step 2
            this.currentStep = 2;
            this.updateFormStepUI();
        }
    },
    
    /**
     * Navigate to previous step
     */
    previousFormStep() {
        if (this.currentStep === 2) {
            this.currentStep = 1;
            this.updateFormStepUI();
        }
    },
    
    /**
     * Cancel form creation/editing
     */
    cancelForm() {
        if (confirm('Are you sure you want to cancel? Your draft will be saved automatically.')) {
            this.saveDraft();
            this.stopAutoSave();
            this.currentStep = 1;
            AdminUI.switchView('forms');
        }
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
     * Edit form
     * @param {string} formId - Form ID
     */
    async editForm(formId) {
        if (!formId) {
            Toast.error('Invalid form ID');
            return;
        }
        
        try {
            // Fetch form directly from Firestore to ensure we have the latest data
            const form = await DB.getForm(formId);
            if (!form) {
                Toast.error('Form not found');
                return;
            }
            
            const titleEl = document.getElementById('form-creator-title');
            const idEl = document.getElementById('form-id');
            const titleInput = document.getElementById('form-title');
            const descInput = document.getElementById('form-description');
            const statusSelect = document.getElementById('form-status');
            const pointsInput = document.getElementById('form-points');
            const fieldsListEl = document.getElementById('form-fields-list');
            
            if (!idEl || !titleInput || !descInput || !statusSelect || !pointsInput || !fieldsListEl) {
                Toast.error('Form elements not found');
                return;
            }
            
            if (titleEl) titleEl.textContent = 'Edit Form/Survey';
            idEl.value = form.id;
            titleInput.value = form.title || '';
            descInput.value = form.description || '';
            statusSelect.value = form.status || 'inactive';
            pointsInput.value = form.points || 0;
            
            fieldsListEl.innerHTML = '';
            this.fieldCounter = 0;
            
            if (form.formFields) {
                form.formFields.forEach(field => {
                    this.addFormField(field);
                });
            }
            
            // Reset to step 1
            this.currentStep = 1;
            this.updateFormStepUI();
            
            // Start auto-save for editing
            this.startAutoSave();
            
            // Switch to form creator view
            AdminUI.switchView('form-creator');
        } catch (error) {
            console.error('Error editing form:', error);
            Toast.error('Failed to load form for editing: ' + error.message);
        }
    },
    
    /**
     * Add form field
     * @param {Object} existingField - Existing field data (optional)
     */
    addFormField(existingField = null) {
        const fieldsList = document.getElementById('form-fields-list');
        if (!fieldsList) {
            Toast.error('Form fields list not found. Please make sure you are on step 2 of form creation.');
            console.error('form-fields-list element not found');
            return;
        }
        
        // Ensure fieldCounter is initialized
        if (typeof this.fieldCounter === 'undefined') {
            this.fieldCounter = 0;
        }
        
        const fieldId = existingField?.id || 'f' + Date.now() + '.' + this.fieldCounter++;
        
        // Count only form-field-container elements for accurate field numbering
        const existingFields = fieldsList.querySelectorAll('.form-field-container');
        const fieldNumber = existingFields.length + 1;
        
        const fieldEl = document.createElement('div');
        fieldEl.className = 'form-field-container border border-slate-200 rounded-lg p-4 bg-white';
        fieldEl.innerHTML = `
            <input type="hidden" class="field-id" value="${this.escapeHtml(fieldId)}">
            <div class="flex justify-between items-center mb-3">
                <span class="font-bold text-slate-700">Field ${fieldNumber}</span>
                <button type="button" onclick="this.closest('.form-field-container').remove()" class="text-red-500 hover:text-red-700">
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
                    <select class="field-type w-full px-3 py-2 border border-slate-200 rounded-lg" onchange="AdminForms.handleFieldTypeChange(this)" required>
                        <option value="text" ${existingField?.type === 'text' ? 'selected' : ''}>Text</option>
                        <option value="textarea" ${existingField?.type === 'textarea' ? 'selected' : ''}>Textarea</option>
                        <option value="number" ${existingField?.type === 'number' ? 'selected' : ''}>Number</option>
                        <option value="email" ${existingField?.type === 'email' ? 'selected' : ''}>Email</option>
                        <option value="tel" ${existingField?.type === 'tel' ? 'selected' : ''}>Phone</option>
                        <option value="date" ${existingField?.type === 'date' ? 'selected' : ''}>Date</option>
                        <option value="dropdown" ${existingField?.type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
                        <option value="checkbox" ${existingField?.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                        <option value="radio" ${existingField?.type === 'radio' ? 'selected' : ''}>Radio</option>
                    </select>
                </div>
                <div class="field-options ${existingField?.type === 'dropdown' || existingField?.type === 'radio' || existingField?.type === 'checkbox' ? '' : 'hidden'}">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Options (one per line) *</label>
                    <textarea class="field-options-text w-full px-3 py-2 border border-slate-200 rounded-lg" rows="3" ${existingField?.type === 'dropdown' || existingField?.type === 'radio' || existingField?.type === 'checkbox' ? 'required' : ''}>${this.escapeHtml(existingField?.options?.join('\n') || '')}</textarea>
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
        
        // Ensure the field is visible (in case step 2 was hidden)
        const step2Div = document.getElementById('form-step-2');
        if (step2Div && step2Div.classList.contains('hidden')) {
            // If we're adding a field but step 2 is hidden, switch to step 2
            this.currentStep = 2;
            this.updateFormStepUI();
        }
        
        // Scroll to the newly added field
        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    
    /**
     * Handle field type change
     * @param {HTMLElement} select - Select element
     */
    handleFieldTypeChange(select) {
        const fieldEl = select.closest('.form-field-container');
        
        if (!fieldEl) {
            return;
        }
        
        const optionsDiv = fieldEl.querySelector('.field-options');
        const optionsTextarea = fieldEl.querySelector('.field-options-text');
        
        if (!optionsDiv || !optionsTextarea) {
            return;
        }
        
        if (select.value === 'dropdown' || select.value === 'radio' || select.value === 'checkbox') {
            optionsDiv.classList.remove('hidden');
            optionsTextarea.required = true;
        } else {
            optionsDiv.classList.add('hidden');
            optionsTextarea.required = false;
        }
    },
    
    /**
     * Save form
     * @param {Event} event - Form submit event
     */
    async saveForm(event) {
        event.preventDefault();
        
        try {
            const formId = document.getElementById('form-id')?.value;
            const title = document.getElementById('form-title')?.value?.trim();
            const description = document.getElementById('form-description')?.value?.trim();
            const status = document.getElementById('form-status')?.value;
            const points = parseInt(document.getElementById('form-points')?.value || '0');
            const fieldsList = document.getElementById('form-fields-list');
            
            // Validation
            if (!title) {
                Toast.error('Form title is required');
                return;
            }
            
            if (points < 0) {
                Toast.error('Points cannot be negative');
                return;
            }
            
            if (!fieldsList || fieldsList.children.length === 0) {
                Toast.error('Please add at least one field');
                return;
            }
            
            const formFields = [];
            // Use children instead of querySelectorAll with invalid selector
            for (let index = 0; index < fieldsList.children.length; index++) {
                const fieldEl = fieldsList.children[index];
                const fieldId = fieldEl.querySelector('.field-id')?.value || fieldEl.querySelector('input[type="hidden"]')?.value;
                const label = fieldEl.querySelector('.field-label')?.value?.trim();
                const fieldType = fieldEl.querySelector('.field-type')?.value;
                const required = fieldEl.querySelector('.field-required')?.checked || false;
                
                if (!label) {
                    Toast.error(`Field ${index + 1} label is required`);
                    return;
                }
                
                const field = {
                    id: fieldId || 'f' + Date.now() + '.' + index + '.' + Math.random(),
                    label,
                    type: fieldType || 'text',
                    required
                };
                
                if (fieldType === 'dropdown' || fieldType === 'radio' || fieldType === 'checkbox') {
                    const optionsText = fieldEl.querySelector('.field-options-text')?.value?.trim();
                    if (!optionsText) {
                        Toast.error(`Field ${index + 1} options are required for ${fieldType} type`);
                        return;
                    }
                    field.options = optionsText.split('\n').filter(o => o.trim());
                }
                
                formFields.push(field);
            }
            
            if (formFields.length === 0) {
                Toast.error('Please add at least one valid field');
                return;
            }
            
            const data = {
                title,
                description,
                formFields,
                points,
                // Default to 'active' for new forms, preserve existing status for updates
                status: status || (formId ? 'inactive' : 'active')
            };
            
            // Save to database
            let savedFormId = formId;
            let operationId = null;
            
            if (formId) {
                // UPDATE: Optimistic update
                const existingForm = this.forms.find(f => f.id === formId);
                if (existingForm) {
                    const updatedForm = {
                        ...existingForm,
                        ...data,
                        id: formId,
                        formFieldsCount: data.formFields?.length || 0,
                        updatedAt: Date.now() // Temporary timestamp
                    };
                    operationId = OptimisticUI.updateItem('form', formId, updatedForm, () => {
                        this.render();
                    }, this.forms);
                }
                
                // Firestore update (async, don't wait)
                data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                DB.db.collection('forms').doc(formId).update(data)
                    .then(() => {
                Toast.success('Form updated successfully');
                    })
                    .catch((error) => {
                        console.error('Error updating form:', error);
                        Toast.error('Failed to update form: ' + error.message);
                        // Rollback optimistic update on error
                        if (operationId) {
                            OptimisticUI.rollback(operationId, () => {
                                this.render();
                            });
                        }
                    });
            } else {
                // CREATE: Optimistic add
                const newForm = {
                    ...data,
                    id: 'temp_' + Date.now(), // Temporary ID
                    formFieldsCount: data.formFields?.length || 0,
                    submissionCount: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                operationId = OptimisticUI.addItem('form', newForm, () => {
                    this.render();
                }, this.forms);
                
                // Firestore create (async, don't wait)
                DB.db.collection('forms').add({
                    ...data,
                    submissionCount: 0,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                })
                    .then((docRef) => {
                savedFormId = docRef.id;
                Toast.success('Form created successfully');
                        
                        // Invalidate memory cache (new form, clear all form cache)
                        MemoryCache.clearPrefix('form:');
                        
                        // Update the optimistic item with real ID
                        const tempIndex = this.forms.findIndex(f => f.id === newForm.id);
                        if (tempIndex !== -1) {
                            this.forms[tempIndex] = {
                                ...this.forms[tempIndex],
                                id: savedFormId
                            };
                            this.render();
                        }
                    })
                    .catch((error) => {
                        console.error('Error creating form:', error);
                        Toast.error('Failed to create form: ' + error.message);
                        // Rollback optimistic update on error
                        if (operationId) {
                            OptimisticUI.rollback(operationId, () => {
                                this.render();
                            });
                        }
                    });
            }
            
            // Stop auto-save after successful save
            this.stopAutoSave();
            // Clear draft after successful save
            localStorage.removeItem('form_draft');
            
            // Return to forms view immediately (optimistic UI already rendered)
            AdminUI.switchView('forms');
            // Real-time listener will confirm the update when Cloud Function completes
        } catch (error) {
            console.error('Error saving form:', error);
            Toast.error('Failed to save form: ' + error.message);
        }
    },
    
    /**
     * View form detail in step flow
     * @param {string} formId - Form ID
     */
    viewFormDetail(formId) {
        if (!formId) {
            Toast.error('Invalid form ID');
            return;
        }
        
        const form = this.forms.find(f => f.id === formId);
        if (!form) {
            Toast.error('Form not found');
            return;
        }
        
        // Find index in current list
        const currentIndex = this.forms.findIndex(f => f.id === formId);
        
        // Store current forms for navigation
        this.currentForms = {
            forms: [...this.forms],
            currentIndex: currentIndex >= 0 ? currentIndex : 0
        };
        
        // Render detail view
        this.renderFormDetailView();
    },
    
    /**
     * Render form detail view (step flow)
     */
    renderFormDetailView() {
        const { forms, currentIndex } = this.currentForms;
        
        const titleEl = document.getElementById('form-detail-title');
        const typeEl = document.getElementById('form-detail-type');
        const contentEl = document.getElementById('form-detail-content');
        const currentEl = document.getElementById('form-detail-current');
        const totalEl = document.getElementById('form-detail-total');
        const progressEl = document.getElementById('form-detail-progress');
        const prevBtn = document.getElementById('form-detail-prev');
        const nextBtn = document.getElementById('form-detail-next');
        
        if (!titleEl || !typeEl || !contentEl || !currentEl || !totalEl || !progressEl || !prevBtn || !nextBtn) {
            Toast.error('Form detail view elements not found');
            return;
        }
        
        // Update navigation
        currentEl.textContent = forms.length > 0 ? currentIndex + 1 : 0;
        totalEl.textContent = forms.length;
        const progress = forms.length > 0 ? ((currentIndex + 1) / forms.length) * 100 : 0;
        progressEl.style.width = progress + '%';
        
        // Update button states
        prevBtn.disabled = currentIndex === 0;
        prevBtn.classList.toggle('opacity-50', currentIndex === 0);
        prevBtn.classList.toggle('cursor-not-allowed', currentIndex === 0);
        nextBtn.disabled = currentIndex >= forms.length - 1;
        nextBtn.classList.toggle('opacity-50', currentIndex >= forms.length - 1);
        nextBtn.classList.toggle('cursor-not-allowed', currentIndex >= forms.length - 1);
        
        // Render current form
        contentEl.innerHTML = '';
        
        if (forms.length === 0) {
            contentEl.innerHTML = '<div class="text-center text-slate-500 py-16"><p class="text-lg">No forms to display</p></div>';
            return;
        }
        
        const form = forms[currentIndex];
        
        // Update title and type
        titleEl.textContent = form.title || 'Untitled Form';
        typeEl.textContent = 'Form/Survey';
        
        // Build form fields HTML
        let formFieldsHTML = '';
        if (form.formFields && form.formFields.length > 0) {
            formFieldsHTML = '<div class="bg-slate-50 rounded-lg p-4 mb-4"><h5 class="font-bold text-slate-800 mb-3">Form Fields:</h5>';
            form.formFields.forEach((field, idx) => {
                formFieldsHTML += `
                    <div class="mb-3 pb-3 border-b border-slate-200 last:border-0">
                        <div class="flex justify-between items-start mb-1">
                            <span class="font-medium text-slate-700">${idx + 1}. ${this.escapeHtml(field.label || field.id)}</span>
                            <span class="text-xs text-slate-500">${field.type || 'text'}</span>
                        </div>
                        ${field.required ? '<span class="text-xs text-red-600">Required</span>' : '<span class="text-xs text-slate-400">Optional</span>'}
                        ${field.options && field.options.length > 0 ? `
                            <div class="mt-2 text-xs text-slate-600">
                                Options: ${field.options.map(opt => this.escapeHtml(opt)).join(', ')}
                            </div>
                        ` : ''}
                    </div>
                `;
            });
            formFieldsHTML += '</div>';
        } else {
            formFieldsHTML = '<div class="bg-slate-50 rounded-lg p-4 mb-4"><p class="text-slate-500">No form fields defined</p></div>';
        }
        
        const statusDisplay = form.status === 'active' 
            ? { className: 'bg-green-100 text-green-700', text: 'Active' }
            : { className: 'bg-slate-100 text-slate-700', text: 'Inactive' };
        
        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200 rounded-xl p-6 max-w-3xl mx-auto';
        card.innerHTML = `
            <div class="flex justify-between items-start mb-6 pb-4 border-b border-slate-200">
                <div>
                    <h4 class="font-bold text-xl text-slate-800 mb-1">${this.escapeHtml(form.title || 'Untitled Form')}</h4>
                    <p class="text-sm text-slate-500">${this.escapeHtml(form.description || 'No description')}</p>
                </div>
                <div class="text-right">
                    <span class="px-3 py-1 rounded-full text-xs font-bold ${statusDisplay.className} mb-2 block">${statusDisplay.text}</span>
                    ${form.points > 0 ? `<span class="text-sm text-slate-600"><i class="fas fa-star text-amber-500"></i> ${form.points} Points</span>` : '<span class="text-sm text-slate-400">No points</span>'}
                </div>
            </div>
            
            <div class="space-y-4">
                <div class="flex items-center gap-4 text-sm text-slate-600">
                    <span><i class="fas fa-list"></i> ${form.formFields?.length || 0} Fields</span>
                    <span><i class="fas fa-file-alt"></i> ${form.submissionCount || 0} Submissions</span>
                </div>
                
                ${formFieldsHTML}
            </div>
            
            <div class="flex gap-3 mt-6 pt-4 border-t border-slate-200">
                <button onclick="AdminForms.viewFormSubmissions('${form.id}')" class="flex-1 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium">
                    <i class="fas fa-list"></i> View Responses
                </button>
                <button onclick="AdminForms.editForm('${form.id}')" class="flex-1 px-4 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium">
                    <i class="fas fa-edit"></i> Edit Form
                </button>
            </div>
        `;
        contentEl.appendChild(card);
        
        // Switch to detail view
        AdminUI.switchView('form-detail');
    },
    
    /**
     * Navigate to previous form
     */
    previousForm() {
        if (this.currentForms.currentIndex > 0) {
            this.currentForms.currentIndex--;
            this.renderFormDetailView();
        }
    },
    
    /**
     * Navigate to next form
     */
    nextForm() {
        if (this.currentForms.currentIndex < this.currentForms.forms.length - 1) {
            this.currentForms.currentIndex++;
            this.renderFormDetailView();
        }
    },
    
    /**
     * Back to forms list
     */
    backToForms() {
        this.currentForms = {
            forms: [],
            currentIndex: 0
        };
        AdminUI.switchView('forms');
    },
    
    /**
     * Delete form
     * @param {string} formId - Form ID
     */
    async deleteForm(formId) {
        if (!formId) {
            Toast.error('Invalid form ID');
            return;
        }
        
        // Enhanced confirmation dialog
        const form = this.forms.find(f => f.id === formId);
        const formTitle = form?.title || 'this form';
        
        if (!confirm(`⚠️ Delete Form?\n\nForm: "${formTitle}"\n\nThis will:\n• Delete the form permanently\n• Remove it from all users' pending missions\n• Delete all associated submissions\n\nThis action cannot be undone.`)) {
            return;
        }
        
        try {
            // Show loading state
            const formCard = document.querySelector(`[data-form-id="${formId}"]`);
            if (formCard) {
                formCard.style.opacity = '0.5';
                formCard.style.pointerEvents = 'none';
                const deleteBtn = formCard.querySelector('[onclick*="deleteForm"]');
                if (deleteBtn) {
                    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    deleteBtn.disabled = true;
                }
            }
            
            // Optimistic UI update: Remove from local list immediately with fade-out
            const operationId = OptimisticUI.removeItem('form', formId, () => {
                this.render();
            }, this.forms);
            
            // Delete from Firestore (async, triggers Cloud Function)
            DB.db.collection('forms').doc(formId).delete()
                .then(() => {
                    // Clear caches
            DB.invalidateCache('form');
            Cache.clear('cache_forms_list');
            
                    // Show success message
                    Toast.success(`Form "${formTitle}" deleted successfully. It will be removed from all users' pending missions shortly.`);
                    
                    // Real-time listener will confirm the update when Cloud Function completes
                })
                .catch((error) => {
                    console.error('Error deleting form:', error);
                    Toast.error('Failed to delete form: ' + error.message);
                    
                    // Rollback optimistic update on error
                    if (operationId) {
                        OptimisticUI.rollback(operationId, () => {
            this.render();
                        });
                    }
                    
                    // Restore UI on error
                    const formCard = document.querySelector(`[data-form-id="${formId}"]`);
                    if (formCard) {
                        formCard.style.opacity = '1';
                        formCard.style.pointerEvents = 'auto';
                        const deleteBtn = formCard.querySelector('[onclick*="deleteForm"]');
                        if (deleteBtn) {
                            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                            deleteBtn.disabled = false;
                        }
                    }
                });
        } catch (error) {
            console.error('Error in deleteForm:', error);
            Toast.error('Failed to delete form: ' + error.message);
        }
    },
    
    /**
     * View form submissions in step flow
     * @param {string} formId - Form ID
     */
    async viewFormSubmissions(formId) {
        if (!formId) {
            Toast.error('Invalid form ID');
            return;
        }
        
        try {
            // Fetch form directly from Firestore to ensure we have complete data
            const form = await DB.getForm(formId);
            if (!form) {
                Toast.error('Form not found');
                return;
            }
            
            // OPTIMIZATION: Use RTDB metadata cache for list/navigation (0 Firestore reads)
            // Fetch pre-computed submission IDs
            const submissionIdsResult = await DB.readFromCache(`admin/submissions/byForm/${formId}`);
            const submissionIds = submissionIdsResult.data ? Object.keys(submissionIdsResult.data) : [];
            
            if (!submissionIds || submissionIds.length === 0) {
                Toast.info(`No responses yet for "${form.title}". Check back later when participants submit this form.`);
                return;
            }
            
            // Fetch metadata for each submission ID from RTDB cache (0 Firestore reads)
            const metadataPromises = submissionIds.map(id => 
                DB.readFromCache(`admin/submissions/metadata/${id}`)
            );
            const metadataResults = await Promise.all(metadataPromises);
            
            // Use metadata for navigation/list view
            let submissionsMetadata = metadataResults
                .map(r => r.data)
                .filter(s => s !== null)
                .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
            
            // Get user details for submissions (from directory cache)
            const userIds = [...new Set(submissionsMetadata.map(s => s.userId))];
            const usersMap = new Map();
            
            // Try attendeeCache/directory first (correct path)
            let directoryResult = await DB.readFromCache('attendeeCache/directory');
            let directory = directoryResult?.data || {};
            
            // Fallback to cache/users/directory if attendeeCache is empty
            if (!directory || Object.keys(directory).length === 0) {
                directoryResult = await DB.readFromCache('cache/users/directory');
                directory = directoryResult?.data || {};
            }
            
            // Fetch user data for all userIds - use batch loading for optimization
            // First, populate from cache
            userIds.forEach(userId => {
                if (directory[userId]) {
                    usersMap.set(userId, directory[userId]);
                }
            });
            
            // Identify which users are missing from cache
            const missingUserIds = userIds.filter(userId => !usersMap.has(userId));
            
            // Batch load missing users from Firestore
            if (missingUserIds.length > 0) {
                const batchUsersMap = await DB.getUsersBatch(missingUserIds);
                batchUsersMap.forEach((user, userId) => {
                    usersMap.set(userId, user);
                });
            }
            
            // Store metadata for navigation and cache for full submissions
            this.currentFormSubmissions = {
                form,
                submissions: submissionsMetadata, // Metadata for navigation
                usersMap,
                currentIndex: 0,
                _fullSubmissionsCache: new Map() // Cache for full submissions loaded from Firestore
            };
            
            // Render submissions view
            this.renderFormSubmissionsView();
        } catch (error) {
            console.error('Error fetching form submissions:', error);
            Toast.error('Failed to load submissions: ' + error.message);
        }
    },
    
    /**
     * Render form submissions view (step flow)
     */
    renderFormSubmissionsView() {
        const { form, submissions, usersMap, currentIndex } = this.currentFormSubmissions;
        
        const titleEl = document.getElementById('form-submissions-view-title');
        const countEl = document.getElementById('form-submissions-view-count');
        const contentEl = document.getElementById('form-submissions-content');
        const currentEl = document.getElementById('form-submissions-current');
        const totalEl = document.getElementById('form-submissions-total');
        const progressEl = document.getElementById('form-submissions-progress');
        const prevBtn = document.getElementById('form-submissions-prev');
        const nextBtn = document.getElementById('form-submissions-next');
        const downloadBtn = document.getElementById('form-submissions-view-download');
        
        if (!titleEl || !countEl || !contentEl || !currentEl || !totalEl || !progressEl || !prevBtn || !nextBtn || !downloadBtn) {
            Toast.error('Form submissions view elements not found');
            return;
        }
        
        titleEl.textContent = `Responses: ${this.escapeHtml(form.title)}`;
        countEl.textContent = `${submissions.length} response${submissions.length !== 1 ? 's' : ''}`;
        
        // Store data for download
        downloadBtn.onclick = () => this.downloadFormSubmissions(form, submissions, usersMap);
        
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
            contentEl.innerHTML = '<div class="text-center text-slate-500 py-16"><p class="text-lg">No responses yet</p></div>';
            return;
        }
        
        const submissionMetadata = submissions[currentIndex];
        
        // OPTIMIZATION: Load full submission from Firestore only when viewing detail (1 read instead of 30-100)
        // Check cache first, then load from Firestore if needed
        let fullSubmission = null;
        if (this.currentFormSubmissions._fullSubmissionsCache && 
            this.currentFormSubmissions._fullSubmissionsCache.has(submissionMetadata.id)) {
            fullSubmission = this.currentFormSubmissions._fullSubmissionsCache.get(submissionMetadata.id);
        } else {
            // Load from Firestore (1 read per submission viewed)
            try {
                const doc = await DB.db.collection('formSubmissions').doc(submissionMetadata.id).get();
                if (doc.exists) {
                    fullSubmission = { id: doc.id, ...doc.data() };
                    // Cache for future navigation
                    if (!this.currentFormSubmissions._fullSubmissionsCache) {
                        this.currentFormSubmissions._fullSubmissionsCache = new Map();
                    }
                    this.currentFormSubmissions._fullSubmissionsCache.set(submissionMetadata.id, fullSubmission);
                } else {
                    // Fallback to metadata if Firestore read fails
                    fullSubmission = submissionMetadata;
                }
            } catch (error) {
                console.error('Error loading full submission:', error);
                // Fallback to metadata
                fullSubmission = submissionMetadata;
            }
        }
        
        // Use full submission if available, otherwise fall back to metadata
        const submission = fullSubmission || submissionMetadata;
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
        
        // Get field labels from form definition
        let fieldLabelsMap = {};
        if (form.formFields) {
            form.formFields.forEach(field => {
                fieldLabelsMap[field.id] = field.label;
            });
        }
        
        // Build form responses HTML
        let formDataHTML = '';
        
        // Check if formData exists and has content
        const hasFormData = submission.formData && 
                           typeof submission.formData === 'object' && 
                           Object.keys(submission.formData).length > 0;
        
        if (hasFormData) {
            formDataHTML = '<div class="bg-slate-50 rounded-lg p-4 mb-4"><h5 class="font-bold text-slate-800 mb-3">Form Responses:</h5>';
            
            // Iterate through form fields in order (to match form definition order)
            if (form.formFields && form.formFields.length > 0) {
                form.formFields.forEach(field => {
                    const fieldId = field.id;
                    const value = submission.formData[fieldId];
                    const label = field.label || fieldId;
                    
                    // Handle different value types
                    let displayValue = value;
                    if (value === null || value === undefined) {
                        displayValue = '(not answered)';
                    } else if (value === '') {
                        displayValue = '(empty)';
                    } else if (Array.isArray(value)) {
                        displayValue = value.length > 0 ? value.join(', ') : '(empty)';
                    } else {
                        const strValue = String(value).trim();
                        displayValue = strValue || '(empty)';
                    }
                    
                    formDataHTML += `
                        <div class="mb-3 pb-3 border-b border-slate-200 last:border-0">
                            <span class="font-medium text-slate-700">${this.escapeHtml(label)}:</span>
                            <span class="text-slate-600 ml-2">${this.escapeHtml(String(displayValue))}</span>
                        </div>
                    `;
                });
            } else {
                // Fallback: iterate through formData keys if form fields not available
                Object.entries(submission.formData).forEach(([key, value]) => {
                    const label = fieldLabelsMap[key] || Utils.cleanFieldId(key) || key;
                    let displayValue = value;
                    if (displayValue === null || displayValue === undefined || displayValue === '') {
                        displayValue = '(empty)';
                    } else if (Array.isArray(displayValue)) {
                        displayValue = displayValue.length > 0 ? displayValue.join(', ') : '(empty)';
                    } else {
                        displayValue = String(displayValue).trim() || '(empty)';
                    }
                    
                    formDataHTML += `
                        <div class="mb-3 pb-3 border-b border-slate-200 last:border-0">
                            <span class="font-medium text-slate-700">${this.escapeHtml(label)}:</span>
                            <span class="text-slate-600 ml-2">${this.escapeHtml(String(displayValue))}</span>
                        </div>
                    `;
                });
            }
            
            formDataHTML += '</div>';
        } else {
            // Show message if formData is missing or empty
            formDataHTML = '<div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4"><p class="text-sm text-amber-700"><i class="fas fa-exclamation-triangle"></i> No form responses found in this submission. The form may have been submitted without data.</p></div>';
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
                    <p class="text-xs text-slate-400">${formattedDate}</p>
                </div>
            </div>
            
            ${formDataHTML}
        `;
        contentEl.appendChild(card);
        
        // Switch to submissions view
        AdminUI.switchView('form-submissions');
    },
    
    /**
     * Navigate to previous form submission
     */
    previousFormSubmission() {
        if (this.currentFormSubmissions.currentIndex > 0) {
            this.currentFormSubmissions.currentIndex--;
            this.renderFormSubmissionsView();
        }
    },
    
    /**
     * Navigate to next form submission
     */
    nextFormSubmission() {
        if (this.currentFormSubmissions.currentIndex < this.currentFormSubmissions.submissions.length - 1) {
            this.currentFormSubmissions.currentIndex++;
            this.renderFormSubmissionsView();
        }
    },
    
    /**
     * Download form submissions as CSV
     * @param {Object} form - Form object
     * @param {Array} submissions - Array of submissions
     * @param {Map} usersMap - Map of userId to user data
     */
    downloadFormSubmissions(form, submissions, usersMap) {
        try {
            if (submissions.length === 0) {
                Toast.error('No responses to download');
                return;
            }
            
            // Build CSV header
            const headers = ['Participant Name', 'Email', 'Submitted Date'];
            
            // Add form field columns
            if (form.formFields) {
                form.formFields.forEach(field => {
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
                    formattedDate
                ];
                
                // Add form field data
                if (form.formFields && submission.formData) {
                    form.formFields.forEach(field => {
                        const value = submission.formData[field.id];
                        let displayValue = '(empty)';
                        
                        if (value !== null && value !== undefined && value !== '') {
                            if (Array.isArray(value)) {
                                displayValue = value.length > 0 ? value.join(', ') : '(empty)';
                            } else {
                                const strValue = String(value).trim();
                                displayValue = strValue || '(empty)';
                            }
                        }
                        
                        row.push(displayValue);
                    });
                } else if (form.formFields) {
                    // If formData is missing, add empty cells for each field
                    form.formFields.forEach(() => {
                        row.push('(no data)');
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
            a.download = `form-responses-${form.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Toast.success(`Downloaded ${submissions.length} responses successfully`);
        } catch (error) {
            console.error('Error downloading form submissions:', error);
            Toast.error('Failed to download responses: ' + error.message);
        }
    },
    
    /**
     * Back to forms list
     */
    backToForms() {
        this.currentFormSubmissions = {
            form: null,
            submissions: [],
            usersMap: new Map(),
            currentIndex: 0
        };
        AdminUI.switchView('forms');
    },
    
    /**
     * View submissions for a form (legacy - redirects to general submissions)
     * @param {string} formId - Form ID
     */
    async viewSubmissions(formId) {
        if (!formId) {
            Toast.error('Invalid form ID');
            return;
        }
        
        try {
            AdminUI.switchView('submissions');
            await AdminSubmissions.filterByForm(formId);
        } catch (error) {
            console.error('Error viewing form submissions:', error);
            Toast.error('Failed to load form submissions');
        }
    }
};

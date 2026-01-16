// Task Module
const Task = {
    currentTask: null,
    selectedFile: null,
    
    async openUploadModal(taskId) {
        // If stuck in submitting state, reset it (safety check)
        if (this._submitting) {
            this._submitting = false;
        }
        
        // Close any existing modal first
        const existingModal = document.querySelector('[id^="modal-"]:not(.hidden)');
        if (existingModal) {
            closeModal(existingModal.id);
        }
        
        const task = await DB.getTask(taskId);
        if (!task) {
            showToast('Task not found', 'error');
            return;
        }
        
        // Check if task can be submitted using CompletionManager
        const canSubmit = await CompletionManager.canSubmitTask(Auth.currentUser.uid, taskId);
        
        if (!canSubmit.canSubmit) {
            Toast.info(canSubmit.reason);
            return;
        }
        
        this.currentTask = task;
        document.getElementById('upload-task-title').textContent = task.title;
        document.getElementById('file-preview').classList.add('hidden');
        document.getElementById('submit-file-btn').classList.add('hidden');
        document.getElementById('file-input').value = '';
        this.selectedFile = null;
        
        const modal = document.getElementById('modal-upload');
        if (modal) {
            // CRITICAL: Reset close button state before showing modal
            const closeBtn = modal.querySelector('button[onclick*="closeModal"]');
            if (closeBtn) {
                closeBtn.style.pointerEvents = 'auto';
            }
            
            // Reset submit button state
            const submitBtn = document.getElementById('submit-file-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Upload File';
            }
            
            modal.classList.remove('hidden');
        }
    },
    
    handleFileSelect(input) {
        const file = input.files[0];
        if (!file) return;
        
        // Validate file type
        const allowedTypes = this.currentTask?.allowedFileTypes || ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
        if (!allowedTypes.includes(file.type)) {
            showToast('Invalid file type. Please select an image or PDF.', 'error');
            input.value = '';
            return;
        }
        
        // Validate file size (max 5MB)
        const maxSize = (this.currentTask?.maxFileSize || 5) * 1024 * 1024;
        if (file.size > maxSize) {
            showToast(`File size exceeds ${this.currentTask?.maxFileSize || 5}MB limit.`, 'error');
            input.value = '';
            return;
        }
        
        this.selectedFile = file;
        
        // Show preview
        const previewEl = document.getElementById('file-preview');
        previewEl.classList.remove('hidden');
        
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewEl.innerHTML = `
                    <img src="${e.target.result}" class="w-full rounded-xl border border-slate-200" alt="Preview">
                    <p class="text-xs text-slate-500 mt-2 text-center">${file.name}</p>
                `;
            };
            reader.readAsDataURL(file);
        } else {
            previewEl.innerHTML = `
                <div class="p-8 bg-slate-50 rounded-xl border border-slate-200 text-center">
                    <i class="fas fa-file-pdf text-4xl text-red-500 mb-2"></i>
                    <p class="text-sm font-medium text-slate-800">${file.name}</p>
                    <p class="text-xs text-slate-500 mt-1">${(file.size / 1024).toFixed(2)} KB</p>
                </div>
            `;
        }
        
        document.getElementById('submit-file-btn').classList.remove('hidden');
    },
    
    async submitTaskFile() {
        if (!this.currentTask || !this.selectedFile) {
            showToast('Please select a file', 'error');
            return;
        }
        
        // Check if already submitting
        const submitBtn = document.getElementById('submit-file-btn');
        if (submitBtn && submitBtn.disabled) {
            return; // Already submitting
        }
        
        // Check if task can be submitted
        const canSubmit = await CompletionManager.canSubmitTask(Auth.currentUser.uid, this.currentTask.id);
        if (!canSubmit.canSubmit) {
            showToast(canSubmit.reason, 'error');
            return;
        }
        
        // Disable button and show loading state
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Uploading...';
        }
        
        // Prevent modal close
        const closeBtn = document.querySelector('#modal-upload button[onclick*="closeModal"]');
        if (closeBtn) closeBtn.style.pointerEvents = 'none';
        
        try {
            // Upload file
            const filePath = `task-submissions/${Auth.currentUser.uid}/${Date.now()}_${this.selectedFile.name}`;
            const fileURL = await DB.uploadFile(this.selectedFile, filePath);
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
            }
            
            // Create submission
            const submission = {
                userId: Auth.currentUser.uid,
                userName: Auth.currentUser.name,
                taskId: this.currentTask.id,
                taskTitle: this.currentTask.title,
                type: this.currentTask.type,
                fileURL: fileURL,
                status: 'pending'
            };
            
            // Prevent double submission
            if (this._submitting) {
                return;
            }
            
            this._submitting = true;
            
            // CRITICAL: Capture task ID before closing modal (to avoid null reference in async handlers)
            const taskId = this.currentTask.id;
            
            
            // IMMEDIATE UX: Show submitting state on card BEFORE database write
            SubmissionHelpers.showSubmittingState(taskId, 'task');
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
                submitBtn.disabled = true;
            }
            
            // Optimistic update: Remove task from pending activities list immediately
            await SubmissionHelpers.optimisticallyRemoveFromPending(
                Auth.currentUser.uid,
                'task',
                taskId
            );
            
            // Close modal immediately (don't wait for database)
            closeModal('modal-upload');
            
            
            // Show success toast immediately
            Toast.success('Submission successful! Waiting for approval.');
            
            // Submit to database (async - don't wait for Cloud Function)
            DB.submitTask(submission)
                .then(() => {
                    
                    // Mark as completed locally
                    CompletionManager.markCompletedLocally(
                        Auth.currentUser.uid,
                        'task',
                        taskId,
                {
                    status: 'pending',
                    submittedAt: Date.now()
                }
            );
            
                    this._submitting = false;
                    this.currentTask = null;
                    
                    // Re-enable close button in case modal is still open
                    const closeBtn = document.querySelector('#modal-upload button[onclick*="closeModal"]');
                    if (closeBtn) {
                        closeBtn.style.pointerEvents = 'auto';
                    }
                })
                .catch(error => {
                    
                    console.error('Error submitting task:', error);
                    Toast.error('Failed to submit task. Please try again.');
                    // Rollback optimistic update on error
                    SubmissionHelpers.rollbackSubmission(taskId, 'task');
                    
                    this._submitting = false;
                    
                    // Re-enable close button and submit button
                    const closeBtn = document.querySelector('#modal-upload button[onclick*="closeModal"]');
                    if (closeBtn) {
                        closeBtn.style.pointerEvents = 'auto';
                    }
                    const submitBtn = document.getElementById('submit-file-btn');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Upload File';
                    }
                });
        } catch (error) {
            // Re-enable button on error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Submit';
            }
            if (closeBtn) closeBtn.style.pointerEvents = 'auto';
            showToast('Upload failed: ' + error.message, 'error');
        }
    },
    
    async openFormModal(taskId) {
        
        // If stuck in submitting state, reset it (safety check)
        if (this._submitting) {
            this._submitting = false;
        }
        
        // Close any existing modal first
        const existingModal = document.querySelector('[id^="modal-"]:not(.hidden)');
        if (existingModal) {
            closeModal(existingModal.id);
        }
        
        const task = await DB.getTask(taskId);
        if (!task) {
            showToast('Task not found', 'error');
            return;
        }
        
        if (task.type !== 'form') {
            showToast('This task is not a form', 'error');
            return;
        }
        
        // Check if task can be submitted using CompletionManager
        const canSubmit = await CompletionManager.canSubmitTask(Auth.currentUser.uid, taskId);
        
        if (!canSubmit.canSubmit) {
            Toast.info(canSubmit.reason);
            return;
        }
        
        this.currentTask = task;
        document.getElementById('task-form-modal-title').textContent = task.title;
        
        const formEl = document.getElementById('task-form');
        formEl.innerHTML = '';
        
        if (task.formFields && task.formFields.length > 0) {
            task.formFields.forEach(field => {
                const fieldEl = document.createElement('div');
                fieldEl.className = 'mb-4';
                
                let inputHTML = '';
                if (field.type === 'dropdown') {
                    inputHTML = `
                        <select name="${field.id}" ${field.required ? 'required' : ''} class="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-rota-pink outline-none">
                            <option value="">Select...</option>
                            ${field.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                        </select>
                    `;
                } else if (field.type === 'checkbox') {
                    inputHTML = `
                        <label class="flex items-center gap-2">
                            <input type="checkbox" name="${field.id}" ${field.required ? 'required' : ''} class="w-4 h-4 text-rota-pink rounded focus:ring-rota-pink">
                            <span>${field.label}</span>
                        </label>
                    `;
                } else {
                    const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
                    inputHTML = `
                        <input type="${inputType}" name="${field.id}" ${field.required ? 'required' : ''} placeholder="${field.label}" class="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-rota-pink outline-none">
                    `;
                }
                
                fieldEl.innerHTML = `
                    <label class="block text-sm font-medium text-slate-700 mb-2">${field.label} ${field.required ? '<span class="text-red-500">*</span>' : ''}</label>
                    ${inputHTML}
                `;
                
                formEl.appendChild(fieldEl);
            });
        }
        
        // CRITICAL: Reset close button state before showing modal
        const modal = document.getElementById('modal-task-form');
        const closeBtn = modal.querySelector('button[onclick*="closeModal"]');
        if (closeBtn) {
            closeBtn.style.pointerEvents = 'auto';
        }
        
        // Reset submit button state
        const submitBtn = modal.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Submit';
        }
        
        modal.classList.remove('hidden');
    },
    
    async submitTaskForm(event) {
        event.preventDefault();
        
        if (!this.currentTask) return;
        
        
        // Prevent double submission
        if (this._submitting) {
            return;
        }
        
        // Check if already submitting
        const submitBtn = event.target.querySelector('button[type="submit"]') || 
                         document.querySelector('#modal-task-form button[type="submit"]');
        if (submitBtn && submitBtn.disabled) {
            return; // Already submitting
        }
        
        this._submitting = true;
        
        // Check if task can be submitted
        const canSubmit = await CompletionManager.canSubmitTask(Auth.currentUser.uid, this.currentTask.id);
        if (!canSubmit.canSubmit) {
            showToast(canSubmit.reason, 'error');
            return;
        }
        
        // Disable button and show loading state
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
        }
        
        // CRITICAL: Collect FormData BEFORE disabling fields
        // Disabled form fields are NOT included in FormData!
        const formData = new FormData(event.target);
        const formDataObj = {};
        formData.forEach((value, key) => {
            formDataObj[key] = value;
        });
        
        
        // Also manually collect from all inputs (FormData might miss some fields)
        // Do this BEFORE disabling fields to ensure we capture all values
        const allInputs = event.target.querySelectorAll('input, select, textarea');
        allInputs.forEach((input) => {
            const fieldId = input.name || input.id;
            if (!fieldId) {
                console.warn('Form input missing name/id attribute:', input);
                return;
            }
            
            // Handle different input types
            if (input.type === 'checkbox') {
                // Checkboxes: only include if checked
                if (input.checked) {
                    if (formDataObj[fieldId]) {
                        // Multiple checkboxes with same name
                        if (Array.isArray(formDataObj[fieldId])) {
                            formDataObj[fieldId].push(input.value);
                        } else {
                            formDataObj[fieldId] = [formDataObj[fieldId], input.value];
                        }
                    } else {
                        formDataObj[fieldId] = input.value || true;
                    }
                }
            } else if (input.type === 'radio') {
                // Radio buttons: only include if checked
                if (input.checked) {
                    formDataObj[fieldId] = input.value;
                }
            } else {
                // Text, select, textarea, etc.
                if (!(fieldId in formDataObj) || formDataObj[fieldId] === '') {
                    formDataObj[fieldId] = input.value;
                }
            }
        });
        
        
        // Validate that we have form data
        const formDataKeys = Object.keys(formDataObj);
        if (formDataKeys.length === 0) {
            throw new Error('No form data collected. Please ensure all form fields have valid names and are properly filled.');
        }
        
        // Prevent modal close
        const closeBtn = document.querySelector('#modal-task-form button[onclick*="closeModal"]');
        if (closeBtn) closeBtn.style.pointerEvents = 'none';
        
        // Disable form fields AFTER collecting all form data
        const formFields = event.target.querySelectorAll('input, select, textarea');
        formFields.forEach(field => field.disabled = true);
        
        try {
            
            // CRITICAL: Capture task ID and title before closing modal (to avoid null reference in async handlers)
            const taskId = this.currentTask.id;
            const taskTitle = this.currentTask.title;
            
            // Create submission
            const submission = {
                userId: Auth.currentUser.uid,
                userName: Auth.currentUser.name,
                taskId: taskId,
                taskTitle: taskTitle,
                type: 'form',
                formData: formDataObj, // This should contain the actual form field responses
                status: 'pending'
            };
            
            
            // IMMEDIATE UX: Show submitting state on card BEFORE database write
            SubmissionHelpers.showSubmittingState(taskId, 'task');
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
                submitBtn.disabled = true;
            }
            
            // Optimistic update: Remove task from pending activities list immediately
            await SubmissionHelpers.optimisticallyRemoveFromPending(
                Auth.currentUser.uid,
                'task',
                taskId
            );
            
            // Close modal immediately (don't wait for database)
            closeModal('modal-task-form');
            
            
            // Show success toast immediately
            Toast.success('Submission successful! Waiting for approval.');
            
            // Submit to database (async - don't wait for Cloud Function)
            DB.submitTask(submission)
                .then(() => {
                    
                    // Mark as completed locally
                    CompletionManager.markCompletedLocally(
                        Auth.currentUser.uid,
                        'task',
                        taskId,
                {
                    status: 'pending',
                    submittedAt: Date.now()
                }
            );
            
                    this._submitting = false;
                    this.currentTask = null;
                    
                    // Re-enable close button in case modal is still open
                    const closeBtn = document.querySelector('#modal-task-form button[onclick*="closeModal"]');
                    if (closeBtn) {
                        closeBtn.style.pointerEvents = 'auto';
                    }
                })
                .catch(error => {
                    
                    console.error('Error submitting task:', error);
                    Toast.error('Failed to submit task. Please try again.');
                    // Rollback optimistic update on error
                    SubmissionHelpers.rollbackSubmission(taskId, 'task');
                    
                    this._submitting = false;
                    
                    // Re-enable close button and submit button
                    const closeBtn = document.querySelector('#modal-task-form button[onclick*="closeModal"]');
                    if (closeBtn) {
                        closeBtn.style.pointerEvents = 'auto';
                    }
                    const submitBtn = document.querySelector('#modal-task-form button[type="submit"]');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Submit';
                    }
                });
            
            showToast('✓ Form submitted successfully! Your submission is pending review.', 'success');
        } catch (error) {
            // Re-enable button and form fields on error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Submit';
            }
            formFields.forEach(field => field.disabled = false);
            if (closeBtn) closeBtn.style.pointerEvents = 'auto';
            showToast('Submission failed: ' + error.message, 'error');
        }
    }
};

// Global functions for onclick handlers
function submitTaskFile() {
    Task.submitTaskFile();
}

function handleFileSelect(input) {
    Task.handleFileSelect(input);
}

function submitTaskForm(event) {
    Task.submitTaskForm(event);
}

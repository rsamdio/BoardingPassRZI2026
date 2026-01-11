// Task Module
const Task = {
    currentTask: null,
    selectedFile: null,
    
    async openUploadModal(taskId) {
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
        
        document.getElementById('modal-upload').classList.remove('hidden');
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
            
            // Submit to database
            await DB.submitTask(submission);
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
            }
            
            // Mark as completed locally with status 'pending'
            await CompletionManager.markCompletedLocally(
                Auth.currentUser.uid,
                'task',
                this.currentTask.id,
                {
                    status: 'pending',
                    submittedAt: Date.now()
                }
            );
            
            // Clear all related caches
            CompletionManager.clearCompletionCaches(
                Auth.currentUser.uid,
                'task',
                this.currentTask.id
            );
            
            // Close modal
            closeModal('modal-upload');
            
            // Refresh UI
            await SubmissionHelpers.refreshUIAfterSubmission('task');
            
            showToast('✓ Submission successful! Waiting for approval.', 'success');
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
        
        document.getElementById('modal-task-form').classList.remove('hidden');
    },
    
    async submitTaskForm(event) {
        event.preventDefault();
        
        if (!this.currentTask) return;
        
        // Check if already submitting
        const submitBtn = event.target.querySelector('button[type="submit"]') || 
                         document.querySelector('#modal-task-form button[type="submit"]');
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
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
        }
        
        // Prevent modal close
        const closeBtn = document.querySelector('#modal-task-form button[onclick*="closeModal"]');
        if (closeBtn) closeBtn.style.pointerEvents = 'none';
        
        // Disable form fields
        const formFields = event.target.querySelectorAll('input, select, textarea');
        formFields.forEach(field => field.disabled = true);
        
        try {
            const formData = new FormData(event.target);
            const formDataObj = {};
            formData.forEach((value, key) => {
                formDataObj[key] = value;
            });
            
            // Create submission
            const submission = {
                userId: Auth.currentUser.uid,
                userName: Auth.currentUser.name,
                taskId: this.currentTask.id,
                taskTitle: this.currentTask.title,
                type: 'form',
                formData: formDataObj,
                status: 'pending'
            };
            
            // Submit to database
            await DB.submitTask(submission);
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
            }
            
            // Mark as completed locally with status 'pending'
            await CompletionManager.markCompletedLocally(
                Auth.currentUser.uid,
                'task',
                this.currentTask.id,
                {
                    status: 'pending',
                    submittedAt: Date.now()
                }
            );
            
            // Clear all related caches
            CompletionManager.clearCompletionCaches(
                Auth.currentUser.uid,
                'task',
                this.currentTask.id
            );
            
            // Close modal
            closeModal('modal-task-form');
            
            // Refresh UI
            await SubmissionHelpers.refreshUIAfterSubmission('task');
            
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

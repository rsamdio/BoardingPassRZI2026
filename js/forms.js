// Forms/Surveys Module (for attendees)
const Forms = {
    currentForm: null,
    
    async openForm(formId) {
        const form = await DB.getForm(formId);
        if (!form) {
            showToast('Form not found', 'error');
            return;
        }
        
        // Check if form can be submitted using CompletionManager
        const canSubmit = await CompletionManager.canSubmitForm(Auth.currentUser.uid, formId);
        if (!canSubmit) {
            showToast('You have already submitted this form', 'info');
            return;
        }
        
        this.currentForm = form;
        document.getElementById('survey-form-modal-title').textContent = form.title;
        document.getElementById('survey-form-description').textContent = form.description || '';
        
        const formEl = document.getElementById('survey-form');
        formEl.innerHTML = '';
        
        if (form.formFields && form.formFields.length > 0) {
            form.formFields.forEach(field => {
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
                } else if (field.type === 'radio') {
                    inputHTML = field.options.map((opt, idx) => `
                        <label class="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                            <input type="radio" name="${field.id}" value="${opt}" ${field.required ? 'required' : ''} class="text-rota-pink focus:ring-rota-pink">
                            <span>${opt}</span>
                        </label>
                    `).join('');
                } else if (field.type === 'checkbox') {
                    inputHTML = `
                        <label class="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                            <input type="checkbox" name="${field.id}" ${field.required ? 'required' : ''} class="w-4 h-4 text-rota-pink rounded focus:ring-rota-pink">
                            <span>${field.label}</span>
                        </label>
                    `;
                } else if (field.type === 'textarea') {
                    inputHTML = `
                        <textarea name="${field.id}" ${field.required ? 'required' : ''} rows="4" placeholder="${field.label}" class="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-rota-pink outline-none"></textarea>
                    `;
                } else {
                    const inputType = field.type === 'email' ? 'email' : 
                                     field.type === 'tel' ? 'tel' : 
                                     field.type === 'number' ? 'number' : 
                                     field.type === 'date' ? 'date' : 'text';
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
        
        document.getElementById('modal-survey-form').classList.remove('hidden');
    },
    
    async submitSurveyForm(event) {
        event.preventDefault();
        
        if (!this.currentForm) return;
        
        // Check if already submitting
        const submitBtn = event.target.querySelector('button[type="submit"]') || 
                         document.querySelector('#modal-survey-form button[type="submit"]');
        if (submitBtn && submitBtn.disabled) {
            return; // Already submitting
        }
        
        // CRITICAL: Collect FormData BEFORE disabling fields
        // Disabled form fields are NOT included in FormData!
        const formData = new FormData(event.target);
        
        // Disable button and show loading state
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
        }
        
        // Prevent modal close
        const closeBtn = document.querySelector('#modal-survey-form button[onclick*="closeModal"]');
        if (closeBtn) closeBtn.style.pointerEvents = 'none';
        
        // Disable form fields AFTER collecting FormData
        const formFields = event.target.querySelectorAll('input, select, textarea');
        formFields.forEach(field => field.disabled = true);
        
        try {
            const formDataObj = {};
            
            const formElement = event.target;
            const allInputs = formElement.querySelectorAll('input, select, textarea');
            
            // Collect from FormData first (handles checkboxes/radios correctly)
            formData.forEach((value, key) => {
                // Handle checkboxes and radio buttons (multiple values with same name)
                if (formDataObj[key]) {
                    if (Array.isArray(formDataObj[key])) {
                        formDataObj[key].push(value);
                    } else {
                        formDataObj[key] = [formDataObj[key], value];
                    }
                } else {
                    formDataObj[key] = value;
                }
            });
            
            // Also manually check all inputs to ensure we didn't miss any
            // This is important for checkboxes that aren't checked (they won't be in FormData)
            allInputs.forEach((input) => {
                const fieldId = input.name || input.id;
                
                if (!fieldId) {
                    console.error('Form input missing name/id attribute');
                    return;
                }
                
                // If this field is not in formDataObj, check if it's a checkbox/radio
                if (!(fieldId in formDataObj)) {
                    if (input.type === 'checkbox' && !input.checked) {
                        // Unchecked checkbox - don't include it
                    } else if (input.type === 'radio' && !input.checked) {
                        // Unchecked radio - don't include it
                    } else {
                        // Manually collect the value
                        if (input.tagName === 'SELECT') {
                            formDataObj[fieldId] = input.value;
                        } else if (input.tagName === 'TEXTAREA') {
                            formDataObj[fieldId] = input.value;
                        } else {
                            formDataObj[fieldId] = input.value;
                        }
                    }
                }
            });
            
            // Validate that we have some form data
            const formDataKeys = Object.keys(formDataObj);
            if (formDataKeys.length === 0) {
                throw new Error('No form data collected. Please ensure all form fields have valid names and are properly filled.');
            }
            
            // Create form submission
            // Use Firestore Timestamp for consistency with Cloud Functions
            const submittedAt = firebase.firestore.Timestamp.now ? firebase.firestore.Timestamp.now() : new Date();
            const submittedAtTimestamp = submittedAt.getTime ? submittedAt.getTime() : (submittedAt.toMillis ? submittedAt.toMillis() : Date.now());
            
            const submission = {
                userId: Auth.currentUser.uid,
                userName: Auth.currentUser.name,
                formId: this.currentForm.id,
                formTitle: this.currentForm.title,
                formData: formDataObj, // This should be a plain object with field IDs as keys
                submittedAt: submittedAt // Use Firestore Timestamp if available
            };
            
            // Submit to database
            await DB.submitForm(submission);
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
            }
            
            // Mark as completed locally
            // Use the same timestamp format as Cloud Function will use
            await CompletionManager.markCompletedLocally(
                Auth.currentUser.uid,
                'form',
                this.currentForm.id,
                {
                    submittedAt: submittedAtTimestamp
                }
            );
            
            // Clear all related caches
            CompletionManager.clearCompletionCaches(
                Auth.currentUser.uid,
                'form',
                this.currentForm.id
            );
            
            // Award points if form has points
            if (this.currentForm.points > 0) {
                await DB.addPoints(Auth.currentUser.uid, this.currentForm.points, `Form: ${this.currentForm.title}`);
                
                // Points are already updated via addPoints() which does Firestore write
                // User stats will be updated by Cloud Function in RTDB cache
                // If user data refresh is needed, use getUserStats() from RTDB cache instead of getUser()
                // This saves 1 Firestore read per form submission
            }
            
            // Close modal
            closeModal('modal-survey-form');
            
            // Refresh UI
            await SubmissionHelpers.refreshUIAfterSubmission('form');
            
            showToast('✓ Form submitted successfully!', 'success');
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

// Global function for onclick
function submitSurveyForm(event) {
    Forms.submitSurveyForm(event);
}

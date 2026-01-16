// Admin Quizzes Module
// Handles quiz creation, editing, and management

const AdminQuizzes = {
    quizzes: [],
    questionCounter: 0,
    loading: false,
    currentStep: 1,
    draftAutoSaveInterval: null,
    templates: [],
    quizzesListener: null, // Real-time listener for quizzes cache
    
    /**
     * Load quizzes
     * @param {boolean} skipRender - Skip rendering if data is already set
     */
    async load(skipRender = false) {
        if (this.loading) {
            return;
        }
        
        try {
            this.loading = true;
            AdminUI.setLoading('quizzes', true);
            AdminUI.showSkeleton('quizzes-list', 'list');
            
            // Use getAllQuizzes for admin (includes inactive, uses RTDB cache)
            this.quizzes = await DB.getAllQuizzes();
            await this.loadTemplates();
            
            // Ensure quizzes have timestamps for sorting
            this.quizzes = this.quizzes.map(quiz => {
                if (quiz.updatedAt && typeof quiz.updatedAt !== 'number') {
                    if (typeof quiz.updatedAt.toMillis === 'function') {
                        quiz.updatedAt = quiz.updatedAt.toMillis();
                    } else if (quiz.updatedAt.seconds !== undefined) {
                        quiz.updatedAt = quiz.updatedAt.seconds * 1000 + (quiz.updatedAt.nanoseconds || 0) / 1000000;
                    }
                }
                if (quiz.createdAt && typeof quiz.createdAt !== 'number') {
                    if (typeof quiz.createdAt.toMillis === 'function') {
                        quiz.createdAt = quiz.createdAt.toMillis();
                    } else if (quiz.createdAt.seconds !== undefined) {
                        quiz.createdAt = quiz.createdAt.seconds * 1000 + (quiz.createdAt.nanoseconds || 0) / 1000000;
                    }
                }
                if (!quiz.updatedAt && !quiz.createdAt) {
                    quiz.createdAt = 0;
                }
                return quiz;
            });
            
            if (!skipRender) {
                this.render();
            }
            
            // Setup real-time listener for quizzes cache updates
            this.setupRealtimeListener();
        } catch (error) {
            console.error('Error loading quizzes:', error);
            Toast.error('Failed to load quizzes');
            this.quizzes = [];
        } finally {
            this.loading = false;
            AdminUI.setLoading('quizzes', false);
        }
    },
    
    /**
     * Setup real-time listener for quizzes cache
     * Automatically refreshes the list when quizzes are created/updated/deleted
     */
    setupRealtimeListener() {
        // Remove existing listener if any
        if (this.quizzesListener) {
            DB.rtdb.ref('adminCache/quizzes').off('value', this.quizzesListener);
            this.quizzesListener = null;
        }
        
        // Create new listener
        this.quizzesListener = (snapshot) => {
            if (snapshot.exists()) {
                const cacheData = snapshot.val();
                const lastUpdated = cacheData.lastUpdated || 0;
                
                // Convert object to array, exclude lastUpdated
                const quizzes = Object.keys(cacheData)
                    .filter(key => key !== 'lastUpdated')
                    .map(key => {
                        const quiz = cacheData[key];
                        return {
                            ...quiz,
                            id: key,
                            questionsCount: quiz.questionsCount || 0
                        };
                    });
                
                // Sort by updatedAt or createdAt (newest first)
                quizzes.sort((a, b) => {
                    const aTime = a.updatedAt || a.createdAt || 0;
                    const bTime = b.updatedAt || b.createdAt || 0;
                    return bTime - aTime;
                });
                
                // Update local state and render
                this.quizzes = quizzes;
                this.render();
            }
        };
        
        // Attach listener
        DB.rtdb.ref('adminCache/quizzes').on('value', this.quizzesListener);
    },
    
    /**
     * Cleanup: Remove real-time listener
     */
    cleanup() {
        if (this.quizzesListener) {
            DB.rtdb.ref('adminCache/quizzes').off('value', this.quizzesListener);
            this.quizzesListener = null;
        }
    },
    
    /**
     * Load templates from Firestore
     */
    async loadTemplates() {
        try {
            const snapshot = await DB.db.collection('quizTemplates').get();
            this.templates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            this.templates = [];
        }
    },
    
    /**
     * Save quiz as template
     */
    async saveAsTemplate(quizId) {
        const quiz = this.quizzes.find(q => q.id === quizId);
        if (!quiz) {
            Toast.error('Quiz not found');
            return;
        }
        
        const templateName = prompt('Enter a name for this template:');
        if (!templateName) return;
        
        try {
            const templateData = {
                name: templateName,
                title: quiz.title,
                description: quiz.description,
                questions: quiz.questions || [],
                totalPoints: quiz.totalPoints || 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: AdminAuth.currentAdmin?.uid || null
            };
            
            await DB.db.collection('quizTemplates').add(templateData);
            await this.loadTemplates();
            Toast.success('Template saved successfully');
        } catch (error) {
            console.error('Error saving template:', error);
            Toast.error('Failed to save template');
        }
    },
    
    /**
     * Create quiz from template
     */
    async createFromTemplate(templateId) {
        try {
            const template = this.templates.find(t => t.id === templateId);
            if (!template) {
                Toast.error('Template not found');
                return;
            }
            
            // Load template into form
            const titleEl = document.getElementById('quiz-creator-title');
            const titleInput = document.getElementById('quiz-title');
            const descInput = document.getElementById('quiz-description');
            const questionsEl = document.getElementById('quiz-questions');
            
            if (titleEl) titleEl.textContent = 'Create Quiz from Template';
            if (titleInput) titleInput.value = template.title || '';
            if (descInput) descInput.value = template.description || '';
            
            if (questionsEl && template.questions) {
                questionsEl.innerHTML = '';
                this.questionCounter = 0;
                template.questions.forEach(q => {
                    this.addQuestion(q);
                });
            }
            
            // Calculate total points after loading questions
            this.calculateTotalPoints();
            
            this.currentStep = 1;
            this.updateStepUI();
            AdminUI.switchView('quiz-creator');
            this.startAutoSave();
        } catch (error) {
            console.error('Error loading template:', error);
            Toast.error('Failed to load template');
        }
    },
    
    /**
     * Delete template
     */
    async deleteTemplate(templateId) {
        if (!confirm('Are you sure you want to delete this template?')) return;
        
        try {
            await DB.db.collection('quizTemplates').doc(templateId).delete();
            await this.loadTemplates();
            Toast.success('Template deleted successfully');
        } catch (error) {
            console.error('Error deleting template:', error);
            Toast.error('Failed to delete template');
        }
    },
    
    /**
     * Render quizzes list
     */
    render() {
        const list = document.getElementById('quizzes-list');
        if (!list) {
            console.error('Quizzes list element not found');
            return;
        }
        
        list.innerHTML = '';
        
        if (this.quizzes.length === 0) {
            list.innerHTML = '<p class="text-center text-slate-500 py-8">No quizzes created yet</p>';
            return;
        }
        
        // Sort by most recent first (by createdAt or updatedAt)
        const sortedQuizzes = [...this.quizzes].sort((a, b) => {
            const aTime = a.updatedAt || a.createdAt || 0;
            const bTime = b.updatedAt || b.createdAt || 0;
            // Handle Firestore Timestamp objects
            const aMillis = aTime?.toMillis ? aTime.toMillis() : (typeof aTime === 'number' ? aTime : 0);
            const bMillis = bTime?.toMillis ? bTime.toMillis() : (typeof bTime === 'number' ? bTime : 0);
            return bMillis - aMillis; // Descending order (most recent first)
        });
        
        sortedQuizzes.forEach(quiz => {
            const card = document.createElement('div');
            card.className = 'bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-all duration-300';
            card.setAttribute('data-quiz-id', quiz.id);
            card.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h4 class="font-bold text-lg text-slate-800 mb-1">${this.escapeHtml(quiz.title)}</h4>
                        <p class="text-sm text-slate-500">${this.escapeHtml(quiz.description || 'No description')}</p>
                    </div>
                    <span class="px-3 py-1 rounded-full text-xs font-bold ${
                        quiz.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                    }">${quiz.status || 'draft'}</span>
                </div>
                <div class="flex items-center gap-4 text-sm text-slate-600 mb-4">
                    <span><i class="fas fa-question-circle"></i> ${quiz.questions?.length || quiz.questionsCount || 0} Questions</span>
                    <span><i class="fas fa-star"></i> ${quiz.totalPoints || 0} Points</span>
                </div>
                <div class="flex gap-2">
                    <button onclick="AdminQuizzes.viewSubmissions('${quiz.id}')" class="flex-1 px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors">
                        <i class="fas fa-eye"></i> View Submissions
                    </button>
                    <button onclick="AdminQuizzes.editQuiz('${quiz.id}')" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button onclick="AdminQuizzes.deleteQuiz('${quiz.id}')" class="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors">
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
    
    currentStep: 1,
    currentQuizSubmissions: {
        quiz: null,
        submissions: [],
        usersMap: new Map(),
        currentIndex: 0
    },
    
    /**
     * Show create quiz modal (now uses step flow)
     */
    showCreateModal() {
        const titleEl = document.getElementById('quiz-creator-title');
        const formEl = document.getElementById('quiz-form');
        const idEl = document.getElementById('quiz-id');
        const questionsEl = document.getElementById('quiz-questions');
        
        if (!titleEl || !formEl || !idEl || !questionsEl) {
            Toast.error('Quiz creator elements not found');
            return;
        }
        
        titleEl.textContent = 'Create Quiz';
        formEl.reset();
        idEl.value = '';
        questionsEl.innerHTML = '';
        this.questionCounter = 0;
        this.currentStep = 1;
        this.updateStepUI();
        // Reset total points display
        this.calculateTotalPoints();
        // Start auto-save
        this.startAutoSave();
        AdminUI.switchView('quiz-creator');
    },
    
    /**
     * Update step UI indicators
     */
    updateStepUI() {
        const step1Indicator = document.getElementById('step-1-indicator');
        const step2Indicator = document.getElementById('step-2-indicator');
        const step1Content = document.getElementById('quiz-step-1');
        const step2Content = document.getElementById('quiz-step-2');
        const prevBtn = document.getElementById('quiz-prev-btn');
        const nextBtn = document.getElementById('quiz-next-btn');
        const saveBtn = document.getElementById('quiz-save-btn');
        
        if (this.currentStep === 1) {
            // Step 1 active
            step1Indicator.classList.remove('bg-slate-200', 'text-slate-500');
            step1Indicator.classList.add('bg-rota-pink', 'text-white');
            step2Indicator.classList.remove('bg-rota-pink', 'text-white');
            step2Indicator.classList.add('bg-slate-200', 'text-slate-500');
            
            step1Content.classList.remove('hidden');
            step2Content.classList.add('hidden');
            
            prevBtn.classList.add('hidden');
            nextBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
        } else {
            // Step 2 active
            step1Indicator.classList.remove('bg-rota-pink', 'text-white');
            step1Indicator.classList.add('bg-green-500', 'text-white');
            step2Indicator.classList.remove('bg-slate-200', 'text-slate-500');
            step2Indicator.classList.add('bg-rota-pink', 'text-white');
            
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
    nextStep() {
        if (this.currentStep === 1) {
            // Validate step 1
            const title = document.getElementById('quiz-title')?.value?.trim();
            
            if (!title) {
                Toast.error('Quiz title is required');
                return;
            }
            
            this.currentStep = 2;
            this.updateStepUI();
        }
    },
    
    /**
     * Go to previous step
     */
    previousStep() {
        if (this.currentStep === 2) {
            this.currentStep = 1;
            this.updateStepUI();
        }
    },
    
    /**
     * Load draft into form
     */
    loadDraftIntoForm(draft) {
        const titleEl = document.getElementById('quiz-creator-title');
        const descriptionEl = document.getElementById('quiz-creator-description');
        const statusEl = document.getElementById('quiz-creator-status');
        
        if (titleEl) titleEl.value = draft.title || '';
        if (descriptionEl) descriptionEl.value = draft.description || '';
        if (statusEl) statusEl.value = draft.status || 'active';
        
        // Load questions
        if (draft.questions && draft.questions.length > 0) {
            const questionsContainer = document.getElementById('quiz-questions-list');
            if (questionsContainer) {
                questionsContainer.innerHTML = '';
                draft.questions.forEach((q, index) => {
                    this.addQuestion();
                    // Set question values
                    const lastQuestion = questionsContainer.lastElementChild;
                    if (lastQuestion) {
                        const typeInput = lastQuestion.querySelector('[name^="question-type"]');
                        const textInput = lastQuestion.querySelector('[name^="question-text"]');
                        const correctInput = lastQuestion.querySelector('[name^="correct-answer"]');
                        
                        if (typeInput) typeInput.value = q.type || 'multiple-choice';
                        if (textInput) textInput.value = q.text || '';
                        if (correctInput) correctInput.value = q.correctAnswer || '';
                        
                        // Set options
                        if (q.options && q.options.length > 0) {
                            q.options.forEach((opt, optIndex) => {
                                const optionInput = lastQuestion.querySelector(`[name="option-${this.questionCounter}-${optIndex}"]`);
                                if (optionInput) {
                                    optionInput.value = opt;
                                } else {
                                    // Add new option input
                                    this.addOptionToQuestion(lastQuestion);
                                    const newOptionInput = lastQuestion.querySelector(`[name="option-${this.questionCounter}-${optIndex}"]`);
                                    if (newOptionInput) newOptionInput.value = opt;
                                }
                            });
                        }
                    }
                });
            }
        }
    },
    
    /**
     * Save draft to localStorage
     */
    saveDraft() {
        try {
            const title = document.getElementById('quiz-title')?.value?.trim();
            const description = document.getElementById('quiz-description')?.value?.trim();
            const status = document.getElementById('quiz-status')?.value || 'active';
            const questionsContainer = document.getElementById('quiz-questions');
            
            if (!title && (!questionsContainer || questionsContainer.children.length === 0)) {
                // Nothing to save
                return;
            }
            
            const draft = {
                title: title || '',
                description: description || '',
                status: status,
                questions: [],
                savedAt: Date.now()
            };
            
            // Save questions
            if (questionsContainer) {
                Array.from(questionsContainer.children).forEach(qEl => {
                    const questionText = qEl.querySelector('.question-text')?.value?.trim();
                    const questionType = qEl.querySelector('.question-type')?.value;
                    const points = parseInt(qEl.querySelector('.question-points')?.value || '0');
                    const correctAnswer = qEl.querySelector('.question-answer')?.value?.trim();
                    const optionsText = qEl.querySelector('.question-options-text')?.value?.trim();
                    
                    if (questionText) {
                        const question = {
                            question: questionText,
                            type: questionType || 'multiple-choice',
                            points: points || 0,
                            correctAnswer: correctAnswer || ''
                        };
                        
                        if (optionsText && questionType !== 'text') {
                            question.options = optionsText.split('\n').filter(o => o.trim());
                        }
                        
                        draft.questions.push(question);
                    }
                });
            }
            
            localStorage.setItem('quiz_draft', JSON.stringify(draft));
        } catch (error) {
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
     * Cancel quiz creation
     */
    cancelQuiz() {
        // Save draft before canceling
        this.saveDraft();
        
        if (confirm('Are you sure you want to cancel? Your progress has been saved as a draft.')) {
            this.stopAutoSave();
            // Clear draft after confirming cancel
            localStorage.removeItem('quiz_draft');
            AdminUI.switchView('quizzes');
            this.currentStep = 1;
        }
    },
    
    /**
     * Edit quiz
     * @param {string} quizId - Quiz ID
     */
    async editQuiz(quizId) {
        if (!quizId) {
            Toast.error('Invalid quiz ID');
            return;
        }
        
        try {
            // Fetch quiz directly from Firestore to ensure we have the latest data including questions
            const quiz = await DB.getQuiz(quizId);
            if (!quiz) {
                Toast.error('Quiz not found');
                return;
            }
            
            const titleEl = document.getElementById('quiz-creator-title');
            const idEl = document.getElementById('quiz-id');
            const titleInput = document.getElementById('quiz-title');
            const descInput = document.getElementById('quiz-description');
            const totalPointsDisplay = document.getElementById('quiz-total-points');
            const statusSelect = document.getElementById('quiz-status');
            const questionsEl = document.getElementById('quiz-questions');
            
            if (!titleEl || !idEl || !titleInput || !descInput || !totalPointsDisplay || !statusSelect || !questionsEl) {
                Toast.error('Quiz form elements not found');
                return;
            }
            
            titleEl.textContent = 'Edit Quiz';
            idEl.value = quiz.id;
            titleInput.value = quiz.title || '';
            descInput.value = quiz.description || '';
            statusSelect.value = quiz.status || 'active';
            
            // Clear existing questions
            questionsEl.innerHTML = '';
            this.questionCounter = 0;
            this.currentStep = 1;
            
            // Load questions if they exist
            if (quiz.questions && Array.isArray(quiz.questions) && quiz.questions.length > 0) {
                quiz.questions.forEach(q => {
                    this.addQuestion(q);
                });
            } else {
            }
            
            // Calculate total points after loading questions
            this.calculateTotalPoints();
            
            // Start auto-save for editing
            this.startAutoSave();
            
            this.updateStepUI();
            AdminUI.switchView('quiz-creator');
        } catch (error) {
            console.error('Error editing quiz:', error);
            Toast.error('Failed to load quiz for editing: ' + error.message);
        }
    },
    
    /**
     * Calculate total points from all questions
     */
    calculateTotalPoints() {
        const questionsContainer = document.getElementById('quiz-questions');
        if (!questionsContainer) return 0;
        
        let total = 0;
        const questionPointsInputs = questionsContainer.querySelectorAll('.question-points');
        questionPointsInputs.forEach(input => {
            const points = parseInt(input.value || '0');
            if (!isNaN(points) && points > 0) {
                total += points;
            }
        });
        
        // Update the display
        const totalPointsEl = document.getElementById('quiz-total-points');
        if (totalPointsEl) {
            totalPointsEl.textContent = total;
        }
        
        return total;
    },
    
    /**
     * Add question to quiz
     * @param {Object} existingQuestion - Existing question data (optional)
     */
    addQuestion(existingQuestion = null) {
        const questionsContainer = document.getElementById('quiz-questions');
        if (!questionsContainer) {
            Toast.error('Questions container not found');
            return;
        }
        
        const qId = existingQuestion?.id || 'q' + Date.now() + '.' + this.questionCounter++;
        
        const questionEl = document.createElement('div');
        questionEl.className = 'border border-slate-200 rounded-lg p-4';
        questionEl.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <span class="font-bold text-slate-700">Question ${questionsContainer.children.length + 1}</span>
                <button type="button" onclick="AdminQuizzes.removeQuestion(this)" class="text-red-500 hover:text-red-700">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="space-y-3">
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Question Text *</label>
                    <input type="text" class="question-text w-full px-3 py-2 border border-slate-200 rounded-lg" value="${this.escapeHtml(existingQuestion?.question || '')}" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Type *</label>
                    <select class="question-type w-full px-3 py-2 border border-slate-200 rounded-lg" onchange="AdminQuizzes.handleQuestionTypeChange(this)" required>
                        <option value="multiple-choice" ${existingQuestion?.type === 'multiple-choice' ? 'selected' : ''}>Multiple Choice</option>
                        <option value="true-false" ${existingQuestion?.type === 'true-false' ? 'selected' : ''}>True/False</option>
                        <option value="text" ${existingQuestion?.type === 'text' ? 'selected' : ''}>Text Input</option>
                    </select>
                </div>
                <div class="question-options ${existingQuestion?.type === 'text' ? 'hidden' : ''}">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Options (one per line) *</label>
                    <textarea class="question-options-text w-full px-3 py-2 border border-slate-200 rounded-lg" rows="4" ${existingQuestion?.type !== 'text' ? 'required' : ''} oninput="AdminQuizzes.updateCorrectAnswerHelper(this)">${this.escapeHtml(existingQuestion?.options?.join('\n') || '')}</textarea>
                    <p class="text-xs text-slate-400 mt-1">Enter each option on a separate line</p>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Correct Answer *</label>
                        <input type="text" class="question-answer w-full px-3 py-2 border border-slate-200 rounded-lg" 
                               value="${this.escapeHtml(existingQuestion?.correctAnswer !== undefined ? 
                                   (existingQuestion.type === 'text' ? String(existingQuestion.correctAnswer) : 
                                    (existingQuestion.options && existingQuestion.options[existingQuestion.correctAnswer] ? 
                                     existingQuestion.options[existingQuestion.correctAnswer] : 
                                     String(existingQuestion.correctAnswer))) : '')}" 
                               placeholder="${existingQuestion?.type === 'text' ? 'Enter the correct answer text' : 'Enter the exact option text'}" 
                               required>
                        <div class="question-answer-helper text-xs text-slate-500 mt-1">
                            ${existingQuestion?.type !== 'text' && existingQuestion?.options && existingQuestion.options.length > 0 ? `
                                <strong>How to answer:</strong> Enter the exact option text from the list above (e.g., "${existingQuestion.options[0] || 'Option 1'}").
                                <br><span class="text-slate-400">Available options: ${existingQuestion.options.map(opt => `"${opt}"`).join(', ')}</span>
                            ` : existingQuestion?.type === 'text' ? `
                                <span class="text-slate-400">Enter the exact text that should be considered correct</span>
                            ` : `
                                <span class="text-slate-400">Enter options above first, then specify the correct answer</span>
                            `}
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Points *</label>
                        <input type="number" class="question-points w-full px-3 py-2 border border-slate-200 rounded-lg" value="${existingQuestion?.points || 10}" min="1" required oninput="AdminQuizzes.calculateTotalPoints()">
                    </div>
                </div>
            </div>
        `;
        questionsContainer.appendChild(questionEl);
        
        // Recalculate total points
        this.calculateTotalPoints();
    },
    
    /**
     * Remove a question and recalculate total points
     */
    removeQuestion(button) {
        const questionEl = button.closest('.border');
        if (questionEl) {
            questionEl.remove();
            // Update question numbers
            const questionsContainer = document.getElementById('quiz-questions');
            if (questionsContainer) {
                Array.from(questionsContainer.children).forEach((el, index) => {
                    const questionNumber = el.querySelector('.font-bold.text-slate-700');
                    if (questionNumber) {
                        questionNumber.textContent = `Question ${index + 1}`;
                    }
                });
            }
            // Recalculate total points
            this.calculateTotalPoints();
        }
    },
    
    /**
     * Handle question type change
     * @param {HTMLElement} select - Select element
     */
    handleQuestionTypeChange(select) {
        const questionEl = select.closest('.border');
        if (!questionEl) return;
        
        const optionsDiv = questionEl.querySelector('.question-options');
        const optionsTextarea = questionEl.querySelector('.question-options-text');
        
        if (!optionsDiv || !optionsTextarea) return;
        
        const helperEl = questionEl.querySelector('.question-answer-helper');
        const answerInput = questionEl.querySelector('.question-answer');
        
        if (select.value === 'text') {
            optionsDiv.classList.add('hidden');
            optionsTextarea.required = false;
            if (helperEl) {
                helperEl.innerHTML = '<span class="text-slate-400">Enter the exact text that should be considered correct</span>';
            }
            if (answerInput) {
                answerInput.placeholder = 'Enter the correct answer text';
            }
        } else {
            optionsDiv.classList.remove('hidden');
            optionsTextarea.required = true;
            // Update helper when options are shown
            if (optionsTextarea.value.trim()) {
                this.updateCorrectAnswerHelper(optionsTextarea);
            } else {
                if (helperEl) {
                    helperEl.innerHTML = '<span class="text-slate-400">Enter options above first, then specify the correct answer</span>';
                }
            }
            if (answerInput) {
                answerInput.placeholder = 'Enter the exact option text';
            }
        }
    },
    
    /**
     * Update correct answer helper text when options change
     * @param {HTMLElement} textarea - Options textarea element
     */
    updateCorrectAnswerHelper(textarea) {
        const questionEl = textarea.closest('.border');
        if (!questionEl) return;
        
        const helperEl = questionEl.querySelector('.question-answer-helper');
        const optionsText = textarea.value.trim();
        
        if (!helperEl) return;
        
        if (!optionsText) {
            helperEl.innerHTML = '<span class="text-slate-400">Enter options above first, then specify the correct answer</span>';
            return;
        }
        
        const options = optionsText.split('\n').filter(o => o.trim());
        if (options.length === 0) {
            helperEl.innerHTML = '<span class="text-slate-400">Enter options above first, then specify the correct answer</span>';
            return;
        }
        
        const firstOption = options[0].trim();
        helperEl.innerHTML = `
            <strong>How to answer:</strong> Enter the exact option text from the list above (e.g., "${firstOption}").
            <br><span class="text-slate-400">Available options: ${options.map(opt => `"${opt.trim()}"`).join(', ')}</span>
        `;
    },
    
    /**
     * Save quiz
     * @param {Event} event - Form submit event
     */
    async saveQuiz(event) {
        event.preventDefault();
        
        try {
            const quizId = document.getElementById('quiz-id')?.value;
            const title = document.getElementById('quiz-title')?.value?.trim();
            const description = document.getElementById('quiz-description')?.value?.trim();
            const status = document.getElementById('quiz-status')?.value;
            const questionsContainer = document.getElementById('quiz-questions');
            
            // Validation
            if (!title) {
                Toast.error('Quiz title is required');
                return;
            }
            
            if (!questionsContainer || questionsContainer.children.length === 0) {
                Toast.error('Please add at least one question');
                return;
            }
            
            const questions = [];
            // Use children instead of querySelectorAll with invalid selector
            for (let index = 0; index < questionsContainer.children.length; index++) {
                const qEl = questionsContainer.children[index];
                const questionText = qEl.querySelector('.question-text')?.value?.trim();
                const questionType = qEl.querySelector('.question-type')?.value;
                const points = parseInt(qEl.querySelector('.question-points')?.value || '0');
                const correctAnswer = qEl.querySelector('.question-answer')?.value?.trim();
                
                if (!questionText) {
                    Toast.error(`Question ${index + 1} text is required`);
                    return;
                }
                
                if (!points || points < 1) {
                    Toast.error(`Question ${index + 1} points must be at least 1`);
                    return;
                }
                
                let finalCorrectAnswer;
                
                if (questionType === 'text') {
                    // For text questions, use the answer as-is
                    if (!correctAnswer) {
                        Toast.error(`Question ${index + 1}: Correct answer is required`);
                        return;
                    }
                    finalCorrectAnswer = correctAnswer;
                } else {
                    // For multiple choice/true-false, get options first
                    const optionsText = qEl.querySelector('.question-options-text')?.value?.trim();
                    if (!optionsText) {
                        Toast.error(`Question ${index + 1} options are required`);
                        return;
                    }
                    const options = optionsText.split('\n').filter(o => o.trim());
                    
                    if (options.length === 0) {
                        Toast.error(`Question ${index + 1}: At least one option is required`);
                        return;
                    }
                    
                    if (!correctAnswer) {
                        Toast.error(`Question ${index + 1}: Correct answer is required`);
                        return;
                    }
                    
                    // Find matching option text (case-insensitive)
                    const matchingIndex = options.findIndex(opt => 
                        opt.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
                    );
                    if (matchingIndex !== -1) {
                        finalCorrectAnswer = matchingIndex;
                    } else {
                        Toast.error(`Question ${index + 1}: Correct answer "${correctAnswer}" doesn't match any option. Please enter the exact option text from the list above.`);
                        return;
                    }
                }
                
                const question = {
                    id: 'q' + index,
                    question: questionText,
                    type: questionType || 'multiple-choice',
                    points,
                    correctAnswer: finalCorrectAnswer
                };
                
                if (questionType !== 'text') {
                    const optionsText = qEl.querySelector('.question-options-text')?.value?.trim();
                    question.options = optionsText.split('\n').filter(o => o.trim());
                }
                
                questions.push(question);
            }
            
            if (questions.length === 0) {
                Toast.error('Please add at least one valid question');
                return;
            }
            
            // Calculate total points from questions
            const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0);
            
            if (totalPoints < 1) {
                Toast.error('Total points must be at least 1. Please ensure all questions have valid points.');
                return;
            }
            
            const data = {
                title,
                description,
                totalPoints,
                questions, // Ensure questions array is included
                status: status || 'active' // Default to 'active' instead of 'draft'
            };
            
            // Save to database
            let savedQuizId = quizId;
            let operationId = null;
            
            if (quizId) {
                // UPDATE: Optimistic update
                const existingQuiz = this.quizzes.find(q => q.id === quizId);
                if (existingQuiz) {
                    const updatedQuiz = {
                        ...existingQuiz,
                        ...data,
                        id: quizId,
                        questionsCount: data.questions?.length || 0,
                        updatedAt: Date.now() // Temporary timestamp
                    };
                    operationId = OptimisticUI.updateItem('quiz', quizId, updatedQuiz, () => {
                        this.render();
                    }, this.quizzes);
                }
                
                // Firestore update (async, don't wait)
                data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                DB.db.collection('quizzes').doc(quizId).update(data)
                    .then(() => {
                Toast.success('Quiz updated successfully');
                    })
                    .catch((error) => {
                        console.error('Error updating quiz:', error);
                        Toast.error('Failed to update quiz: ' + error.message);
                        // Rollback optimistic update on error
                        if (operationId) {
                            OptimisticUI.rollback(operationId, () => {
                                this.render();
                            });
                        }
                    });
            } else {
                // CREATE: Optimistic add
                const newQuiz = {
                    ...data,
                    id: 'temp_' + Date.now(), // Temporary ID
                    questionsCount: data.questions?.length || 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                operationId = OptimisticUI.addItem('quiz', newQuiz, () => {
                    this.render();
                }, this.quizzes);
                
                // Firestore create (async, don't wait)
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                DB.db.collection('quizzes').add(data)
                    .then((docRef) => {
                savedQuizId = docRef.id;
                Toast.success('Quiz created successfully');
                        
                        // Update the optimistic item with real ID
                        const tempIndex = this.quizzes.findIndex(q => q.id === newQuiz.id);
                        if (tempIndex !== -1) {
                            this.quizzes[tempIndex] = {
                                ...this.quizzes[tempIndex],
                                id: savedQuizId
                            };
                            this.render();
                        }
                    })
                    .catch((error) => {
                        console.error('Error creating quiz:', error);
                        Toast.error('Failed to create quiz: ' + error.message);
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
            localStorage.removeItem('quiz_draft');
            
            // Return to quizzes view immediately (optimistic UI already rendered)
            AdminUI.switchView('quizzes');
            // Real-time listener will confirm the update when Cloud Function completes
            
            // Render immediately with the fresh data we just fetched
            this.render();
            
            // Reset loading state after a brief delay to allow render
            setTimeout(() => {
                this.loading = wasLoading;
            }, 500);
            
            this.currentStep = 1;
        } catch (error) {
            console.error('Error saving quiz:', error);
            Toast.error('Failed to save quiz: ' + error.message);
        }
    },
    
    /**
     * View submissions for a quiz
     * @param {string} quizId - Quiz ID
     */
    async viewSubmissions(quizId) {
        if (!quizId) {
            Toast.error('Invalid quiz ID');
            return;
        }
        
        try {
            // Fetch quiz directly from Firestore to ensure we have complete data including questions
            let quiz = await DB.getQuiz(quizId);
            if (!quiz) {
                Toast.error('Quiz not found');
                return;
            }
            
            // Ensure questions have IDs if they don't already
            if (quiz.questions && Array.isArray(quiz.questions)) {
                quiz.questions = quiz.questions.map((q, index) => ({
                    ...q,
                    id: q.id || `q${index}` // Ensure every question has an ID
                }));
            }
            
            // Fetch pre-computed submission IDs (quick check)
            const submissionIdsResult = await DB.readFromCache(`admin/submissions/byQuiz/${quizId}`);
            const submissionIds = submissionIdsResult.data ? Object.keys(submissionIdsResult.data) : [];
            
            if (!submissionIds || submissionIds.length === 0) {
                Toast.info(`No submissions yet for "${quiz.title}". Check back later when participants complete this quiz.`);
                return;
            }
            
            // Fetch full submissions from Firestore (needed for detailed view with answers)
            let submissionsSnapshot;
            try {
                submissionsSnapshot = await DB.db.collection('quizSubmissions')
                    .where('quizId', '==', quizId)
                    .orderBy('completedAt', 'desc')
                    .get();
            } catch (orderError) {
                // If orderBy fails, fetch without ordering and sort in memory
                // OrderBy failed, sorting in memory
                submissionsSnapshot = await DB.db.collection('quizSubmissions')
                    .where('quizId', '==', quizId)
                    .get();
            }
            
            let submissions = submissionsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // Sort by completedAt if not already sorted
            submissions.sort((a, b) => {
                const aTime = Utils.timestampToMillis(a.completedAt);
                const bTime = Utils.timestampToMillis(b.completedAt);
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
            
            // Store submissions data
            this.currentQuizSubmissions = {
                quiz,
                submissions,
                usersMap,
                currentIndex: 0
            };
            
            // Render submissions view
            this.renderSubmissionsView();
        } catch (error) {
            console.error('Error fetching quiz submissions:', error);
            Toast.error('Failed to load submissions: ' + error.message);
        }
    },
    
    /**
     * Download quiz submissions as CSV
     * @param {Object} quiz - Quiz object
     * @param {Array} submissions - Array of submissions
     * @param {Map} usersMap - Map of userId to user data
     */
    downloadQuizSubmissions(quiz, submissions, usersMap) {
        try {
            if (submissions.length === 0) {
                Toast.error('No submissions to download');
                return;
            }
            
            // Build CSV header
            const headers = ['Participant Name', 'Email', 'Score', 'Total Points', 'Percentage', 'Completed Date'];
            
            // Add question columns
            if (quiz.questions) {
                quiz.questions.forEach((q, idx) => {
                    headers.push(`Q${idx + 1}: ${q.question}`, `Q${idx + 1}: Answer`, `Q${idx + 1}: Correct`, `Q${idx + 1}: Points`);
                });
            }
            
            // Build CSV rows
            const rows = submissions.map(submission => {
                const user = usersMap.get(submission.userId) || { name: submission.userName || 'Unknown', email: 'N/A' };
                const completedDate = submission.completedAt 
                    ? (submission.completedAt.toDate ? submission.completedAt.toDate() : new Date(submission.completedAt))
                    : null;
                const formattedDate = completedDate ? Utils.formatDate(completedDate) : 'Date not available';
                const percentage = submission.totalPoints > 0 
                    ? ((submission.totalScore / submission.totalPoints) * 100).toFixed(1) + '%'
                    : '0%';
                
                const row = [
                    user.name || 'Unknown',
                    user.email || 'N/A',
                    submission.totalScore || 0,
                    submission.totalPoints || 0,
                    percentage,
                    formattedDate
                ];
                
                // Add answer data for each question
                if (quiz.questions) {
                    quiz.questions.forEach((q, idx) => {
                        const answer = submission.answers?.find(a => a.questionId === q.id);
                        const questionText = q.question || `Question ${idx + 1}`;
                        const userAnswer = answer ? (q.type !== 'text' && q.options 
                            ? (q.options[answer.answer] || answer.answer) 
                            : answer.answer) : 'Not answered';
                        const correctAnswer = q.type === 'text' 
                            ? q.correctAnswer 
                            : (q.options && q.options[q.correctAnswer] ? q.options[q.correctAnswer] : 'N/A');
                        const isCorrect = answer?.isCorrect ? 'Yes' : 'No';
                        const points = answer?.pointsEarned || 0;
                        
                        row.push(questionText, userAnswer, correctAnswer, points);
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
            a.download = `quiz-submissions-${quiz.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            Toast.success(`Downloaded ${submissions.length} submissions successfully`);
        } catch (error) {
            console.error('Error downloading submissions:', error);
            Toast.error('Failed to download submissions: ' + error.message);
        }
    },
    
    /**
     * Render submissions view (step flow)
     */
    renderSubmissionsView() {
        const { quiz, submissions, usersMap, currentIndex } = this.currentQuizSubmissions;
        
        const titleEl = document.getElementById('quiz-submissions-view-title');
        const countEl = document.getElementById('quiz-submissions-view-count');
        const contentEl = document.getElementById('quiz-submissions-content');
        const currentEl = document.getElementById('quiz-submissions-current');
        const totalEl = document.getElementById('quiz-submissions-total');
        const progressEl = document.getElementById('quiz-submissions-progress');
        const prevBtn = document.getElementById('quiz-submissions-prev');
        const nextBtn = document.getElementById('quiz-submissions-next');
        const downloadBtn = document.getElementById('quiz-submissions-view-download');
        
        if (!titleEl || !countEl || !contentEl || !currentEl || !totalEl || !progressEl || !prevBtn || !nextBtn || !downloadBtn) {
            Toast.error('Submissions view elements not found');
            return;
        }
        
        titleEl.textContent = `Submissions: ${this.escapeHtml(quiz.title)}`;
        countEl.textContent = `${submissions.length} submission${submissions.length !== 1 ? 's' : ''}`;
        
        // Store data for download
        downloadBtn.onclick = () => {
            const { quiz, submissions, usersMap } = this.currentQuizSubmissions;
            this.downloadQuizSubmissions(quiz, submissions, usersMap);
        };
        
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
        
        const completedDate = submission.completedAt 
            ? (submission.completedAt.toDate ? submission.completedAt.toDate() : new Date(submission.completedAt))
            : null;
        const formattedDate = completedDate ? Utils.formatDate(completedDate) : 'Date not available';
        const percentage = submission.totalPoints > 0 
            ? ((submission.totalScore / submission.totalPoints) * 100).toFixed(1) + '%'
            : '0%';
        
        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200 rounded-xl p-6 max-w-3xl mx-auto';
        card.innerHTML = `
            <div class="flex justify-between items-start mb-6 pb-4 border-b border-slate-200">
                <div>
                    <h4 class="font-bold text-xl text-slate-800 mb-1">${this.escapeHtml(userName)}</h4>
                    <p class="text-sm text-slate-500">${this.escapeHtml(userInfoDisplay)}</p>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-bold text-rota-pink mb-1">${submission.totalScore || 0} / ${submission.totalPoints || 0}</div>
                    <p class="text-sm text-slate-500">${percentage}</p>
                    <p class="text-xs text-slate-400 mt-1">${formattedDate}</p>
                </div>
            </div>
            <div class="space-y-4">
                <h5 class="font-bold text-slate-700 mb-3">Answers:</h5>
                ${submission.answers ? submission.answers.map((ans, idx) => {
                    // Try to find question by ID first
                    let question = quiz.questions?.find(q => q.id === ans.questionId);
                    
                    // If not found by ID, try to match by index (fallback for older submissions)
                    if (!question && quiz.questions && quiz.questions.length > idx) {
                        question = quiz.questions[idx];
                    }
                    
                    if (!question) {
                        console.error('Question not found:', {
                            questionId: ans.questionId,
                            answerIndex: idx,
                            quizQuestions: quiz.questions?.map(q => ({ id: q.id, question: q.question?.substring(0, 50) })),
                            submissionAnswers: submission.answers?.map(a => ({ questionId: a.questionId }))
                        });
                        return `<div class="p-4 rounded-lg border-2 bg-slate-50 border-slate-200">
                            <p class="text-sm text-slate-500">Question ${idx + 1}: Question data not found (ID: ${ans.questionId || 'N/A'})</p>
                            <p class="text-xs text-slate-400 mt-1">Answer: ${ans.answer !== undefined ? ans.answer : 'N/A'}</p>
                        </div>`;
                    }
                    
                    const questionText = question.question || `Question ${idx + 1}`;
                    const questionPoints = question.points || 0;
                    const pointsEarned = ans.pointsEarned || 0;
                    
                    // Get correct answer text
                    let correctAnswerText = 'N/A';
                    if (question.type === 'text') {
                        correctAnswerText = question.correctAnswer || 'N/A';
                    } else if (question.options && question.correctAnswer !== undefined) {
                        // correctAnswer might be an index (number) or the option text itself
                        const correctIndex = typeof question.correctAnswer === 'number' 
                            ? question.correctAnswer 
                            : question.options.findIndex(opt => opt === question.correctAnswer);
                        correctAnswerText = (correctIndex >= 0 && question.options[correctIndex]) 
                            ? question.options[correctIndex] 
                            : String(question.correctAnswer);
                    }
                    
                    // Get user answer text
                    let userAnswerText = 'Not answered';
                    if (ans.answer !== undefined && ans.answer !== null) {
                        if (question.type === 'text') {
                            userAnswerText = String(ans.answer);
                        } else if (question.options) {
                            // ans.answer might be an index (number) or the option text itself
                            const answerIndex = typeof ans.answer === 'number' 
                                ? ans.answer 
                                : question.options.findIndex(opt => opt === ans.answer);
                            userAnswerText = (answerIndex >= 0 && question.options[answerIndex]) 
                                ? question.options[answerIndex] 
                                : String(ans.answer);
                        } else {
                            userAnswerText = String(ans.answer);
                        }
                    }
                    
                    return `
                        <div class="p-4 rounded-lg border-2 ${ans.isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}">
                            <div class="flex justify-between items-start mb-2">
                                <p class="font-bold text-slate-800">${this.escapeHtml(questionText)}</p>
                                <span class="text-xs font-bold ${ans.isCorrect ? 'text-green-700' : 'text-red-700'}">
                                    ${pointsEarned} / ${questionPoints} pts
                                </span>
                            </div>
                            <div class="space-y-2 mt-3">
                                <p class="text-sm">
                                    <span class="font-medium text-slate-600">Answer: </span>
                                    <span class="${ans.isCorrect ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}">${this.escapeHtml(userAnswerText)}</span>
                                </p>
                                ${!ans.isCorrect ? `
                                    <p class="text-sm text-slate-600">
                                        <span class="font-medium">Correct Answer: </span>
                                        <span class="text-green-700">${this.escapeHtml(correctAnswerText)}</span>
                                    </p>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('') : '<p class="text-slate-500">No answers recorded</p>'}
            </div>
        `;
        contentEl.appendChild(card);
        
        // Switch to submissions view
        AdminUI.switchView('quiz-submissions');
    },
    
    /**
     * Navigate to previous submission
     */
    previousSubmission() {
        if (this.currentQuizSubmissions.currentIndex > 0) {
            this.currentQuizSubmissions.currentIndex--;
            this.renderSubmissionsView();
        }
    },
    
    /**
     * Navigate to next submission
     */
    nextSubmission() {
        if (this.currentQuizSubmissions.currentIndex < this.currentQuizSubmissions.submissions.length - 1) {
            this.currentQuizSubmissions.currentIndex++;
            this.renderSubmissionsView();
        }
    },
    
    /**
     * Back to quizzes list
     */
    backToQuizzes() {
        this.currentQuizSubmissions = {
            quiz: null,
            submissions: [],
            usersMap: new Map(),
            currentIndex: 0
        };
        AdminUI.switchView('quizzes');
    },
    
    /**
     * Delete quiz
     * @param {string} quizId - Quiz ID
     */
    async deleteQuiz(quizId) {
        if (!quizId) {
            Toast.error('Invalid quiz ID');
            return;
        }
        
        // Enhanced confirmation dialog
        const quiz = this.quizzes.find(q => q.id === quizId);
        const quizTitle = quiz?.title || 'this quiz';
        
        if (!confirm(`⚠️ Delete Quiz?\n\nQuiz: "${quizTitle}"\n\nThis will:\n• Delete the quiz permanently\n• Remove it from all users' pending missions\n• Delete all associated submissions\n\nThis action cannot be undone.`)) {
            return;
        }
        
        try {
            // Show loading state
            const quizCard = document.querySelector(`[data-quiz-id="${quizId}"]`);
            if (quizCard) {
                quizCard.style.opacity = '0.5';
                quizCard.style.pointerEvents = 'none';
                const deleteBtn = quizCard.querySelector('[onclick*="deleteQuiz"]');
                if (deleteBtn) {
                    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    deleteBtn.disabled = true;
                }
            }
            
            // Optimistic UI update: Remove from local list immediately with fade-out
            const operationId = OptimisticUI.removeItem('quiz', quizId, () => {
                this.render();
            }, this.quizzes);
            
            // Delete from Firestore (async, triggers Cloud Function)
            DB.db.collection('quizzes').doc(quizId).delete()
                .then(() => {
                    // Clear caches
            DB.invalidateCache('quiz');
                    Cache.clear(Cache.keys.quizList());
                    
                    // Show success message
                    Toast.success(`Quiz "${quizTitle}" deleted successfully. It will be removed from all users' pending missions shortly.`);
                    
                    // Real-time listener will confirm the update when Cloud Function completes
                })
                .catch((error) => {
            console.error('Error deleting quiz:', error);
            Toast.error('Failed to delete quiz: ' + error.message);
                    
                    // Rollback optimistic update on error
                    if (operationId) {
                        OptimisticUI.rollback(operationId, () => {
                            this.render();
                        });
                    }
                    
                    // Restore UI on error
                    const quizCard = document.querySelector(`[data-quiz-id="${quizId}"]`);
                    if (quizCard) {
                        quizCard.style.opacity = '1';
                        quizCard.style.pointerEvents = 'auto';
                        const deleteBtn = quizCard.querySelector('[onclick*="deleteQuiz"]');
                        if (deleteBtn) {
                            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                            deleteBtn.disabled = false;
                        }
                    }
                });
        } catch (error) {
            console.error('Error in deleteQuiz:', error);
            Toast.error('Failed to delete quiz: ' + error.message);
        }
    }
};

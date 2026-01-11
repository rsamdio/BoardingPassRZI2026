// Quiz Module
const Quiz = {
    currentQuiz: null,
    currentAnswers: {},
    timer: null,
    timeRemaining: 0,
    
    async startQuiz(quizId) {
        const quiz = await DB.getQuiz(quizId);
        if (!quiz) {
            showToast('Quiz not found', 'error');
            return;
        }
        
        // Check if already completed using CompletionManager
        const canStart = await CompletionManager.canStartQuiz(Auth.currentUser.uid, quizId);
        if (!canStart) {
            showToast('You have already completed this quiz', 'info');
            return;
        }
        
        this.currentQuiz = quiz;
        this.currentAnswers = {};
        
        if (quiz.isTimeBased && quiz.timeLimit) {
            this.timeRemaining = quiz.timeLimit * 60; // Convert to seconds
            this.startTimer();
        }
        
        this.renderQuiz();
        document.getElementById('modal-quiz').classList.remove('hidden');
    },
    
    startTimer() {
        const timerEl = document.getElementById('quiz-timer');
        this.timer = setInterval(() => {
            this.timeRemaining--;
            const minutes = Math.floor(this.timeRemaining / 60);
            const seconds = this.timeRemaining % 60;
            timerEl.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            if (this.timeRemaining <= 0) {
                this.submitQuiz(true); // Auto-submit when time runs out
            }
        }, 1000);
    },
    
    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },
    
    renderQuiz() {
        if (!this.currentQuiz) return;
        
        document.getElementById('quiz-modal-title').textContent = this.currentQuiz.title;
        const contentEl = document.getElementById('quiz-content');
        contentEl.innerHTML = '';
        
        this.currentQuiz.questions.forEach((q, index) => {
            const questionEl = document.createElement('div');
            questionEl.className = 'mb-6';
            questionEl.innerHTML = `
                <div class="mb-3">
                    <span class="text-xs font-bold text-rota-pink bg-rose-100 px-2 py-1 rounded">Question ${index + 1}</span>
                    <p class="font-bold text-slate-800 mt-2">${q.question}</p>
                    <p class="text-xs text-slate-500 mt-1">Points: ${q.points}</p>
                </div>
            `;
            
            if (q.type === 'multiple-choice') {
                q.options.forEach((option, optIndex) => {
                    const optionEl = document.createElement('label');
                    optionEl.className = 'block mb-2 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors';
                    optionEl.innerHTML = `
                        <input type="radio" name="q${q.id}" value="${optIndex}" onchange="Quiz.setAnswer('${q.id}', ${optIndex})" class="mr-2">
                        ${option}
                    `;
                    questionEl.appendChild(optionEl);
                });
            } else if (q.type === 'true-false') {
                q.options.forEach((option, optIndex) => {
                    const optionEl = document.createElement('label');
                    optionEl.className = 'block mb-2 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors';
                    optionEl.innerHTML = `
                        <input type="radio" name="q${q.id}" value="${optIndex}" onchange="Quiz.setAnswer('${q.id}', ${optIndex})" class="mr-2">
                        ${option}
                    `;
                    questionEl.appendChild(optionEl);
                });
            } else {
                const inputEl = document.createElement('input');
                inputEl.type = 'text';
                inputEl.className = 'w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-rota-pink outline-none';
                inputEl.placeholder = 'Type your answer...';
                inputEl.onchange = (e) => this.setAnswer(q.id, e.target.value);
                questionEl.appendChild(inputEl);
            }
            
            contentEl.appendChild(questionEl);
        });
    },
    
    setAnswer(questionId, answer) {
        this.currentAnswers[questionId] = answer;
    },
    
    async submitQuiz(autoSubmit = false) {
        if (!this.currentQuiz) return;
        
        // Check if already submitting
        const submitBtn = document.getElementById('quiz-submit-btn');
        if (submitBtn && submitBtn.disabled) {
            return; // Already submitting
        }
        
        this.stopTimer();
        
        if (!autoSubmit && Object.keys(this.currentAnswers).length < this.currentQuiz.questions.length) {
            if (!confirm('You have not answered all questions. Submit anyway?')) {
                if (this.currentQuiz.isTimeBased && this.timeRemaining > 0) {
                    this.startTimer();
                }
                return;
            }
        }
        
        // Disable button and show loading state
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
        }
        
        // Prevent modal close
        const closeBtn = document.querySelector('#modal-quiz button[onclick*="closeModal"]');
        if (closeBtn) closeBtn.style.pointerEvents = 'none';
        
        // Disable quiz questions/interactions
        const quizContent = document.getElementById('quiz-content');
        if (quizContent) {
            const inputs = quizContent.querySelectorAll('input, select, textarea, button');
            inputs.forEach(input => {
                if (input.id !== 'quiz-submit-btn') {
                    input.disabled = true;
                }
            });
        }
        
        try {
            // Calculate score
            let totalScore = 0;
            const answers = this.currentQuiz.questions.map(q => {
                const userAnswer = this.currentAnswers[q.id];
                const isCorrect = q.type === 'text' 
                    ? userAnswer?.toLowerCase().trim() === q.correctAnswer?.toLowerCase().trim()
                    : parseInt(userAnswer) === q.correctAnswer;
                
                const pointsEarned = isCorrect ? q.points : 0;
                totalScore += pointsEarned;
                
                return {
                    questionId: q.id,
                    answer: userAnswer,
                    isCorrect,
                    pointsEarned
                };
            });
            
            const startTime = this.currentQuiz.isTimeBased 
                ? Date.now() - (this.currentQuiz.timeLimit * 60 - this.timeRemaining) * 1000
                : Date.now();
            const timeTaken = Math.floor((Date.now() - startTime) / 1000);
            
            // Submit to database
            // Use Firestore Timestamp for consistency with Cloud Functions
            const submittedAt = firebase.firestore.Timestamp.now ? firebase.firestore.Timestamp.now() : new Date();
            const submittedAtTimestamp = submittedAt.getTime ? submittedAt.getTime() : (submittedAt.toMillis ? submittedAt.toMillis() : Date.now());
            
            const submission = {
                userId: Auth.currentUser.uid,
                userName: Auth.currentUser.name,
                quizId: this.currentQuiz.id,
                quizTitle: this.currentQuiz.title,
                answers,
                score: totalScore, // Use 'score' to match Cloud Function expectations
                totalScore: totalScore,
                totalPoints: this.currentQuiz.totalPoints,
                timeTaken,
                submittedAt: submittedAt, // Use submittedAt (not completedAt) to match Cloud Function
                completedAt: submittedAt // Keep for backward compatibility
            };
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
            }
            
            // Submit to database first
            await DB.submitQuiz(submission);
            
            // Update button text
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Updating...';
            }
            
            // Optimistic update: Remove quiz from pending activities list immediately
            await SubmissionHelpers.optimisticallyRemoveFromPending(
                Auth.currentUser.uid, 
                'quiz', 
                this.currentQuiz.id
            );
            
            // Award points only if score > 0
            if (totalScore > 0) {
                try {
                    const updatedUser = await DB.addPoints(Auth.currentUser.uid, totalScore, `Quiz: ${this.currentQuiz.title}`);
                    // Update local user
                    Auth.currentUser = { ...Auth.currentUser, ...updatedUser };
                } catch (error) {
                    console.error('Error awarding points:', error);
                    // Don't block quiz submission if points fail
                    Toast.error('Quiz submitted but failed to award points: ' + error.message);
                }
            } else {
                // When score is 0, no points are awarded, so no user update needed
                // When score > 0, addPoints() already updates Auth.currentUser
                // If user data refresh is needed, use RTDB cache:
                // const userStats = await DB.getUserStats(Auth.currentUser.uid);
                // Auth.currentUser = { ...Auth.currentUser, points: userStats.totalPoints };
                // This saves 1 Firestore read per quiz submission with 0 points
            }
            
            // Mark as completed in local cache IMMEDIATELY
            // Use the same timestamp format as Cloud Function will use
            await CompletionManager.markCompletedLocally(
                Auth.currentUser.uid,
                'quiz',
                this.currentQuiz.id,
                {
                    submittedAt: submittedAtTimestamp,
                    points: totalScore,
                    score: totalScore
                }
            );
            
            // Clear all related caches to force refresh from RTDB
            CompletionManager.clearCompletionCaches(
                Auth.currentUser.uid,
                'quiz',
                this.currentQuiz.id
            );
            
            // Also clear pending activities cache to force immediate refresh
            SubmissionHelpers.clearActivityCaches(Auth.currentUser.uid, 'quiz', this.currentQuiz.id);
            
            // Show results
            this.showResults(totalScore, this.currentQuiz.totalPoints);
            
            // Close modal and refresh UI after showing results
            setTimeout(() => {
                closeModal('modal-quiz');
                // Force immediate UI refresh
                UI.renderPendingActivities().catch(console.error);
                UI.renderQuizzes().catch(console.error);
            }, 2000);
        } catch (error) {
            // Re-enable button and inputs on error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Submit Quiz';
            }
            if (quizContent) {
                const inputs = quizContent.querySelectorAll('input, select, textarea, button');
                inputs.forEach(input => {
                    if (input.id !== 'quiz-submit-btn') {
                        input.disabled = false;
                    }
                });
            }
            if (closeBtn) closeBtn.style.pointerEvents = 'auto';
            showToast('Quiz submission failed: ' + error.message, 'error');
            
            // Restart timer if it was time-based
            if (this.currentQuiz.isTimeBased && this.timeRemaining > 0) {
                this.startTimer();
            }
        }
    },
    
    showResults(score, total) {
        const contentEl = document.getElementById('quiz-content');
        const percentage = Math.round((score / total) * 100);
        contentEl.innerHTML = `
            <div class="text-center py-8">
                <div class="w-20 h-20 bg-${percentage >= 70 ? 'green' : percentage >= 50 ? 'amber' : 'red'}-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-${percentage >= 70 ? 'trophy' : 'star'} text-${percentage >= 70 ? 'green' : percentage >= 50 ? 'amber' : 'red'}-500 text-3xl"></i>
                </div>
                <h3 class="text-2xl font-bold text-slate-800 mb-2">Quiz Complete!</h3>
                <p class="text-4xl font-bold text-rota-pink mb-2">${score} / ${total}</p>
                <p class="text-slate-500">You earned ${score} points!</p>
            </div>
        `;
        
        document.getElementById('quiz-submit-btn').style.display = 'none';
    }
};

// Global function for onclick
function submitQuiz() {
    Quiz.submitQuiz();
}

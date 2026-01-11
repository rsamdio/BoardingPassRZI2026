// Submission Helpers
// Unified utilities for handling submissions and cache invalidation

const SubmissionHelpers = {
    /**
     * Clear all caches related to user activities after submission
     * @param {string} userId - User ID
     * @param {string} activityType - 'quiz', 'task', or 'form'
     * @param {string} activityId - Activity ID (optional, for specific activity cache)
     */
    clearActivityCaches(userId, activityType, activityId = '') {
        const typePlural = activityType === 'quiz' ? 'quizzes' : activityType === 'task' ? 'tasks' : 'forms';
        const cacheKeys = [
            `rtdb_cache_cache_users_${userId}_pendingActivities_combined`,
            `rtdb_cache_cache_users_${userId}_pendingActivities_${typePlural}`,
            `rtdb_cache_cache_users_${userId}_completedActivities_combined`,
            `rtdb_cache_cache_users_${userId}_completedActivities_${typePlural}`,
            `rtdb_cache_cache_users_${userId}_completions`,
            `rtdb_cache_cache_users_${userId}_stats`
        ];
        
        // Also clear version cache to force refresh
        cacheKeys.push(`pending_activities_version_${userId}`);
        cacheKeys.push(`completed_activities_version_${userId}`);
        
        // Clear completion status cache specifically for the activity
        if (activityId) {
            cacheKeys.push(`rtdb_cache_cache_users_${userId}_completions_${activityType}_${activityId}`);
        }
        
        cacheKeys.forEach(key => {
            try {
                Cache.clear(key);
            } catch (error) {
            }
        });
        
    },
    
    /**
     * Optimistically update pending activities list
     * Removes the submitted activity from pending list immediately
     * @param {string} userId - User ID
     * @param {string} activityType - 'quiz', 'task', or 'form'
     * @param {string} activityId - Activity ID
     * @returns {Promise<boolean>} - Success status
     */
    async optimisticallyRemoveFromPending(userId, activityType, activityId) {
        try {
            const pending = await DB.getPendingActivities(userId) || [];
            const updatedPending = pending.filter(item => {
                // Remove if it matches the activity
                if (activityType === 'quiz' && item.itemType === 'quiz' && item.id === activityId) {
                    return false;
                }
                if (activityType === 'task' && item.itemType === 'task' && item.id === activityId) {
                    return false;
                }
                if (activityType === 'form' && item.itemType === 'form' && item.id === activityId) {
                    return false;
                }
                return true;
            });
            
            // Update localStorage cache immediately
            const cacheKey = `rtdb_cache_cache_users_${userId}_pendingActivities_combined`;
            Cache.set(cacheKey, {
                data: updatedPending,
                timestamp: Date.now()
            }, 'SYSTEM');
            
            return true;
        } catch (error) {
            return false;
        }
    },
    
    /**
     * Refresh UI after submission
     * @param {string} activityType - 'quiz', 'task', or 'form'
     */
    async refreshUIAfterSubmission(activityType) {
        // Immediate refresh
        await UI.renderPendingActivities();
        
        // Refresh stats and home view
        if (typeof App !== 'undefined' && App.initializeDashboard) {
            App.initializeDashboard();
        }
        
        // Fallback refresh after Cloud Function completes (3 seconds)
        setTimeout(async () => {
            const userId = Auth.currentUser?.uid;
            if (!userId) return;
            
            // Clear all related caches
            SubmissionHelpers.clearActivityCaches(userId, activityType, '');
            
            // Force refresh
            await UI.renderPendingActivities();
            if (typeof App !== 'undefined' && App.initializeDashboard) {
                App.initializeDashboard();
            }
        }, 3000);
    },
    
    /**
     * Check if a task can be submitted
     * @param {Array} submissions - User's submissions
     * @param {string} taskId - Task ID
     * @param {string} userId - User ID
     * @returns {Object} - { canSubmit: boolean, reason: string }
     */
    canSubmitTask(submissions, taskId, userId) {
        if (!submissions || !Array.isArray(submissions)) {
            return { canSubmit: true, reason: '' };
        }
        
        // Find submissions for this task
        const taskSubmissions = submissions.filter(s => s.taskId === taskId);
        
        if (taskSubmissions.length === 0) {
            return { canSubmit: true, reason: '' };
        }
        
        // Check for pending submission
        const pendingSubmission = taskSubmissions.find(s => s.status === 'pending');
        if (pendingSubmission) {
            return { 
                canSubmit: false, 
                reason: 'You already have a pending submission for this task. Please wait for review.' 
            };
        }
        
        // Check for approved submission
        const approvedSubmission = taskSubmissions.find(s => s.status === 'approved');
        if (approvedSubmission) {
            return { 
                canSubmit: false, 
                reason: 'This task has already been approved. You cannot resubmit.' 
            };
        }
        
        // Rejected submissions can be resubmitted
        return { canSubmit: true, reason: '' };
    },
    
    /**
     * Check if a quiz can be submitted
     * @param {Object} completionStatus - User's completion status
     * @param {string} quizId - Quiz ID
     * @returns {boolean}
     */
    canSubmitQuiz(completionStatus, quizId) {
        if (!completionStatus || !completionStatus.quizzes) {
            return true;
        }
        
        return !completionStatus.quizzes[quizId];
    },
    
    /**
     * Check if a form can be submitted
     * @param {Object} completionStatus - User's completion status
     * @param {string} formId - Form ID
     * @returns {boolean}
     */
    canSubmitForm(completionStatus, formId) {
        if (!completionStatus || !completionStatus.forms) {
            return true;
        }
        
        return !completionStatus.forms[formId];
    },
    
    /**
     * Get status display styling for submission status badges
     * @param {string} status - Submission status ('pending', 'approved', 'rejected', 'completed')
     * @returns {Object} - Object with className and label properties
     */
    getStatusDisplay(status) {
        const statusLower = (status || 'pending').toLowerCase();
        
        switch (statusLower) {
            case 'approved':
            case 'completed':
                return {
                    className: 'bg-green-100 text-green-700',
                    label: statusLower === 'approved' ? 'Approved' : 'Completed'
                };
            case 'rejected':
                return {
                    className: 'bg-red-100 text-red-700',
                    label: 'Rejected'
                };
            case 'pending':
            default:
                return {
                    className: 'bg-amber-100 text-amber-700',
                    label: 'Pending'
                };
        }
    },
    
    /**
     * Check if a submission can be approved
     * @param {Object} submission - Submission object
     * @returns {Object} - { canApprove: boolean, reason: string }
     */
    canApproveSubmission(submission) {
        if (!submission) {
            return { canApprove: false, reason: 'Submission not found' };
        }
        
        if (submission.status === 'approved') {
            return { canApprove: false, reason: 'This submission has already been approved' };
        }
        
        if (submission.status === 'rejected') {
            // Rejected submissions can be approved (reversal)
            return { canApprove: true, reason: '' };
        }
        
        if (submission.status === 'pending') {
            return { canApprove: true, reason: '' };
        }
        
        // Default: allow approval
        return { canApprove: true, reason: '' };
    }
};

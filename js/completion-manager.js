// Completion Manager
// Centralized logic for managing completion status and activity lists

const CompletionManager = {
    /**
     * Check if an activity is completed
     * @param {string} userId - User ID
     * @param {string} activityType - 'quiz', 'task', or 'form'
     * @param {string} activityId - Activity ID
     * @returns {Promise<Object|null>} - Completion data or null
     */
    async isCompleted(userId, activityType, activityId) {
        try {
            const completionStatus = await DB.getUserCompletionStatus(userId, false, true); // Force fresh read
            const typeKey = `${activityType}s`; // quizzes, tasks, forms
            
            if (completionStatus[typeKey] && completionStatus[typeKey][activityId]) {
                return completionStatus[typeKey][activityId];
            }
            return null;
        } catch (error) {
            console.error('Error checking completion status:', error);
            return null;
        }
    },
    
    /**
     * Check if a quiz can be started (not completed)
     * @param {string} userId - User ID
     * @param {string} quizId - Quiz ID
     * @returns {Promise<boolean>}
     */
    async canStartQuiz(userId, quizId) {
        const completion = await this.isCompleted(userId, 'quiz', quizId);
        return !completion; // Can start if not completed
    },
    
    /**
     * Check if a task can be submitted
     * @param {string} userId - User ID
     * @param {string} taskId - Task ID
     * @returns {Promise<{canSubmit: boolean, reason: string}>}
     */
    async canSubmitTask(userId, taskId) {
        const completion = await this.isCompleted(userId, 'task', taskId);
        
        if (!completion) {
            return { canSubmit: true, reason: '' };
        }
        
        const status = completion.status;
        
        // Can resubmit if rejected
        if (status === 'rejected') {
            return { canSubmit: true, reason: '' };
        }
        
        // Cannot submit if pending (waiting review) or approved (completed)
        if (status === 'pending') {
            return { 
                canSubmit: false, 
                reason: 'You already have a pending submission for this task. Please wait for review.' 
            };
        }
        
        if (status === 'approved') {
            return { 
                canSubmit: false, 
                reason: 'This task has already been approved. You cannot resubmit.' 
            };
        }
        
        return { canSubmit: true, reason: '' };
    },
    
    /**
     * Check if a form can be submitted
     * @param {string} userId - User ID
     * @param {string} formId - Form ID
     * @returns {Promise<boolean>}
     */
    async canSubmitForm(userId, formId) {
        const completion = await this.isCompleted(userId, 'form', formId);
        return !completion; // Can submit if not completed
    },
    
    /**
     * Mark activity as completed in local cache immediately
     * @param {string} userId - User ID
     * @param {string} activityType - 'quiz', 'task', or 'form'
     * @param {string} activityId - Activity ID
     * @param {Object} completionData - Completion data
     */
    async markCompletedLocally(userId, activityType, activityId, completionData) {
        try {
            
            // Get current completion status (force fresh read)
            const completionStatus = await DB.getUserCompletionStatus(userId, false, true);
            const typeKey = `${activityType}s`;
            
            // Update completion status
            if (!completionStatus[typeKey]) {
                completionStatus[typeKey] = {};
            }
            
            // Merge completion data, ensuring all required fields
            completionStatus[typeKey][activityId] = {
                completed: true,
                ...completionData,
                lastUpdated: Date.now()
            };
            
            
            // Update local cache immediately
            const cacheKey = `rtdb_cache_cache_users_${userId}_completions`;
            Cache.set(cacheKey, {
                data: completionStatus,
                timestamp: Date.now()
            }, 'SYSTEM');
            
        } catch (error) {
            console.error(`[CompletionManager] Error marking activity as completed locally:`, error);
        }
    },
    
    /**
     * Clear all completion-related caches
     * @param {string} userId - User ID
     * @param {string} activityType - 'quiz', 'task', or 'form'
     * @param {string} activityId - Activity ID
     */
    clearCompletionCaches(userId, activityType, activityId) {
        const typePlural = `${activityType}s`;
        const cacheKeys = [
            // Completion status cache
            `rtdb_cache_cache_users_${userId}_completions`,
            // Pending activities caches
            `rtdb_cache_cache_users_${userId}_pendingActivities_combined`,
            `rtdb_cache_cache_users_${userId}_pendingActivities_${typePlural}`,
            // Completed activities caches
            `rtdb_cache_cache_users_${userId}_completedActivities_combined`,
            `rtdb_cache_cache_users_${userId}_completedActivities_${typePlural}`,
            // Version caches
            `pending_activities_version_${userId}`,
            `completed_activities_version_${userId}`
        ];
        
        cacheKeys.forEach(key => {
            try {
                Cache.clear(key);
            } catch (error) {
            }
        });
        
    },
    
    /**
     * Filter activities based on completion status
     * @param {Array} activities - Activities to filter
     * @param {Object} completionStatus - Completion status object
     * @param {string} listType - 'pending' or 'completed'
     * @returns {Array} - Filtered activities
     */
    filterActivities(activities, completionStatus, listType = 'pending') {
        if (!activities || !Array.isArray(activities)) {
            return [];
        }
        
        return activities.filter(activity => {
            const activityType = activity.itemType || activity.type || 'task';
            const activityId = activity.id || activity.quizId || activity.taskId || activity.formId;
            const typeKey = `${activityType === 'quiz' ? 'quiz' : activityType === 'form' ? 'form' : 'task'}s`;
            
            if (!completionStatus[typeKey] || !completionStatus[typeKey][activityId]) {
                // Not in completion status
                if (listType === 'pending') {
                    return true; // Show in pending
                }
                return false; // Don't show in completed
            }
            
            const completion = completionStatus[typeKey][activityId];
            
            if (activityType === 'task') {
                const status = completion.status;
                
                if (listType === 'pending') {
                    // Show in pending only if rejected (can resubmit)
                    return status === 'rejected';
                } else {
                    // Show in completed only if approved
                    return status === 'approved';
                }
            } else {
                // Quiz or Form
                if (listType === 'pending') {
                    return false; // Don't show in pending if completed
                } else {
                    return true; // Show in completed
                }
            }
        });
    }
};

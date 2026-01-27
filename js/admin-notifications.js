// Admin Notifications Manager
// Handles sending custom push notifications to users

const AdminNotifications = {
    previewData: null,
    
    /**
     * Initialize notifications view
     */
    init() {
        // Add character counter for message textarea
        const messageTextarea = document.getElementById('notification-message');
        const charCount = document.getElementById('notification-char-count');
        
        if (messageTextarea && charCount) {
            messageTextarea.addEventListener('input', () => {
                const length = messageTextarea.value.length;
                charCount.textContent = `${length}/200`;
                if (length > 200) {
                    charCount.classList.add('text-red-500');
                } else {
                    charCount.classList.remove('text-red-500');
                }
            });
        }
    },
    
    /**
     * Handle target audience change
     */
    handleTargetChange() {
        const target = document.getElementById('notification-target').value;
        const specificContainer = document.getElementById('specific-users-container');
        
        if (target === 'specific') {
            specificContainer.classList.remove('hidden');
        } else {
            specificContainer.classList.add('hidden');
        }
    },
    
    /**
     * Preview notification before sending
     */
    previewNotification() {
        const title = document.getElementById('notification-title').value.trim();
        const message = document.getElementById('notification-message').value.trim();
        
        if (!title) {
            Toast.error('Please enter a notification title');
            return;
        }
        
        if (!message) {
            Toast.error('Please enter a notification message');
            return;
        }
        
        this.previewData = {
            title: title,
            message: message,
            target: document.getElementById('notification-target').value,
            userIds: this.getUserIds()
        };
        
        // Show preview
        document.getElementById('preview-title').textContent = title;
        document.getElementById('preview-message').textContent = message;
        document.getElementById('notification-preview-modal').classList.remove('hidden');
    },
    
    /**
     * Close preview modal
     */
    closePreview() {
        document.getElementById('notification-preview-modal').classList.add('hidden');
        this.previewData = null;
    },
    
    /**
     * Send notification from preview
     */
    sendFromPreview() {
        if (this.previewData) {
            this.closePreview();
            this.sendNotificationInternal(this.previewData);
        }
    },
    
    /**
     * Get user IDs from textarea
     */
    getUserIds() {
        const textarea = document.getElementById('notification-user-ids');
        if (!textarea) return null;
        
        const text = textarea.value.trim();
        if (!text) return null;
        
        // Split by newlines and filter empty lines
        const userIds = text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        return userIds.length > 0 ? userIds : null;
    },
    
    /**
     * Send notification
     */
    async sendNotification(event) {
        if (event) {
            event.preventDefault();
        }
        
        const title = document.getElementById('notification-title').value.trim();
        const message = document.getElementById('notification-message').value.trim();
        const target = document.getElementById('notification-target').value;
        
        if (!title) {
            Toast.error('Please enter a notification title');
            return;
        }
        
        if (!message) {
            Toast.error('Please enter a notification message');
            return;
        }
        
        const data = {
            title: title,
            message: message,
            target: target,
            userIds: target === 'specific' ? this.getUserIds() : null
        };
        
        await this.sendNotificationInternal(data);
    },
    
    /**
     * Internal function to send notification
     */
    async sendNotificationInternal(data) {
        const sendButton = document.getElementById('send-notification-btn');
        const originalText = sendButton.innerHTML;
        
        // Disable button and show loading
        sendButton.disabled = true;
        sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        
        try {
            // Get current user's auth token
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) {
                throw new Error('Not authenticated');
            }
            
            const idToken = await currentUser.getIdToken();
            
            // Prepare request body
            const requestBody = {
                title: data.title,
                message: data.message,
                notificationType: 'engagement_custom'
            };
            
            // Add target users if specified
            if (data.target === 'specific' && data.userIds && data.userIds.length > 0) {
                requestBody.targetUsers = data.userIds;
            }
            
            // Call Cloud Function
            const functionUrl = `https://us-central1-rzi2026chennai.cloudfunctions.net/sendCustomEngagementNotifications`;
            
            const response = await fetch(functionUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(requestBody)
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to send notifications');
            }
            
            // Success
            Toast.success(`Notification sent successfully to ${result.sent || 0} users!`);
            
            // Reset form
            document.getElementById('notification-form').reset();
            document.getElementById('notification-char-count').textContent = '0/200';
            document.getElementById('specific-users-container').classList.add('hidden');
            document.getElementById('notification-target').value = 'all';
            
        } catch (error) {
            console.error('Error sending notification:', error);
            Toast.error(`Failed to send notification: ${error.message}`);
        } finally {
            // Re-enable button
            sendButton.disabled = false;
            sendButton.innerHTML = originalText;
        }
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AdminNotifications.init());
} else {
    AdminNotifications.init();
}

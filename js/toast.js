// Toast Notification Module
// Centralized toast notification system for both attendee and admin apps

const Toast = {
    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: 'success', 'error', 'info', 'warning'
     * @param {number} duration - Duration in milliseconds (default: 3000)
     */
    show(message, type = 'success', duration = 3000) {
        // Try to find toast element (works for both index.html and admin.html)
        const toast = document.getElementById('toast');
        if (!toast) {
            return;
        }

        const icon = toast.querySelector('i');
        const msgEl = document.getElementById('toast-msg') || toast.querySelector('[id*="toast"]');
        
        if (!icon || !msgEl) {
            return;
        }

        // Set icon and message based on type
        const typeConfig = {
            success: {
                icon: 'fa-check-circle',
                bgColor: 'bg-green-500',
                textColor: 'text-white'
            },
            error: {
                icon: 'fa-exclamation-circle',
                bgColor: 'bg-red-500',
                textColor: 'text-white'
            },
            info: {
                icon: 'fa-info-circle',
                bgColor: 'bg-blue-500',
                textColor: 'text-white'
            },
            warning: {
                icon: 'fa-exclamation-triangle',
                bgColor: 'bg-amber-500',
                textColor: 'text-white'
            }
        };

        const config = typeConfig[type] || typeConfig.success;
        
        // Update icon classes
        icon.className = `fas ${config.icon} ${config.textColor}`;
        
        // Update message
        msgEl.textContent = message;
        
        // Update background color
        toast.className = toast.className.replace(/bg-\w+-\d+/, '');
        toast.classList.add(config.bgColor);
        
        // Show toast
        toast.style.top = '20px';
        toast.style.opacity = '1';
        
        // Hide after duration
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.top = '-100px';
            }, 300);
        }, duration);
    },

    /**
     * Show success toast
     * @param {string} message - Message to display
     */
    success(message) {
        this.show(message, 'success');
    },

    /**
     * Show error toast
     * @param {string} message - Message to display
     */
    error(message) {
        this.show(message, 'error', 4000); // Longer duration for errors
    },

    /**
     * Show info toast
     * @param {string} message - Message to display
     */
    info(message) {
        this.show(message, 'info');
    },

    /**
     * Show warning toast
     * @param {string} message - Message to display
     */
    warning(message) {
        this.show(message, 'warning');
    }
};

// Global function for backward compatibility
function showToast(message, type = 'success') {
    Toast.show(message, type);
}

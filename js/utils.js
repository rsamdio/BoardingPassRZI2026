// Utility Functions Module
// Centralized helper functions used across the application

const Utils = {
    /**
     * Convert Firestore Timestamp to milliseconds for comparison
     * Handles all Firestore Timestamp formats
     * @param {Object} timestamp - Firestore Timestamp object
     * @returns {number} - Timestamp in milliseconds, or 0 if invalid
     */
    timestampToMillis(timestamp) {
        if (!timestamp) return 0;
        if (timestamp.toMillis) return timestamp.toMillis();
        if (timestamp.toDate) return timestamp.toDate().getTime();
        if (timestamp.seconds) return timestamp.seconds * 1000;
        if (typeof timestamp === 'number') return timestamp;
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? 0 : date.getTime();
    },

    /**
     * Format Firestore Timestamp to readable date string
     * @param {Object} timestamp - Firestore Timestamp object
     * @param {Object} options - Intl.DateTimeFormat options
     * @returns {string} - Formatted date string or 'Date not available'
     */
    formatDate(timestamp, options = {}) {
        if (!timestamp) return 'Date not available';
        
        try {
            let date;
            if (timestamp.toDate) {
                date = timestamp.toDate();
            } else if (timestamp.toMillis) {
                date = new Date(timestamp.toMillis());
            } else if (timestamp.seconds) {
                date = new Date(timestamp.seconds * 1000);
            } else {
                date = new Date(timestamp);
            }
            
            if (isNaN(date.getTime())) {
                return 'Date not available';
            }
            
            const defaultOptions = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            };
            
            return date.toLocaleString(undefined, { ...defaultOptions, ...options });
        } catch (e) {
            return 'Date not available';
        }
    },

    /**
     * Get the most recent item from an array based on timestamp
     * @param {Array} items - Array of items with timestamp field
     * @param {string} timestampField - Field name containing timestamp (default: 'submittedAt')
     * @returns {Object|null} - Most recent item or null
     */
    getMostRecent(items, timestampField = 'submittedAt') {
        if (!items || items.length === 0) return null;
        
        return items.reduce((mostRecent, current) => {
            const currentTime = this.timestampToMillis(current[timestampField]);
            const recentTime = this.timestampToMillis(mostRecent[timestampField]);
            return currentTime > recentTime ? current : mostRecent;
        });
    },

    /**
     * Group items by a key and keep only the most recent for each group
     * @param {Array} items - Array of items
     * @param {Function} keyFn - Function to generate key for grouping
     * @param {string} timestampField - Field name containing timestamp
     * @returns {Map} - Map of key -> most recent item
     */
    groupByMostRecent(items, keyFn, timestampField = 'submittedAt') {
        const grouped = new Map();
        
        items.forEach(item => {
            const key = keyFn(item);
            const existing = grouped.get(key);
            
            if (!existing) {
                grouped.set(key, item);
            } else {
                const existingTime = this.timestampToMillis(existing[timestampField]);
                const currentTime = this.timestampToMillis(item[timestampField]);
                
                if (currentTime > existingTime) {
                    grouped.set(key, item);
                }
            }
        });
        
        return grouped;
    },

    /**
     * Normalize email address (lowercase, trim)
     * @param {string} email - Email address
     * @returns {string} - Normalized email
     */
    normalizeEmail(email) {
        if (!email) return '';
        return email.toLowerCase().trim();
    },

    /**
     * Debounce function execution
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} - Debounced function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Safe JSON parse with fallback
     * @param {string} str - JSON string
     * @param {*} fallback - Fallback value if parse fails
     * @returns {*} - Parsed object or fallback
     */
    safeJsonParse(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    },

    /**
     * Format file size to human-readable format
     * @param {number} bytes - File size in bytes
     * @returns {string} - Formatted size (e.g., "1.5 MB")
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    /**
     * Validate file type
     * @param {File} file - File object
     * @param {Array<string>} allowedTypes - Array of allowed MIME types
     * @returns {boolean} - True if file type is allowed
     */
    validateFileType(file, allowedTypes) {
        return allowedTypes.includes(file.type);
    },

    /**
     * Validate file size
     * @param {File} file - File object
     * @param {number} maxSizeMB - Maximum size in MB
     * @returns {boolean} - True if file size is within limit
     */
    validateFileSize(file, maxSizeMB) {
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        return file.size <= maxSizeBytes;
    },

    /**
     * Generate unique ID (simple timestamp-based)
     * @returns {string} - Unique ID
     */
    generateId() {
        return `f${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Clean up form field ID to readable label
     * @param {string} fieldId - Field ID (e.g., "f17679139677070.42466293257832")
     * @returns {string} - Cleaned label or original ID
     */
    cleanFieldId(fieldId) {
        if (!fieldId) return '';
        // Remove "f" prefix and numbers, keep only meaningful text
        const cleaned = fieldId.replace(/^f\d+\.?\d*:?\s*/, '').trim();
        // If still looks like an ID, return generic label
        if (cleaned.match(/^f?\d+\.?\d*$/)) {
            return `Field ${fieldId}`;
        }
        return cleaned || fieldId;
    }
};

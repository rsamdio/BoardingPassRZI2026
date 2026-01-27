// Notification Settings Manager
// Manages user notification preferences

const NotificationSettings = {
  /**
   * Get user notification preferences
   * @returns {Promise<Object|null>} - Preferences object or null if not logged in
   */
  async getPreferences() {
    if (!Auth || !Auth.currentUser) return null;
    
    try {
      const userDoc = await DB.db.collection('users').doc(Auth.currentUser.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        return {
          enabled: userData.notificationEnabled !== false, // Default to true
          pendingMissions: userData.notificationPrefs?.pendingMissions !== false, // Default to true
          submissions: userData.notificationPrefs?.submissions !== false, // Default to true
          engagement: userData.notificationPrefs?.engagement !== false // Default to true
        };
      }
    } catch (error) {
      console.error('[NotificationSettings] Error getting preferences:', error);
    }
    
    // Default preferences (all enabled)
    return {
      enabled: true,
      pendingMissions: true,
      submissions: true,
      engagement: true
    };
  },
  
  /**
   * Update user notification preferences
   * Uses .update() to preserve existing user data
   * @param {Object} preferences - Preferences object
   * @returns {Promise<boolean>} - Success status
   */
  async updatePreferences(preferences) {
    if (!Auth || !Auth.currentUser) return false;
    
    try {
      // Use .update() to preserve all existing user fields
      await DB.db.collection('users').doc(Auth.currentUser.uid).update({
        notificationPrefs: {
          pendingMissions: preferences.pendingMissions !== false,
          submissions: preferences.submissions !== false,
          engagement: preferences.engagement !== false
        },
        notificationEnabled: preferences.enabled !== false
      });
      
      // If disabling, delete FCM token
      if (preferences.enabled === false) {
        if (typeof FCMNotifications !== 'undefined') {
          await FCMNotifications.deleteToken();
        }
      } else if (preferences.enabled === true) {
        // Re-initialize FCM if enabling
        if (typeof FCMNotifications !== 'undefined') {
          await FCMNotifications.init();
        }
      }
      
      return true;
    } catch (error) {
      console.error('[NotificationSettings] Error updating preferences:', error);
      return false;
    }
  }
};

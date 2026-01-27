// FCM Push Notification Manager
// Manages FCM token registration and foreground message handling

const FCMNotifications = {
  messaging: null,
  vapidKey: null, // Will be set from config or Firebase Console
  
  /**
   * Initialize FCM and request permission
   * Automatically enables notifications by default unless user has explicitly disabled them
   * @param {boolean} forcePrompt - Force permission prompt even if previously denied
   * @returns {Promise<{success: boolean, reason?: string, token?: string}>}
   */
  async init(forcePrompt = false) {
    if (!('Notification' in window)) {
      console.log('[FCM] This browser does not support notifications');
      return { success: false, reason: 'not_supported' };
    }
    
    // Check if service worker is supported
    if (!('serviceWorker' in navigator)) {
      console.log('[FCM] Service workers not supported');
      return { success: false, reason: 'service_worker_not_supported' };
    }
    
    try {
      // Check if user has explicitly disabled notifications
      if (Auth && Auth.currentUser) {
        try {
          const userDoc = await DB.db.collection('users').doc(Auth.currentUser.uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            // If user has explicitly set notificationEnabled to false, don't auto-enable
            if (userData.notificationEnabled === false) {
              console.log('[FCM] User has explicitly disabled notifications');
              return { success: false, reason: 'user_disabled' };
            }
          }
        } catch (error) {
          console.error('[FCM] Error checking user preferences:', error);
          // Continue with initialization if check fails
        }
      }
      
      // Register service worker
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('[FCM] Service worker registered:', registration);
      
      // Check current permission status
      let permission = Notification.permission;
      
      // If permission is default (not yet asked) or forcePrompt is true, request it
      if (permission === 'default' || forcePrompt) {
        permission = await Notification.requestPermission();
      }
      
      if (permission !== 'granted') {
        console.log('[FCM] Notification permission denied or not granted');
        return { success: false, reason: 'permission_denied' };
      }
      
      // Get VAPID key from config
      // VAPID key should be obtained from Firebase Console:
      // Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
      // Then add it to js/config.js as: CONFIG.FCM_VAPID_KEY = 'your-vapid-key'
      this.vapidKey = (typeof CONFIG !== 'undefined' && CONFIG.FCM_VAPID_KEY) 
        ? CONFIG.FCM_VAPID_KEY 
        : null;
      
      if (!this.vapidKey) {
        console.warn('[FCM] VAPID key not configured. Please get VAPID key from Firebase Console and add it to js/config.js as CONFIG.FCM_VAPID_KEY');
        return { success: false, reason: 'vapid_key_not_configured' };
      }
      
      // Initialize Firebase Messaging (using Firebase v8 compat API)
      if (typeof firebase === 'undefined' || !firebase.messaging) {
        console.error('[FCM] Firebase messaging not available');
        return { success: false, reason: 'firebase_not_loaded' };
      }
      
      this.messaging = firebase.messaging();
      
      // Get FCM token
      const token = await this.messaging.getToken({
        vapidKey: this.vapidKey,
        serviceWorkerRegistration: registration
      });
      
      if (token) {
        console.log('[FCM] Token obtained:', token);
        // Save token to user profile
        await this.saveTokenToUserProfile(token);
        
        // Note: Not setting up foreground listener - all notifications go through service worker
        // This ensures consistent behavior whether app is open or closed
        // Service worker handles all notifications via onBackgroundMessage
        
        // Listen for token refresh
        this.setupTokenRefresh();
        
        return { success: true, token };
      } else {
        console.log('[FCM] No token available');
        return { success: false, reason: 'no_token' };
      }
    } catch (error) {
      console.error('[FCM] Error initializing:', error);
      return { success: false, reason: 'error', error: error.message };
    }
  },
  
  /**
   * Save FCM token to user profile in Firestore
   * Uses .update() to preserve existing user data
   * Only sets notificationEnabled to true if it's not explicitly false
   * @param {string} token - FCM token
   */
  async saveTokenToUserProfile(token) {
    if (!Auth || !Auth.currentUser) {
      console.warn('[FCM] No user logged in, cannot save token');
      return;
    }
    
    try {
      // Check if user has explicitly disabled notifications
      const userDoc = await DB.db.collection('users').doc(Auth.currentUser.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const explicitlyDisabled = userData.notificationEnabled === false;
      
      // Use .update() to preserve all existing user fields
      // Only set notificationEnabled to true if user hasn't explicitly disabled it
      const updateData = {
        fcmToken: token,
        fcmTokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      // Only set notificationEnabled to true if it's not explicitly false
      // This allows auto-enable on login while respecting user's explicit disable choice
      if (!explicitlyDisabled) {
        updateData.notificationEnabled = true;
      }
      
      await DB.db.collection('users').doc(Auth.currentUser.uid).update(updateData);
      console.log('[FCM] Token saved to user profile', explicitlyDisabled ? '(notifications remain disabled by user choice)' : '(notifications enabled)');
    } catch (error) {
      console.error('[FCM] Error saving token:', error);
    }
  },
  
  /**
   * Listen for foreground messages (when app is open)
   * DISABLED: We use service worker for all notifications (foreground and background)
   * This ensures consistent behavior and prevents duplicates
   */
  setupForegroundListener() {
    if (!this.messaging) return;
    
    // Don't set up foreground listener - let service worker handle all notifications
    // This ensures consistent behavior whether app is open or closed
    console.log('[FCM] Foreground listener disabled - using service worker for all notifications');
    
    // Optional: You can still listen for messages to update UI without showing notifications
    // But we won't show browser notifications here to avoid duplicates
    try {
      this.messaging.onMessage((payload) => {
        console.log('[FCM] Message received (handled by service worker):', payload);
        // Service worker will show the notification
        // We can optionally update UI here if needed, but don't show notifications
      });
    } catch (error) {
      console.error('[FCM] Error setting up message listener:', error);
    }
  },
  
  /**
   * Listen for token refresh
   */
  setupTokenRefresh() {
    if (!this.messaging) return;
    
    try {
      this.messaging.onTokenRefresh(async (token) => {
        console.log('[FCM] Token refreshed:', token);
        await this.saveTokenToUserProfile(token);
      });
    } catch (error) {
      console.error('[FCM] Error setting up token refresh:', error);
    }
  },
  
  /**
   * Delete FCM token (when user disables notifications)
   */
  async deleteToken() {
    if (!this.messaging) return;
    
    try {
      await this.messaging.deleteToken();
      
      // Remove from user profile using .update() with FieldValue.delete()
      if (Auth && Auth.currentUser) {
        await DB.db.collection('users').doc(Auth.currentUser.uid).update({
          fcmToken: firebase.firestore.FieldValue.delete(),
          notificationEnabled: false
        });
      }
      
      console.log('[FCM] Token deleted');
    } catch (error) {
      console.error('[FCM] Error deleting token:', error);
    }
  },
  
  /**
   * Check if notifications are enabled
   * @returns {Promise<boolean>}
   */
  async isEnabled() {
    if (!Auth || !Auth.currentUser) return false;
    
    try {
      const userDoc = await DB.db.collection('users').doc(Auth.currentUser.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        return userData.notificationEnabled === true && !!userData.fcmToken;
      }
    } catch (error) {
      console.error('[FCM] Error checking status:', error);
    }
    
    return false;
  }
};

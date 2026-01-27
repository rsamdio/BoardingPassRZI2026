// Firebase Cloud Messaging Service Worker
// Handles background push notifications when app is closed

// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize Firebase (use config from js/config.js)
firebase.initializeApp({
  apiKey: "AIzaSyAGem0HmSLdbb4vPqvUWhl39qqPpOk_Ljg",
  authDomain: "rzi2026chennai.firebaseapp.com",
  databaseURL: "https://rzi2026chennai-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rzi2026chennai",
  storageBucket: "rzi2026chennai.firebasestorage.app",
  messagingSenderId: "122606728262",
  appId: "1:122606728262:web:8ce0bdc0096ba66c848647"
});

const messaging = firebase.messaging();

// Handle ALL messages via service worker (both foreground and background)
// Using data-only payload ensures all messages go through service worker
// This provides consistent notification behavior regardless of app state
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received message (handled by service worker):', payload);
  console.log('[firebase-messaging-sw.js] Payload data:', JSON.stringify(payload.data));
  
  // Extract notification data from payload
  // For data-only messages, all data is in payload.data (all values are strings)
  // For notification messages, data is in payload.notification
  const notificationTitle = payload.notification?.title || 
                           payload.data?.title || 
                           'New Notification';
  
  const notificationBody = payload.notification?.body || 
                          payload.data?.body || 
                          payload.data?.message ||
                          '';
  
  console.log('[firebase-messaging-sw.js] Extracted title:', notificationTitle);
  console.log('[firebase-messaging-sw.js] Extracted body:', notificationBody);
  
  // Use icon from data payload or default to logo
  const iconUrl = payload.data?.icon || '/rzilogo.webp';
  const badgeUrl = payload.data?.badge || '/rzilogo.webp';
  
  // Create unique tag using timestamp to prevent duplicates
  const notificationTag = payload.data?.timestamp || 
                         `${payload.data?.type || 'default'}-${Date.now()}`;
  
  // Prepare notification data (remove notification-specific fields from data)
  const notificationData = {};
  if (payload.data) {
    Object.keys(payload.data).forEach(key => {
      // Skip notification display fields, keep only data fields
      if (!['title', 'body', 'message', 'icon', 'badge', 'imageUrl', 'requireInteraction'].includes(key)) {
        notificationData[key] = payload.data[key];
      }
    });
  }
  
  const notificationOptions = {
    body: notificationBody,
    icon: iconUrl, // Use the Rotaract logo
    badge: badgeUrl, // Use logo as badge too
    image: payload.notification?.image || payload.data?.imageUrl,
    data: notificationData, // Clean data without notification fields
    tag: notificationTag, // Unique tag to prevent duplicates
    requireInteraction: payload.data?.requireInteraction === 'true' || false,
    renotify: false, // Don't renotify if same tag exists
    silent: false
    // Note: Not including 'actions' to avoid browser adding unsubscribe links
  };

  console.log('[firebase-messaging-sw.js] Showing notification:', {
    title: notificationTitle,
    body: notificationBody,
    icon: iconUrl,
    tag: notificationTag
  });

  // Show notification via service worker (works for both foreground and background)
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification clicked:', event);
  
  event.notification.close();
  
  // Get URL from notification data or default
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window if app is closed
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

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

// Handle background messages (when app is closed)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);
  
  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.message || '',
    icon: '/rzilogo.webp', // Use the Rotaract logo
    badge: '/rzilogo.webp', // Use logo as badge too
    image: payload.notification?.image,
    data: payload.data || {},
    tag: payload.data?.type || 'default', // Group similar notifications
    requireInteraction: payload.data?.requireInteraction || false,
    actions: payload.data?.actions || []
  };

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

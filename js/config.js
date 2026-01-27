// Firebase Configuration
// Production Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyAGem0HmSLdbb4vPqvUWhl39qqPpOk_Ljg",
    authDomain: "rzi2026chennai.firebaseapp.com",
    databaseURL: "https://rzi2026chennai-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "rzi2026chennai",
    storageBucket: "rzi2026chennai.firebasestorage.app",
    messagingSenderId: "122606728262",
    appId: "1:122606728262:web:8ce0bdc0096ba66c848647"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
}

// App Configuration
const CONFIG = {
    delay: 800,
    // FCM VAPID Key - Get from Firebase Console:
    // Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
    FCM_VAPID_KEY: 'BJjTv0EJppthHi7EUASV-Z6E_YljSFH3ePKVk6A1A-q8taDa99v6qb1EOfOq2gUgkFiTyK5L_FrWzlNH8dbeAgU' // Uncomment and add your VAPID key here
};

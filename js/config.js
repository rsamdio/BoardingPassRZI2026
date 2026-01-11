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
    delay: 800
};

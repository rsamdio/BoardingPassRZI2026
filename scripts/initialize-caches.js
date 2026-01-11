/**
 * Script to initialize RTDB caches
 * Run this from the project root: node scripts/initialize-caches.js
 * 
 * Make sure you're authenticated with Firebase CLI first:
 * firebase login
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
try {
  // Try to use application default credentials
  admin.initializeApp();
  console.log('✅ Firebase Admin initialized');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
  console.log('\n💡 Make sure you have:');
  console.log('   1. Run: firebase login');
  console.log('   2. Or set GOOGLE_APPLICATION_CREDENTIALS environment variable');
  process.exit(1);
}

const functions = admin.functions();
const httpsCallable = functions.httpsCallable('initializeCaches');

async function runInitialization() {
  console.log('\n🚀 Starting cache initialization...');
  console.log('⏳ This may take a few minutes. Please wait...\n');
  
  try {
    // Note: This requires admin authentication
    // For callable functions, we need to use the client SDK with auth
    // Since this is a server-side script, we'll use a workaround
    
    // Actually, callable functions require client SDK with auth token
    // Let's use a different approach - call the HTTP endpoint directly
    // Or better: use the admin SDK to trigger the function logic directly
    
    console.log('⚠️  Note: Callable functions require client-side authentication.');
    console.log('📝 Please use one of these methods:');
    console.log('\n   1. Open initialize-caches.html in your browser (while logged in as admin)');
    console.log('   2. Or run this in browser console (while on admin.html):');
    console.log('      const init = firebase.functions().httpsCallable("initializeCaches");');
    console.log('      await init();');
    console.log('\n   3. Or manually trigger from Firebase Console → Functions → initializeCaches');
    
    // Alternative: We could import and call the migration functions directly
    // But that would require refactoring the code
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

runInitialization();

/**
 * Migration: Initialize running totals for admin stats
 * 
 * This script calculates initial counts for admin stats and stores them in RTDB
 * as running totals. After this, stats will be updated incrementally instead of
 * recalculating from full collections.
 * 
 * Run this ONCE before deploying Phase 3 incremental stats changes:
 * cd functions && node migrations/initialize-stats-totals.js
 */

const admin = require("firebase-admin");

// Initialize with database URL
admin.initializeApp({
  databaseURL: "https://rzi2026chennai-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();
const rtdb = admin.database();

/**
 * One-time script to initialize running totals for admin stats
 */
async function initializeStatsTotals() {
  console.log("Initializing admin stats running totals...");
  console.log("Timestamp:", new Date().toISOString());
  
  try {
    // ============================================
    // Count Users
    // ============================================
    console.log("\n=== Counting Users ===");
    const usersSnapshot = await db.collection("users")
      .where("role", "==", "attendee")
      .get();
    
    const activeUsers = usersSnapshot.docs.filter(doc => 
      doc.data().status === "active"
    ).length;
    
    const totalUsers = usersSnapshot.size;
    
    console.log(`Total users: ${totalUsers}`);
    console.log(`Active users: ${activeUsers}`);
    
    // ============================================
    // Count Pending Users
    // ============================================
    console.log("\n=== Counting Pending Users ===");
    const pendingUsersSnapshot = await db.collection("pendingUsers").get();
    const pendingUsers = pendingUsersSnapshot.size;
    
    console.log(`Pending users: ${pendingUsers}`);
    
    // ============================================
    // Count Submissions by Status
    // ============================================
    console.log("\n=== Counting Submissions ===");
    const submissionsSnapshot = await db.collection("submissions").get();
    
    let pendingSubmissions = 0;
    let approvedSubmissions = 0;
    let rejectedSubmissions = 0;
    
    submissionsSnapshot.forEach(doc => {
      const status = doc.data().status || "pending";
      if (status === "pending") pendingSubmissions++;
      else if (status === "approved") approvedSubmissions++;
      else if (status === "rejected") rejectedSubmissions++;
    });
    
    console.log(`Pending submissions: ${pendingSubmissions}`);
    console.log(`Approved submissions: ${approvedSubmissions}`);
    console.log(`Rejected submissions: ${rejectedSubmissions}`);
    console.log(`Total submissions: ${submissionsSnapshot.size}`);
    
    // ============================================
    // Calculate Total Points
    // ============================================
    console.log("\n=== Calculating Total Points ===");
    let totalPoints = 0;
    usersSnapshot.forEach(doc => {
      totalPoints += doc.data().points || 0;
    });
    
    console.log(`Total points: ${totalPoints}`);
    
    // ============================================
    // Initialize Running Totals in RTDB
    // ============================================
    console.log("\n=== Initializing RTDB Cache ===");
    
    const statsData = {
      totalUsers: totalUsers + pendingUsers,
      activeUsers: activeUsers,
      pendingUsers: pendingUsers,
      totalPoints: totalPoints,
      pendingSubmissions: pendingSubmissions,
      approvedSubmissions: approvedSubmissions,
      rejectedSubmissions: rejectedSubmissions,
      lastUpdated: Date.now(),
      version: 1,
      initialized: true
    };
    
    await rtdb.ref("adminCache/stats").set(statsData);
    
    console.log("✅ Stats totals initialized in RTDB:");
    console.log(JSON.stringify(statsData, null, 2));
    
    // ============================================
    // Verification
    // ============================================
    console.log("\n=== Verification ===");
    const verifySnap = await rtdb.ref("adminCache/stats").once("value");
    if (verifySnap.exists()) {
      const verified = verifySnap.val();
      console.log("✅ Verified stats in RTDB:");
      console.log(`  - Total users: ${verified.totalUsers}`);
      console.log(`  - Active users: ${verified.activeUsers}`);
      console.log(`  - Pending users: ${verified.pendingUsers}`);
      console.log(`  - Total points: ${verified.totalPoints}`);
      console.log(`  - Pending submissions: ${verified.pendingSubmissions}`);
      console.log(`  - Approved submissions: ${verified.approvedSubmissions}`);
      console.log(`  - Rejected submissions: ${verified.rejectedSubmissions}`);
      console.log(`  - Initialized: ${verified.initialized}`);
    } else {
      throw new Error("Failed to verify stats initialization");
    }
    
  } catch (error) {
    console.error("❌ Error initializing stats:", error);
    throw error;
  }
}

// Run initialization
initializeStatsTotals()
  .then(() => {
    console.log("\n✅ Initialization completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Initialization failed:", error);
    process.exit(1);
  });

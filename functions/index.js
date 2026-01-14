/**
 * Firebase Cloud Functions for Rotaract Zone Institute App
 * 
 * These functions keep RTDB caches in sync with Firestore data changes
 * This reduces Firestore read costs by caching frequently accessed data
 */

const {onDocumentUpdated, onDocumentCreated, onDocumentDeleted} = require("firebase-functions/v2/firestore");
const {onRequest, onCall} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();

const region = "us-central1";
const db = admin.firestore();
const rtdb = admin.database();

/**
 * Update leaderboard cache in RTDB
 * - Writes top 50 users for the leaderboard modal
 * - Computes and stores rank for **all** active attendees
 */
async function updateLeaderboardCache() {
  try {
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .orderBy("points", "desc")
        .get();

    const leaderboardData = {};
    const rankUpdates = {};
    let index = 0;

    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      const points = data.points || 0;
      const rank = index + 1;

      // Build top 50 leaderboard data (index 0–49)
      if (index < 50) {
        leaderboardData[index] = {
          uid: doc.id,
          name: data.name || data.displayName || "User",
          email: data.email || null,
          district: data.district || null,
          designation: data.designation || null,
          points: points,
          photoURL: data.photoURL || data.photo || null,
          photo: data.photoURL || data.photo || null, // Keep both for backward compatibility
        };
      }

      // Rank data for this user (all users)
      const rankData = {
        rank: rank,
        points: points,
        lastUpdated: Date.now(),
      };

      rankUpdates[`ranks/${doc.id}`] = rankData;
      rankUpdates[`cache/leaderboard/ranks/${doc.id}`] = rankData;

      index++;
    });

    // Fill remaining leaderboard slots with null if less than 50
    for (let i = index; i < 50; i++) {
      if (leaderboardData[i] === undefined) {
        leaderboardData[i] = null;
      }
    }

    // Persist leaderboard and rank caches
    await Promise.all([
      rtdb.ref("leaderboard/top50").set(leaderboardData),
      rtdb.ref("cache/leaderboard/top50").set(leaderboardData),
      rtdb.ref().update(rankUpdates),
    ]);
    
    // Update metadata
    const metadataRef = rtdb.ref("cache/leaderboard/metadata");
    const existingMetaSnap = await metadataRef.once("value");
    const existingMeta = existingMetaSnap.val() || {};

    await metadataRef.set({
      lastUpdated: Date.now(),
      version: (existingMeta.version || 0) + 1,
      count: index,
    });
  } catch (error) {
    console.error("Error updating leaderboard cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update individual user rank in RTDB
 */
async function updateUserRank(uid, points) {
  try {
    // Calculate rank based on points
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .orderBy("points", "desc")
        .get();

    let rank = 1;
    usersSnapshot.forEach((doc) => {
      if (doc.id === uid) {
        return; // Found user, stop
      }
      if ((doc.data().points || 0) > points) {
        rank++;
      }
    });

    // Update both old path (for backward compatibility) and new path
    const rankData = {
      rank: rank,
      points: points,
      lastUpdated: Date.now()
    };
    
    await Promise.all([
      rtdb.ref(`ranks/${uid}`).set(rankData),
      rtdb.ref(`cache/leaderboard/ranks/${uid}`).set(rankData)
    ]);
  } catch (error) {
    console.error(`Error updating user rank for ${uid}:`, error);
    // Non-critical, don't throw
  }
}

/**
 * Update admin participants cache in RTDB
 * Fetches all pending and active users from Firestore
 */
async function updateAdminParticipantsCache() {
  try {
    // Fetch pending users
    const pendingUsersSnapshot = await db.collection("pendingUsers").get();
    const pendingUsers = [];
    pendingUsersSnapshot.forEach((doc) => {
      const data = doc.data();
      pendingUsers.push({
        email: doc.id,
        name: data.name,
        district: data.district,
        designation: data.designation,
        status: "pending",
        createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      });
    });

    // Fetch active users
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .get();
    const activeUsers = [];
    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      activeUsers.push({
        uid: doc.id,
        email: data.email,
        name: data.name,
        district: data.district,
        designation: data.designation,
        points: data.points || 0,
        status: data.status || "active",
        photo: data.photo || data.photoURL || null,
        firstLoginAt: data.firstLoginAt ? data.firstLoginAt.toMillis() : null,
      });
    });

    // Update RTDB cache
    await rtdb.ref("adminCache/participants").set({
      pending: pendingUsers,
      active: activeUsers,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating admin participants cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update attendee directory cache in RTDB
 * Populates attendeeCache/directory for attendee app (accessible to all authenticated users)
 */
async function updateAttendeeDirectoryCache() {
  try {
    // Fetch active users only (attendees don't need pending users)
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .get();
    
    const directoryData = {};
    
    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      // Get name from name or displayName (displayName comes from Google auth)
      const userName = data.name || data.displayName || null;
      // Get photoURL from photoURL or photo (photoURL comes from Google auth, photo might be from old data)
      // Also check for any other photo-related fields
      const userPhotoURL = data.photoURL || data.photo || data.profilePhoto || null;
      
      if (!userPhotoURL && Object.keys(directoryData).length < 3) {
      }
      
      directoryData[doc.id] = {
        uid: doc.id,
        email: data.email || null,
        name: userName,
        displayName: data.displayName || userName, // Include displayName for compatibility
        district: data.district || null,
        designation: data.designation || null,
        points: data.points || 0,
        photoURL: userPhotoURL, // Ensure photoURL is included
        photo: userPhotoURL, // Keep both for compatibility
        status: data.status || "active"
      };
    });
    
    directoryData.lastUpdated = Date.now();
    
    // Update RTDB cache
    await rtdb.ref("attendeeCache/directory").set(directoryData);
  } catch (error) {
    console.error("Error updating attendee directory cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Callable function to manually trigger attendee directory cache update
 * Can be called from admin panel or for initial cache population
 */
exports.updateAttendeeDirectory = onCall(
    { region: region },
    async (request) => {
      // Only allow admins to trigger this
      if (!request.auth) {
        throw new Error("Unauthorized");
      }
      
      // Check if user is admin
      const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
      if (!adminDoc.exists) {
        throw new Error("Unauthorized: Admin access required");
      }
      
      await updateAttendeeDirectoryCache();
      return { success: true, message: "Attendee directory cache updated" };
    }
);

/**
 * Check cache health - returns status of all RTDB caches
 * Useful for monitoring and debugging
 */
exports.checkCacheHealth = onCall(
    { region: region },
    async (request) => {
      // Only allow admins to check cache health
      if (!request.auth) {
        throw new Error("Unauthorized");
      }
      
      // Check if user is admin
      const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
      if (!adminDoc.exists) {
        throw new Error("Unauthorized: Admin access required");
      }
      
      const health = {};
      
      // Indexed caches
      const indexedChecks = [
        { path: 'cache/activities/quizzes/metadata', name: 'Activities Indexed (Quizzes)' },
        { path: 'cache/activities/tasks/metadata', name: 'Activities Indexed (Tasks)' },
        { path: 'cache/activities/forms/metadata', name: 'Activities Indexed (Forms)' },
        { path: 'cache/leaderboard/metadata', name: 'Leaderboard Indexed' },
        { path: 'cache/users/directory', name: 'Directory' }
      ];
      
      // Pre-computed caches (sample a few users)
      const directoryRef = rtdb.ref('cache/users/directory');
      const directorySnap = await directoryRef.once('value');
      const directoryData = directorySnap.val() || {};
      const userIds = Object.keys(directoryData).filter(key => key !== 'lastUpdated').slice(0, 3);
      
      const precomputedChecks = [];
      userIds.forEach(uid => {
        precomputedChecks.push(
          { path: `cache/users/${uid}/pendingActivities/metadata`, name: `User ${uid.substring(0, 8)} Pending Lists`, sample: true },
          { path: `cache/users/${uid}/completedActivities/metadata`, name: `User ${uid.substring(0, 8)} Completed Lists`, sample: true }
        );
      });
      
      // Admin caches
      const adminChecks = [
        { path: 'cache/admin/stats', name: 'Admin Stats' },
        { path: 'cache/admin/submissions/metadata', name: 'Submission Metadata (Sample)', sample: true }
      ];
      
      // Old caches (for backward compatibility check)
      const oldChecks = [
        { path: 'attendeeCache/activities', name: 'Old Activities Cache' },
        { path: 'adminCache/stats', name: 'Old Admin Stats' },
        { path: 'leaderboard/top50', name: 'Old Leaderboard' }
      ];
      
      const allChecks = [...indexedChecks, ...precomputedChecks, ...adminChecks, ...oldChecks];
      
      for (const check of allChecks) {
        try {
          const ref = rtdb.ref(check.path);
          const snap = await ref.once('value');
          const data = snap.val();
          
          if (check.sample && !snap.exists()) {
            // For sample checks, just note if it exists
            health[check.name] = {
              exists: false,
              status: 'MISSING',
              note: 'Sample check - may not exist for all users'
            };
            continue;
          }
          
          const lastUpdated = data?.lastUpdated || data?.metadata?.lastUpdated || 0;
          const version = data?.version || data?.metadata?.version || null;
          const age = Date.now() - lastUpdated;
          const ageMinutes = Math.round(age / 60000);
          
          health[check.name] = {
            exists: snap.exists(),
            age: ageMinutes,
            ageFormatted: ageMinutes < 60 ? `${ageMinutes}m` : `${Math.round(ageMinutes / 60)}h`,
            status: age < 600000 ? 'OK' : age < 1800000 ? 'STALE' : 'VERY_STALE',
            lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
            version: version,
            dataSize: snap.exists() ? JSON.stringify(data).length : 0
          };
        } catch (error) {
          health[check.name] = {
            exists: false,
            error: error.message,
            status: 'ERROR'
          };
        }
      }
      
      return health;
    }
);

/**
 * Sync admins from Firestore to RTDB
 * This allows RTDB security rules to check admin status
 */
async function syncAdminsToRTDB() {
  try {
    const adminsSnapshot = await db.collection("admins").get();
    const adminsData = {};
    
    adminsSnapshot.forEach((doc) => {
      const data = doc.data();
      adminsData[doc.id] = {
        uid: doc.id,
        name: data.name || null,
        email: data.email || null,
        role: data.role || "admin",
        createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      };
    });
    
    // Update RTDB admins collection
    await rtdb.ref("admins").set(adminsData);
  } catch (error) {
    console.error("Error syncing admins to RTDB:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update email lookup cache in RTDB
 */
async function updateEmailCache(email, uid, type, isDelete = false) {
  if (!email) return;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    if (isDelete) {
      await rtdb.ref(`adminCache/emails/${normalizedEmail}`).remove();
    } else {
      await rtdb.ref(`adminCache/emails/${normalizedEmail}`).set({
        uid: uid,
        type: type, // "pending" or "active"
        lastUpdated: Date.now(),
      });
    }
  } catch (error) {
    console.error(`Error updating email cache:`, error);
    // Non-critical, don't throw
  }
}

/**
 * Update admin dashboard statistics cache in RTDB
 * Aggregates user counts, points, and submission statistics
 */
async function updateAdminStatsCache() {
  try {
    // Fetch all users (active and pending)
    const [usersSnapshot, pendingUsersSnapshot, submissionsSnapshot] = await Promise.all([
      db.collection("users")
        .where("role", "==", "attendee")
        .get(),
      db.collection("pendingUsers").get(),
      db.collection("submissions").get()
    ]);

    // Calculate user statistics
    const allUsers = [];
    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      allUsers.push({
        uid: doc.id,
        status: data.status || "active",
        points: data.points || 0,
      });
    });

    const activeUsers = allUsers.filter(u => u.status === "active");
    const pendingUsers = pendingUsersSnapshot.size;
    const totalUsers = allUsers.length + pendingUsers;
    const totalPoints = allUsers.reduce((sum, u) => sum + (u.points || 0), 0);

    // Calculate submission statistics
    const submissions = [];
    submissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      submissions.push({
        status: data.status || "pending",
      });
    });

    const pendingSubmissions = submissions.filter(s => s.status === "pending").length;
    const approvedSubmissions = submissions.filter(s => s.status === "approved").length;
    const rejectedSubmissions = submissions.filter(s => s.status === "rejected").length;

    // Update RTDB cache
    await rtdb.ref("adminCache/stats").set({
      totalUsers: totalUsers,
      activeUsers: activeUsers.length,
      pendingUsers: pendingUsers,
      totalPoints: totalPoints,
      pendingSubmissions: pendingSubmissions,
      approvedSubmissions: approvedSubmissions,
      rejectedSubmissions: rejectedSubmissions,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating admin stats cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update quizzes list cache in RTDB
 */
async function updateQuizzesCache() {
  try {
    const quizzesSnapshot = await db.collection("quizzes").get();
    const quizzesData = {};
    
    // Get submission counts for each quiz
    const quizSubmissionsSnapshot = await db.collection("quizSubmissions").get();
    const submissionCounts = {};
    quizSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      const quizId = data.quizId;
      if (quizId) {
        submissionCounts[quizId] = (submissionCounts[quizId] || 0) + 1;
      }
    });
    
    quizzesSnapshot.forEach((doc) => {
      const data = doc.data();
      quizzesData[doc.id] = {
        id: doc.id,
        title: data.title || "Untitled Quiz",
        description: data.description || "",
        status: data.status || "inactive",
        questionsCount: (data.questions && data.questions.length) || 0,
        submissionsCount: submissionCounts[doc.id] || 0,
        totalPoints: data.totalPoints || 0,
        createdAt: data.createdAt ? data.createdAt.toMillis() : 0,
        updatedAt: data.updatedAt ? data.updatedAt.toMillis() : (data.createdAt ? data.createdAt.toMillis() : 0),
      };
    });
    
    await rtdb.ref("adminCache/quizzes").set({
      ...quizzesData,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating quizzes cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update tasks list cache in RTDB
 */
async function updateTasksCache() {
  try {
    const tasksSnapshot = await db.collection("tasks").get();
    const tasksData = {};
    
    // Get submission counts for each task
    const taskSubmissionsSnapshot = await db.collection("submissions").get();
    const submissionCounts = {};
    taskSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      const taskId = data.taskId;
      if (taskId) {
        submissionCounts[taskId] = (submissionCounts[taskId] || 0) + 1;
      }
    });
    
    tasksSnapshot.forEach((doc) => {
      const data = doc.data();
      tasksData[doc.id] = {
        id: doc.id,
        title: data.title || "Untitled Task",
        description: data.description || "",
        type: data.type || "upload",
        status: data.status || "inactive",
        points: data.points || 0,
        submissionsCount: submissionCounts[doc.id] || 0,
        formFieldsCount: (data.formFields && data.formFields.length) || 0,
        createdAt: data.createdAt ? data.createdAt.toMillis() : 0,
        updatedAt: data.updatedAt ? data.updatedAt.toMillis() : (data.createdAt ? data.createdAt.toMillis() : 0),
      };
    });
    
    await rtdb.ref("adminCache/tasks").set({
      ...tasksData,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating tasks cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update forms list cache in RTDB
 */
async function updateFormsCache() {
  try {
    const formsSnapshot = await db.collection("forms").get();
    const formsData = {};
    
    // Get submission counts for each form
    const formSubmissionsSnapshot = await db.collection("formSubmissions").get();
    const submissionCounts = {};
    formSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      const formId = data.formId;
      if (formId) {
        submissionCounts[formId] = (submissionCounts[formId] || 0) + 1;
      }
    });
    
    formsSnapshot.forEach((doc) => {
      const data = doc.data();
      formsData[doc.id] = {
        id: doc.id,
        title: data.title || "Untitled Form",
        description: data.description || "",
        status: data.status || "inactive",
        points: data.points || 0,
        formFields: data.formFields || [], // Include full formFields array for admin view
        formFieldsCount: (data.formFields && data.formFields.length) || 0,
        submissionsCount: submissionCounts[doc.id] || 0,
        submissionCount: submissionCounts[doc.id] || 0, // Also include as submissionCount for compatibility
        createdAt: data.createdAt ? data.createdAt.toMillis() : 0,
        updatedAt: data.updatedAt ? data.updatedAt.toMillis() : (data.createdAt ? data.createdAt.toMillis() : 0),
      };
    });
    
    await rtdb.ref("adminCache/forms").set({
      ...formsData,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating forms cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update submission counts cache in RTDB
 */
async function updateSubmissionCountsCache() {
  try {
    const [submissionsSnapshot, formSubmissionsSnapshot] = await Promise.all([
      db.collection("submissions").get(),
      db.collection("formSubmissions").get()
    ]);
    
    // Count by status for task submissions
    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    
    const byTask = {};
    const byForm = {};
    
    // Process task submissions
    submissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      const status = data.status || "pending";
      
      if (status === "pending") counts.pending++;
      else if (status === "approved") counts.approved++;
      else if (status === "rejected") counts.rejected++;
      
      // Count by task
      if (data.taskId) {
        if (!byTask[data.taskId]) {
          byTask[data.taskId] = { pending: 0, approved: 0, rejected: 0 };
        }
        if (status === "pending") byTask[data.taskId].pending++;
        else if (status === "approved") byTask[data.taskId].approved++;
        else if (status === "rejected") byTask[data.taskId].rejected++;
      }
    });
    
    // Process form submissions
    formSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.formId) {
        byForm[data.formId] = (byForm[data.formId] || 0) + 1;
      }
    });
    
    await rtdb.ref("adminCache/submissionCounts").set({
      pending: counts.pending,
      approved: counts.approved,
      rejected: counts.rejected,
      byTask: byTask,
      byForm: byForm,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating submission counts cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update attendee activities cache in RTDB
 * Syncs active quizzes, tasks, and forms for attendee app
 */
async function updateAttendeeActivitiesCache() {
  try {
    // Fetch only active activities
    const [quizzesSnapshot, tasksSnapshot, formsSnapshot] = await Promise.all([
      db.collection("quizzes")
        .where("status", "==", "active")
        .get(),
      db.collection("tasks")
        .where("status", "==", "active")
        .get(),
      db.collection("forms")
        .where("status", "==", "active")
        .get()
    ]);

    const activitiesData = {
      quizzes: {},
      tasks: {},
      forms: {},
      lastUpdated: Date.now()
    };

    // Process quizzes
    quizzesSnapshot.forEach((doc) => {
      const data = doc.data();
      activitiesData.quizzes[doc.id] = {
        id: doc.id,
        title: data.title || "Untitled Quiz",
        description: data.description || "",
        totalPoints: data.totalPoints || 0,
        questionsCount: (data.questions && data.questions.length) || 0,
        isTimeBased: data.isTimeBased || false,
        timeLimit: data.timeLimit || null,
        createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      };
    });

    // Process tasks
    tasksSnapshot.forEach((doc) => {
      const data = doc.data();
      activitiesData.tasks[doc.id] = {
        id: doc.id,
        title: data.title || "Untitled Task",
        description: data.description || "",
        type: data.type || "upload",
        points: data.points || 0,
        formFieldsCount: (data.formFields && data.formFields.length) || 0,
        createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      };
    });

    // Process forms
    formsSnapshot.forEach((doc) => {
      const data = doc.data();
      activitiesData.forms[doc.id] = {
        id: doc.id,
        title: data.title || "Untitled Form",
        description: data.description || "",
        points: data.points || 0,
        formFieldsCount: (data.formFields && data.formFields.length) || 0,
        createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
      };
    });

    await rtdb.ref("attendeeCache/activities").set(activitiesData);
  } catch (error) {
    console.error("Error updating attendee activities cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update user completion status cache in RTDB
 * Maintains completion status for quizzes, tasks, and forms per user
 */
async function updateUserCompletionStatusCache(userId) {
  if (!userId) return;
  
  try {
    // Fetch all submissions for this user
    const [quizSubmissionsSnapshot, taskSubmissionsSnapshot, formSubmissionsSnapshot] = await Promise.all([
      db.collection("quizSubmissions")
        .where("userId", "==", userId)
        .get(),
      db.collection("submissions")
        .where("userId", "==", userId)
        .get(),
      db.collection("formSubmissions")
        .where("userId", "==", userId)
        .get()
    ]);

    const completionData = {
      quizzes: {},
      tasks: {},
      forms: {},
      lastUpdated: Date.now()
    };

    // Process quiz submissions
    quizSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.quizId) {
        completionData.quizzes[data.quizId] = {
          completed: true,
          score: data.score || 0,
          totalScore: data.totalScore || 0,
          submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
        };
      }
    });

    // Process task submissions (keep most recent)
    const taskCompletions = {};
    taskSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.taskId) {
        const submittedAt = data.submittedAt ? data.submittedAt.toMillis() : 0;
        if (!taskCompletions[data.taskId] || submittedAt > (taskCompletions[data.taskId].submittedAt || 0)) {
          taskCompletions[data.taskId] = {
            completed: true,
            status: data.status || "pending",
            submittedAt: submittedAt,
          };
        }
      }
    });
    completionData.tasks = taskCompletions;

    // Process form submissions
    formSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.formId) {
        completionData.forms[data.formId] = {
          completed: true,
          submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
        };
      }
    });

    await rtdb.ref(`attendeeCache/completions/${userId}`).set(completionData);
  } catch (error) {
    console.error(`Error updating completion status cache for ${userId}:`, error);
    // Non-critical, don't throw
  }
}

/**
 * Update user stats cache in RTDB
 * Aggregates user statistics for quick access
 */
async function updateUserStatsCache(userId) {
  if (!userId) return;
  
  try {
    // Fetch user data
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return;
    }
    const userData = userDoc.data();

    // Fetch submission counts
    const [quizSubmissionsSnapshot, taskSubmissionsSnapshot, formSubmissionsSnapshot] = await Promise.all([
      db.collection("quizSubmissions")
        .where("userId", "==", userId)
        .get(),
      db.collection("submissions")
        .where("userId", "==", userId)
        .get(),
      db.collection("formSubmissions")
        .where("userId", "==", userId)
        .get()
    ]);

    // Calculate stats
    const stats = {
      totalPoints: userData.points || 0,
      rank: 0, // Will be updated by updateUserRank
      quizzesCompleted: quizSubmissionsSnapshot.size,
      tasksCompleted: 0,
      formsCompleted: formSubmissionsSnapshot.size,
      pendingSubmissions: 0,
      approvedSubmissions: 0,
      rejectedSubmissions: 0,
      lastUpdated: Date.now()
    };

    // Count task submissions by status
    taskSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      const status = data.status || "pending";
      if (status === "pending") stats.pendingSubmissions++;
      else if (status === "approved") {
        stats.approvedSubmissions++;
        stats.tasksCompleted++;
      }
      else if (status === "rejected") stats.rejectedSubmissions++;
    });

    // Get rank from RTDB if available
    try {
      // Try new path first
      const rankRef = rtdb.ref(`cache/leaderboard/ranks/${userId}`);
      const rankSnap = await rankRef.once("value");
      if (rankSnap.exists()) {
        stats.rank = rankSnap.val().rank || 0;
      } else {
        // Fallback to old path
        const oldRankRef = rtdb.ref(`ranks/${userId}`);
        const oldRankSnap = await oldRankRef.once("value");
        if (oldRankSnap.exists()) {
          stats.rank = oldRankSnap.val().rank || 0;
        }
      }
    } catch (error) {
      // Rank not available yet, will be updated separately
    }

    // Write to new cache path (cache/users/{userId}/stats)
    await rtdb.ref(`cache/users/${userId}/stats`).set(stats);
    
    // Also write to old path for backward compatibility
    await rtdb.ref(`attendeeCache/userStats/${userId}`).set(stats);
  } catch (error) {
    console.error(`Error updating user stats cache for ${userId}:`, error);
    // Non-critical, don't throw
  }
}

/**
 * Update activity metadata cache in RTDB
 * Stores activity counts and metadata for quick overview
 */
async function updateActivityMetadataCache() {
  try {
    const [quizzesSnapshot, tasksSnapshot, formsSnapshot] = await Promise.all([
      db.collection("quizzes")
        .where("status", "==", "active")
        .get(),
      db.collection("tasks")
        .where("status", "==", "active")
        .get(),
      db.collection("forms")
        .where("status", "==", "active")
        .get()
    ]);

    let totalPoints = 0;
    quizzesSnapshot.forEach((doc) => {
      totalPoints += (doc.data().totalPoints || 0);
    });
    tasksSnapshot.forEach((doc) => {
      totalPoints += (doc.data().points || 0);
    });
    formsSnapshot.forEach((doc) => {
      totalPoints += (doc.data().points || 0);
    });

    const metadata = {
      quizzes: {
        count: quizzesSnapshot.size,
        totalPoints: quizzesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().totalPoints || 0), 0)
      },
      tasks: {
        count: tasksSnapshot.size,
        totalPoints: tasksSnapshot.docs.reduce((sum, doc) => sum + (doc.data().points || 0), 0)
      },
      forms: {
        count: formsSnapshot.size,
        totalPoints: formsSnapshot.docs.reduce((sum, doc) => sum + (doc.data().points || 0), 0)
      },
      totalPoints: totalPoints,
      lastUpdated: Date.now()
    };

    await rtdb.ref("attendeeCache/activityMetadata").set(metadata);
  } catch (error) {
    console.error("Error updating activity metadata cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update recent activity cache in RTDB
 * Maintains last 20 submissions sorted by timestamp
 */
async function updateRecentActivityCache() {
  try {
    // Fetch recent submissions from both collections
    const [taskSubmissionsSnapshot, formSubmissionsSnapshot, quizSubmissionsSnapshot] = await Promise.all([
      db.collection("submissions")
        .orderBy("submittedAt", "desc")
        .limit(30)
        .get(),
      db.collection("formSubmissions")
        .orderBy("submittedAt", "desc")
        .limit(30)
        .get(),
      db.collection("quizSubmissions")
        .orderBy("submittedAt", "desc")
        .limit(30)
        .get()
    ]);
    
    const allActivities = [];
    
    // Process task submissions
    taskSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.taskId && data.userId) {
        allActivities.push({
          id: doc.id,
          type: "task",
          userId: data.userId,
          userName: data.userName || data.name || "Unknown",
          taskId: data.taskId,
          taskTitle: data.taskTitle || data.title || "Untitled Task",
          status: data.status || "pending",
          submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
        });
      }
    });
    
    // Process form submissions
    formSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.formId && data.userId) {
        allActivities.push({
          id: doc.id,
          type: "form",
          userId: data.userId,
          userName: data.userName || data.name || "Unknown",
          formId: data.formId,
          taskTitle: data.formTitle || data.title || "Untitled Form",
          status: "submitted", // Forms don't have approval status
          submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
        });
      }
    });
    
    // Process quiz submissions
    quizSubmissionsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.quizId && data.userId) {
        allActivities.push({
          id: doc.id,
          type: "quiz",
          userId: data.userId,
          userName: data.userName || data.name || "Unknown",
          quizId: data.quizId,
          taskTitle: data.quizTitle || data.title || "Untitled Quiz",
          status: "completed",
          score: data.score || 0,
          totalScore: data.totalScore || 0,
          submittedAt: data.submittedAt ? data.submittedAt.toMillis() : Date.now(),
        });
      }
    });
    
    // Sort by submittedAt descending and take top 20
    allActivities.sort((a, b) => b.submittedAt - a.submittedAt);
    const recentActivities = allActivities.slice(0, 20);
    
    // Store in RTDB with index as key for easy access
    const activitiesData = {};
    recentActivities.forEach((activity, index) => {
      activitiesData[index] = activity;
    });
    
    await rtdb.ref("adminCache/recentActivity").set({
      items: activitiesData,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("Error updating recent activity cache:", error);
    // Non-critical, don't throw
  }
}

// ============================================================================
// ENHANCED ARCHITECTURE: Indexed Cache Functions
// ============================================================================

/**
 * Update activity in indexed cache structure
 * Maintains byId, byPoints, byDate indexes
 */
async function updateActivityInCache(activityType, activityId, activityData) {
  try {
    // CRITICAL: Only cache 'active' activities in indexed cache
    // Inactive activities should not appear in pending missions
    // Default to 'active' if status is missing (for new activities)
    const status = activityData.status || 'active';
    if (status !== 'active') {
      // If activity is not active, remove it from indexed cache (if it exists)
      await removeActivityFromCache(activityType, activityId);
      return; // Don't add inactive activities to indexed cache
    }
    
    const points = activityData.totalPoints || activityData.points || 0;
    const date = activityData.createdAt?.toDate?.()?.toISOString().split('T')[0] || 
                 (activityData.createdAt ? new Date(activityData.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    
    const updates = {};
    
    // Update byId with full data
    // For tasks, ensure type field is always included
    const cacheData = {
      id: activityId,
      ...activityData,
      status: 'active', // Ensure status is set
      questionsCount: activityData.questions?.length || activityData.questionsCount || 0,
      // For forms, ensure formFields array and counts are included
      formFieldsCount: activityData.formFields?.length || activityData.formFieldsCount || 0
    };
    
    // Ensure task type is preserved (default to 'upload' if missing)
    if (activityType === 'tasks' && !cacheData.type) {
      cacheData.type = activityData.type || 'upload';
    }
    
    // For forms, ensure formFields array is preserved
    if (activityType === 'forms' && activityData.formFields) {
      cacheData.formFields = activityData.formFields;
    }
    
    updates[`cache/activities/${activityType}/byId/${activityId}`] = cacheData;
    
    // Update byPoints index
    updates[`cache/activities/${activityType}/byPoints/${points}/${activityId}`] = true;
    
    // Update byDate index
    updates[`cache/activities/${activityType}/byDate/${date}/${activityId}`] = true;
    
    // Update list array (need to read current list first)
    const listRef = rtdb.ref(`cache/activities/${activityType}/list`);
    const listSnap = await listRef.once('value');
    const currentList = listSnap.val() || [];
    
    if (!currentList.includes(activityId)) {
      updates[`cache/activities/${activityType}/list`] = [...currentList, activityId];
    }
    
    // Update metadata version
    const metadataRef = rtdb.ref(`cache/activities/${activityType}/metadata`);
    const metadataSnap = await metadataRef.once('value');
    const currentMetadata = metadataSnap.val() || { version: 0, count: 0 };
    
    updates[`cache/activities/${activityType}/metadata`] = {
      lastUpdated: Date.now(),
      version: (currentMetadata.version || 0) + 1,
      count: currentList.length + (currentList.includes(activityId) ? 0 : 1)
    };
    
    await rtdb.ref().update(updates);
  } catch (error) {
    console.error(`Error updating ${activityType} in indexed cache:`, error);
    throw error;
  }
}

/**
 * Update activity indexes when data changes
 * Handles moving items between indexes (e.g., points change)
 */
async function updateActivityIndexes(activityType, activityId, oldData, newData) {
  try {
    const oldPoints = oldData.totalPoints || oldData.points || 0;
    const newPoints = newData.totalPoints || newData.points || 0;
    const oldDate = oldData.createdAt?.toDate?.()?.toISOString().split('T')[0] || 
                   (oldData.createdAt ? new Date(oldData.createdAt).toISOString().split('T')[0] : null);
    const newDate = newData.createdAt?.toDate?.()?.toISOString().split('T')[0] || 
                   (newData.createdAt ? new Date(newData.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    
    const updates = {};
    
    // Update byPoints index if points changed
    if (oldPoints !== newPoints) {
      // Remove from old points index
      if (oldPoints > 0) {
        updates[`cache/activities/${activityType}/byPoints/${oldPoints}/${activityId}`] = null;
      }
      // Add to new points index
      updates[`cache/activities/${activityType}/byPoints/${newPoints}/${activityId}`] = true;
    }
    
    // Update byDate index if date changed
    if (oldDate && oldDate !== newDate) {
      updates[`cache/activities/${activityType}/byDate/${oldDate}/${activityId}`] = null;
      updates[`cache/activities/${activityType}/byDate/${newDate}/${activityId}`] = true;
    }
    
    if (Object.keys(updates).length > 0) {
      await rtdb.ref().update(updates);
    }
  } catch (error) {
    console.error(`Error updating ${activityType} indexes:`, error);
    // Non-critical, don't throw
  }
}

/**
 * Remove activity from all indexes
 */
async function removeActivityFromCache(activityType, activityId) {
  try {
    // Get current activity data to know which indexes to clean
    const activityRef = rtdb.ref(`cache/activities/${activityType}/byId/${activityId}`);
    const activitySnap = await activityRef.once('value');
    
    if (!activitySnap.exists()) {
      return; // Already removed
    }
    
    const activityData = activitySnap.val();
    const points = activityData.totalPoints || activityData.points || 0;
    const date = activityData.createdAt?.toDate?.()?.toISOString().split('T')[0] || 
                 (activityData.createdAt ? new Date(activityData.createdAt).toISOString().split('T')[0] : null);
    
    const updates = {};
    
    // Remove from byId
    updates[`cache/activities/${activityType}/byId/${activityId}`] = null;
    
    // Remove from byPoints
    if (points > 0) {
      updates[`cache/activities/${activityType}/byPoints/${points}/${activityId}`] = null;
    }
    
    // Remove from byDate
    if (date) {
      updates[`cache/activities/${activityType}/byDate/${date}/${activityId}`] = null;
    }
    
    // Remove from list
    const listRef = rtdb.ref(`cache/activities/${activityType}/list`);
    const listSnap = await listRef.once('value');
    const currentList = listSnap.val() || [];
    const updatedList = currentList.filter(id => id !== activityId);
    updates[`cache/activities/${activityType}/list`] = updatedList;
    
    // Update metadata
    const metadataRef = rtdb.ref(`cache/activities/${activityType}/metadata`);
    const metadataSnap = await metadataRef.once('value');
    const currentMetadata = metadataSnap.val() || { version: 0, count: 0 };
    
    updates[`cache/activities/${activityType}/metadata`] = {
      lastUpdated: Date.now(),
      version: (currentMetadata.version || 0) + 1,
      count: updatedList.length
    };
    
    await rtdb.ref().update(updates);
  } catch (error) {
    console.error(`Error removing ${activityType} from indexed cache:`, error);
    throw error;
  }
}

/**
 * Get activities from indexed cache (helper for pre-compute functions)
 */
async function getActivitiesFromIndexedCache() {
  try {
    const [quizzesSnap, tasksSnap, formsSnap] = await Promise.all([
      rtdb.ref('cache/activities/quizzes/byId').once('value'),
      rtdb.ref('cache/activities/tasks/byId').once('value'),
      rtdb.ref('cache/activities/forms/byId').once('value')
    ]);
    
    // CRITICAL: Filter to only include 'active' activities
    // This ensures inactive activities don't appear in pending missions
    const filterActive = (activities) => {
      return Object.values(activities || {}).filter(activity => {
        const status = activity.status || 'inactive';
        return status === 'active';
      });
    };
    
    return {
      quizzes: filterActive(quizzesSnap.val()),
      tasks: filterActive(tasksSnap.val()),
      forms: filterActive(formsSnap.val())
    };
  } catch (error) {
    console.error("Error getting activities from indexed cache:", error);
    return { quizzes: [], tasks: [], forms: [] };
  }
}

/**
 * Get completion status from cache (helper for pre-compute functions)
 */
async function getCompletionStatusFromCache(userId) {
  try {
    const completionSnap = await rtdb.ref(`cache/users/${userId}/completions`).once('value');
    return completionSnap.val() || { quizzes: {}, tasks: {}, forms: {} };
  } catch (error) {
    console.error(`Error getting completion status for ${userId}:`, error);
    return { quizzes: {}, tasks: {}, forms: {} };
  }
}

// ============================================================================
// ENHANCED ARCHITECTURE: Pre-Compute Functions
// ============================================================================

/**
 * Pre-compute user activity lists (pending and completed)
 * This is the core function that creates pre-computed filtered views
 * @param {string} userId - User ID
 * @param {Array<string>} excludeActivityIds - Optional array of activity IDs to explicitly exclude (for deleted activities)
 */
async function updateUserActivityLists(userId, excludeActivityIds = []) {
  try {
    
    // Fetch from indexed cache (not Firestore)
    const activities = await getActivitiesFromIndexedCache();
    const completion = await getCompletionStatusFromCache(userId);
    
    // CRITICAL: Explicitly filter out deleted activities
    // This ensures that even if RTDB hasn't fully propagated the deletion,
    // we won't include deleted tasks in the user's pending list
    if (excludeActivityIds.length > 0) {
      activities.quizzes = activities.quizzes.filter(q => !excludeActivityIds.includes(q.id));
      activities.tasks = activities.tasks.filter(t => !excludeActivityIds.includes(t.id));
      activities.forms = activities.forms.filter(f => !excludeActivityIds.includes(f.id));
    }
    
    
    // PRE-COMPUTE: Pending activities
    // Rules:
    // - Quizzes: Show if NOT in completion status
    // - Tasks: Show if NOT in completion status OR status is 'rejected' (can resubmit)
    // - Forms: Show if NOT in completion status
    const pending = {
      quizzes: activities.quizzes.filter(q => {
        // Show if not completed - check by quiz ID
        const isCompleted = completion.quizzes && completion.quizzes[q.id];
        if (isCompleted) {
        }
        return !isCompleted;
      }),
      tasks: activities.tasks.filter(t => {
        const taskCompletion = completion.tasks?.[t.id];
        if (!taskCompletion) {
          // Not submitted yet, show in pending
          return true;
        }
        // Only show if rejected (can resubmit)
        // Don't show if pending (submitted, waiting review) or approved (completed)
        return taskCompletion.status === 'rejected';
      }),
      forms: activities.forms.filter(f => {
        // Show if not completed
        return !completion.forms || !completion.forms[f.id];
      }),
      combined: []
    };
    
    // PRE-COMPUTE: Completed activities (with completion data merged)
    // Rules:
    // - Quizzes: Show if in completion status
    // - Tasks: Show only if status is 'approved' (completed)
    // - Forms: Show if in completion status
    const completed = {
      quizzes: activities.quizzes
        .filter(q => {
          const isCompleted = completion.quizzes && completion.quizzes[q.id];
          if (isCompleted) {
          }
          return isCompleted;
        })
        .map(q => {
          const completionData = completion.quizzes[q.id] || {};
          return { 
            ...q, 
            ...completionData, 
            itemType: 'quiz', 
            completed: true,
            id: q.id // Ensure ID is preserved
          };
        }),
      tasks: activities.tasks
        .filter(t => {
          const taskCompletion = completion.tasks?.[t.id];
          // Only show approved tasks in completed list
          return taskCompletion && taskCompletion.status === 'approved';
        })
        .map(t => ({ ...t, ...completion.tasks[t.id], itemType: 'task', completed: true })),
      forms: activities.forms
        .filter(f => completion.forms && completion.forms[f.id])
        .map(f => ({ ...f, ...completion.forms[f.id], itemType: 'form', completed: true })),
      combined: []
    };
    
    // Combine for "All" tab
    pending.combined = [
      ...pending.quizzes.map(q => ({ ...q, itemType: 'quiz' })),
      ...pending.tasks.map(t => ({ ...t, itemType: 'task' })),
      ...pending.forms.map(f => ({ ...f, itemType: 'form' }))
    ];
    
    completed.combined = [
      ...completed.quizzes,
      ...completed.tasks,
      ...completed.forms
    ].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
    
    // Get current metadata version
    const metadataRef = rtdb.ref(`cache/users/${userId}/pendingActivities/metadata`);
    const metadataSnap = await metadataRef.once('value');
    const currentVersion = metadataSnap.val()?.version || 0;
    
    // Store in RTDB
    await rtdb.ref(`cache/users/${userId}`).update({
      'pendingActivities': {
        quizzes: pending.quizzes,
        tasks: pending.tasks,
        forms: pending.forms,
        combined: pending.combined,
        metadata: { 
          lastUpdated: Date.now(), 
          version: currentVersion + 1,
          counts: {
            quizzes: pending.quizzes.length,
            tasks: pending.tasks.length,
            forms: pending.forms.length,
            combined: pending.combined.length
          }
        }
      },
      'completedActivities': {
        quizzes: completed.quizzes,
        tasks: completed.tasks,
        forms: completed.forms,
        combined: completed.combined,
        metadata: { 
          lastUpdated: Date.now(), 
          version: currentVersion + 1,
          counts: {
            quizzes: completed.quizzes.length,
            tasks: completed.tasks.length,
            forms: completed.forms.length,
            combined: completed.combined.length
          }
        }
      }
    });
  } catch (error) {
    console.error(`Error updating user activity lists for ${userId}:`, error);
    throw error;
  }
}

/**
 * Batch update helper: Trigger pre-compute updates for all users
 * Non-blocking, processes in batches
 * Falls back to Firestore if directory cache is empty
 */
async function triggerUserActivityListUpdates(activityId = null, activityType = null) {
  try {
    // Get all active user IDs from directory cache
    const directorySnap = await rtdb.ref('cache/users/directory').once('value');
    const directoryData = directorySnap.val() || {};
    let userIds = Object.keys(directoryData).filter(key => key !== 'lastUpdated');
    
    // Fallback to Firestore if directory cache is empty
    if (userIds.length === 0) {
      const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .get();
      
      userIds = usersSnapshot.docs.map(doc => doc.id);
      
      if (userIds.length === 0) {
        return;
      }
      
      // Update directory cache in background (don't wait)
      updateAttendeeDirectoryCache().catch(err => {
        console.error("Failed to update directory cache:", err);
      });
    }
    
    // CRITICAL: If activityId is provided, explicitly exclude it from all user lists
    // This ensures deleted activities are never included, even if RTDB hasn't fully propagated
    const excludeIds = activityId ? [activityId] : [];
    
    // Update all users in parallel (not batches) - faster for smaller user bases
    // For larger user bases, this will still work but may hit rate limits
    await Promise.all(
      userIds.map(uid => 
        updateUserActivityLists(uid, excludeIds).catch(err => {
          console.error(`Failed to update lists for ${uid}:`, err);
          // Return null on error so Promise.all doesn't fail
          return null;
        })
      )
    );
    
    console.log(`Updated activity lists for ${userIds.length} users${excludeIds.length > 0 ? ` (excluded: ${excludeIds.join(', ')})` : ''}`);
    
  } catch (error) {
    console.error("Error triggering user activity list updates:", error);
    // Don't throw - this is called from other functions and we don't want to break them
  }
}

/**
 * Update submission lists in indexed and pre-computed cache
 * Maintains byTask, byForm, byQuiz, byStatus, byUser indexes and metadata
 */
async function updateSubmissionLists(submissionId, submissionData, changeType) {
  try {
    const { taskId, formId, quizId, userId, status } = submissionData;
    
    const updates = {};
    
    // Update indexed structure
    if (taskId) {
      updates[`cache/admin/submissions/byTask/${taskId}/${submissionId}`] = 
        changeType === 'delete' ? null : true;
    }
    if (formId) {
      updates[`cache/admin/submissions/byForm/${formId}/${submissionId}`] = 
        changeType === 'delete' ? null : true;
    }
    if (quizId) {
      updates[`cache/admin/submissions/byQuiz/${quizId}/${submissionId}`] = 
        changeType === 'delete' ? null : true;
    }
    if (status) {
      updates[`cache/admin/submissions/byStatus/${status}/${submissionId}`] = 
        changeType === 'delete' ? null : true;
    }
    if (userId) {
      updates[`cache/admin/submissions/byUser/${userId}/${submissionId}`] = 
        changeType === 'delete' ? null : true;
    }
    
    // PRE-COMPUTE: Submission metadata (for list view)
    if (changeType !== 'delete') {
      // Fetch task/form/quiz title for better display
      let taskTitle = submissionData.taskTitle || null;
      let formTitle = submissionData.formTitle || null;
      let quizTitle = submissionData.quizTitle || null;
      
      // If title not in submission data, fetch from task/form/quiz document
      if (!taskTitle && taskId) {
        try {
          const taskDoc = await db.collection('tasks').doc(taskId).get();
          if (taskDoc.exists) {
            taskTitle = taskDoc.data().title || null;
          }
        } catch (error) {
        }
      }
      
      if (!formTitle && formId) {
        try {
          const formDoc = await db.collection('forms').doc(formId).get();
          if (formDoc.exists) {
            formTitle = formDoc.data().title || null;
          }
        } catch (error) {
        }
      }
      
      if (!quizTitle && quizId) {
        try {
          const quizDoc = await db.collection('quizzes').doc(quizId).get();
          if (quizDoc.exists) {
            quizTitle = quizDoc.data().title || null;
          }
        } catch (error) {
        }
      }
      
      // Ensure status is always included and matches the byStatus path
      const finalStatus = status || submissionData.status || 'pending';
      updates[`cache/admin/submissions/metadata/${submissionId}`] = {
        id: submissionId,
        userId,
        userName: submissionData.userName || submissionData.name || 'Unknown',
        taskId: taskId || null,
        formId: formId || null,
        quizId: quizId || null,
        taskTitle: taskTitle || null,
        formTitle: formTitle || null,
        quizTitle: quizTitle || null,
        title: taskTitle || formTitle || quizTitle || null, // Generic title field
        type: submissionData.type || null, // 'upload' or 'form'
        fileURL: submissionData.fileURL || null, // For file uploads
        status: finalStatus, // Always use the final status to ensure consistency with byStatus path
        submittedAt: submissionData.submittedAt?.toMillis?.() || 
                    (submissionData.submittedAt ? new Date(submissionData.submittedAt).getTime() : Date.now()),
        points: submissionData.points || submissionData.pointsAwarded || 0
      };
    } else {
      updates[`cache/admin/submissions/metadata/${submissionId}`] = null;
    }
    
    if (Object.keys(updates).length > 0) {
      await rtdb.ref().update(updates);
    }
  } catch (error) {
    console.error(`Error updating submission lists for ${submissionId}:`, error);
    throw error;
  }
}

/**
 * Update user completion status in indexed cache
 */
async function updateUserCompletion(userId, activityType, activityId, completionData) {
  try {
    
    const updates = {};
    
    // Fix pluralization: quiz -> quizzes, task -> tasks, form -> forms
    const typePlural = activityType === 'quiz' ? 'quizzes' : `${activityType}s`;
    const completionPath = `cache/users/${userId}/completions/${typePlural}/${activityId}`;
    
    // Ensure all required fields are present
    updates[completionPath] = {
      completed: true,
      ...completionData,
      lastUpdated: Date.now()
    };
    
    await rtdb.ref().update(updates);
    
    // Trigger pre-compute update for this user
    await updateUserActivityLists(userId);
  } catch (error) {
    console.error(`[updateUserCompletion] Error updating user completion for ${userId}:`, error);
    throw error;
  }
}

/**
 * Update user stats in cache
 */
async function updateUserStats(userId) {
  try {
    // This will be handled by existing updateUserStatsCache function
    // But we'll also ensure it updates the new cache location
    await updateUserStatsCache(userId);
  } catch (error) {
    console.error(`Error updating user stats for ${userId}:`, error);
    // Non-critical
  }
}

/**
 * Update leaderboard incrementally (when points change)
 */
async function updateLeaderboardIncremental(userId, oldPoints, newPoints) {
  try {
    if (oldPoints === newPoints) return;
    
    // Update user rank
    await updateUserRank(userId, newPoints);
    
    // Update leaderboard cache
    await updateLeaderboardCache();
  } catch (error) {
    console.error(`Error updating leaderboard incrementally for ${userId}:`, error);
    // Non-critical
  }
}

/**
 * Refresh activities indexed cache from Firestore
 */
async function refreshActivitiesIndexedCache() {
  try {
    const [quizzesSnapshot, tasksSnapshot, formsSnapshot] = await Promise.all([
      db.collection("quizzes").where("status", "==", "active").get(),
      db.collection("tasks").where("status", "==", "active").get(),
      db.collection("forms").where("status", "==", "active").get()
    ]);
    
    // Update quizzes
    for (const doc of quizzesSnapshot.docs) {
      await updateActivityInCache('quizzes', doc.id, doc.data());
    }
    
    // Update tasks
    for (const doc of tasksSnapshot.docs) {
      await updateActivityInCache('tasks', doc.id, doc.data());
    }
    
    // Update forms
    for (const doc of formsSnapshot.docs) {
      await updateActivityInCache('forms', doc.id, doc.data());
    }
    
  } catch (error) {
    console.error("Error refreshing activities indexed cache:", error);
    throw error;
  }
}

/**
 * Refresh leaderboard cache
 */
async function refreshLeaderboardCache() {
  try {
    await updateLeaderboardCache();
  } catch (error) {
    console.error("Error refreshing leaderboard cache:", error);
    throw error;
  }
}

/**
 * Refresh admin stats cache
 */
async function refreshAdminStatsCache() {
  try {
    await updateAdminStatsCache();
  } catch (error) {
    console.error("Error refreshing admin stats cache:", error);
    throw error;
  }
}

/**
 * Debounced user list update queue
 */
const updateQueue = new Map();

/**
 * Debounced user list update to prevent excessive calls
 */
async function debouncedUserListUpdate(userId, delay = 5000) {
  if (updateQueue.has(userId)) {
    clearTimeout(updateQueue.get(userId));
  }
  
  const timeoutId = setTimeout(async () => {
    try {
      await updateUserActivityLists(userId);
      updateQueue.delete(userId);
    } catch (error) {
      console.error(`Error in debounced update for ${userId}:`, error);
      updateQueue.delete(userId);
    }
  }, delay);
  
  updateQueue.set(userId, timeoutId);
}

/**
 * Scheduled cache refresh function
 * Runs every 15 minutes to ensure cache consistency
 */
exports.scheduledCacheRefresh = onSchedule(
    {
      schedule: "*/15 * * * *", // Every 15 minutes
      region: region,
      timeZone: "UTC"
    },
    async (event) => {
      
      try {
        // Refresh indexed caches
        await Promise.all([
          refreshActivitiesIndexedCache(),
          refreshLeaderboardCache(),
          refreshAdminStatsCache()
        ]);
        
        // Refresh pre-computed lists for all users (in batches)
        await triggerUserActivityListUpdates();
        
      } catch (error) {
        console.error("Error in scheduled cache refresh:", error);
        // Don't throw - scheduled functions should not fail silently
      }
    }
);

/**
 * Triggered when a user document is created or updated
 */
exports.onUserUpdate = onDocumentUpdated(
    {
      document: "users/{uid}",
      region: region,
    },
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();
      const uid = event.params.uid;

      // Only process attendee users
      if (after.role !== "attendee") {
        return null;
      }

      const updates = [];

      // Check if points changed
      const pointsChanged = (before.points || 0) !== (after.points || 0);
      if (pointsChanged) {
        updates.push(updateLeaderboardCache());
        updates.push(updateUserRank(uid, after.points || 0));
      }

      // Check if user data changed (affects admin cache)
      const userDataChanged =
          (before.name !== after.name) ||
          (before.email !== after.email) ||
          (before.district !== after.district) ||
          (before.designation !== after.designation) ||
          (before.status !== after.status);

      // Check if points changed (affects stats)
      if (pointsChanged || userDataChanged) {
        updates.push(updateAdminStatsCache());
      }

      if (userDataChanged) {
        updates.push(updateAdminParticipantsCache());
        updates.push(updateAttendeeDirectoryCache()); // Also update attendee directory cache
        
        // Update email cache if email changed
        if (before.email !== after.email) {
          if (before.email) {
            updates.push(updateEmailCache(before.email, uid, "active", true));
          }
          if (after.email) {
            updates.push(updateEmailCache(after.email, uid, "active"));
          }
        }
      }

      // Update attendee caches
      if (pointsChanged || userDataChanged) {
        updates.push(updateUserStatsCache(uid));
        if (pointsChanged) {
          updates.push(updateAttendeeDirectoryCache()); // Update directory when points change
        }
      }
      
      // If user status changed to 'active', generate activity lists (new users start as 'pending')
      if (before.status !== after.status && after.status === 'active') {
        updates.push(updateUserActivityLists(uid));
      }

      await Promise.all(updates);
      return null;
    }
);

/**
 * Triggered when a user document is created
 */
exports.onUserCreate = onDocumentCreated(
    {
      document: "users/{uid}",
      region: region,
    },
    async (event) => {
      const userData = event.data.data();
      const uid = event.params.uid;

      // Only process attendee users
      if (userData.role !== "attendee") {
        return null;
      }

      const updates = [
        updateLeaderboardCache(),
        updateAdminParticipantsCache(),
        updateAttendeeDirectoryCache(), // Also update attendee directory cache
        updateAdminStatsCache(),
        updateUserRank(uid, userData.points || 0),
        updateUserStatsCache(uid),
        updateUserCompletionStatusCache(uid),
        // Generate pre-computed activity lists for the new user
        updateUserActivityLists(uid),
      ];

      if (userData.email) {
        updates.push(updateEmailCache(userData.email, uid, "active"));
      }

      await Promise.all(updates);
      return null;
    }
);

/**
 * Triggered when a pendingUser document is created
 */
exports.onPendingUserCreate = onDocumentCreated(
    {
      document: "pendingUsers/{email}",
      region: region,
    },
    async (event) => {
      const pendingData = event.data.data();
      const email = event.params.email;

      const updates = [
        updateAdminParticipantsCache(),
        updateAdminStatsCache(),
        updateEmailCache(email, null, "pending"),
      ];

      await Promise.all(updates);
      return null;
    }
);

/**
 * Triggered when a pendingUser document is updated
 */
exports.onPendingUserUpdate = onDocumentUpdated(
    {
      document: "pendingUsers/{email}",
      region: region,
    },
    async (event) => {
      const updates = [
        updateAdminParticipantsCache(),
        updateAdminStatsCache(),
      ];
      await Promise.all(updates);
      return null;
    }
);

/**
 * Triggered when a pendingUser document is deleted
 */
exports.onPendingUserDelete = onDocumentDeleted(
    {
      document: "pendingUsers/{email}",
      region: region,
    },
    async (event) => {
      const email = event.params.email;

      const updates = [
        updateAdminParticipantsCache(),
        updateAdminStatsCache(),
        updateEmailCache(email, null, "pending", true),
      ];

      await Promise.all(updates);
      return null;
    }
);

/**
 * Triggered when an admin document is created
 */
exports.onAdminCreate = onDocumentCreated(
    {
      document: "admins/{uid}",
      region: region,
    },
    async (event) => {
      await syncAdminsToRTDB();
      return null;
    }
);

/**
 * Triggered when an admin document is updated
 */
exports.onAdminUpdate = onDocumentUpdated(
    {
      document: "admins/{uid}",
      region: region,
    },
    async (event) => {
      await syncAdminsToRTDB();
      return null;
    }
);

/**
 * Triggered when an admin document is deleted
 */
exports.onAdminDelete = onDocumentDeleted(
    {
      document: "admins/{uid}",
      region: region,
    },
    async (event) => {
      await syncAdminsToRTDB();
      return null;
    }
);

/**
 * Triggered when a submission document is created
 */
exports.onSubmissionCreate = onDocumentCreated(
    {
      document: "submissions/{submissionId}",
      region: region,
    },
    async (event) => {
      const submissionData = event.data.data();
      const { userId, taskId } = submissionData;
      
      // CRITICAL: Update user activity list FIRST (fastest path to remove from pending)
      // This ensures the card disappears from user's pending list as quickly as possible
      if (taskId) {
        // Update completion status and activity list in parallel with submission cache
        await Promise.all([
          updateSubmissionLists(event.params.submissionId, submissionData, 'create'),
          updateUserCompletion(userId, 'task', taskId, {
            completed: true,
            status: 'pending',
            submittedAt: submissionData.submittedAt?.toMillis?.() || 
                         (submissionData.submittedAt ? new Date(submissionData.submittedAt).getTime() : Date.now())
          })
          // Note: updateUserCompletion already calls updateUserActivityLists internally
        ]);
      } else {
        await updateSubmissionLists(event.params.submissionId, submissionData, 'create');
      }
      
      // Step 2: Update other caches in parallel (non-blocking for user experience)
      Promise.all([
        // Update user stats
        updateUserStats(userId),
        // Update admin caches
        updateAdminStatsCache(),
        updateRecentActivityCache(),
        updateSubmissionCountsCache(),
        // Update old caches (for backward compatibility)
        updateUserCompletionStatusCache(userId),
        taskId ? updateTasksCache() : Promise.resolve()
      ]).catch(err => {
        console.error('Error updating secondary caches:', err);
        // Don't throw - user list is already updated
      });
      
      return null;
    }
);

/**
 * Triggered when a submission document is updated
 */
exports.onSubmissionUpdate = onDocumentUpdated(
    {
      document: "submissions/{submissionId}",
      region: region,
    },
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();
      const { userId, taskId } = after;
      
      const statusChanged = before.status !== after.status;
      const pointsChanged = (before.pointsAwarded || 0) !== (after.pointsAwarded || 0);
      
      // CRITICAL: Remove from old status path and update metadata BEFORE adding to new path
      // This ensures atomic cache updates and prevents submissions from appearing in wrong lists
      const statusUpdates = {};
      if (statusChanged && before.status) {
        // Remove from old status path immediately
        statusUpdates[`cache/admin/submissions/byStatus/${before.status}/${event.params.submissionId}`] = null;
        // Also update metadata status immediately to prevent cache mismatch
        statusUpdates[`cache/admin/submissions/metadata/${event.params.submissionId}/status`] = after.status;
      }
      
      // Apply status updates FIRST (remove from old path, update metadata)
      // This must happen before updateSubmissionLists to ensure atomic updates
      if (Object.keys(statusUpdates).length > 0) {
        await rtdb.ref().update(statusUpdates);
      }
      
      const updates = [
        // 1. Update indexed submission cache (this will add to new status path)
        // Note: This happens AFTER old path removal to ensure atomic updates
        updateSubmissionLists(event.params.submissionId, after, 'update'),
        // 2. Update admin caches
        updateAdminStatsCache(),
        updateRecentActivityCache()
      ];
      
      // Update user completion status if status changed
      if (statusChanged && taskId) {
        updates.push(updateUserCompletion(userId, 'task', taskId, {
          status: after.status,
          submittedAt: after.submittedAt?.toMillis?.() || 
                      (after.submittedAt ? new Date(after.submittedAt).getTime() : Date.now())
        }));
      }
      
      // Update user stats if points changed
      if (pointsChanged) {
        updates.push(updateUserStats(userId));
      }
      
      // PRE-COMPUTE: Update user activity lists if status changed
      if (statusChanged) {
        updates.push(updateUserActivityLists(userId));
      }
      
      // Update leaderboard if points changed
      if (pointsChanged) {
        updates.push(updateLeaderboardIncremental(userId, before.pointsAwarded || 0, after.pointsAwarded || 0));
      }
      
      // Update old caches (for backward compatibility)
      if (statusChanged) {
        updates.push(updateSubmissionCountsCache());
        updates.push(updateUserCompletionStatusCache(userId));
        updates.push(updateUserStatsCache(userId));
        
        // Create notification for status change
        if (after.status === 'approved') {
          const taskDoc = await db.collection('tasks').doc(taskId).get();
          const taskTitle = taskDoc.exists ? taskDoc.data().title : 'Task';
          updateUserNotificationCache(userId, {
            type: 'submission_approved',
            title: 'Submission Approved!',
            message: `Your submission for "${taskTitle}" has been approved. Points awarded!`,
            points: after.pointsAwarded || 0
          });
        } else if (after.status === 'rejected') {
          const taskDoc = await db.collection('tasks').doc(taskId).get();
          const taskTitle = taskDoc.exists ? taskDoc.data().title : 'Task';
          updateUserNotificationCache(userId, {
            type: 'submission_rejected',
            title: 'Submission Rejected',
            message: `Your submission for "${taskTitle}" was rejected. You can resubmit.`
          });
        }
      }
      
      await Promise.all(updates);
      return null;
    }
);

/**
 * Triggered when a submission document is deleted
 */
exports.onSubmissionDelete = onDocumentDeleted(
    {
      document: "submissions/{submissionId}",
      region: region,
    },
    async (event) => {
      const submissionData = event.data.data();
      const { userId, taskId } = submissionData;
      
      await Promise.all([
        // 1. Remove from indexed submission cache
        updateSubmissionLists(event.params.submissionId, submissionData, 'delete'),
        // 2. Update user completion status if needed
        taskId && userId ? updateUserCompletion(userId, 'task', taskId, {
          completed: false,
          status: null
        }) : Promise.resolve(),
        // 3. PRE-COMPUTE: Update user activity lists
        userId ? updateUserActivityLists(userId) : Promise.resolve(),
        // 4. Update admin caches
        updateAdminStatsCache(),
        updateSubmissionCountsCache()
      ]);
      return null;
    }
);

/**
 * Triggered when a user document is deleted
 */
exports.onUserDelete = onDocumentDeleted(
    {
      document: "users/{uid}",
      region: region,
    },
    async (event) => {
      const deletedUserData = event.data.data();
      const uid = event.params.uid;
      
      const updates = [
        updateLeaderboardCache(),
        updateAdminParticipantsCache(),
        updateAttendeeDirectoryCache(), // Clear from directory cache
        updateAdminStatsCache(),
      ];
      
      // Clear email cache if email exists
      if (deletedUserData && deletedUserData.email) {
        updates.push(updateEmailCache(deletedUserData.email, uid, "active", true));
      }
      
      await Promise.all(updates);
      return null;
    }
);

/**
 * Update quizzes cache when quiz submissions change
 */
exports.onQuizSubmissionCreate = onDocumentCreated(
    {
      document: "quizSubmissions/{submissionId}",
      region: region,
    },
    async (event) => {
      const submissionData = event.data.data();
      const { userId, quizId } = submissionData;
      
      
      // Extract timestamp correctly (handle both Firestore Timestamp and Date)
      let submittedAtTimestamp = Date.now();
      if (submissionData.submittedAt) {
        if (submissionData.submittedAt.toMillis) {
          // Firestore Timestamp
          submittedAtTimestamp = submissionData.submittedAt.toMillis();
        } else if (submissionData.submittedAt.getTime) {
          // JavaScript Date
          submittedAtTimestamp = submissionData.submittedAt.getTime();
        } else if (typeof submissionData.submittedAt === 'number') {
          // Already a timestamp
          submittedAtTimestamp = submissionData.submittedAt;
        } else if (submissionData.completedAt) {
          // Fallback to completedAt
          if (submissionData.completedAt.toMillis) {
            submittedAtTimestamp = submissionData.completedAt.toMillis();
          } else if (submissionData.completedAt.getTime) {
            submittedAtTimestamp = submissionData.completedAt.getTime();
          }
        }
      }
      
      const score = submissionData.score || submissionData.totalScore || 0;
      
      
      // CRITICAL: Update user activity list FIRST (fastest path to remove from pending)
      // This ensures the card disappears from user's pending list as quickly as possible
      await Promise.all([
        updateSubmissionLists(event.params.submissionId, {
          ...submissionData,
          quizId: quizId,
          status: 'completed',
          pointsAwarded: score
        }, 'create'),
        updateUserCompletion(userId, 'quiz', quizId, {
          completed: true,
          submittedAt: submittedAtTimestamp,
          points: score,
          score: score // Include both for consistency
        })
        // Note: updateUserCompletion already calls updateUserActivityLists internally
      ]);
      
      // Step 2: Update other caches in parallel (non-blocking for user experience)
      Promise.all([
        // Update user stats
        updateUserStats(userId),
        // Update admin caches
        updateQuizzesCache(),
        updateRecentActivityCache(),
        // Update old caches (for backward compatibility)
        updateUserCompletionStatusCache(userId),
        updateUserStatsCache(userId)
      ]).catch(err => {
        console.error('Error updating secondary caches:', err);
        // Don't throw - user list is already updated
      });
      
      // Step 4: Create notification for quiz completion (separate to ensure it completes)
      try {
        const quizDoc = await db.collection('quizzes').doc(quizId).get();
        const quizData = quizDoc.exists ? quizDoc.data() : null;
        const quizTitle = quizData?.title || 'Quiz';
        const score = submissionData.score || submissionData.totalScore || 0;
        const totalScore = submissionData.totalScore || submissionData.totalPoints || 0;
        
        
        await updateUserNotificationCache(userId, {
          type: 'quiz_completed',
          title: 'Quiz Completed!',
          message: `You scored ${score}/${totalScore} on "${quizTitle}"`,
          points: score
        });
        
      } catch (error) {
        console.error('Error creating quiz completion notification:', error);
        // Non-critical, don't throw
      }
      return null;
    }
);

/**
 * Update forms cache when form submissions change
 */
exports.onFormSubmissionCreate = onDocumentCreated(
    {
      document: "formSubmissions/{submissionId}",
      region: region,
    },
    async (event) => {
      const submissionData = event.data.data();
      const { userId, formId } = submissionData;
      
      // Step 1: Update indexed submission cache
      await updateSubmissionLists(event.params.submissionId, {
        ...submissionData,
        formId: formId,
        status: 'completed'
      }, 'create');
      
      // Step 2: Update user completion status (indexed) - MUST complete before updating lists
      await updateUserCompletion(userId, 'form', formId, {
        completed: true,
        submittedAt: submissionData.submittedAt?.toMillis?.() || 
                     (submissionData.submittedAt ? new Date(submissionData.submittedAt).getTime() : Date.now())
      });
      // Note: updateUserCompletion already calls updateUserActivityLists internally
      
      // Step 3: Update other caches in parallel
      await Promise.all([
        // Update user stats
        updateUserStats(userId),
        // Update admin caches
        updateFormsCache(),
        updateRecentActivityCache(),
        updateSubmissionCountsCache(),
        // Update old caches (for backward compatibility)
        updateUserCompletionStatusCache(userId),
        updateUserStatsCache(userId)
      ]);
      
      // Step 4: Create notification for form completion (separate to ensure it completes)
      try {
        const formDoc = await db.collection('forms').doc(formId).get();
        const formData = formDoc.exists ? formDoc.data() : null;
        const formTitle = formData?.title || 'Form';
        const points = formData?.points || 0;
        
        
        await updateUserNotificationCache(userId, {
          type: 'form_completed',
          title: 'Form Submitted!',
          message: points > 0 
            ? `You submitted "${formTitle}" and earned ${points} points!`
            : `You submitted "${formTitle}" successfully!`,
          points: points
        });
        
      } catch (error) {
        console.error('Error creating form completion notification:', error);
        // Non-critical, don't throw
      }
      
      return null;
    }
);

/**
 * Triggered when a quiz document is created
 */
exports.onQuizCreate = onDocumentCreated(
    {
      document: "quizzes/{quizId}",
      region: region,
    },
    async (event) => {
      const quizData = event.data.data();
      const quizId = event.params.quizId;
      
      // Step 1: Update all caches in parallel (no verification needed - RTDB writes are atomic)
      await Promise.all([
        updateActivityInCache('quizzes', quizId, quizData),
        updateQuizzesCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      
      // Step 2: Trigger user list updates for all users in parallel
      await triggerUserActivityListUpdates(null, 'quizzes');
      
      console.log(`Quiz ${quizId} created and user lists updated for all users`);
      return null;
    }
);

/**
 * Triggered when a quiz document is updated
 */
exports.onQuizUpdate = onDocumentUpdated(
    {
      document: "quizzes/{quizId}",
      region: region,
    },
    async (event) => {
      const oldData = event.data.before.data();
      const newData = event.data.after.data();
      const quizId = event.params.quizId;
      
      // Step 1: Update all caches in parallel
      await Promise.all([
        updateActivityInCache('quizzes', quizId, newData),
        updateActivityIndexes('quizzes', quizId, oldData, newData),
        updateQuizzesCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      
      // Step 2: Trigger pre-compute updates if status or points changed
      // This is critical - when status changes to 'active', users need to see it
      // When status changes to 'inactive', users need it removed
      if (oldData.status !== newData.status || oldData.totalPoints !== newData.totalPoints) {
        // If status changed to active, don't exclude (it's being added)
        // If status changed to inactive, exclude it (it's being removed)
        const excludeId = newData.status !== 'active' ? quizId : null;
        await triggerUserActivityListUpdates(excludeId, 'quizzes');
      }
      
      return null;
    }
);

/**
 * Triggered when a quiz document is deleted
 */
exports.onQuizDelete = onDocumentDeleted(
    {
      document: "quizzes/{quizId}",
      region: region,
    },
    async (event) => {
      const quizId = event.params.quizId;
      
      // Find all quiz submissions for this quiz so we can clean up
      const submissionsSnapshot = await db.collection("quizSubmissions")
        .where("quizId", "==", quizId)
        .get();
      
      const affectedUserIds = new Set();
      const batch = db.batch();
      submissionsSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.userId) {
          affectedUserIds.add(data.userId);
        }
        batch.delete(doc.ref);
      });
      if (!submissionsSnapshot.empty) {
        await batch.commit();
      }

      // Step 1: Remove from indexed structure and update caches
      await Promise.all([
        removeActivityFromCache('quizzes', quizId),
        updateQuizzesCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);

      // Step 2: Update user activity lists for affected users first (they had submissions)
      // CRITICAL: Pass quizId to explicitly exclude it from the list
      const affectedUserUpdates = Array.from(affectedUserIds).map(uid => 
        Promise.all([
          updateUserCompletionStatusCache(uid),
          updateUserStatsCache(uid),
          updateUserActivityLists(uid, [quizId]) // Explicitly exclude deleted quiz
        ]).catch(err => {
          console.error(`Failed to update user ${uid} after quiz deletion:`, err);
        })
      );
      await Promise.all(affectedUserUpdates);

      // Step 3: Trigger pre-compute updates for ALL users (to remove quiz from pending lists)
      await triggerUserActivityListUpdates(quizId, 'quizzes');
      
      return null;
    }
);

/**
 * Triggered when a task document is created
 */
exports.onTaskCreate = onDocumentCreated(
    {
      document: "tasks/{taskId}",
      region: region,
    },
    async (event) => {
      const taskData = event.data.data();
      const taskId = event.params.taskId;
      
      // Step 1: Update all caches in parallel (no verification needed - RTDB writes are atomic)
      await Promise.all([
        updateActivityInCache('tasks', taskId, taskData),
        updateTasksCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      
      // Step 2: Trigger user list updates for all users in parallel
      await triggerUserActivityListUpdates(null, 'tasks');
      
      console.log(`Task ${taskId} created and user lists updated for all users`);
      return null;
    }
);

/**
 * Triggered when a task document is updated
 */
exports.onTaskUpdate = onDocumentUpdated(
    {
      document: "tasks/{taskId}",
      region: region,
    },
    async (event) => {
      const oldData = event.data.before.data();
      const newData = event.data.after.data();
      const taskId = event.params.taskId;
      
      // Step 1: Update all caches in parallel
      await Promise.all([
        updateActivityInCache('tasks', taskId, newData),
        updateActivityIndexes('tasks', taskId, oldData, newData),
        updateTasksCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      
      // Step 2: Trigger pre-compute updates if status or points changed
      // This is critical - when status changes to 'active', users need to see it
      // When status changes to 'inactive', users need it removed
      if (oldData.status !== newData.status || oldData.points !== newData.points) {
        // If status changed to active, don't exclude (it's being added)
        // If status changed to inactive, exclude it (it's being removed)
        const excludeId = newData.status !== 'active' ? taskId : null;
        await triggerUserActivityListUpdates(excludeId, 'tasks');
      }
      
      return null;
    }
);

/**
 * Triggered when a task document is deleted
 */
exports.onTaskDelete = onDocumentDeleted(
    {
      document: "tasks/{taskId}",
      region: region,
    },
    async (event) => {
      const taskId = event.params.taskId;
      
      // Delete all submissions for this task
      const submissionsSnapshot = await db.collection("submissions")
        .where("taskId", "==", taskId)
        .get();
      
      const affectedUserIds = new Set();
      if (!submissionsSnapshot.empty) {
        const batch = db.batch();
        submissionsSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.userId) {
            affectedUserIds.add(data.userId);
          }
          batch.delete(doc.ref);
        });
        await batch.commit();
      }

      // Step 1: Remove from indexed structure and update caches
      await Promise.all([
        removeActivityFromCache('tasks', taskId),
        updateTasksCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);

      // Verify the task is removed from indexed cache before updating user lists
      const verifyRef = rtdb.ref(`cache/activities/tasks/byId/${taskId}`);
      const verifySnap = await verifyRef.once('value');
      if (verifySnap.exists()) {
        console.warn(`Task ${taskId} still exists in indexed cache after removal attempt. Retrying...`);
        // Retry removal
        await removeActivityFromCache('tasks', taskId);
      }

      // Step 2: Update user activity lists for affected users first (they had submissions)
      // CRITICAL: Pass taskId to explicitly exclude it from the list
      const affectedUserUpdates = Array.from(affectedUserIds).map(uid => 
        Promise.all([
          updateUserCompletionStatusCache(uid),
          updateUserStatsCache(uid),
          updateUserActivityLists(uid, [taskId]) // Explicitly exclude deleted task
        ]).catch(err => {
          console.error(`Failed to update user ${uid} after task deletion:`, err);
        })
      );
      await Promise.all(affectedUserUpdates);

      // Step 3: Trigger pre-compute updates for ALL users (to remove task from pending lists)
      // This is critical - even users without submissions need their pending lists updated
      await triggerUserActivityListUpdates(taskId, 'tasks');
      
      console.log(`Task ${taskId} deleted and user lists updated for all users`);
      
      return null;
    }
);

/**
 * Triggered when a form document is created
 */
exports.onFormCreate = onDocumentCreated(
    {
      document: "forms/{formId}",
      region: region,
    },
    async (event) => {
      const formData = event.data.data();
      const formId = event.params.formId;
      
      // Step 1: Update all caches in parallel (no verification needed - RTDB writes are atomic)
      await Promise.all([
        updateActivityInCache('forms', formId, formData),
        updateFormsCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      
      // Step 2: Trigger user list updates for all users in parallel
      await triggerUserActivityListUpdates(null, 'forms');
      
      console.log(`Form ${formId} created and user lists updated for all users`);
      return null;
    }
);

/**
 * Triggered when a form document is updated
 */
exports.onFormUpdate = onDocumentUpdated(
    {
      document: "forms/{formId}",
      region: region,
    },
    async (event) => {
      const oldData = event.data.before.data();
      const newData = event.data.after.data();
      const formId = event.params.formId;
      
      // Step 1: Update all caches in parallel
      await Promise.all([
        updateActivityInCache('forms', formId, newData),
        updateActivityIndexes('forms', formId, oldData, newData),
        updateFormsCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      
      // Step 2: Trigger pre-compute updates if status or points changed
      // This is critical - when status changes to 'active', users need to see it
      // When status changes to 'inactive', users need it removed
      if (oldData.status !== newData.status || oldData.points !== newData.points) {
        // If status changed to active, don't exclude (it's being added)
        // If status changed to inactive, exclude it (it's being removed)
        const excludeId = newData.status !== 'active' ? formId : null;
        await triggerUserActivityListUpdates(excludeId, 'forms');
      }
      
      return null;
    }
);

/**
 * Triggered when a form document is deleted
 */
exports.onFormDelete = onDocumentDeleted(
    {
      document: "forms/{formId}",
      region: region,
    },
    async (event) => {
      const formId = event.params.formId;
      
      // Delete all submissions for this form
      const submissionsSnapshot = await db.collection("formSubmissions")
        .where("formId", "==", formId)
        .get();
      
      const affectedUserIds = new Set();
      const batch = db.batch();
      submissionsSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.userId) {
          affectedUserIds.add(data.userId);
        }
        batch.delete(doc.ref);
      });
      if (!submissionsSnapshot.empty) {
        await batch.commit();
      }

      // Step 1: Remove from indexed structure and update caches
      await Promise.all([
        removeActivityFromCache('forms', formId),
        updateFormsCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);

      // Step 2: Update user activity lists for affected users first (they had submissions)
      // CRITICAL: Pass formId to explicitly exclude it from the list
      const affectedUserUpdates = Array.from(affectedUserIds).map(uid => 
        Promise.all([
          updateUserCompletionStatusCache(uid),
          updateUserStatsCache(uid),
          updateUserActivityLists(uid, [formId]) // Explicitly exclude deleted form
        ]).catch(err => {
          console.error(`Failed to update user ${uid} after form deletion:`, err);
        })
      );
      await Promise.all(affectedUserUpdates);

      // Step 3: Trigger pre-compute updates for ALL users (to remove form from pending lists)
      await triggerUserActivityListUpdates(formId, 'forms');
      
      return null;
    }
);

/**
 * Update user notification cache in RTDB
 * Creates notifications for status changes, points awarded, etc.
 */
async function updateUserNotificationCache(userId, notification) {
  if (!userId || !notification) return;
  
  try {
    const notificationsRef = rtdb.ref(`attendeeCache/notifications/${userId}`);
    const notificationsSnap = await notificationsRef.once("value");
    
    const notifications = notificationsSnap.exists() ? notificationsSnap.val() : {};
    const notificationId = Date.now().toString();
    
    notifications[notificationId] = {
      ...notification,
      id: notificationId,
      timestamp: Date.now(),
      read: false
    };
    
    // Keep only last 50 notifications
    const notificationArray = Object.values(notifications);
    notificationArray.sort((a, b) => b.timestamp - a.timestamp);
    const recentNotifications = notificationArray.slice(0, 50);
    
    const notificationsData = {};
    recentNotifications.forEach(n => {
      notificationsData[n.id] = n;
    });
    
    await notificationsRef.set(notificationsData);
  } catch (error) {
    console.error(`Error updating notification cache for ${userId}:`, error);
    // Non-critical, don't throw
  }
}

/**
 * HTTP function to manually sync admins to RTDB
 * Call this after creating your first admin: https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/syncAdmins
 */
exports.syncAdmins = onRequest(
    {
      region: region,
      cors: true, // Enable CORS for browser access
    },
    async (req, res) => {
      // Set CORS headers
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      
      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      
      try {
        await syncAdminsToRTDB();
        res.status(200).send("Admins synced to RTDB successfully");
      } catch (error) {
        console.error("Error syncing admins:", error);
        res.status(500).send("Error syncing admins: " + error.message);
      }
    }
);

/**
 * Callable function to sync admins to RTDB (more secure, requires auth)
 * Can be called from admin panel
 */
exports.syncAdminsCallable = onCall(
    {
      region: region,
    },
    async (request) => {
      // Only allow authenticated users
      if (!request.auth) {
        throw new Error("Unauthorized");
      }
      
      // Check if user is admin
      const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
      if (!adminDoc.exists) {
        throw new Error("Unauthorized: Admin access required");
      }
      
      await syncAdminsToRTDB();
      return { success: true, message: "Admins synced to RTDB successfully" };
    }
);

/**
 * Migration helper: Populate indexed activities structure
 */
async function migrateActivitiesIndexed() {
  
  try {
    // Migrate quizzes
    const quizzesSnapshot = await db.collection("quizzes")
        .where("status", "==", "active")
        .get();
    
    const quizzesIndexed = {
      byId: {},
      byPoints: {},
      byDate: {},
      list: [],
      metadata: {
        lastUpdated: Date.now(),
        version: 1,
        count: quizzesSnapshot.size
      }
    };
    
    quizzesSnapshot.forEach((doc) => {
      const data = doc.data();
      const quizId = doc.id;
      const points = data.totalPoints || 0;
      const date = data.createdAt?.toDate()?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0];
      
      quizzesIndexed.byId[quizId] = {
        id: quizId,
        ...data,
        questionsCount: data.questions?.length || 0
      };
      
      if (!quizzesIndexed.byPoints[points]) {
        quizzesIndexed.byPoints[points] = {};
      }
      quizzesIndexed.byPoints[points][quizId] = true;
      
      if (!quizzesIndexed.byDate[date]) {
        quizzesIndexed.byDate[date] = {};
      }
      quizzesIndexed.byDate[date][quizId] = true;
      
      quizzesIndexed.list.push(quizId);
    });
    
    await rtdb.ref("cache/activities/quizzes").set(quizzesIndexed);
    
    // Migrate tasks (similar structure)
    const tasksSnapshot = await db.collection("tasks")
        .where("status", "==", "active")
        .get();
    
    const tasksIndexed = {
      byId: {},
      byPoints: {},
      byDate: {},
      list: [],
      metadata: {
        lastUpdated: Date.now(),
        version: 1,
        count: tasksSnapshot.size
      }
    };
    
    tasksSnapshot.forEach((doc) => {
      const data = doc.data();
      const taskId = doc.id;
      const points = data.points || 0;
      const date = data.createdAt?.toDate()?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0];
      
      tasksIndexed.byId[taskId] = {
        id: taskId,
        ...data
      };
      
      if (!tasksIndexed.byPoints[points]) {
        tasksIndexed.byPoints[points] = {};
      }
      tasksIndexed.byPoints[points][taskId] = true;
      
      if (!tasksIndexed.byDate[date]) {
        tasksIndexed.byDate[date] = {};
      }
      tasksIndexed.byDate[date][taskId] = true;
      
      tasksIndexed.list.push(taskId);
    });
    
    await rtdb.ref("cache/activities/tasks").set(tasksIndexed);
    
    // Migrate forms (similar structure)
    const formsSnapshot = await db.collection("forms")
        .where("status", "==", "active")
        .get();
    
    const formsIndexed = {
      byId: {},
      byPoints: {},
      byDate: {},
      list: [],
      metadata: {
        lastUpdated: Date.now(),
        version: 1,
        count: formsSnapshot.size
      }
    };
    
    formsSnapshot.forEach((doc) => {
      const data = doc.data();
      const formId = doc.id;
      const points = data.points || 0;
      const date = data.createdAt?.toDate()?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0];
      
      formsIndexed.byId[formId] = {
        id: formId,
        ...data
      };
      
      if (!formsIndexed.byPoints[points]) {
        formsIndexed.byPoints[points] = {};
      }
      formsIndexed.byPoints[points][formId] = true;
      
      if (!formsIndexed.byDate[date]) {
        formsIndexed.byDate[date] = {};
      }
      formsIndexed.byDate[date][formId] = true;
      
      formsIndexed.list.push(formId);
    });
    
    await rtdb.ref("cache/activities/forms").set(formsIndexed);
    
  } catch (error) {
    console.error("Error migrating activities indexed structure:", error);
    throw error;
  }
}

/**
 * Migration helper: Populate pre-computed user activity lists
 */
async function migrateUserPreComputedLists() {
  
  try {
    // Get all active attendees
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .get();
    
    // Get all active activities
    const [quizzesSnapshot, tasksSnapshot, formsSnapshot] = await Promise.all([
      db.collection("quizzes").where("status", "==", "active").get(),
      db.collection("tasks").where("status", "==", "active").get(),
      db.collection("forms").where("status", "==", "active").get()
    ]);
    
    const activities = {
      quizzes: [],
      tasks: [],
      forms: []
    };
    
    quizzesSnapshot.forEach((doc) => {
      activities.quizzes.push({
        id: doc.id,
        ...doc.data(),
        questionsCount: doc.data().questions?.length || 0
      });
    });
    
    tasksSnapshot.forEach((doc) => {
      activities.tasks.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    formsSnapshot.forEach((doc) => {
      activities.forms.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Process each user
    let processed = 0;
    const batchSize = 10;
    
    for (let i = 0; i < usersSnapshot.size; i += batchSize) {
      const batch = usersSnapshot.docs.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (userDoc) => {
        const userId = userDoc.id;
        
        try {
          // Get user's completion status
          // Note: Task submissions are in 'submissions' collection, not 'taskSubmissions'
          const [quizSubmissions, taskSubmissions, formSubmissions] = await Promise.all([
            db.collection("quizSubmissions")
                .where("userId", "==", userId)
                .get(),
            db.collection("submissions")
                .where("userId", "==", userId)
                .get(),
            db.collection("formSubmissions")
                .where("userId", "==", userId)
                .get()
          ]);
          
          const completion = {
            quizzes: {},
            tasks: {},
            forms: {}
          };
          
          quizSubmissions.forEach((doc) => {
            const data = doc.data();
            completion.quizzes[data.quizId] = {
              completed: true,
              submittedAt: data.submittedAt?.toMillis() || Date.now(),
              points: data.pointsEarned || 0
            };
          });
          
          // Filter task submissions from 'submissions' collection (those with taskId)
          taskSubmissions.forEach((doc) => {
            const data = doc.data();
            // Only process submissions that have a taskId (task submissions)
            if (data.taskId) {
              completion.tasks[data.taskId] = {
                completed: true,
                status: data.status || 'pending',
                submittedAt: data.submittedAt?.toMillis() || Date.now()
              };
            }
          });
          
          formSubmissions.forEach((doc) => {
            const data = doc.data();
            completion.forms[data.formId] = {
              completed: true,
              submittedAt: data.submittedAt?.toMillis() || Date.now()
            };
          });
          
          // Pre-compute pending activities
          const pending = {
            quizzes: activities.quizzes.filter(q => !completion.quizzes[q.id]),
            tasks: activities.tasks.filter(t => 
              !completion.tasks[t.id] || completion.tasks[t.id].status === 'rejected'
            ),
            forms: activities.forms.filter(f => !completion.forms[f.id]),
            combined: []
          };
          
          // Pre-compute completed activities
          const completed = {
            quizzes: activities.quizzes
                .filter(q => completion.quizzes[q.id])
                .map(q => ({ ...q, ...completion.quizzes[q.id], itemType: 'quiz' })),
            tasks: activities.tasks
                .filter(t => completion.tasks[t.id]?.status === 'approved')
                .map(t => ({ ...t, ...completion.tasks[t.id], itemType: 'task' })),
            forms: activities.forms
                .filter(f => completion.forms[f.id])
                .map(f => ({ ...f, ...completion.forms[f.id], itemType: 'form' })),
            combined: []
          };
          
          // Combine for "All" tab
          pending.combined = [
            ...pending.quizzes.map(q => ({ ...q, itemType: 'quiz' })),
            ...pending.tasks.map(t => ({ ...t, itemType: 'task' })),
            ...pending.forms.map(f => ({ ...f, itemType: 'form' }))
          ];
          
          completed.combined = [
            ...completed.quizzes,
            ...completed.tasks,
            ...completed.forms
          ].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
          
          // Calculate user stats
          // Filter task submissions (those with taskId) from the submissions collection
          const taskSubs = taskSubmissions.docs.filter(d => {
            const data = d.data();
            return data.taskId; // Only count submissions with taskId
          });
          
          const userData = userDoc.data();
          const stats = {
            totalPoints: userData.points || 0,
            rank: 0, // Will be updated by updateUserRank
            quizzesCompleted: quizSubmissions.size,
            tasksCompleted: taskSubs.filter(d => d.data().status === 'approved').length,
            formsCompleted: formSubmissions.size,
            pendingSubmissions: taskSubs.filter(d => d.data().status === 'pending').length,
            approvedSubmissions: taskSubs.filter(d => d.data().status === 'approved').length,
            rejectedSubmissions: taskSubs.filter(d => d.data().status === 'rejected').length,
            lastUpdated: Date.now()
          };
          
          // Store in RTDB
          await rtdb.ref(`cache/users/${userId}`).update({
            'pendingActivities': {
              ...pending,
              metadata: { lastUpdated: Date.now(), version: 1, counts: {
                quizzes: pending.quizzes.length,
                tasks: pending.tasks.length,
                forms: pending.forms.length,
                combined: pending.combined.length
              }}
            },
            'completedActivities': {
              ...completed,
              metadata: { lastUpdated: Date.now(), version: 1, counts: {
                quizzes: completed.quizzes.length,
                tasks: completed.tasks.length,
                forms: completed.forms.length,
                combined: completed.combined.length
              }}
            },
            'completions': completion,
            'stats': stats
          });
          
          // Also write to old path for backward compatibility
          await rtdb.ref(`attendeeCache/userStats/${userId}`).set(stats);
          
          processed++;
          if (processed % 10 === 0) {
          }
        } catch (error) {
          console.error(`Error processing user ${userId}:`, error);
        }
      }));
    }
    
  } catch (error) {
    console.error("Error migrating user pre-computed lists:", error);
    throw error;
  }
}

/**
 * Migration helper: Populate leaderboard cache
 */
async function migrateLeaderboard() {
  
  try {
    await updateLeaderboardCache();
    
    // Also update ranks and stats for all users
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .get();
    
    const updatePromises = usersSnapshot.docs.map(async (doc) => {
      const userId = doc.id;
      const userData = doc.data();
      
      // Update rank
      await updateUserRank(userId, userData.points || 0);
      
      // Update stats cache
      await updateUserStatsCache(userId);
    });
    
    await Promise.all(updatePromises);
    
    await rtdb.ref("cache/leaderboard/metadata").set({
      lastUpdated: Date.now(),
      version: 1
    });
    
  } catch (error) {
    console.error("Error migrating leaderboard:", error);
    throw error;
  }
}

/**
 * Migration helper: Populate admin data
 */
async function migrateAdminData() {
  
  try {
    // Update admin caches
    await Promise.all([
      updateAdminParticipantsCache(),
      updateAdminStatsCache(),
      updateQuizzesCache(),
      updateTasksCache(),
      updateFormsCache(),
      updateRecentActivityCache()
    ]);
    
    // Migrate submissions to new structure
    const submissionsSnapshot = await db.collection("submissions").get();
    
    const submissionUpdates = {};
    
    // Process submissions in batches to fetch titles
    const batchSize = 10;
    for (let i = 0; i < submissionsSnapshot.size; i += batchSize) {
      const batch = submissionsSnapshot.docs.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (doc) => {
        const data = doc.data();
        const submissionId = doc.id;
        const { taskId, formId, quizId, userId, status } = data;
        
        // Update indexed structure
        if (taskId) {
          submissionUpdates[`cache/admin/submissions/byTask/${taskId}/${submissionId}`] = true;
        }
        if (formId) {
          submissionUpdates[`cache/admin/submissions/byForm/${formId}/${submissionId}`] = true;
        }
        if (quizId) {
          submissionUpdates[`cache/admin/submissions/byQuiz/${quizId}/${submissionId}`] = true;
        }
        if (status) {
          submissionUpdates[`cache/admin/submissions/byStatus/${status}/${submissionId}`] = true;
        }
        if (userId) {
          submissionUpdates[`cache/admin/submissions/byUser/${userId}/${submissionId}`] = true;
        }
        
        // Fetch titles for better display
        let taskTitle = data.taskTitle || null;
        let formTitle = data.formTitle || null;
        let quizTitle = data.quizTitle || null;
        
        if (!taskTitle && taskId) {
          try {
            const taskDoc = await db.collection('tasks').doc(taskId).get();
            if (taskDoc.exists) {
              taskTitle = taskDoc.data().title || null;
            }
          } catch (error) {
          }
        }
        
        if (!formTitle && formId) {
          try {
            const formDoc = await db.collection('forms').doc(formId).get();
            if (formDoc.exists) {
              formTitle = formDoc.data().title || null;
            }
          } catch (error) {
          }
        }
        
        if (!quizTitle && quizId) {
          try {
            const quizDoc = await db.collection('quizzes').doc(quizId).get();
            if (quizDoc.exists) {
              quizTitle = quizDoc.data().title || null;
            }
          } catch (error) {
          }
        }
        
        // Pre-compute metadata with titles
        submissionUpdates[`cache/admin/submissions/metadata/${submissionId}`] = {
          id: submissionId,
          userId,
          userName: data.userName || data.name || 'Unknown',
          taskId: taskId || null,
          formId: formId || null,
          quizId: quizId || null,
          taskTitle: taskTitle || null,
          formTitle: formTitle || null,
          quizTitle: quizTitle || null,
          title: taskTitle || formTitle || quizTitle || null, // Generic title field
          type: data.type || null, // 'upload' or 'form'
          fileURL: data.fileURL || null, // For file uploads
          status: status || 'pending',
          submittedAt: data.submittedAt?.toMillis() || Date.now(),
          points: data.points || data.pointsAwarded || 0
        };
      }));
    }
    
    await rtdb.ref().update(submissionUpdates);
    
  } catch (error) {
    console.error("Error migrating admin data:", error);
    throw error;
  }
}

/**
 * Callable function to refresh a specific user's activity lists
 * Can be called by the user themselves or by admins
 */
exports.refreshUserActivityLists = onCall(
    { region: region },
    async (request) => {
      if (!request.auth) {
        throw new Error("Unauthorized");
      }
      
      const userId = request.data?.userId || request.auth.uid;
      
      // Users can only refresh their own lists, unless they're an admin
      if (userId !== request.auth.uid) {
        const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
        if (!adminDoc.exists) {
          throw new Error("Unauthorized: Can only refresh your own activity lists");
        }
      }
      
      
      try {
        await updateUserActivityLists(userId);
        return { 
          success: true, 
          message: "Activity lists refreshed successfully",
          userId: userId,
          timestamp: Date.now()
        };
      } catch (error) {
        console.error("Error refreshing user activity lists:", error);
        throw new Error(`Failed to refresh activity lists: ${error.message}`);
      }
    }
);

/**
 * Callable function to initialize/populate all RTDB caches from Firestore
 * Use this when starting fresh or when caches are empty
 * Only accessible by admins
 */
exports.initializeCaches = onCall(
    { 
      region: region,
      timeoutSeconds: 540, // 9 minutes (max for 2nd gen functions)
      memory: "512MiB"
    },
    async (request) => {
      // Only allow admins
      if (!request.auth) {
        throw new Error("Unauthorized");
      }
      
      const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
      if (!adminDoc.exists) {
        throw new Error("Unauthorized: Admin required");
      }
      
      
      const steps = [];
      
      try {
        // Step 1: Populate directory cache first (needed for pre-compute)
        try {
          await updateAttendeeDirectoryCache();
          steps.push("Step 1: Directory cache populated");
        } catch (error) {
          console.error("Step 1 failed:", error);
          steps.push(`Step 1 FAILED: ${error.message}`);
          throw error;
        }
        
        // Step 2: Populate indexed activity caches
        try {
          await migrateActivitiesIndexed();
          steps.push("Step 2: Indexed activity caches populated");
        } catch (error) {
          console.error("Step 2 failed:", error);
          steps.push(`Step 2 FAILED: ${error.message}`);
          throw error;
        }
        
        // Step 3: Populate pre-computed user lists (requires directory cache)
        try {
          await migrateUserPreComputedLists();
          steps.push("Step 3: Pre-computed user activity lists populated");
        } catch (error) {
          console.error("Step 3 failed:", error);
          steps.push(`Step 3 FAILED: ${error.message}`);
          throw error;
        }
        
        // Step 4: Populate leaderboard and admin caches
        try {
          await Promise.all([
            migrateLeaderboard(),
            migrateAdminData()
          ]);
          steps.push("Step 4: Leaderboard and admin caches populated");
        } catch (error) {
          console.error("Step 4 failed:", error);
          steps.push(`Step 4 FAILED: ${error.message}`);
          throw error;
        }
        
        
        return { 
          success: true, 
          message: "All caches initialized successfully",
          steps: steps,
          timestamp: Date.now()
        };
      } catch (error) {
        console.error("Initialization error:", error);
        console.error("Error stack:", error.stack);
        // Return error details instead of throwing to avoid CORS issues
        return {
          success: false,
          message: `Initialization failed at step ${steps.length + 1}: ${error.message}`,
          error: error.message,
          steps: steps,
          stack: error.stack,
          timestamp: Date.now()
        };
      }
    }
);

/**
 * Callable function to migrate to enhanced RTDB structure
 * Only accessible by admins
 * @deprecated Use initializeCaches instead for fresh starts
 */
exports.migrateToEnhancedStructure = onCall(
    { region: region },
    async (request) => {
      // Only allow admins
      if (!request.auth) {
        throw new Error("Unauthorized");
      }
      
      const adminDoc = await db.collection("admins").doc(request.auth.uid).get();
      if (!adminDoc.exists) {
        throw new Error("Unauthorized: Admin required");
      }
      
      
      try {
        // Note: We don't delete old structure to avoid breaking existing clients
        // Old structure will be deprecated gradually
        
        // Populate new structure
        await Promise.all([
          migrateActivitiesIndexed(),      // Indexed structure
          migrateUserPreComputedLists(),   // Pre-computed lists for all users
          migrateLeaderboard(),
          migrateAdminData()
        ]);
        
        
        return { 
          success: true, 
          message: "Enhanced structure migration complete",
          timestamp: Date.now()
        };
      } catch (error) {
        console.error("Migration error:", error);
        throw new Error(`Migration failed: ${error.message}`);
      }
    }
);

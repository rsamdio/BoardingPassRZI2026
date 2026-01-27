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
const PENDING_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sanitize email for use as RTDB key
 * RTDB keys cannot contain: ., $, #, [, ]
 */
function sanitizeEmailForRTDBKey(email) {
  if (!email) return null;
  return email
    .toLowerCase()
    .trim()
    .replace(/\./g, '_DOT_')
    .replace(/\$/g, '_DOLLAR_')
    .replace(/#/g, '_HASH_')
    .replace(/\[/g, '_LBRACK_')
    .replace(/\]/g, '_RBRACK_');
}

function isFreshTimestamp(lastUpdated, ttlMs = PENDING_CACHE_TTL_MS) {
  return typeof lastUpdated === "number" && Date.now() - lastUpdated < ttlMs;
}

function mapPendingUserData(email, data) {
  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  return {
    email: normalizedEmail,
    name: data?.name || null,
    district: data?.district || null,
    designation: data?.designation || null,
    phone: data?.phone || null,
    status: "pending",
    createdAt: data?.createdAt
      ? (data.createdAt.toMillis ? data.createdAt.toMillis() : data.createdAt)
      : Date.now(),
  };
}

async function writePendingCache(pendingUsers, pendingCount, timestamp) {
  const count = typeof pendingCount === "number" ? pendingCount : (pendingUsers || []).length;
  const ts = timestamp || Date.now();
  const updates = {
    "adminCache/participants/pending": pendingUsers || [],
    "adminCache/participants/lastUpdated": ts,
    "adminCache/metadata/pendingCount": count,
    "adminCache/metadata/lastUpdated": ts,
  };
  await rtdb.ref().update(updates);
  return { pendingCount: count, lastUpdated: ts };
}

async function refreshPendingUsers(force = false) {
  const [pendingSnap, metaSnap] = await Promise.all([
    rtdb.ref("adminCache/participants/pending").once("value"),
    rtdb.ref("adminCache/metadata").once("value"),
  ]);

  const pendingCached = pendingSnap.exists() ? pendingSnap.val() : [];
  const metadata = metaSnap.exists() ? metaSnap.val() : {};
  const lastUpdated = metadata.lastUpdated || null;
  const pendingCount = metadata.pendingCount || (Array.isArray(pendingCached) ? pendingCached.length : 0);

  if (!force && isFreshTimestamp(lastUpdated)) {
    return {
      pendingUsers: Array.isArray(pendingCached) ? pendingCached : [],
      pendingCount,
      lastUpdated,
      fromCache: true,
    };
  }

  const snapshot = await db.collection("pendingUsers").get();
  const pendingUsers = [];
  snapshot.forEach((doc) => {
    pendingUsers.push(mapPendingUserData(doc.id, doc.data()));
  });

  const ts = Date.now();
  await writePendingCache(pendingUsers, pendingUsers.length, ts);

  return {
    pendingUsers,
    pendingCount: pendingUsers.length,
    lastUpdated: ts,
    fromCache: false,
  };
}

async function applyPendingUserChange(email, pendingData, action) {
  if (!email) return { pendingCount: 0 };
  const normalizedEmail = email.toLowerCase().trim();

  const [pendingSnap, metaSnap] = await Promise.all([
    rtdb.ref("adminCache/participants/pending").once("value"),
    rtdb.ref("adminCache/metadata").once("value"),
  ]);

  const pendingListRaw = pendingSnap.exists() ? pendingSnap.val() : [];
  const pendingList = Array.isArray(pendingListRaw) ? pendingListRaw.filter(Boolean) : [];
  const metadata = metaSnap.exists() ? metaSnap.val() : {};
  let pendingCount = typeof metadata.pendingCount === "number" ? metadata.pendingCount : pendingList.length;

  const timestamp = Date.now();
  const existingIndex = pendingList.findIndex(
      (p) => p && p.email && p.email.toLowerCase().trim() === normalizedEmail);

  if (action === "delete") {
    if (existingIndex !== -1) {
      pendingList.splice(existingIndex, 1);
      pendingCount = Math.max(0, pendingCount - 1);
    }
  } else {
    const entry = mapPendingUserData(normalizedEmail, pendingData);
    if (existingIndex === -1) {
      pendingList.push(entry);
      pendingCount += 1;
    } else {
      const existing = pendingList[existingIndex] || {};
      const merged = { ...existing, ...entry };
      // Preserve original createdAt if present
      if (existing.createdAt && !pendingData?.createdAt) {
        merged.createdAt = existing.createdAt;
      }
      pendingList[existingIndex] = merged;
    }
  }

  await writePendingCache(pendingList, pendingCount, timestamp);
  return { pendingCount, lastUpdated: timestamp };
}

/**
 * Update leaderboard cache in RTDB using pre-fetched attendee data.
 * @param {Array<Object>} activeAttendees - Array of active attendee objects ({ id, points, ... }).
 */
async function updateLeaderboardCacheFromSnapshot(activeAttendees) {
  try {
    const sorted = [...activeAttendees].sort((a, b) => {
      const aPoints = a.points || 0;
      const bPoints = b.points || 0;
      return bPoints - aPoints;
    });

    const leaderboardData = {};
    const rankUpdates = {};
    let index = 0;

    sorted.forEach((user) => {
      const points = user.points || 0;
      const rank = index + 1;

      // Build top 50 leaderboard data (index 0–49)
      if (index < 50) {
        leaderboardData[index] = {
          uid: user.id,
          name: user.name || user.displayName || "User",
          email: user.email || null,
          district: user.district || null,
          designation: user.designation || null,
          points: points,
          photoURL: user.photoURL || user.photo || null,
          photo: user.photoURL || user.photo || null, // Keep both for backward compatibility
        };
      }

      // Rank data for this user (all users)
      const rankData = {
        rank: rank,
        points: points,
        lastUpdated: Date.now(),
      };

      rankUpdates[`ranks/${user.id}`] = rankData;
      rankUpdates[`cache/leaderboard/ranks/${user.id}`] = rankData;

      index++;
    });

    // Fill remaining leaderboard slots with null if less than 50
    for (let i = index; i < 50; i++) {
      if (leaderboardData[i] === undefined) {
        leaderboardData[i] = null;
      }
    }

    // Read metadata first (before building updates)
    const metadataRef = rtdb.ref("cache/leaderboard/metadata");
    const existingMetaSnap = await metadataRef.once("value");
    const existingMeta = existingMetaSnap.val() || {};

    // Build all updates including metadata
    const allUpdates = {
      "leaderboard/top50": leaderboardData,
      "cache/leaderboard/top50": leaderboardData,
      "cache/leaderboard/metadata": {
        lastUpdated: Date.now(),
        version: (existingMeta.version || 0) + 1,
        count: index,
      },
      ...rankUpdates
    };

    // Single atomic update
    await rtdb.ref().update(allUpdates);
  } catch (error) {
    console.error("Error updating leaderboard cache from snapshot:", error);
    // Non-critical, don't throw
  }
}

/**
 * Wrapper that preserves existing behavior by querying Firestore
 * and then delegating to updateLeaderboardCacheFromSnapshot.
 */
async function updateLeaderboardCache() {
  try {
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .orderBy("points", "desc")
        .get();

    const activeAttendees = usersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    await updateLeaderboardCacheFromSnapshot(activeAttendees);
  } catch (error) {
    console.error("Error updating leaderboard cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update individual user rank in RTDB
 * @deprecated Use updateLeaderboardCache() instead - it calculates ranks for all users
 * This function is kept for backward compatibility only and should not be called
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
async function updateAdminParticipantsCache(force = false, allAttendeesPrefetched = null, pendingUsersPrefetched = null) {
  try {
    // RTDB-first pending users; only hit Firestore if forced or stale
    const pendingResult = pendingUsersPrefetched
      ? {
          pendingUsers: pendingUsersPrefetched,
          pendingCount: pendingUsersPrefetched.length,
          lastUpdated: Date.now(),
          fromCache: true,
        }
      : await refreshPendingUsers(force);

    let allAttendees = allAttendeesPrefetched;
    if (!allAttendees) {
      const usersSnapshot = await db.collection("users")
          .where("role", "==", "attendee")
          .get();
      allAttendees = usersSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    }

    // Delegate to the in-memory variant
    await updateAdminParticipantsCacheFromSnapshot(allAttendees, pendingResult.pendingUsers, pendingResult);
  } catch (error) {
    console.error("Error updating admin participants cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update admin participants cache in RTDB using in-memory attendee data.
 * @param {Array<Object>} allAttendees - Array of attendee objects ({ id, ... }).
 * @param {Array<Object>} [pendingUsersPrefetched] - Optional pre-fetched pending users.
 * @param {Object} [pendingMetadata] - Optional pending metadata ({pendingCount,lastUpdated})
 */
async function updateAdminParticipantsCacheFromSnapshot(allAttendees, pendingUsersPrefetched, pendingMetadata = {}) {
  try {
    let pendingUsers = pendingUsersPrefetched;
    pendingMetadata = pendingMetadata || {};

    // Validate prefetched data freshness (5 minute threshold)
    const PENDING_USERS_TTL = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const prefetchedAge = pendingMetadata.lastUpdated 
      ? (now - pendingMetadata.lastUpdated) 
      : Infinity;

    if (!pendingUsers || prefetchedAge > PENDING_USERS_TTL) {
      // Fetch fresh pending users
      const pendingResult = await refreshPendingUsers(true);
      pendingUsers = pendingResult.pendingUsers;
      pendingMetadata = pendingResult;
    }

    const activeUsers = allAttendees.map((user) => ({
      uid: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone || null,
      district: user.district,
      designation: user.designation,
      points: user.points || 0,
      status: user.status || "active",
      photo: user.photo || user.photoURL || null,
      firstLoginAt: user.firstLoginAt
        ? (user.firstLoginAt.toMillis ? user.firstLoginAt.toMillis() : user.firstLoginAt)
        : null,
    }));

    const timestamp = pendingMetadata.lastUpdated || Date.now();
    const pendingCount = typeof pendingMetadata.pendingCount === "number"
      ? pendingMetadata.pendingCount
      : pendingUsers.length;

    // Update RTDB cache
    const updates = {
      "adminCache/participants": {
        pending: pendingUsers,
        active: activeUsers,
        lastUpdated: timestamp,
      },
      "adminCache/metadata/pendingCount": pendingCount,
      "adminCache/metadata/lastUpdated": timestamp,
    };
    await rtdb.ref().update(updates);
  } catch (error) {
    console.error("Error updating admin participants cache from snapshot:", error);
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
    
    const activeAttendees = usersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    await updateAttendeeDirectoryCacheFromSnapshot(activeAttendees);
  } catch (error) {
    console.error("Error updating attendee directory cache:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update attendee directory cache in RTDB using in-memory active attendee data.
 * @param {Array<Object>} activeAttendees - Array of active attendee objects ({ id, ... }).
 */
async function updateAttendeeDirectoryCacheFromSnapshot(activeAttendees) {
  try {
    const directoryData = {};
    const userCacheUpdates = {};
    
    activeAttendees.forEach((user) => {
      const userName = user.name || user.displayName || null;
      const userPhotoURL = user.photoURL || user.photo || user.profilePhoto || null;
      
      const userData = {
        uid: user.id,
        email: user.email || null,
        name: userName,
        displayName: user.displayName || userName, // Include displayName for compatibility
        district: user.district || null,
        designation: user.designation || null,
        points: user.points || 0,
        photoURL: userPhotoURL, // Ensure photoURL is included
        photo: userPhotoURL, // Keep both for compatibility
        status: user.status || "active"
      };
      
      directoryData[user.id] = userData;
      
      // Also prepare individual user cache data
      userCacheUpdates[`attendeeCache/users/${user.id}`] = {
        ...userData,
        role: user.role || "attendee",
        lastUpdated: Date.now()
      };
    });
    
    directoryData.lastUpdated = Date.now();
    
    // Update RTDB cache - directory and individual user caches
    const updates = {
      "attendeeCache/directory": directoryData,
      ...userCacheUpdates
    };
    
    await rtdb.ref().update(updates);
  } catch (error) {
    console.error("Error updating attendee directory cache from snapshot:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update all user-related caches (leaderboard, admin participants, attendee directory)
 * using a single attendees snapshot (fetch-once, filter-in-memory pattern).
 * @param {FirebaseFirestore.QuerySnapshot} allAttendeesSnapshot
 */
async function updateAllUserCaches(allAttendeesSnapshot) {
  try {
    const attendees = allAttendeesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const activeAttendees = attendees.filter(
        (user) => (user.status || "active") === "active",
    );

    const cacheNames = ['leaderboard', 'participants', 'directory'];
    const results = await Promise.allSettled([
      updateLeaderboardCacheFromSnapshot(activeAttendees),
      updateAdminParticipantsCacheFromSnapshot(attendees),
      updateAttendeeDirectoryCacheFromSnapshot(activeAttendees),
    ]);

    // Handle edge case: empty results array (unlikely but possible)
    if (results.length === 0) {
      console.warn('[updateAllUserCaches] No cache update results returned');
      return; // Early exit
    }

    // Log any failures for monitoring (but don't throw - cache failures shouldn't break user operations)
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `[updateAllUserCaches] Failed to update ${cacheNames[index]} cache:`,
          result.reason
        );
        // Optionally: Send to error tracking service for alerting
      }
    });

    // Check if all failed - log critical error but DON'T throw (non-critical operation)
    const allFailed = results.every(r => r.status === 'rejected');
    if (allFailed) {
      console.error('[updateAllUserCaches] CRITICAL: All cache updates failed', {
        leaderboard: results[0]?.status === 'rejected' ? results[0].reason : null,
        participants: results[1]?.status === 'rejected' ? results[1].reason : null,
        directory: results[2]?.status === 'rejected' ? results[2].reason : null
      });
      // DO NOT throw - this function is called from user operations and must not break them
      // Cache failures are logged for monitoring but don't block user operations
    }
  } catch (error) {
    console.error("Error updating all user caches from snapshot:", error);
    // Non-critical, don't throw
  }
}

/**
 * Update individual user data in RTDB cache
 * Writes user data to attendeeCache/users/{userId} for fast client-side access
 * @param {string} uid - User ID
 * @param {Object} userData - User data from Firestore
 */
async function updateUserDataCache(uid, userData) {
  try {
    if (!uid || !userData) return;
    
    // Only cache attendee users
    if (userData.role !== "attendee") return;
    
    const userCacheData = {
      uid: uid,
      name: userData.name || userData.displayName || null,
      email: userData.email || null,
      district: userData.district || null,
      designation: userData.designation || null,
      points: userData.points || 0,
      photoURL: userData.photoURL || userData.photo || null,
      photo: userData.photoURL || userData.photo || null, // Keep both for compatibility
      status: userData.status || "active",
      role: userData.role || "attendee",
      lastUpdated: Date.now()
    };
    
    // Write to RTDB cache
    await rtdb.ref(`attendeeCache/users/${uid}`).set(userCacheData);
  } catch (error) {
    console.error(`Error updating user data cache for ${uid}:`, error);
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
  const sanitizedKey = sanitizeEmailForRTDBKey(email);

  try {
    if (isDelete) {
      await rtdb.ref(`adminCache/emails/${sanitizedKey}`).remove();
    } else {
      await rtdb.ref(`adminCache/emails/${sanitizedKey}`).set({
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
 * Supports incremental updates to avoid full collection scans
 * @param {Object} incrementalUpdate - Optional incremental update object (e.g., {pendingSubmissions: 1})
 */
async function updateAdminStatsCache(incrementalUpdate = null) {
  try {
    // Check if we have running totals initialized
    const statsRef = rtdb.ref("adminCache/stats");
    const statsSnap = await statsRef.once("value");
    const currentStats = statsSnap.exists() ? statsSnap.val() : null;
    
    // If incremental update provided, apply it
    if (incrementalUpdate && currentStats && currentStats.initialized) {
      // Use RTDB transaction for atomic updates with retry logic
      const MAX_RETRIES = 3;
      let retries = 0;
      let committed = false;
      
      while (retries < MAX_RETRIES && !committed) {
        try {
          const transactionResult = await statsRef.transaction((current) => {
            if (!current || !current.initialized) {
              // Stats not initialized, abort transaction (will trigger full recalculation)
              return undefined;
            }
            
            const updated = { ...current };
            Object.keys(incrementalUpdate).forEach(key => {
              if (typeof incrementalUpdate[key] === 'number') {
                // Atomic increment/decrement
                updated[key] = (updated[key] || 0) + incrementalUpdate[key];
              } else {
                // Direct assignment for non-numeric values
                updated[key] = incrementalUpdate[key];
              }
            });
            
            updated.lastUpdated = Date.now();
            updated.version = (updated.version || 0) + 1;
            return updated;
          });
          
          if (transactionResult.committed) {
            committed = true;
            return; // Success - exit function
          }
          
          // Transaction aborted (not an error, just conflict)
          retries++;
          if (retries < MAX_RETRIES) {
            const backoffMs = 50 * Math.pow(2, retries - 1); // 50ms, 100ms, 200ms
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            console.log(`[updateAdminStatsCache] Transaction aborted, retrying (${retries}/${MAX_RETRIES})...`);
          }
        } catch (error) {
          // Transaction threw an error (different from abort - network issue, permission denied, etc.)
          console.error('[updateAdminStatsCache] Transaction error:', error);
          retries++;
          if (retries < MAX_RETRIES) {
            const backoffMs = 50 * Math.pow(2, retries - 1); // 50ms, 100ms, 200ms
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          } else {
            // All retries failed, fall through to full recalculation
            break;
          }
        }
      }
      
      // If all retries failed, log warning and fall through to full recalculation
      if (!committed) {
        console.warn('[updateAdminStatsCache] Transaction failed after retries, falling back to full recalculation');
        // Proceed with full recalculation below
      } else {
        return; // Transaction succeeded
      }
    }
    
    // If cache is fresh (< 15 minutes), skip full recalculation
    if (currentStats && currentStats.lastUpdated) {
      const age = Date.now() - currentStats.lastUpdated;
      const STALE_THRESHOLD = 15 * 60 * 1000; // 15 minutes
      
      if (age < STALE_THRESHOLD && currentStats.initialized) {
        // Cache is fresh, no need to recalculate
        return;
      }
    }
    
    // Full recalculation (only if cache is stale or not initialized)
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
      version: (currentStats?.version || 0) + 1,
      initialized: true
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
        formFields: data.formFields || [], // Include full formFields array for form-type tasks
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
    
    // Safely extract date, handling invalid dates
    let date = null;
    if (activityData.createdAt) {
      try {
        // Try Firestore Timestamp first
        if (activityData.createdAt.toDate && typeof activityData.createdAt.toDate === 'function') {
          const dateObj = activityData.createdAt.toDate();
          if (dateObj && !isNaN(dateObj.getTime())) {
            date = dateObj.toISOString().split('T')[0];
          }
        } else {
          // Try as regular date
          const dateObj = new Date(activityData.createdAt);
          if (dateObj && !isNaN(dateObj.getTime())) {
            date = dateObj.toISOString().split('T')[0];
          }
        }
      } catch (error) {
        // Invalid date, skip date-based removal
        console.warn(`Invalid date for activity ${activityId}:`, activityData.createdAt);
      }
    }
    
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
    
    const result = {
      quizzes: filterActive(quizzesSnap.val()),
      tasks: filterActive(tasksSnap.val()),
      forms: filterActive(formsSnap.val())
    };
    
    
    return result;
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
 * Update user activity lists (optimized version with pre-fetched activities)
 * @param {string} userId - User ID
 * @param {Object} preFetchedActivities - Pre-fetched activities data
 * @param {Array} excludeActivityIds - Activity IDs to exclude
 */
async function updateUserActivityListsOptimized(userId, preFetchedActivities, excludeActivityIds = []) {
  try {
    // Fetch completions for this specific user (still need per-user data)
    const completion = await getCompletionStatusFromCache(userId);
    
    // Use pre-fetched activities instead of reading again
    let activities = preFetchedActivities;
    
    // Filter excluded activities
    if (excludeActivityIds.length > 0) {
      activities = {
        quizzes: activities.quizzes.filter(q => !excludeActivityIds.includes(q.id)),
        tasks: activities.tasks.filter(t => !excludeActivityIds.includes(t.id)),
        forms: activities.forms.filter(f => !excludeActivityIds.includes(f.id))
      };
    }
    
    // PRE-COMPUTE: Pending activities
    const pending = {
      quizzes: activities.quizzes.filter(q => {
        const isCompleted = completion.quizzes && completion.quizzes[q.id];
        return !isCompleted;
      }),
      tasks: activities.tasks.filter(t => {
        const taskCompletion = completion.tasks?.[t.id];
        if (!taskCompletion) {
          return true;
        }
        return taskCompletion.status === 'rejected';
      }),
      forms: activities.forms.filter(f => {
        return !completion.forms || !completion.forms[f.id];
      }),
      combined: []
    };
    
    // PRE-COMPUTE: Completed activities
    const completed = {
      quizzes: activities.quizzes
        .filter(q => {
          const isCompleted = completion.quizzes && completion.quizzes[q.id];
          return isCompleted;
        })
        .map(q => {
          const completionData = completion.quizzes[q.id] || {};
          return { 
            ...q, 
            ...completionData, 
            itemType: 'quiz', 
            completed: true,
            id: q.id
          };
        }),
      tasks: activities.tasks
        .filter(t => {
          const taskCompletion = completion.tasks?.[t.id];
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
 * OPTIMIZED: Pre-fetches activities once before updating all users
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
    const excludeIds = activityId ? [activityId] : [];
    
    // OPTIMIZATION: Fetch activities ONCE before updating all users
    const activities = await getActivitiesFromIndexedCache();
    
    // Filter excluded activities from the pre-fetched data
    const filteredActivities = {
      quizzes: excludeIds.length > 0 
        ? activities.quizzes.filter(q => !excludeIds.includes(q.id))
        : activities.quizzes,
      tasks: excludeIds.length > 0
        ? activities.tasks.filter(t => !excludeIds.includes(t.id))
        : activities.tasks,
      forms: excludeIds.length > 0
        ? activities.forms.filter(f => !excludeIds.includes(f.id))
        : activities.forms
    };
    
    // Now update all users with pre-fetched activities (only 1 read for activities, not N)
    await Promise.all(
      userIds.map(uid => 
        updateUserActivityListsOptimized(uid, filteredActivities, excludeIds).catch(err => {
          console.error(`Failed to update lists for ${uid}:`, err);
          return null;
        })
      )
    );
    
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
      
      // If title not in submission data, try RTDB cache (no Firestore read)
      if (!taskTitle && taskId) {
        try {
          const taskCacheRef = rtdb.ref(`adminCache/tasks/${taskId}`);
          const taskCacheSnap = await taskCacheRef.once('value');
          if (taskCacheSnap.exists()) {
            taskTitle = taskCacheSnap.val()?.title || null;
          }
          // If still not found, log warning but don't read from Firestore
          if (!taskTitle) {
            console.warn(`[updateSubmissionLists] Task title not found in cache for ${taskId}, using null`);
          }
        } catch (error) {
          console.warn(`[updateSubmissionLists] Error reading task cache for ${taskId}:`, error);
        }
      }
      
      if (!formTitle && formId) {
        try {
          const formCacheRef = rtdb.ref(`adminCache/forms/${formId}`);
          const formCacheSnap = await formCacheRef.once('value');
          if (formCacheSnap.exists()) {
            formTitle = formCacheSnap.val()?.title || null;
          }
          if (!formTitle) {
            console.warn(`[updateSubmissionLists] Form title not found in cache for ${formId}, using null`);
          }
        } catch (error) {
          console.warn(`[updateSubmissionLists] Error reading form cache for ${formId}:`, error);
        }
      }
      
      if (!quizTitle && quizId) {
        try {
          const quizCacheRef = rtdb.ref(`adminCache/quizzes/${quizId}`);
          const quizCacheSnap = await quizCacheRef.once('value');
          if (quizCacheSnap.exists()) {
            quizTitle = quizCacheSnap.val()?.title || null;
          }
          if (!quizTitle) {
            console.warn(`[updateSubmissionLists] Quiz title not found in cache for ${quizId}, using null`);
          }
        } catch (error) {
          console.warn(`[updateSubmissionLists] Error reading quiz cache for ${quizId}:`, error);
        }
      }
      
      // Determine collection based on submission type
      let collection = 'submissions'; // Default for task submissions
      if (formId) {
        collection = 'formSubmissions';
      } else if (quizId) {
        collection = 'quizSubmissions';
      }
      
      // Ensure status is always included and matches the byStatus path
      const finalStatus = status || submissionData.status || 'pending';
      
      // Verify collection is set correctly (defensive check)
      if (!collection || (collection !== 'submissions' && collection !== 'formSubmissions' && collection !== 'quizSubmissions')) {
        console.warn(`[updateSubmissionLists] Invalid collection determined for submission ${submissionId}: ${collection}. Defaulting to 'submissions'.`);
        collection = 'submissions';
      }
      
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
        points: submissionData.points || submissionData.pointsAwarded || 0,
        collection: collection // Collection hint for fast client-side loading (CRITICAL for optimization)
      };
      
      // Log metadata creation for debugging (only in development or if collection is missing)
      if (process.env.NODE_ENV === 'development' || !collection) {
        console.log(`[updateSubmissionLists] Created metadata for submission ${submissionId} with collection: ${collection}`);
      }
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
    const listUpdateStart = Date.now();
    await updateUserActivityLists(userId);
    const listUpdateEnd = Date.now();
    
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
    
    // OPTIMIZATION: Read users collection once and update all user caches
    // This replaces the deprecated updateUserRank() call and eliminates duplicate read
    const allAttendeesSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .get();
    
    await updateAllUserCaches(allAttendeesSnapshot);
  } catch (error) {
    console.error(`Error updating leaderboard incrementally for ${userId}:`, error);
    // Non-critical
  }
}

/**
 * Refresh activities indexed cache from Firestore
 */
async function refreshActivitiesIndexedCache(force = false) {
  try {
    // Check cache freshness first (unless forced)
    if (!force) {
      try {
        const TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
        const now = Date.now();
        
        // Check all three activity type metadata caches
        const [quizzesMeta, tasksMeta, formsMeta] = await Promise.all([
          rtdb.ref('cache/activities/quizzes/metadata').once('value'),
          rtdb.ref('cache/activities/tasks/metadata').once('value'),
          rtdb.ref('cache/activities/forms/metadata').once('value')
        ]);
        
        // Check if all caches are fresh
        const quizzesFresh = quizzesMeta.exists() && 
          (now - (quizzesMeta.val()?.lastUpdated || 0)) < TTL_MS;
        const tasksFresh = tasksMeta.exists() && 
          (now - (tasksMeta.val()?.lastUpdated || 0)) < TTL_MS;
        const formsFresh = formsMeta.exists() && 
          (now - (formsMeta.val()?.lastUpdated || 0)) < TTL_MS;
        
        // If all caches are fresh, skip Firestore reads
        if (quizzesFresh && tasksFresh && formsFresh) {
          console.log('[refreshActivitiesIndexedCache] Cache is fresh, skipping Firestore reads');
          return; // Cache is fresh, no need to read from Firestore
        }
      } catch (error) {
        // Cache check failed, proceed with Firestore read (fallback)
        console.warn('[refreshActivitiesIndexedCache] Cache freshness check failed, proceeding with Firestore read:', error);
      }
    }
    
    // Cache is stale or forced, read from Firestore
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
async function refreshLeaderboardCache(force = false) {
  const lockRef = rtdb.ref('cache/leaderboard/_refreshLock');
  const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  
  try {
    // Try to acquire lock (unless forced)
    if (!force) {
      const lockSnap = await lockRef.once('value');
      if (lockSnap.exists()) {
        const lockData = lockSnap.val();
        const lockAge = Date.now() - (lockData.timestamp || 0);
        
        if (lockAge < LOCK_TIMEOUT) {
          console.log('[refreshLeaderboardCache] Refresh already in progress, skipping');
          return; // Another refresh is in progress
        } else {
          // Lock expired, clear it
          console.warn('[refreshLeaderboardCache] Lock expired, clearing and proceeding');
          await lockRef.remove();
        }
      }
      
      // Check cache freshness before acquiring lock
      try {
        const TTL_MS = 10 * 60 * 1000; // 10 minutes TTL
        const now = Date.now();
        const metadataSnap = await rtdb.ref('cache/leaderboard/metadata').once('value');
        
        if (metadataSnap.exists()) {
          const metadata = metadataSnap.val();
          const lastUpdated = metadata.lastUpdated || 0;
          
          if ((now - lastUpdated) < TTL_MS) {
            console.log('[refreshLeaderboardCache] Cache is fresh, skipping Firestore read');
            return; // Cache is fresh, no need to refresh
          }
        }
      } catch (error) {
        console.warn('[refreshLeaderboardCache] Cache freshness check failed, proceeding:', error);
      }
    }
    
    // Acquire lock
    await lockRef.set({
      timestamp: Date.now(),
      pid: process.pid || 'unknown',
      functionId: 'refreshLeaderboardCache'
    });
    
    try {
      // Cache is stale or forced, read from Firestore once and update cache
      const usersSnapshot = await db.collection("users")
          .where("role", "==", "attendee")
          .where("status", "==", "active")
          .orderBy("points", "desc")
          .get();
      
      const activeAttendees = usersSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      
      await updateLeaderboardCacheFromSnapshot(activeAttendees);
    } finally {
      // Always release lock with retry logic
      let lockRemoved = false;
      let removeRetries = 0;
      const MAX_REMOVE_RETRIES = 3;
      
      while (!lockRemoved && removeRetries < MAX_REMOVE_RETRIES) {
        try {
          await lockRef.remove();
          lockRemoved = true;
        } catch (removeError) {
          removeRetries++;
          if (removeRetries < MAX_REMOVE_RETRIES) {
            // Exponential backoff for lock removal retries: 100ms, 200ms, 400ms
            const backoffMs = 100 * Math.pow(2, removeRetries - 1);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            console.warn(`[refreshLeaderboardCache] Lock removal failed, retrying (${removeRetries}/${MAX_REMOVE_RETRIES})...`);
          } else {
            console.error('[refreshLeaderboardCache] Failed to release lock after retries:', removeError);
            // Lock will expire after LOCK_TIMEOUT (5 minutes), so not critical
          }
        }
      }
    }
  } catch (error) {
    // Release lock on error (with retry logic)
    let lockRemoved = false;
    let removeRetries = 0;
    const MAX_REMOVE_RETRIES = 3;
    
    while (!lockRemoved && removeRetries < MAX_REMOVE_RETRIES) {
      try {
        await lockRef.remove();
        lockRemoved = true;
      } catch (lockError) {
        removeRetries++;
        if (removeRetries < MAX_REMOVE_RETRIES) {
          const backoffMs = 100 * Math.pow(2, removeRetries - 1);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          console.error('[refreshLeaderboardCache] Error releasing lock after retries:', lockError);
          // Lock will expire after LOCK_TIMEOUT, so not critical
        }
      }
    }
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
        // Refresh indexed caches (force refresh for scheduled task)
        await Promise.all([
          refreshActivitiesIndexedCache(true), // Force refresh for scheduled task
          refreshLeaderboardCache(true), // Force refresh during scheduled run
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

      // Check if user data changed (affects admin cache)
      const userDataChanged =
          (before.name !== after.name) ||
          (before.email !== after.email) ||
          (before.district !== after.district) ||
          (before.designation !== after.designation) ||
          (before.status !== after.status);

      // Determine if we need to refresh user-related caches
      const needUserCaches = pointsChanged || userDataChanged;

      // Check if points changed (affects stats)
      // Note: Points changes don't affect user counts, so we can skip incremental update
      // Only recalculate if cache is stale (handled by updateAdminStatsCache internally)
      if (pointsChanged || userDataChanged) {
        updates.push(updateAdminStatsCache()); // Will use cache if fresh
      }
      
      // Handle status changes (incremental)
      if (before.status !== after.status) {
        if (before.status === 'pending' && after.status === 'active') {
          // User activated: increment activeUsers
          updates.push(updateAdminStatsCache({
            activeUsers: 1
          }));
        } else if (before.status === 'active' && after.status === 'pending') {
          // User deactivated: decrement activeUsers
          updates.push(updateAdminStatsCache({
            activeUsers: -1
          }));
        }
      }

      if (userDataChanged) {
        
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
      }

      // If caches need to be refreshed, do a single Firestore read and update all user caches
      if (needUserCaches) {
        const allAttendeesSnapshot = await db.collection("users")
            .where("role", "==", "attendee")
            .get();
        updates.push(updateAllUserCaches(allAttendeesSnapshot));
      }
      
      // If user status changed to 'active', generate activity lists (new users start as 'pending')
      if (before.status !== after.status && after.status === 'active') {
        updates.push(updateUserActivityLists(uid));
      }
      
      // Always update user data cache when user is updated (for any changes)
      updates.push(updateUserDataCache(uid, after));

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

      const allAttendeesSnapshot = await db.collection("users")
          .where("role", "==", "attendee")
          .get();

      const updates = [
        updateAllUserCaches(allAttendeesSnapshot),
        updateAdminStatsCache({
          totalUsers: 1,
          activeUsers: userData.status === 'active' ? 1 : 0
        }),
        // updateUserRank() removed - rank is calculated in updateLeaderboardCache()
        updateUserStatsCache(uid),
        updateUserCompletionStatusCache(uid),
        // Generate pre-computed activity lists for the new user
        updateUserActivityLists(uid),
        // Cache user data in RTDB for fast client-side access
        updateUserDataCache(uid, userData),
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
        applyPendingUserChange(email, pendingData, "create"),
        updateAdminStatsCache({
          totalUsers: 1,
          pendingUsers: 1
        }),
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
      const email = event.params.email;
      const pendingData = event.data.after.data();
      const updates = [
        applyPendingUserChange(email, pendingData, "update"),
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
        applyPendingUserChange(email, null, "delete"),
        updateAdminStatsCache({
          totalUsers: -1,
          pendingUsers: -1
        }),
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
        const parallelStart = Date.now();
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
        const parallelEnd = Date.now();
        
      } else {
        await updateSubmissionLists(event.params.submissionId, submissionData, 'create');
      }
      
      // Step 2: Update other caches in parallel (non-blocking for user experience)
      Promise.all([
        // Update user stats
        updateUserStats(userId),
        // Update admin caches (incremental: new submission = pending)
        updateAdminStatsCache({
          pendingSubmissions: 1
        }),
        updateRecentActivityCache(),
        updateSubmissionCountsCache(),
        // Update old caches (for backward compatibility)
        updateUserCompletionStatusCache(userId),
        taskId ? updateTasksCache() : Promise.resolve()
      ]).then(() => {
      }).catch(err => {
        console.error('Error updating secondary caches:', err);
        // Don't throw - user list is already updated
      });
      
      // Step 3: Create notification for submission created (confirmation)
      if (taskId) {
        try {
          let taskTitle = submissionData.taskTitle || 'Task';
          if (!taskTitle || taskTitle === 'Task') {
            try {
              const taskCacheRef = rtdb.ref(`adminCache/tasks/${taskId}`);
              const taskCacheSnap = await taskCacheRef.once('value');
              if (taskCacheSnap.exists()) {
                taskTitle = taskCacheSnap.val()?.title || 'Task';
              }
            } catch (error) {
              // Fallback to 'Task' if cache read fails
            }
          }
          
          // RTDB notification
          updateUserNotificationCache(userId, {
            type: 'submission_created',
            title: 'Submission Received',
            message: `Your submission for "${taskTitle}" has been received and is under review.`,
            taskId: taskId,
            taskTitle: taskTitle,
            submissionId: event.params.submissionId
          });
          
          // Push notification (non-blocking)
          try {
            await sendPushNotification(userId, {
              type: 'submission_created',
              title: 'Submission Received',
              body: `Your submission for "${taskTitle}" has been received and is under review.`,
              data: {
                type: 'submission_created',
                taskId: taskId,
                taskTitle: taskTitle,
                submissionId: event.params.submissionId,
                url: `/tasks/${taskId}`
              }
            });
          } catch (error) {
            console.error('Error sending submission created push notification:', error);
            // Non-critical
          }
        } catch (error) {
          console.error('Error creating submission notification:', error);
          // Non-critical, don't throw
        }
      }
      
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
      
      // Apply status updates (already atomic - no transaction needed)
      if (Object.keys(statusUpdates).length > 0) {
        try {
          await rtdb.ref().update(statusUpdates); // ✅ Atomic for multiple paths
        } catch (error) {
          console.error('[onSubmissionUpdate] Failed to update status paths:', error);
          // Continue with other updates - status update failure is logged but not blocking
        }
      }
      
      // Prepare stats update for status changes
      let statsUpdate = null;
      if (statusChanged) {
        statsUpdate = {};
        // Decrement old status
        if (before.status === 'pending') statsUpdate.pendingSubmissions = -1;
        else if (before.status === 'approved') statsUpdate.approvedSubmissions = -1;
        else if (before.status === 'rejected') statsUpdate.rejectedSubmissions = -1;
        // Increment new status
        if (after.status === 'pending') statsUpdate.pendingSubmissions = (statsUpdate.pendingSubmissions || 0) + 1;
        else if (after.status === 'approved') statsUpdate.approvedSubmissions = (statsUpdate.approvedSubmissions || 0) + 1;
        else if (after.status === 'rejected') statsUpdate.rejectedSubmissions = (statsUpdate.rejectedSubmissions || 0) + 1;
      }
      
      // Then proceed with other updates using Promise.allSettled for graceful error handling
      const updates = [
        // 1. Update indexed submission cache (this will add to new status path)
        // Note: This happens AFTER old path removal to ensure atomic updates
        updateSubmissionLists(event.params.submissionId, after, 'update'),
        // 2. Update admin caches (incremental: handle status changes)
        updateAdminStatsCache(statsUpdate),
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
      
      // Send push notification for points awarded (separate from approval notification)
      if (pointsChanged && after.pointsAwarded > 0 && after.status === 'approved') {
        try {
          let taskTitle = after.taskTitle || 'Task';
          if (!taskTitle || taskTitle === 'Task') {
            try {
              const taskCacheRef = rtdb.ref(`adminCache/tasks/${taskId}`);
              const taskCacheSnap = await taskCacheRef.once('value');
              if (taskCacheSnap.exists()) {
                taskTitle = taskCacheSnap.val()?.title || 'Task';
              }
            } catch (error) {
              // Fallback to 'Task' if cache read fails
            }
          }
          
          await sendPushNotification(userId, {
            type: 'points_awarded',
            title: 'Points Awarded!',
            body: `You earned ${after.pointsAwarded} points for "${taskTitle}"!`,
            data: {
              type: 'points_awarded',
              taskId: taskId,
              taskTitle: taskTitle,
              points: String(after.pointsAwarded),
              url: `/tasks/${taskId}`
            }
          });
        } catch (error) {
          console.error('Error sending points awarded push notification:', error);
          // Non-critical
        }
      }
      
      // Update old caches (for backward compatibility)
      if (statusChanged) {
        updates.push(updateSubmissionCountsCache());
        updates.push(updateUserCompletionStatusCache(userId));
        updates.push(updateUserStatsCache(userId));
        
        // Create notification for status change
        // Use taskTitle from submission data or cache (avoid Firestore read)
        let taskTitle = after.taskTitle || 'Task';
        if (!taskTitle || taskTitle === 'Task') {
          try {
            const taskCacheRef = rtdb.ref(`adminCache/tasks/${taskId}`);
            const taskCacheSnap = await taskCacheRef.once('value');
            if (taskCacheSnap.exists()) {
              taskTitle = taskCacheSnap.val()?.title || 'Task';
            }
          } catch (error) {
            // Fallback to 'Task' if cache read fails
          }
        }
        
        if (after.status === 'approved') {
          // RTDB notification (existing)
          updateUserNotificationCache(userId, {
            type: 'submission_approved',
            title: 'Submission Approved!',
            message: `Your submission for "${taskTitle}" has been approved. Points awarded!`,
            points: after.pointsAwarded || 0,
            taskId: taskId,
            taskTitle: taskTitle
          });
          
          // NEW: Push notification (non-blocking)
          try {
            await sendPushNotification(userId, {
              type: 'submission_approved',
              title: 'Submission Approved!',
              body: `Your submission for "${taskTitle}" has been approved. ${after.pointsAwarded || 0} points awarded!`,
              data: {
                type: 'submission_approved',
                taskId: taskId,
                taskTitle: taskTitle,
                points: String(after.pointsAwarded || 0),
                url: `/tasks/${taskId}`
              }
            });
          } catch (error) {
            console.error('Error sending approval push notification:', error);
            // Non-critical
          }
        } else if (after.status === 'rejected') {
          const rejectionReason = after.rejectionReason || 'Please review and resubmit.';
          
          // RTDB notification (existing)
          updateUserNotificationCache(userId, {
            type: 'submission_rejected',
            title: 'Submission Rejected',
            message: `Your submission for "${taskTitle}" was rejected. ${rejectionReason}`,
            taskId: taskId,
            taskTitle: taskTitle,
            rejectionReason: rejectionReason,
            canResubmit: true
          });
          
          // NEW: Push notification (non-blocking)
          try {
            await sendPushNotification(userId, {
              type: 'submission_rejected',
              title: 'Mission Resubmission Available',
              body: `Your submission for "${taskTitle}" was rejected. You can resubmit now!`,
              data: {
                type: 'submission_rejected',
                taskId: taskId,
                taskTitle: taskTitle,
                url: `/tasks/${taskId}`
              }
            });
          } catch (error) {
            console.error('Error sending rejection push notification:', error);
            // Non-critical
          }
        }
      }
      
      // Use allSettled to handle partial failures gracefully
      const results = await Promise.allSettled(updates);
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const updateNames = [
            'updateSubmissionLists',
            'updateAdminStatsCache',
            'updateRecentActivityCache',
            'updateUserCompletion',
            'updateUserStats',
            'updateUserActivityLists',
            'updateLeaderboardIncremental',
            'updateSubmissionCountsCache',
            'updateUserCompletionStatusCache',
            'updateUserStatsCache'
          ];
          console.error(`[onSubmissionUpdate] ${updateNames[index] || `Update ${index}`} failed:`, result.reason);
        }
      });
      
      // Note: Status updates are already applied, so even if other updates fail,
      // the cache will be partially updated. This is acceptable for cache consistency.
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
        // 4. Update admin caches (incremental: decrement submission count by status)
        updateAdminStatsCache({
          [submissionData.status === 'pending' ? 'pendingSubmissions' : 
            submissionData.status === 'approved' ? 'approvedSubmissions' : 
            'rejectedSubmissions']: -1
        }),
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

      // Only process attendee users
      if (deletedUserData.role !== "attendee") {
        return null;
      }

      // Read users collection ONCE (shared read) - same pattern as onUserCreate
      const allAttendeesSnapshot = await db.collection("users")
          .where("role", "==", "attendee")
          .get();

      const updates = [
        updateAllUserCaches(allAttendeesSnapshot), // ✅ Uses shared read instead of 3 separate reads
        updateAdminStatsCache({
          totalUsers: -1,
          activeUsers: deletedUserData.status === 'active' ? -1 : 0
        }),
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
      const cacheUpdateStart = Date.now();
      await Promise.all([
        updateActivityInCache('tasks', taskId, taskData),
        updateTasksCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      const cacheUpdateEnd = Date.now();
      
      
      // Step 2: Trigger user list updates for all users in parallel
      const listUpdateStart = Date.now();
      await triggerUserActivityListUpdates(null, 'tasks');
      
      // Step 3: Send push notifications for new pending missions (non-blocking)
      if (taskData.status === 'active') {
        try {
          await sendPendingMissionNotification(taskId, taskData, 'new_task');
        } catch (error) {
          console.error('Error sending new task notifications:', error);
          // Non-critical, don't throw
        }
      }
      
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
      
      // Step 3: Send push notification when task becomes active (non-blocking)
      if (oldData.status !== 'active' && newData.status === 'active') {
        try {
          await sendPendingMissionNotification(taskId, newData, 'task_activated');
        } catch (error) {
          console.error('Error sending task activation notifications:', error);
          // Non-critical, don't throw
        }
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
      const cacheRemoveStart = Date.now();
      await Promise.all([
        removeActivityFromCache('tasks', taskId),
        updateTasksCache(),
        updateAttendeeActivitiesCache(),
        updateActivityMetadataCache()
      ]);
      const cacheRemoveEnd = Date.now();
      

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
      const listUpdateStart = Date.now();
      await triggerUserActivityListUpdates(taskId, 'tasks');
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
 * Send push notification to a single user
 * @param {string} userId - User ID
 * @param {Object} notification - Notification data
 * @returns {Promise<string>} - FCM message ID
 */
async function sendPushNotification(userId, notification) {
  if (!userId || !notification) return;
  
  try {
    // Get user's FCM token (read-only operation)
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`[sendPushNotification] User ${userId} not found`);
      return;
    }
    
    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;
    const notificationEnabled = userData.notificationEnabled !== false; // Default to true if not set
    
    if (!fcmToken || !notificationEnabled) {
      console.log(`[sendPushNotification] User ${userId} has no FCM token or notifications disabled`);
      return;
    }
    
    // Check user preferences (read-only)
    const prefs = userData.notificationPrefs || {};
    const notificationType = notification.type || 'default';
    
    // Check if this notification type is enabled
    if (notificationType.includes('pending') && prefs.pendingMissions === false) {
      console.log(`[sendPushNotification] User ${userId} has pendingMissions disabled`);
      return;
    }
    if (notificationType.includes('submission') && prefs.submissions === false) {
      console.log(`[sendPushNotification] User ${userId} has submissions disabled`);
      return;
    }
    if (notificationType.includes('engagement') && prefs.engagement === false) {
      console.log(`[sendPushNotification] User ${userId} has engagement disabled`);
      return;
    }
    
    // Prepare FCM message
    const message = {
      notification: {
        title: notification.title || 'Notification',
        body: notification.body || notification.message || '',
        imageUrl: notification.imageUrl
      },
      data: {
        type: notification.type || 'default',
        taskId: notification.data?.taskId || '',
        taskTitle: notification.data?.taskTitle || '',
        url: notification.data?.url || '/',
        timestamp: Date.now().toString(),
        ...notification.data
      },
      token: fcmToken,
      webpush: {
        fcmOptions: {
          link: notification.data?.url || '/'
        },
        notification: {
          icon: 'https://rzi2026chennai.firebaseapp.com/rzilogo.webp', // Use the Rotaract logo
          badge: 'https://rzi2026chennai.firebaseapp.com/rzilogo.webp', // Use logo as badge too
          requireInteraction: notification.requireInteraction || false
        }
      }
    };
    
    // Send via FCM Admin SDK
    const response = await admin.messaging().send(message);
    console.log(`[sendPushNotification] Successfully sent to ${userId}:`, response);
    
    return response;
  } catch (error) {
    console.error(`[sendPushNotification] Error sending to ${userId}:`, error);
    
    // Handle invalid token - remove it (cleanup operation)
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      try {
        // Use .update() with FieldValue.delete() to preserve other fields
        await db.collection('users').doc(userId).update({
          fcmToken: admin.firestore.FieldValue.delete(),
          notificationEnabled: false
        });
        console.log(`[sendPushNotification] Removed invalid token for ${userId}`);
      } catch (updateError) {
        console.error(`[sendPushNotification] Error removing invalid token:`, updateError);
      }
    }
    
    // Don't throw - notification failures shouldn't break the calling function
    return null;
  }
}

/**
 * Send push notification to all active users about new pending mission
 * @param {string} taskId - Task ID
 * @param {Object} taskData - Task data
 * @param {string} notificationType - Type of notification ('new_task' or 'task_activated')
 */
async function sendPendingMissionNotification(taskId, taskData, notificationType = 'new_task') {
  try {
    // Get all active users with FCM tokens (read-only query)
    const usersSnapshot = await db.collection('users')
      .where('role', '==', 'attendee')
      .where('status', '==', 'active')
      .where('notificationEnabled', '==', true)
      .get();
    
    if (usersSnapshot.empty) {
      console.log('[sendPendingMissionNotification] No active users with notifications enabled');
      return;
    }
    
    const taskTitle = taskData.title || 'New Mission';
    const points = taskData.points || 0;
    
    // Prepare notification message
    const notification = {
      type: notificationType,
      title: 'New Mission Available!',
      body: points > 0 
        ? `"${taskTitle}" is now available. Earn ${points} points!`
        : `"${taskTitle}" is now available. Check it out!`,
      data: {
        type: notificationType,
        taskId: taskId,
        taskTitle: taskTitle,
        points: String(points),
        url: `/tasks/${taskId}`
      },
      requireInteraction: false
    };
    
    // Send to all users in parallel (with batching to avoid rate limits)
    const BATCH_SIZE = 100; // FCM allows up to 500, but we'll be conservative
    const users = usersSnapshot.docs;
    
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      
      const sendPromises = batch.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Only send if user has FCM token
        if (userData.fcmToken) {
          try {
            await sendPushNotification(userId, notification);
          } catch (error) {
            // Log but continue with other users
            console.error(`[sendPendingMissionNotification] Error sending to ${userId}:`, error);
          }
        }
      });
      
      await Promise.allSettled(sendPromises);
      
      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`[sendPendingMissionNotification] Sent to ${users.length} users`);
  } catch (error) {
    console.error('[sendPendingMissionNotification] Error:', error);
    // Don't throw - notification failures shouldn't break task creation/update
  }
}

/**
 * Get count of pending missions for a user
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Count of pending missions
 */
async function getUserPendingMissionsCount(userId) {
  try {
    // Get user's pending activities from RTDB cache (read-only)
    const pendingRef = rtdb.ref(`users/${userId}/activityLists/pending`);
    const pendingSnap = await pendingRef.once('value');
    
    if (!pendingSnap.exists()) {
      return 0;
    }
    
    const pending = pendingSnap.val();
    const tasks = pending.tasks || [];
    const quizzes = pending.quizzes || [];
    const forms = pending.forms || [];
    
    return tasks.length + quizzes.length + forms.length;
  } catch (error) {
    console.error(`[getUserPendingMissionsCount] Error for ${userId}:`, error);
    return 0; // Return 0 on error to avoid blocking
  }
}

/**
 * Enhanced notification function that sends both RTDB and FCM
 * @param {string} userId - User ID
 * @param {Object} notification - Notification data
 * @param {boolean} sendPush - Whether to send push notification (default: true)
 */
async function sendUserNotification(userId, notification, sendPush = true) {
  // 1. Save to RTDB (for in-app notifications)
  await updateUserNotificationCache(userId, notification);
  
  // 2. Send FCM push notification (if enabled)
  if (sendPush) {
    try {
      await sendPushNotification(userId, {
        ...notification,
        body: notification.message || notification.body || '',
        data: {
          type: notification.type,
          taskId: notification.taskId || '',
          taskTitle: notification.taskTitle || '',
          points: String(notification.points || 0),
          url: notification.taskId ? `/tasks/${notification.taskId}` : '/'
        }
      });
    } catch (error) {
      console.error(`[sendUserNotification] Error sending push to ${userId}:`, error);
      // Non-critical - RTDB notification still works
    }
  }
}

/**
 * Scheduled function to send daily pending missions notifications
 * Runs daily at 10 AM (configurable timezone)
 * Only sends notifications to users who have pending missions
 */
exports.sendEngagementNotifications = onSchedule(
  {
    schedule: '0 10 * * *', // 10 AM daily (UTC)
    timeZone: 'Asia/Kolkata', // Adjust to your timezone
    region: region
  },
  async (event) => {
    console.log('[sendEngagementNotifications] Starting daily pending missions notifications');
    
    try {
      // Get all active users with notifications enabled (read-only query)
      const usersSnapshot = await db.collection('users')
        .where('role', '==', 'attendee')
        .where('status', '==', 'active')
        .where('notificationEnabled', '==', true)
        .get();
      
      if (usersSnapshot.empty) {
        console.log('[sendEngagementNotifications] No active users found');
        return;
      }
      
      let notificationsSent = 0;
      let usersSkipped = 0;
      
      // Get pending missions count for each user and send notifications only if they have pending missions
      const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        if (!userData.fcmToken) {
          usersSkipped++;
          return; // Skip users without FCM token
        }
        
        try {
          // Get user's pending missions count (read-only RTDB operation)
          const pendingCount = await getUserPendingMissionsCount(userId);
          
          // Only send notification if user has pending missions
          if (pendingCount > 0) {
            // User has pending missions - send notification
            const notification = {
              type: 'engagement_pending_missions',
              title: 'Pending Missions Reminder',
              body: `You have ${pendingCount} pending mission${pendingCount > 1 ? 's' : ''} waiting for you. Complete them to earn points!`,
              data: {
                type: 'engagement_pending_missions',
                pendingCount: String(pendingCount),
                url: '/'
              }
            };
            
            // Send push notification
            await sendPushNotification(userId, notification);
            notificationsSent++;
          } else {
            usersSkipped++;
            // User has no pending missions - skip notification
          }
          
        } catch (error) {
          console.error(`[sendEngagementNotifications] Error for user ${userId}:`, error);
          usersSkipped++;
          // Continue with other users
        }
      });
      
      await Promise.allSettled(notificationPromises);
      console.log(`[sendEngagementNotifications] Completed: ${notificationsSent} notifications sent, ${usersSkipped} users skipped`);
      
    } catch (error) {
      console.error('[sendEngagementNotifications] Error:', error);
      // Don't throw - scheduled functions should not fail silently, but we log the error
    }
  }
);

/**
 * HTTP function to send custom engagement notifications
 * Can be called manually or via cron job
 * 
 * Usage: POST https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/sendCustomEngagementNotifications
 * Headers: Authorization: Bearer <admin-token>
 * Body: { message: "Custom message", targetUsers: ["userId1", "userId2"] } (optional)
 */
exports.sendCustomEngagementNotifications = onRequest(
  {
    cors: true,
    region: region
  },
  async (request, response) => {
    // Verify admin authentication (basic check - can be enhanced)
    if (!request.headers.authorization) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    try {
      const { title, message, targetUsers, notificationType = 'engagement_custom' } = request.body || {};
      
      // Validate required fields
      if (!title || !message) {
        response.status(400).json({ error: 'Title and message are required' });
        return;
      }
      
      let usersQuery = db.collection('users')
        .where('role', '==', 'attendee')
        .where('status', '==', 'active')
        .where('notificationEnabled', '==', true);
      
      let usersSnapshot;
      
      // If specific users provided, filter by them
      // Note: Firestore 'in' query limit is 10, so we handle larger arrays by filtering client-side
      if (targetUsers && Array.isArray(targetUsers) && targetUsers.length > 0) {
        if (targetUsers.length <= 10) {
          // Use 'in' query for 10 or fewer users
          usersQuery = usersQuery.where(admin.firestore.FieldPath.documentId(), 'in', targetUsers);
          usersSnapshot = await usersQuery.get();
        } else {
          // For more than 10 users, fetch all and filter client-side
          const allUsersSnapshot = await usersQuery.get();
          const targetUsersSet = new Set(targetUsers);
          // Filter to only target users
          const filteredDocs = allUsersSnapshot.docs.filter(doc => targetUsersSet.has(doc.id));
          // Create a query snapshot-like object
          usersSnapshot = {
            docs: filteredDocs,
            empty: filteredDocs.length === 0,
            size: filteredDocs.length,
            forEach: function(callback) {
              filteredDocs.forEach(callback);
            }
          };
        }
      } else {
        usersSnapshot = await usersQuery.get();
      }
      
      if (usersSnapshot.empty) {
        response.json({ success: true, message: 'No users found', sent: 0 });
        return;
      }
      
      const sendPromises = usersSnapshot.docs.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        if (!userData.fcmToken) {
          return;
        }
        
        try {
          await sendPushNotification(userId, {
            type: notificationType,
            title: title,
            body: message,
            data: {
              type: notificationType,
              url: '/'
            }
          });
        } catch (error) {
          console.error(`[sendCustomEngagementNotifications] Error for ${userId}:`, error);
        }
      });
      
      await Promise.allSettled(sendPromises);
      
      response.json({
        success: true,
        message: 'Notifications sent',
        sent: usersSnapshot.size
      });
      
    } catch (error) {
      console.error('[sendCustomEngagementNotifications] Error:', error);
      response.status(500).json({ error: error.message });
    }
  }
);

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
    // OPTIMIZATION: Read users collection once and use snapshot for both operations
    const usersSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .where("status", "==", "active")
        .orderBy("points", "desc")
        .get();
    
    const activeAttendees = usersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    // Update leaderboard cache using snapshot (eliminates duplicate read)
    await updateLeaderboardCacheFromSnapshot(activeAttendees);
    
    // Also update stats cache for all users
    const updatePromises = usersSnapshot.docs.map(async (doc) => {
      const userId = doc.id;
      
      // Update stats cache
      await updateUserStatsCache(userId);
    });
    
    await Promise.all(updatePromises);
    
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
    // OPTIMIZATION: Read users collection once and use updateAllUserCaches
    const allAttendeesSnapshot = await db.collection("users")
        .where("role", "==", "attendee")
        .get();
    
    // Update admin caches
    await Promise.all([
      updateAllUserCaches(allAttendeesSnapshot), // Updates leaderboard, participants, and directory in one go
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
        // Step 1: Populate all user caches (directory, leaderboard, participants) in one go
        try {
          // OPTIMIZATION: Read users once and update all user caches
          const allAttendeesSnapshot = await db.collection("users")
              .where("role", "==", "attendee")
              .get();
          
          await updateAllUserCaches(allAttendeesSnapshot); // Updates directory, leaderboard, and participants
          steps.push("Step 1: All user caches populated (directory, leaderboard, participants)");
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

/**
 * Callable function to initialize admin stats running totals
 * Only accessible by admins
 * Run this ONCE before using incremental stats updates
 */
exports.initializeStatsTotals = onCall(
    {
      region: region,
      timeoutSeconds: 540,
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
      
      try {
        // Count Users
        const usersSnapshot = await db.collection("users")
          .where("role", "==", "attendee")
          .get();
        
        const activeUsers = usersSnapshot.docs.filter(doc => 
          doc.data().status === "active"
        ).length;
        
        const totalUsers = usersSnapshot.size;
        
        // Count Pending Users
        const pendingUsersSnapshot = await db.collection("pendingUsers").get();
        const pendingUsers = pendingUsersSnapshot.size;
        
        // Count Submissions by Status
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
        
        // Calculate Total Points
        let totalPoints = 0;
        usersSnapshot.forEach(doc => {
          totalPoints += doc.data().points || 0;
        });
        
        // Initialize Running Totals in RTDB
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
        
        return {
          success: true,
          message: "Stats totals initialized successfully",
          stats: statsData,
          timestamp: Date.now()
        };
      } catch (error) {
        console.error("Error initializing stats:", error);
        throw new Error(`Initialization failed: ${error.message}`);
      }
    }
);

/**
 * Callable function to backfill missing titles in submissions
 * Only accessible by admins
 * Run this ONCE to backfill existing submissions with titles
 */
exports.backfillSubmissionTitles = onCall(
    {
      region: region,
      timeoutSeconds: 540,
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
      
      try {
        let processed = 0;
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        
        // Process Task Submissions
        const taskSubmissionsSnapshot = await db.collection("submissions")
          .where("taskId", "!=", null)
          .get();
        
        let batch = db.batch();
        let batchCount = 0;
        const BATCH_SIZE = 500;
        
        for (const doc of taskSubmissionsSnapshot.docs) {
          try {
            const data = doc.data();
            
            if (data.taskTitle) {
              skipped++;
              continue;
            }
            
            let taskTitle = null;
            if (data.taskId) {
              try {
                const taskCacheRef = rtdb.ref(`adminCache/tasks/${data.taskId}`);
                const taskCacheSnap = await taskCacheRef.once('value');
                if (taskCacheSnap.exists()) {
                  taskTitle = taskCacheSnap.val()?.title || null;
                }
                
                if (!taskTitle) {
                  const taskDoc = await db.collection('tasks').doc(data.taskId).get();
                  if (taskDoc.exists) {
                    taskTitle = taskDoc.data().title || null;
                  }
                }
              } catch (error) {
                console.error(`Error fetching task title for ${data.taskId}:`, error);
                errors++;
                continue;
              }
            }
            
            if (taskTitle) {
              batch.update(doc.ref, { taskTitle: taskTitle });
              batchCount++;
              updated++;
              
              if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
              }
            } else {
              skipped++;
            }
            
            processed++;
          } catch (error) {
            console.error(`Error processing submission ${doc.id}:`, error);
            errors++;
          }
        }
        
        if (batchCount > 0) {
          await batch.commit();
        }
        
        const taskResults = { processed, updated, skipped, errors };
        
        // Process Form Submissions
        processed = 0;
        updated = 0;
        skipped = 0;
        errors = 0;
        batch = db.batch();
        batchCount = 0;
        
        const formSubmissionsSnapshot = await db.collection("formSubmissions").get();
        
        for (const doc of formSubmissionsSnapshot.docs) {
          try {
            const data = doc.data();
            
            if (data.formTitle) {
              skipped++;
              continue;
            }
            
            let formTitle = null;
            if (data.formId) {
              try {
                const formCacheRef = rtdb.ref(`adminCache/forms/${data.formId}`);
                const formCacheSnap = await formCacheRef.once('value');
                if (formCacheSnap.exists()) {
                  formTitle = formCacheSnap.val()?.title || null;
                }
                
                if (!formTitle) {
                  const formDoc = await db.collection('forms').doc(data.formId).get();
                  if (formDoc.exists) {
                    formTitle = formDoc.data().title || null;
                  }
                }
              } catch (error) {
                console.error(`Error fetching form title for ${data.formId}:`, error);
                errors++;
                continue;
              }
            }
            
            if (formTitle) {
              batch.update(doc.ref, { formTitle: formTitle });
              batchCount++;
              updated++;
              
              if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
              }
            } else {
              skipped++;
            }
            
            processed++;
          } catch (error) {
            console.error(`Error processing form submission ${doc.id}:`, error);
            errors++;
          }
        }
        
        if (batchCount > 0) {
          await batch.commit();
        }
        
        const formResults = { processed, updated, skipped, errors };
        
        // Process Quiz Submissions
        processed = 0;
        updated = 0;
        skipped = 0;
        errors = 0;
        batch = db.batch();
        batchCount = 0;
        
        const quizSubmissionsSnapshot = await db.collection("quizSubmissions").get();
        
        for (const doc of quizSubmissionsSnapshot.docs) {
          try {
            const data = doc.data();
            
            if (data.quizTitle) {
              skipped++;
              continue;
            }
            
            let quizTitle = null;
            if (data.quizId) {
              try {
                const quizCacheRef = rtdb.ref(`adminCache/quizzes/${data.quizId}`);
                const quizCacheSnap = await quizCacheRef.once('value');
                if (quizCacheSnap.exists()) {
                  quizTitle = quizCacheSnap.val()?.title || null;
                }
                
                if (!quizTitle) {
                  const quizDoc = await db.collection('quizzes').doc(data.quizId).get();
                  if (quizDoc.exists) {
                    quizTitle = quizDoc.data().title || null;
                  }
                }
              } catch (error) {
                console.error(`Error fetching quiz title for ${data.quizId}:`, error);
                errors++;
                continue;
              }
            }
            
            if (quizTitle) {
              batch.update(doc.ref, { quizTitle: quizTitle });
              batchCount++;
              updated++;
              
              if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
              }
            } else {
              skipped++;
            }
            
            processed++;
          } catch (error) {
            console.error(`Error processing quiz submission ${doc.id}:`, error);
            errors++;
          }
        }
        
        if (batchCount > 0) {
          await batch.commit();
        }
        
        const quizResults = { processed, updated, skipped, errors };
        
        return {
          success: true,
          message: "Title backfill complete",
          results: {
            tasks: taskResults,
            forms: formResults,
            quizzes: quizResults,
            total: {
              updated: taskResults.updated + formResults.updated + quizResults.updated,
              skipped: taskResults.skipped + formResults.skipped + quizResults.skipped,
              errors: taskResults.errors + formResults.errors + quizResults.errors
            }
          },
          timestamp: Date.now()
        };
      } catch (error) {
        console.error("Error backfilling titles:", error);
        throw new Error(`Backfill failed: ${error.message}`);
      }
    }
);

/**
 * Migration: Backfill missing titles in submissions
 * 
 * This script backfills missing taskTitle, formTitle, and quizTitle fields
 * in existing submissions so we can safely remove the fallback Firestore reads.
 * 
 * Run this ONCE before deploying Phase 3 changes:
 * cd functions && node migrations/backfill-submission-titles.js
 */

const admin = require("firebase-admin");

// Initialize with database URL
admin.initializeApp({
  databaseURL: "https://rzi2026chennai-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();
const rtdb = admin.database();

/**
 * Migration: Backfill missing titles in submissions
 */
async function backfillSubmissionTitles() {
  console.log("Starting submission title backfill migration...");
  console.log("Timestamp:", new Date().toISOString());
  
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  // ============================================
  // Process Task Submissions
  // ============================================
  console.log("\n=== Processing Task Submissions ===");
  
  const taskSubmissionsSnapshot = await db.collection("submissions")
    .where("taskId", "!=", null)
    .get();
  
  console.log(`Found ${taskSubmissionsSnapshot.size} task submissions`);
  
  let batch = db.batch();
  let batchCount = 0;
  const BATCH_SIZE = 500;
  
  for (const doc of taskSubmissionsSnapshot.docs) {
    try {
      const data = doc.data();
      
      // Skip if title already exists
      if (data.taskTitle) {
        skipped++;
        continue;
      }
      
      // Get title from RTDB cache (fast, no Firestore read)
      let taskTitle = null;
      if (data.taskId) {
        try {
          const taskCacheRef = rtdb.ref(`adminCache/tasks/${data.taskId}`);
          const taskCacheSnap = await taskCacheRef.once('value');
          if (taskCacheSnap.exists()) {
            taskTitle = taskCacheSnap.val()?.title || null;
          }
          
          // If not in cache, read from Firestore (fallback)
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
          console.log(`  Processed ${processed} submissions, updated ${updated}`);
        }
      } else {
        console.warn(`  Could not find title for task ${data.taskId} in submission ${doc.id}`);
        skipped++;
      }
      
      processed++;
    } catch (error) {
      console.error(`Error processing submission ${doc.id}:`, error);
      errors++;
    }
  }
  
  // Commit remaining batch
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  Committed final batch of ${batchCount} updates`);
  }
  
  console.log(`Task submissions: ${processed} processed, ${updated} updated, ${skipped} skipped, ${errors} errors`);
  
  // ============================================
  // Process Form Submissions
  // ============================================
  console.log("\n=== Processing Form Submissions ===");
  
  const formSubmissionsSnapshot = await db.collection("formSubmissions").get();
  console.log(`Found ${formSubmissionsSnapshot.size} form submissions`);
  
  batch = db.batch();
  batchCount = 0;
  processed = 0;
  let formUpdated = 0;
  let formSkipped = 0;
  let formErrors = 0;
  
  for (const doc of formSubmissionsSnapshot.docs) {
    try {
      const data = doc.data();
      
      // Skip if title already exists
      if (data.formTitle) {
        formSkipped++;
        continue;
      }
      
      // Get title from RTDB cache
      let formTitle = null;
      if (data.formId) {
        try {
          const formCacheRef = rtdb.ref(`adminCache/forms/${data.formId}`);
          const formCacheSnap = await formCacheRef.once('value');
          if (formCacheSnap.exists()) {
            formTitle = formCacheSnap.val()?.title || null;
          }
          
          // If not in cache, read from Firestore (fallback)
          if (!formTitle) {
            const formDoc = await db.collection('forms').doc(data.formId).get();
            if (formDoc.exists) {
              formTitle = formDoc.data().title || null;
            }
          }
        } catch (error) {
          console.error(`Error fetching form title for ${data.formId}:`, error);
          formErrors++;
          continue;
        }
      }
      
      if (formTitle) {
        batch.update(doc.ref, { formTitle: formTitle });
        batchCount++;
        formUpdated++;
        
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
          console.log(`  Processed ${processed} submissions, updated ${formUpdated}`);
        }
      } else {
        console.warn(`  Could not find title for form ${data.formId} in submission ${doc.id}`);
        formSkipped++;
      }
      
      processed++;
    } catch (error) {
      console.error(`Error processing form submission ${doc.id}:`, error);
      formErrors++;
    }
  }
  
  // Commit remaining batch
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  Committed final batch of ${batchCount} updates`);
  }
  
  console.log(`Form submissions: ${processed} processed, ${formUpdated} updated, ${formSkipped} skipped, ${formErrors} errors`);
  
  // ============================================
  // Process Quiz Submissions
  // ============================================
  console.log("\n=== Processing Quiz Submissions ===");
  
  const quizSubmissionsSnapshot = await db.collection("quizSubmissions").get();
  console.log(`Found ${quizSubmissionsSnapshot.size} quiz submissions`);
  
  batch = db.batch();
  batchCount = 0;
  processed = 0;
  let quizUpdated = 0;
  let quizSkipped = 0;
  let quizErrors = 0;
  
  for (const doc of quizSubmissionsSnapshot.docs) {
    try {
      const data = doc.data();
      
      // Skip if title already exists
      if (data.quizTitle) {
        quizSkipped++;
        continue;
      }
      
      // Get title from RTDB cache
      let quizTitle = null;
      if (data.quizId) {
        try {
          const quizCacheRef = rtdb.ref(`adminCache/quizzes/${data.quizId}`);
          const quizCacheSnap = await quizCacheRef.once('value');
          if (quizCacheSnap.exists()) {
            quizTitle = quizCacheSnap.val()?.title || null;
          }
          
          // If not in cache, read from Firestore (fallback)
          if (!quizTitle) {
            const quizDoc = await db.collection('quizzes').doc(data.quizId).get();
            if (quizDoc.exists) {
              quizTitle = quizDoc.data().title || null;
            }
          }
        } catch (error) {
          console.error(`Error fetching quiz title for ${data.quizId}:`, error);
          quizErrors++;
          continue;
        }
      }
      
      if (quizTitle) {
        batch.update(doc.ref, { quizTitle: quizTitle });
        batchCount++;
        quizUpdated++;
        
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
          console.log(`  Processed ${processed} submissions, updated ${quizUpdated}`);
        }
      } else {
        console.warn(`  Could not find title for quiz ${data.quizId} in submission ${doc.id}`);
        quizSkipped++;
      }
      
      processed++;
    } catch (error) {
      console.error(`Error processing quiz submission ${doc.id}:`, error);
      quizErrors++;
    }
  }
  
  // Commit remaining batch
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  Committed final batch of ${batchCount} updates`);
  }
  
  console.log(`Quiz submissions: ${processed} processed, ${quizUpdated} updated, ${quizSkipped} skipped, ${quizErrors} errors`);
  
  // ============================================
  // Summary
  // ============================================
  console.log("\n=== Migration Complete ===");
  console.log(`Total task submissions processed: ${taskSubmissionsSnapshot.size}`);
  console.log(`  - Updated: ${updated}`);
  console.log(`  - Skipped (already had title): ${skipped}`);
  console.log(`  - Errors: ${errors}`);
  console.log(`\nTotal form submissions processed: ${formSubmissionsSnapshot.size}`);
  console.log(`  - Updated: ${formUpdated}`);
  console.log(`  - Skipped (already had title): ${formSkipped}`);
  console.log(`  - Errors: ${formErrors}`);
  console.log(`\nTotal quiz submissions processed: ${quizSubmissionsSnapshot.size}`);
  console.log(`  - Updated: ${quizUpdated}`);
  console.log(`  - Skipped (already had title): ${quizSkipped}`);
  console.log(`  - Errors: ${quizErrors}`);
  console.log(`\nTotal updated: ${updated + formUpdated + quizUpdated}`);
  console.log(`Total skipped: ${skipped + formSkipped + quizSkipped}`);
  console.log(`Total errors: ${errors + formErrors + quizErrors}`);
}

// Run migration
backfillSubmissionTitles()
  .then(() => {
    console.log("\n✅ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  });

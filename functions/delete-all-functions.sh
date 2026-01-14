#!/bin/bash

# Script to delete all Firebase Cloud Functions
# Usage: ./delete-all-functions.sh

PROJECT_ID="rzi2026chennai"
REGION="us-central1"

echo "⚠️  WARNING: This will delete ALL Cloud Functions!"
echo ""
read -p "Are you sure you want to continue? Type 'yes' to confirm: " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Deleting all functions..."

# List of all function names (update this if you add/remove functions)
FUNCTIONS=(
    "checkCacheHealth"
    "initializeCaches"
    "migrateToEnhancedStructure"
    "onAdminCreate"
    "onAdminDelete"
    "onAdminUpdate"
    "onFormCreate"
    "onFormDelete"
    "onFormSubmissionCreate"
    "onFormUpdate"
    "onPendingUserCreate"
    "onPendingUserDelete"
    "onPendingUserUpdate"
    "onQuizCreate"
    "onQuizDelete"
    "onQuizSubmissionCreate"
    "onQuizUpdate"
    "onSubmissionCreate"
    "onSubmissionDelete"
    "onSubmissionUpdate"
    "onTaskCreate"
    "onTaskDelete"
    "onTaskUpdate"
    "onUserCreate"
    "onUserDelete"
    "onUserUpdate"
    "refreshUserActivityLists"
    "scheduledCacheRefresh"
    "syncAdmins"
    "syncAdminsCallable"
    "updateAttendeeDirectory"
)

# Delete each function
for func in "${FUNCTIONS[@]}"; do
    echo "Deleting $func..."
    firebase functions:delete "$func" --region "$REGION" --project "$PROJECT_ID" --force 2>/dev/null || echo "  (Function $func may not exist or already deleted)"
done

echo ""
echo "✅ All functions deleted!"
echo ""
echo "You can now deploy fresh functions with:"
echo "  firebase deploy --only functions --project $PROJECT_ID"

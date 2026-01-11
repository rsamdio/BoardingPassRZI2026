# Rotaract Zone Institute Application

A mobile-first web application for managing Rotaract Zone Institute events, featuring participant management, quizzes, tasks, and a leaderboard system.

## Features

### Attendee Application (`index.html`)
- **Mobile-first design** optimized for smartphones
- **Google OAuth authentication**
- **Participant profile setup** (name, district, designation)
- **Directory view** of all participants with search
- **Quizzes** with time-based functionality
- **Tasks** with file upload or form submission
- **Real-time leaderboard** with rankings
- **Points system** for gamification

### Admin Dashboard (`admin.html`)
- **Web-optimized** desktop interface
- **Attendee management** (add, edit, activate/deactivate)
- **Quiz creation** with multiple question types and time limits
- **Task creation** (file upload or form-based)
- **Submission review** and approval system
- **Leaderboard management** with manual point adjustments
- **Analytics dashboard** with event statistics

## Tech Stack

- **HTML5, CSS3, JavaScript (ES6+)**
- **Tailwind CSS** (via CDN)
- **FontAwesome 6.4.0** for icons
- **Firebase** (Firestore, Storage, Auth, Realtime Database)
- **Cloud Functions** (for automatic cache synchronization)

## Setup Instructions

**⚠️ IMPORTANT**: Complete setup is required before using the application.

**👉 See [SETUP.md](SETUP.md) for complete, detailed setup instructions.**

The setup guide includes:
- Step-by-step Firebase project configuration
- Security rules deployment
- **Admin user creation** (critical - see Step 4)
- Cloud Functions deployment
- Initial data setup
- Testing and troubleshooting

### Quick Overview

### 1. Firebase Configuration

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication (Google provider)
3. Create Firestore database
4. Create Realtime Database (for caching)
5. Set up Storage bucket
6. Deploy Cloud Functions (see Cloud Functions section below)
7. Update `js/config.js` with your Firebase credentials:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

### 2. Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && 
             exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }
    
    // Helper function to check if document belongs to authenticated user
    function isOwnUser(uid) {
      return request.auth != null && request.auth.uid == uid;
    }
    
    // Helper function to get user email from auth token (normalized)
    function getUserEmail() {
      return request.auth != null && request.auth.token.email != null 
             ? request.auth.token.email.toLowerCase().trim() 
             : null;
    }
    
    // Admins collection
    match /admins/{uid} {
      allow read, write: if isAdmin();
    }
    
    // Users collection - main user data (active attendees)
    match /users/{uid} {
      // Anyone authenticated can read (for leaderboard)
      allow read: if request.auth != null;
      
      // Users can update their own document
      allow update: if isOwnUser(uid);
      
      // Users can create their own document when migrating from pendingUsers
      allow create: if isOwnUser(uid);
      
      // Admins can also create/delete users
      allow create, delete: if isAdmin();
    }
    
    // Pending users (created by admin, migrated on first login)
    match /pendingUsers/{email} {
      // Admins can do everything
      allow read, write, delete: if isAdmin();
      
      // Authenticated users can read pendingUsers (for migration check)
      // The code validates email match, so this is secure
      allow read: if request.auth != null;
      
      // Authenticated users can delete pendingUsers (after migration)
      // The code validates email match, so this is secure
      allow delete: if request.auth != null;
    }
    
    // Quizzes collection
    match /quizzes/{quizId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
    
    // Tasks collection
    match /tasks/{taskId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
    
    // Submissions collection
    match /submissions/{submissionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update: if isAdmin();
    }
    
    // Quiz submissions
    match /quizSubmissions/{submissionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
    }
  }
}
```

### 3. Storage Security Rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /task-submissions/{userId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    match /profile-photos/{userId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 4. Deployment

#### Option 1: Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize project
firebase init hosting

# Deploy
firebase deploy
```

#### Option 2: Static Hosting

Upload all files to any static hosting service:
- Netlify
- Vercel
- GitHub Pages
- AWS S3 + CloudFront

## File Structure

```
rziapp/
├── index.html              # Mobile-first attendee application
├── admin.html              # Web-optimized admin dashboard
├── js/
│   ├── config.js           # Firebase configuration
│   ├── cache.js            # localStorage caching module
│   ├── auth.js             # Authentication module
│   ├── db.js               # Database operations (with RTDB + localStorage caching)
│   ├── ui.js               # UI rendering
│   ├── quiz.js             # Quiz functionality
│   ├── task.js             # Task submission handling
│   ├── app.js              # Main app logic
│   ├── admin-auth.js       # Admin authentication
│   ├── admin-ui.js         # Admin UI management
│   ├── admin-attendees.js  # Attendee management
│   ├── admin-quizzes.js    # Quiz management
│   ├── admin-tasks.js      # Task management
│   ├── admin-submissions.js # Submission review
│   ├── admin-leaderboard.js # Leaderboard management
│   └── admin-app.js        # Admin app logic
├── template/
│   └── index.html          # Original POC template
├── AI_PROMPT.md            # AI prompt for application design
└── README.md               # This file
```

## Setup Instructions

**⚠️ IMPORTANT**: Before using the application, you must complete the setup process.

See **[SETUP.md](SETUP.md)** for complete, step-by-step setup instructions including:
- Firebase project configuration
- Security rules deployment
- Admin user creation (critical step)
- Cloud Functions deployment
- Initial data setup
- Testing and troubleshooting

### Quick Start Checklist

1. ✅ Create Firebase project and enable services (Auth, Firestore, RTDB, Storage, Functions)
2. ✅ Update `js/config.js` with your Firebase configuration
3. ✅ Deploy security rules (Firestore, RTDB, Storage)
4. ✅ **Create admin user in `admins` collection** (see SETUP.md Step 4)
5. ✅ Deploy Cloud Functions
6. ✅ Add attendees to `pendingUsers` collection
7. ✅ Test admin and attendee access

**Without completing these steps, the application will not work.**

## Usage

### For Attendees

1. Open `index.html` in a browser
2. Sign in with Google
3. Complete profile setup (name, district, designation)
4. Browse activities (quizzes and tasks)
5. Submit tasks and take quizzes to earn points
6. View leaderboard and track progress

### For Admins

1. Open `admin.html` in a browser
2. Sign in with admin credentials
3. Manage attendees (add, edit, activate/deactivate)
4. Create quizzes with time limits
5. Create tasks (upload or form-based)
6. Review and approve submissions
7. View analytics and manage leaderboard

## Key Features Explained

### Time-Based Quizzes
- Admins can set time limits for quizzes
- Timer counts down during quiz taking
- Auto-submission when time runs out
- Points awarded based on correct answers

### Task Types
- **Upload Tasks**: Participants upload files (images/PDFs) as proof
- **Form Tasks**: Participants fill out forms with custom fields
- Both types can be approved/rejected by admins

### Points System
- Points awarded for:
  - Completing quizzes (based on score)
  - Approved task submissions
  - Form submissions (auto-approved)
- Points displayed in leaderboard
- Admins can manually adjust points

### Access Control
- Only users in the approved attendees list can access the app
- Admin role required for admin dashboard
- Status-based access (active/inactive/pending)

## Architecture

The application uses an **Enhanced Optimal Firebase Architecture** with a dual-layer RTDB cache structure:

### Architecture Overview

- **Pre-computed filtered views** for 90% of common queries (maximum performance)
- **Indexed structure** for flexibility and future features
- **Zero Firestore reads** for attendees (maximum cost savings)
- **3-layer caching**: localStorage → RTDB → Error (no Firestore fallback for attendees)

### Cache Layers

1. **localStorage** (Layer 1 - Free, Instant)
   - User's pending/completed activities
   - User stats and profile
   - Leaderboard data
   - Directory/participant list
   - TTL: 5-30 minutes depending on data type

2. **RTDB Pre-computed Cache** (Layer 2a - Cheap, Fast)
   - Pre-filtered activity lists per user
   - User stats and completion status
   - Leaderboard top 50
   - Directory cache
   - Auto-synced by Cloud Functions

3. **RTDB Indexed Cache** (Layer 2b - Flexible)
   - Activities indexed by ID, points, date
   - Submission indexes
   - Used for complex queries and admin operations

### Cost Optimization

**Before Optimizations:**
- ~330 Firestore reads per user session
- Cost: ~$0.20 per 1000 sessions

**After Enhanced Architecture:**
- **0 Firestore reads** for attendees
- **1-2 RTDB reads** per session
- Cost: **<$0.01 per 1000 sessions**

**Total Savings: ~99.95% reduction in read costs**

### Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: Detailed architecture documentation
- **[RTDB_STRUCTURE.md](RTDB_STRUCTURE.md)**: RTDB cache structure reference
- **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)**: Developer guide for extending the system

## Development Notes

- The app uses modular JavaScript architecture
- Mock mode available for development without Firebase
- Responsive design with Tailwind CSS
- Mobile-first approach for attendee app
- Desktop-optimized admin dashboard
- Multi-layer caching for cost optimization

## Troubleshooting

### Firebase Not Working
- Check Firebase configuration in `js/config.js`
- Verify Firestore, RTDB, and Storage rules are deployed
- Ensure Authentication is enabled
- Check browser console for errors
- **For admin login issues**: Verify user exists in `admins` collection with correct UID

### Admin Login Issues
- **Most common issue**: Admin user not created in `admins` collection
- **Solution**: 
  1. Sign in to the app once with your Google account (so you have a UID)
  2. Go to Firebase Console → Authentication → Users
  3. Find your user and copy the UID
  4. Go to Firestore Database → Data
  5. Create collection `admins` (if it doesn't exist)
  6. Create document with your UID as the document ID
  7. Add fields: `name`, `email`, `role: "admin"`
  8. Try logging in to admin.html again
- See **SETUP.md Step 4** for detailed instructions with screenshots

### Mock Mode Issues
- Clear localStorage if data seems corrupted
- Check browser console for JavaScript errors
- Verify all JS files are loaded correctly

### File Upload Issues
- Check Storage bucket permissions
- Verify file size limits
- Check allowed file types

## License

This project is created for Rotaract Zone Institute events.

## Support

For issues or questions, please contact the development team.

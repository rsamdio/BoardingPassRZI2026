// Client-side Caching Module
// Reduces Firestore reads by caching frequently accessed data in localStorage

const Cache = {
    // Cache TTLs (Time To Live)
    // Increased TTLs for static data to reduce Firestore reads
    TTL: {
        USER_DATA: 5 * 60 * 1000,      // 5 minutes (user data changes frequently)
        QUIZ_LIST: 30 * 60 * 1000,     // 30 minutes (quizzes rarely change)
        TASK_LIST: 30 * 60 * 1000,     // 30 minutes (tasks rarely change)
        LEADERBOARD: 5 * 60 * 1000,    // 5 minutes (increased from 2 min)
        RANK: 5 * 60 * 1000,            // 5 minutes (increased from 2 min)
        DIRECTORY: 10 * 60 * 1000       // 10 minutes (increased from 5 min)
    },
    
    // Get cached data
    get(key) {
        try {
            const cached = localStorage.getItem(key);
            if (!cached) return null;
            
            const data = JSON.parse(cached);
            const now = Date.now();
            
            // Check if cache is still valid
            if (data.timestamp && (now - data.timestamp) < (this.TTL[data.type] || 0)) {
                return data.value;
            }
            
            // Cache expired, remove it
            localStorage.removeItem(key);
            return null;
        } catch (error) {
            // Invalid cache, remove it
            localStorage.removeItem(key);
            return null;
        }
    },
    
    // Set cached data
    set(key, value, type) {
        try {
            localStorage.setItem(key, JSON.stringify({
                value: value,
                type: type,
                timestamp: Date.now()
            }));
        } catch (error) {
            // localStorage might be full or disabled, ignore
        }
    },
    
    // Clear specific cache
    clear(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            // Ignore
        }
    },
    
    // Clear all app caches
    clearAll() {
        try {
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.startsWith('cache_') || key.startsWith('user_')) {
                    localStorage.removeItem(key);
                }
            });
        } catch (error) {
            // Ignore
        }
    },
    
    // Cache keys
    keys: {
        userData: (uid) => `user_${uid}_data`,
        quizList: () => 'cache_quiz_list',
        taskList: () => 'cache_task_list',
        leaderboard: () => 'cache_leaderboard',
        userRank: (uid) => `user_${uid}_rank`,
        directory: () => 'cache_directory',
        completedQuizzes: (uid) => `user_${uid}_completed_quizzes`,
        submissions: (uid) => `user_${uid}_submissions`,
        allAttendees: () => 'cache_all_attendees'
    }
};

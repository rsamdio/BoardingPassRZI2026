// Simple in-memory cache for the admin panel
// NOTE: This is per-tab/session only (not shared across users or tabs)

const MemoryCache = {
    /**
     * Internal cache map.
     * key -> { value: any, expiresAt: number | null }
     */
    _cache: new Map(),

    /**
     * Store a value in the cache.
     * @param {string} key
     * @param {any} value
     * @param {number} ttlMs Time-to-live in milliseconds (default: 5 minutes)
     */
    set(key, value, ttlMs = 5 * 60 * 1000) {
        const now = Date.now();
        const expiresAt = ttlMs > 0 ? now + ttlMs : null;
        this._cache.set(key, { value, expiresAt });
    },

    /**
     * Get a value from the cache.
     * Returns undefined if missing or expired.
     * @param {string} key
     * @returns {any | undefined}
     */
    get(key) {
        const entry = this._cache.get(key);
        if (!entry) {
            return undefined;
        }

        const { value, expiresAt } = entry;
        if (expiresAt !== null && Date.now() > expiresAt) {
            // Expired - remove and return undefined
            this._cache.delete(key);
            return undefined;
        }

        return value;
    },

    /**
     * Check if the cache has a non-expired value for the key.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return this.get(key) !== undefined;
    },

    /**
     * Delete a single cache entry.
     * @param {string} key
     */
    delete(key) {
        this._cache.delete(key);
    },

    /**
     * Clear all cache entries.
     */
    clearAll() {
        this._cache.clear();
    },

    /**
     * Clear all keys that start with the given prefix.
     * Used for invalidating quiz/task/form specific caches, e.g. 'quiz:'.
     * @param {string} prefix
     */
    clearPrefix(prefix) {
        if (!prefix) return;
        for (const key of this._cache.keys()) {
            if (key.startsWith(prefix)) {
                this._cache.delete(key);
            }
        }
    }
};


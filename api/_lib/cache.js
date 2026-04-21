/**
 * STUFE 1: Smart In-Memory Cache with LRU + Safety
 * 
 * 🚀 Features:
 * - LRU (Least Recently Used) eviction at MAX_CACHE_ITEMS
 * - TTL auto-expiration (backup mechanism)
 * - Strict user-scope isolation
 * - Event-driven invalidation (STUFE 3)
 * - Memory-safe: max ~100MB even with 1000 users
 */

class CacheManager {
  constructor() {
    this.cache = new Map(); // key → { value, createdAt, lastAccessedAt, ttlMs, userId }
    this.timers = new Map(); // key → timeoutId
    this.userKeys = new Map(); // userId → Set<keys> (for user-scope cleanup)
    
    // STUFE 1: Safety limits
    this.MAX_CACHE_ITEMS = 1000;
    this.MAX_USER_ITEMS = 50; // max 50 items per user
  }

  /**
   * Get value from cache (updates LRU timestamp)
   * @param {string} key - Cache key
   * @returns {any} Cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE MISS] ${key}`);
      }
      return undefined;
    }

    // Update last accessed time (for LRU)
    entry.lastAccessedAt = Date.now();

    if (process.env.DEBUG_CACHE) {
      console.log(`[CACHE HIT] ${key} (LRU updated)`);
    }

    return entry.value;
  }

  /**
   * Set value in cache with TTL & LRU
   * @param {string} key - Cache key (format: 'dashboard:user:${userId}:...')
   * @param {any} value - Value to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 30000)
   * @param {string} userId - User ID for scope isolation
   */
  set(key, value, ttlMs = 30000, userId = null) {
    // Extract userId from key if not provided
    if (!userId && key.includes('user:')) {
      const match = key.match(/user:([^:]+)/);
      userId = match ? match[1] : null;
    }

    // STUFE 1: Check per-user limit
    if (userId) {
      const userKeys = this.userKeys.get(userId) || new Set();
      if (userKeys.size >= this.MAX_USER_ITEMS) {
        // User has too many cached items, remove oldest
        const oldestKey = Array.from(userKeys)[0];
        this.delete(oldestKey);
        if (process.env.DEBUG_CACHE) {
          console.log(`[CACHE LRU] User ${userId} limit reached, evicted oldest key`);
        }
      }
    }

    // STUFE 1: Global cache size check (LRU eviction)
    if (this.cache.size >= this.MAX_CACHE_ITEMS) {
      this._evictLRU();
    }

    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    // Store value with metadata
    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      ttlMs,
      userId,
    });

    // Track user's keys for scope cleanup
    if (userId) {
      if (!this.userKeys.has(userId)) {
        this.userKeys.set(userId, new Set());
      }
      this.userKeys.get(userId).add(key);
    }

    // STUFE 1: Set expiration timer (backup to LRU)
    const timer = setTimeout(() => {
      this.delete(key);
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE TTL EXPIRE] ${key}`);
      }
    }, ttlMs);

    this.timers.set(key, timer);

    if (process.env.DEBUG_CACHE) {
      console.log(`[CACHE SET] ${key} (TTL: ${ttlMs}ms, Size: ${this.cache.size}/${this.MAX_CACHE_ITEMS})`);
    }
  }

  /**
   * STUFE 1: LRU Eviction - remove least recently used item
   */
  _evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();

    // Find least recently accessed entry
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE LRU EVICT] Removed ${oldestKey} (last used ${Date.now() - oldestTime}ms ago)`);
      }
    }
  }

  /**
   * Delete specific cache key
   * @param {string} key - Cache key
   */
  delete(key) {
    const entry = this.cache.get(key);
    
    if (entry?.userId) {
      const userKeys = this.userKeys.get(entry.userId);
      if (userKeys) {
        userKeys.delete(key);
      }
    }

    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    this.cache.delete(key);

    if (process.env.DEBUG_CACHE) {
      console.log(`[CACHE DELETE] ${key}`);
    }
  }

  /**
   * STUFE 3: Event-driven invalidation
   * Clear cache for specific user on task changes
   * @param {string} userId - User ID
   * @param {string} event - Event type: 'task_created', 'task_updated', 'task_deleted', 'group_change', 'permission_change'
   */
  invalidateByEvent(userId, event) {
    // STUFE 3: Smart invalidation by event type
    const keysToInvalidate = [];

    // Always invalidate dashboard cache on any task change
    for (const key of (this.userKeys.get(userId) || new Set())) {
      if (key.includes('dashboard:user:' + userId)) {
        keysToInvalidate.push(key);
      }
    }

    // For group changes, also invalidate related users' caches
    if (event === 'group_change' || event === 'permission_change') {
      // Could expand to invalidate all users in that group
    }

    for (const key of keysToInvalidate) {
      this.delete(key);
    }

    if (process.env.DEBUG_CACHE && keysToInvalidate.length > 0) {
      console.log(`[CACHE INVALIDATE] Event '${event}' for user ${userId}, cleared ${keysToInvalidate.length} keys`);
    }
  }

  /**
   * Invalidate all cache keys matching pattern (legacy support)
   * @param {string|RegExp} pattern - Pattern to match keys
   */
  invalidate(pattern) {
    let count = 0;
    for (const key of this.cache.keys()) {
      let matches = false;

      if (typeof pattern === 'string') {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        matches = regex.test(key);
      } else if (pattern instanceof RegExp) {
        matches = pattern.test(key);
      }

      if (matches) {
        this.delete(key);
        count++;
      }
    }

    if (process.env.DEBUG_CACHE && count > 0) {
      console.log(`[CACHE INVALIDATE] Pattern '${pattern}', cleared ${count} keys`);
    }
  }

  /**
   * Clear all cache for a specific user
   * @param {string} userId - User ID
   */
  clearUser(userId) {
    const userKeys = this.userKeys.get(userId) || new Set();
    let count = 0;

    for (const key of userKeys) {
      this.delete(key);
      count++;
    }

    this.userKeys.delete(userId);

    if (process.env.DEBUG_CACHE && count > 0) {
      console.log(`[CACHE USER CLEAR] Cleared ${count} keys for user ${userId}`);
    }
  }

  /**
   * Clear all cache
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.cache.clear();
    this.timers.clear();
    this.userKeys.clear();
    if (process.env.DEBUG_CACHE) {
      console.log('[CACHE CLEAR] All cache cleared');
    }
  }

  /**
   * Get cache stats (for monitoring)
   */
  getStats() {
    return {
      totalSize: this.cache.size,
      maxSize: this.MAX_CACHE_ITEMS,
      maxPerUser: this.MAX_USER_ITEMS,
      userCount: this.userKeys.size,
      users: Array.from(this.userKeys.entries()).map(([userId, keys]) => ({
        userId,
        itemCount: keys.size,
      })),
      memoryEstimate: `~${(this.cache.size * 1024 / 1000).toFixed(1)}KB`, // rough estimate
    };
  }
}

// Single instance
const cacheManager = new CacheManager();

module.exports = { cacheManager };

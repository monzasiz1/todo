const { Redis } = require('@upstash/redis');

const DEFAULT_TTL_SECONDS = 30;
const FALLBACK_MAX_CACHE_ITEMS = 1000;
const FALLBACK_MAX_USER_ITEMS = 50;

class MemoryFallbackCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
    this.userKeys = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.lastAccessedAt = Date.now();
    return entry.value;
  }

  set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS, userId = null) {
    if (userId) {
      const userKeySet = this.userKeys.get(userId) || new Set();
      if (userKeySet.size >= FALLBACK_MAX_USER_ITEMS) {
        const oldestKey = Array.from(userKeySet)[0];
        this.delete(oldestKey);
      }
    }

    if (this.cache.size >= FALLBACK_MAX_CACHE_ITEMS) {
      this.evictLRU();
    }

    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    this.cache.set(key, {
      value,
      userId,
      lastAccessedAt: Date.now(),
    });

    if (userId) {
      if (!this.userKeys.has(userId)) {
        this.userKeys.set(userId, new Set());
      }
      this.userKeys.get(userId).add(key);
    }

    const timer = setTimeout(() => this.delete(key), ttlSeconds * 1000);
    this.timers.set(key, timer);
  }

  delete(key) {
    const entry = this.cache.get(key);
    if (entry?.userId && this.userKeys.has(entry.userId)) {
      this.userKeys.get(entry.userId).delete(key);
      if (this.userKeys.get(entry.userId).size === 0) {
        this.userKeys.delete(entry.userId);
      }
    }

    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    this.cache.delete(key);
  }

  clearUser(userId) {
    const keys = Array.from(this.userKeys.get(userId) || []);
    for (const key of keys) {
      this.delete(key);
    }
  }

  invalidateByPrefix(prefix) {
    const keys = Array.from(this.cache.keys()).filter((key) => key.startsWith(prefix));
    for (const key of keys) {
      this.delete(key);
    }
    return keys.length;
  }

  invalidateByEvent(userId) {
    return this.invalidateByPrefix(`dashboard:user:${userId}:`);
  }

  evictLRU() {
    let oldestKey = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  getStats() {
    return {
      backend: 'memory',
      totalSize: this.cache.size,
      maxSize: FALLBACK_MAX_CACHE_ITEMS,
      maxPerUser: FALLBACK_MAX_USER_ITEMS,
      userCount: this.userKeys.size,
      users: Array.from(this.userKeys.entries()).map(([userId, keys]) => ({ userId, itemCount: keys.size })),
    };
  }
}

class CacheManager {
  constructor() {
    this.memory = new MemoryFallbackCache();
    this.redis = null;
    this.redisEnabled = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

    if (this.redisEnabled) {
      this.redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
  }

  get backendName() {
    return this.redis ? 'redis' : 'memory';
  }

  async get(key) {
    if (this.redis) {
      try {
        const value = await this.redis.get(key);
        return value === null ? undefined : value;
      } catch (error) {
        console.error('Redis get failed, falling back to memory:', error);
      }
    }

    return this.memory.get(key);
  }

  async set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS, userId = null) {
    if (this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        pipeline.set(key, value, { ex: ttlSeconds });
        if (userId) {
          pipeline.sadd(`dashboard:userkeys:${userId}`, key);
          pipeline.expire(`dashboard:userkeys:${userId}`, ttlSeconds);
        }
        await pipeline.exec();
        return;
      } catch (error) {
        console.error('Redis set failed, falling back to memory:', error);
      }
    }

    this.memory.set(key, value, ttlSeconds, userId);
  }

  async delete(key) {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (error) {
        console.error('Redis delete failed, falling back to memory:', error);
      }
    }

    this.memory.delete(key);
  }

  async clearUser(userId) {
    if (this.redis) {
      try {
        const userKeyIndex = `dashboard:userkeys:${userId}`;
        const keys = await this.redis.smembers(userKeyIndex);
        if (Array.isArray(keys) && keys.length > 0) {
          await this.redis.del(...keys);
        }
        await this.redis.del(userKeyIndex);
      } catch (error) {
        console.error('Redis clearUser failed, falling back to memory:', error);
      }
    }

    this.memory.clearUser(userId);
  }

  async invalidateByEvent(userId, event) {
    if (this.redis) {
      try {
        const userKeyIndex = `dashboard:userkeys:${userId}`;
        const keys = await this.redis.smembers(userKeyIndex);
        if (Array.isArray(keys) && keys.length > 0) {
          await this.redis.del(...keys);
        }
        await this.redis.del(userKeyIndex);
      } catch (error) {
        console.error(`Redis invalidateByEvent failed for ${event}, falling back to memory:`, error);
      }
    }

    this.memory.invalidateByEvent(userId);
  }

  async getStats() {
    const memoryStats = this.memory.getStats();
    return {
      backend: this.backendName,
      redisEnabled: this.redisEnabled,
      memoryFallback: memoryStats,
    };
  }
}

const cacheManager = new CacheManager();

module.exports = { cacheManager, DEFAULT_TTL_SECONDS };

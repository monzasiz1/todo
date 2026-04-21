const { gzipSync, gunzipSync } = require('zlib');

const DEFAULT_TTL_SECONDS = 30;
const FALLBACK_MAX_CACHE_ITEMS = 1000;
const FALLBACK_MAX_USER_ITEMS = 50;
const REDIS_VALUE_GZIP_PREFIX = 'gz:';

class UpstashRestRedis {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async command(args) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(`Upstash command failed: ${response.status}`);
    }

    const payload = await response.json();
    return payload?.result;
  }

  async get(key) {
    return this.command(['GET', key]);
  }

  static encodeValue(value) {
    const json = JSON.stringify(value);
    const gz = gzipSync(Buffer.from(json, 'utf8'));
    return `${REDIS_VALUE_GZIP_PREFIX}${gz.toString('base64')}`;
  }

  static decodeValue(rawValue) {
    if (rawValue === null || rawValue === undefined) return undefined;
    if (typeof rawValue !== 'string') return rawValue;

    if (rawValue.startsWith(REDIS_VALUE_GZIP_PREFIX)) {
      const b64 = rawValue.slice(REDIS_VALUE_GZIP_PREFIX.length);
      const json = gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
      return JSON.parse(json);
    }

    return JSON.parse(rawValue);
  }

  async set(key, encodedValue, ttlSeconds) {
    return this.command(['SET', key, encodedValue, 'EX', String(ttlSeconds)]);
  }

  async sadd(key, member) {
    return this.command(['SADD', key, member]);
  }

  async smembers(key) {
    return this.command(['SMEMBERS', key]);
  }

  async expire(key, ttlSeconds) {
    return this.command(['EXPIRE', key, String(ttlSeconds)]);
  }

  async del(...keys) {
    if (!keys.length) return 0;
    return this.command(['DEL', ...keys]);
  }
}

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
      this.redis = new UpstashRestRedis(
        process.env.UPSTASH_REDIS_REST_URL,
        process.env.UPSTASH_REDIS_REST_TOKEN
      );
    }
  }

  get backendName() {
    return this.redis ? 'redis' : 'memory';
  }

  async get(key) {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        return UpstashRestRedis.decodeValue(raw);
      } catch (error) {
        console.error('Redis get failed, falling back to memory:', error);
      }
    }

    return this.memory.get(key);
  }

  async set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS, userId = null) {
    if (this.redis) {
      try {
        const encoded = UpstashRestRedis.encodeValue(value);
        await this.redis.set(key, encoded, ttlSeconds);
        if (userId) {
          await this.redis.sadd(`dashboard:userkeys:${userId}`, key);
          await this.redis.expire(`dashboard:userkeys:${userId}`, ttlSeconds);
        }
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

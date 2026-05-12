/**
 * Cache Invalidation Handler
 * 
 * STUFE 3: Event-driven cache invalidation
 * 
 * Usage in endpoints:
 * - const { invalidateCacheOnEvent } = require('./_lib/cache-invalidation');
 * - invalidateCacheOnEvent(userId, 'task_created');
 */

const { cacheManager } = require('./cache');

/**
 * Clear cache on task-related events
 * @param {string} userId - User ID
 * @param {string} event - Event type
 * @param {object} metadata - Optional metadata (taskId, groupId, etc.)
 */
async function invalidateCacheOnEvent(userId, event, metadata = {}) {
  // STUFE 3: Invalidate based on event type
  switch (event) {
    case 'task_created':
    case 'task_updated':
    case 'task_deleted':
    case 'task_completed':
    case 'task_reordered':
      // Clear all dashboard caches for this user
      await cacheManager.invalidateByEvent(userId, event);
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE INVALIDATE] Event: ${event} for user ${userId}`);
      }
      break;

    case 'group_change':
      // Group task changes - clear user's cache + all group members' caches
      await cacheManager.invalidateByEvent(userId, event);
      // Could also invalidate all members in metadata.groupId
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE INVALIDATE] Event: group_change for user ${userId}, groupId: ${metadata.groupId}`);
      }
      break;

    case 'permission_change':
      // Permission changes - clear user's cache
      await cacheManager.invalidateByEvent(userId, event);
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE INVALIDATE] Event: permission_change for user ${userId}, taskId: ${metadata.taskId}`);
      }
      break;

    case 'user_logout':
      // User logs out - clear all their cache
      await cacheManager.clearUser(userId);
      if (process.env.DEBUG_CACHE) {
        console.log(`[CACHE INVALIDATE] User logout: ${userId}`);
      }
      break;

    default:
      console.warn(`[CACHE] Unknown event type: ${event}`);
  }
}

module.exports = { invalidateCacheOnEvent };

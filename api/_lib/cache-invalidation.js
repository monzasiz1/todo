// ⚠️ IMPORTANT: APPEND THIS TO END OF api/tasks.js

// Cache invalidation middleware - called after any task mutation
function invalidateTaskCache(userId) {
  // Invalidate all dashboard caches for this user
  cacheManager.invalidate(`dashboard:${userId}:*`);
  
  if (process.env.DEBUG_CACHE) {
    console.log(`[CACHE INVALIDATED] User ${userId} dashboard cache cleared`);
  }
}

// Wrap this around your PATCH /api/tasks/:id/toggle, PUT, DELETE, and PATCH /api/tasks/reorder endpoints
// Example usage in existing endpoints:

/*

// PATCH /api/tasks/reorder - ADD THIS AFTER UPDATE:
cacheManager.invalidate(`dashboard:${user.id}:*`);

// PUT /api/tasks/:id or PATCH /api/tasks/:id/toggle - ADD BEFORE res.json():
cacheManager.invalidate(`dashboard:${user.id}:*`);

// DELETE /api/tasks/:id - ADD BEFORE res.json():
cacheManager.invalidate(`dashboard:${user.id}:*`);

*/

module.exports = { invalidateTaskCache };

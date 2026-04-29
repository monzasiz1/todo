// Health Check Endpoint - Add to api/health.js

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {}
  };
  
  try {
    // 1. Database connectivity
    const { getPool } = require('./_lib/db');
    const pool = getPool();
    const dbResult = await pool.query('SELECT 1 as test');
    checks.checks.database = dbResult.rows[0]?.test === 1 ? 'ok' : 'failed';
    
    // 2. Critical table schema validation
    const schemaCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name IN ('twofa_enabled', 'twofa_secret')
    `);
    const hasColumns = schemaCheck.rows.map(r => r.column_name);
    checks.checks.schema_users = hasColumns.includes('twofa_enabled') && hasColumns.includes('twofa_secret') ? 'ok' : 'missing_columns';
    
    // 3. 2FA Library availability
    try {
      const { authenticator } = require('otplib');
      const testSecret = authenticator.generateSecret();
      const testCode = authenticator.generate(testSecret);
      const isValid = authenticator.verify({ token: testCode, secret: testSecret });
      checks.checks.twofa_lib = isValid ? 'ok' : 'validation_failed';
    } catch (e) {
      checks.checks.twofa_lib = 'library_error';
    }
    
    // 4. Corrupted 2FA states detection
    const corruptedResult = await pool.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE twofa_enabled = TRUE AND (twofa_secret IS NULL OR twofa_secret = '')
    `);
    const corruptedCount = parseInt(corruptedResult.rows[0]?.count || 0);
    checks.checks.twofa_corruption = corruptedCount === 0 ? 'ok' : `${corruptedCount}_corrupted_users`;
    
    // Overall status
    const hasErrors = Object.values(checks.checks).some(status => status !== 'ok');
    if (hasErrors) {
      checks.status = 'degraded';
      res.status(503);
    }
    
  } catch (err) {
    checks.status = 'unhealthy';
    checks.error = err.message;
    res.status(503);
  }
  
  return res.json(checks);
};
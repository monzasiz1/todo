const { cors } = require('./_lib/auth');

module.exports = function handler(req, res) {
  cors(res);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.length + ' chars)' : 'NOT SET',
      JWT_SECRET: process.env.JWT_SECRET ? 'SET' : 'NOT SET',
      MISTRAL_API_KEY: process.env.MISTRAL_API_KEY ? 'SET' : 'NOT SET',
    }
  });
};

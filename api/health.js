const { cors } = require('../_lib/auth');

module.exports = function handler(req, res) {
  cors(res);
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};

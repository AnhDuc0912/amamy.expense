var crypto = require('crypto');

var sessions = new Set();

function grant() {
  var token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  return token;
}

function isValid(token) {
  return !!token && sessions.has(token);
}

function revoke(token) {
  sessions.delete(token);
}

module.exports = {
  grant: grant,
  isValid: isValid,
  revoke: revoke
};

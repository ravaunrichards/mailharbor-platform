'use strict';

const jwt = require('jsonwebtoken');

function issueAccessToken(user, secret) {
  return jwt.sign(
    { email: user.email, displayName: user.display_name },
    secret,
    { subject: String(user.id), issuer: 'mailharbor', audience: 'mailharbor-web', expiresIn: '12h' }
  );
}

function requireAuth(secret) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Sign in to continue.' });
    try {
      const claims = jwt.verify(match[1], secret, { issuer: 'mailharbor', audience: 'mailharbor-web' });
      req.user = { id: Number(claims.sub), email: claims.email, displayName: claims.displayName };
      if (!Number.isSafeInteger(req.user.id) || req.user.id <= 0) throw new Error('Invalid subject.');
      return next();
    } catch (_error) {
      return res.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' });
    }
  };
}

module.exports = { issueAccessToken, requireAuth };
/**
 * authToken.service.js
 *
 * One-time, time-limited secrets for password reset and email verification.
 *
 * Rules that matter, all of them for a reason:
 *
 *   - The token is generated with a CSPRNG and returned to the caller once.
 *     Only its SHA-256 hash is stored, so a database leak yields no working
 *     links. It is not bcrypt: these are 256-bit random values, not
 *     user-chosen passwords, so there is nothing to brute-force and a slow hash
 *     would only make lookups expensive.
 *   - Redeeming marks it used, in the same statement that checks it, so a
 *     forwarded reset email can't be replayed and two concurrent requests can't
 *     both succeed.
 *   - Issuing a new token for a purpose invalidates the outstanding ones, so a
 *     user who clicks "forgot password" twice can't be confused by which link
 *     works, and an older leaked link stops working.
 */

const crypto = require('crypto');
const pool = require('../config/db');

const PURPOSES = { PASSWORD_RESET: 'password_reset', EMAIL_VERIFICATION: 'email_verification' };

function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * @returns {Promise<string>} the raw token - the only time it exists in plain form
 */
async function issue(userId, purpose, ttlMs, client = pool) {
  const token = crypto.randomBytes(32).toString('base64url');

  // Supersede anything outstanding for this purpose.
  await client.query(
    `UPDATE auth_tokens SET used_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose]
  );

  await client.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::bigint || ' milliseconds')::interval)`,
    [userId, purpose, hash(token), String(ttlMs)]
  );

  return token;
}

/**
 * Consumes a token, returning the user it belongs to, or null.
 *
 * The check and the consumption are a single UPDATE ... RETURNING: doing them
 * as a SELECT followed by an UPDATE would let two simultaneous requests both
 * pass the check before either marked it used.
 */
async function redeem(token, purpose, client = pool) {
  if (!token || typeof token !== 'string') return null;
  const { rows } = await client.query(
    `UPDATE auth_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id`,
    [hash(token), purpose]
  );
  return rows.length ? rows[0].user_id : null;
}

/** Housekeeping: expired and used tokens carry no value. */
async function purgeExpired(client = pool) {
  const { rowCount } = await client.query(
    `DELETE FROM auth_tokens WHERE expires_at < NOW() - INTERVAL '7 days' OR used_at < NOW() - INTERVAL '7 days'`
  );
  return rowCount;
}

module.exports = { issue, redeem, purgeExpired, hash, PURPOSES };

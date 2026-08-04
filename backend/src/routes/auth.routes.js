const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { resolveRole } = require('../services/roles.service');
const { config } = require('../config/env');
const logger = require('../logger');
const tokens = require('../services/authToken.service');
const mail = require('../services/mail.service');

const router = express.Router();

function signToken(user) {
  const { JWT_SECRET, JWT_EXPIRES_IN } = config();
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// POST /api/auth/register
router.post('/register', validate({ body: schemas.register }), async (req, res) => {
  try {
    const { name, email, password, inviteCode } = req.body;

    const { role, error } = resolveRole(inviteCode, config().TEACHER_INVITE_CODE);
    if (error) return res.status(403).json({ error });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'This email address is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash, role]
    );
    const user = result.rows[0];

    // Best effort: a mail outage must not stop someone creating an account.
    // The address can always be confirmed later from the profile.
    sendVerification(user).catch((err) =>
      logger.error({ err, userId: user.id }, 'Could not send the verification email')
    );

    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    logger.error({ err }, 'Registration failed');
    res.status(500).json({ error: 'An error occurred during registration' });
  }
});

// POST /api/auth/login
router.post('/login', validate({ body: schemas.login }), async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken(user);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    logger.error({ err }, 'Login failed');
    res.status(500).json({ error: 'An error occurred during login' });
  }
});

/** Issues a verification token and emails the link. */
async function sendVerification(user) {
  const env = config();
  const ttlHours = env.EMAIL_VERIFICATION_TTL_HOURS;
  const token = await tokens.issue(
    user.id,
    tokens.PURPOSES.EMAIL_VERIFICATION,
    ttlHours * 60 * 60 * 1000
  );
  return mail.sendEmailVerification({
    to: user.email,
    name: user.name,
    url: `${env.PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`,
    expiresInHours: ttlHours,
  });
}

// POST /api/auth/forgot-password
//
// Always answers the same way, whether or not the address exists. Saying "no
// such account" would turn this endpoint into a way to test which addresses are
// registered, which for a university install means confirming who is enrolled.
router.post(
  '/forgot-password',
  validate({ body: schemas.forgotPassword }),
  async (req, res) => {
    const generic = {
      message: 'If that address has an account, a reset link is on its way.',
    };
    try {
      const { rows } = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [
        req.body.email,
      ]);
      if (rows.length === 0) return res.json(generic);

      const env = config();
      const ttlMin = env.PASSWORD_RESET_TTL_MIN;
      const token = await tokens.issue(
        rows[0].id,
        tokens.PURPOSES.PASSWORD_RESET,
        ttlMin * 60 * 1000
      );
      await mail.sendPasswordReset({
        to: rows[0].email,
        name: rows[0].name,
        url: `${env.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes: ttlMin,
      });
      res.json(generic);
    } catch (err) {
      logger.error({ err }, 'Password reset request failed');
      // Same answer even on failure: an error here would otherwise reveal
      // whether the address exists.
      res.json(generic);
    }
  }
);

// POST /api/auth/reset-password
router.post('/reset-password', validate({ body: schemas.resetPassword }), async (req, res) => {
  try {
    const userId = await tokens.redeem(req.body.token, tokens.PURPOSES.PASSWORD_RESET);
    if (!userId) {
      return res.status(400).json({
        error: 'That reset link is invalid, already used, or has expired. Request a new one.',
      });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $2 WHERE id = $1
       RETURNING id, name, email, role, email_verified_at`,
      [userId, passwordHash]
    );

    // Reaching the inbox proves the address, so a reset also verifies it.
    if (!rows[0].email_verified_at) {
      await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [userId]);
    }

    logger.info({ userId }, 'password reset completed');
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Password reset failed');
    res.status(500).json({ error: 'Could not reset the password' });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', validate({ body: schemas.verifyEmail }), async (req, res) => {
  try {
    const userId = await tokens.redeem(req.body.token, tokens.PURPOSES.EMAIL_VERIFICATION);
    if (!userId) {
      return res
        .status(400)
        .json({ error: 'That confirmation link is invalid or has expired. Request a new one.' });
    }
    await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Email verification failed');
    res.status(500).json({ error: 'Could not confirm the address' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, email_verified_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows[0]?.email_verified_at) {
      return res.json({ alreadyVerified: true });
    }
    await sendVerification(rows[0]);
    res.json({ sent: true });
  } catch (err) {
    logger.error({ err }, 'Resending verification failed');
    res.status(500).json({ error: 'Could not send the confirmation email' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/registration-options - lets the signup form show or hide the
// teacher invite-code field instead of guessing whether the server accepts one.
router.get('/registration-options', (req, res) => {
  res.json({ teacherRegistrationEnabled: Boolean(config().TEACHER_INVITE_CODE) });
});

module.exports = router;

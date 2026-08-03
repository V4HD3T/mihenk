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

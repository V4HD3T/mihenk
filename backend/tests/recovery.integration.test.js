/**
 * Password reset and email verification, end to end against a real SMTP server.
 *
 * The link is pulled out of the message that was actually delivered, then used,
 * so this covers the whole path rather than asserting that a function was
 * called. Needs Mailpit (or any SMTP catcher with an API):
 *
 *   docker run -d --name mihenk-mail -p 1025:1025 -p 8025:8025 axllent/mailpit
 *
 * Skips when no catcher is reachable, so `npm test` still works without it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const MAILPIT = process.env.TEST_MAILPIT_URL || 'http://127.0.0.1:8025';
const SMTP_HOST = process.env.TEST_SMTP_HOST || '127.0.0.1';
const SMTP_PORT = process.env.TEST_SMTP_PORT || '1025';

async function mailpitReachable() {
  try {
    const res = await fetch(`${MAILPIT}/api/v1/messages`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const dbUp = await db.isAvailable();
const mailUp = await mailpitReachable();
const describeIf = dbUp && mailUp ? describe : describe.skip;

if (dbUp && !mailUp) {
  console.warn(`\n[integration] No SMTP catcher at ${MAILPIT} - skipping account recovery tests.\n`);
}

describeIf('account recovery', () => {
  let app;

  const clearInbox = () => fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

  /** The most recent message sent to an address, with its body. */
  async function latestMessageTo(address) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    const { messages } = await res.json();
    const hit = messages.find((m) => m.To.some((t) => t.Address === address));
    if (!hit) return null;
    const full = await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`).then((r) => r.json());
    return { subject: hit.Subject, text: full.Text, html: full.HTML };
  }

  const linkFrom = (body, path) => {
    const m = body?.match(new RegExp(`https?://[^\\s"<]*${path}\\?token=[A-Za-z0-9_-]+`));
    return m ? m[0] : null;
  };
  const tokenFrom = (url) => (url ? new URL(url).searchParams.get('token') : null);

  beforeAll(async () => {
    db.applyEnv();
    process.env.MAIL_TRANSPORT = 'smtp';
    process.env.SMTP_HOST = SMTP_HOST;
    process.env.SMTP_PORT = SMTP_PORT;
    process.env.MAIL_FROM = 'Mihenk <no-reply@test.local>';
    process.env.PUBLIC_URL = 'https://mihenk.test';
    await db.resetSchema();

    const appModule = await import('../src/app.js');
    // The mail transport is cached on first use and this suite is the only one
    // that wants a real SMTP connection.
    const mail = await import('../src/services/mail.service.js');
    mail.default.resetTransport();
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });
  });

  afterAll(async () => {
    const mail = await import('../src/services/mail.service.js');
    mail.default.resetTransport();
    delete process.env.MAIL_TRANSPORT;
    delete process.env.SMTP_HOST;
    await db.close();
  });

  beforeEach(async () => {
    await clearInbox();
  });

  async function registerUser(email, password = 'password123') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Person', email, password });
    expect(res.status).toBe(201);
    return res.body;
  }

  const login = (email, password) =>
    request(app).post('/api/auth/login').send({ email, password });

  describe('email verification', () => {
    it('sends a confirmation link when an account is created', async () => {
      await registerUser('verify@x.edu');

      // Delivery is fire-and-forget so registration is never blocked by mail.
      let message = null;
      for (let i = 0; i < 20 && !message; i++) {
        await new Promise((r) => setTimeout(r, 150));
        message = await latestMessageTo('verify@x.edu');
      }
      expect(message).toBeTruthy();
      expect(message.subject).toMatch(/confirm/i);
      expect(linkFrom(message.text, '/verify-email')).toMatch(/^https:\/\/mihenk\.test/);
    });

    it('confirms the address when the link is used', async () => {
      await registerUser('confirm@x.edu');
      let message = null;
      for (let i = 0; i < 20 && !message; i++) {
        await new Promise((r) => setTimeout(r, 150));
        message = await latestMessageTo('confirm@x.edu');
      }
      const token = tokenFrom(linkFrom(message.text, '/verify-email'));

      const res = await request(app).post('/api/auth/verify-email').send({ token });
      expect(res.status).toBe(200);

      const { rows } = await db
        .getPool()
        .query('SELECT email_verified_at FROM users WHERE email = $1', ['confirm@x.edu']);
      expect(rows[0].email_verified_at).not.toBeNull();
    });

    it('refuses a token that has already been used', async () => {
      await registerUser('once@x.edu');
      let message = null;
      for (let i = 0; i < 20 && !message; i++) {
        await new Promise((r) => setTimeout(r, 150));
        message = await latestMessageTo('once@x.edu');
      }
      const token = tokenFrom(linkFrom(message.text, '/verify-email'));

      await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
      const second = await request(app).post('/api/auth/verify-email').send({ token });
      expect(second.status).toBe(400);
    });
  });

  describe('password reset', () => {
    it('answers identically for a real and an unknown address', async () => {
      await registerUser('real@x.edu');

      const known = await request(app).post('/api/auth/forgot-password').send({ email: 'real@x.edu' });
      const unknown = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@x.edu' });

      // Anything else turns this into a way to test who has an account.
      expect(known.status).toBe(unknown.status);
      expect(known.body).toEqual(unknown.body);
    });

    it('sends nothing to an address that has no account', async () => {
      await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@x.edu' });
      await new Promise((r) => setTimeout(r, 800));
      expect(await latestMessageTo('ghost@x.edu')).toBeNull();
    });

    it('resets the password through the emailed link', async () => {
      await registerUser('reset@x.edu', 'oldpassword');
      await clearInbox();

      await request(app).post('/api/auth/forgot-password').send({ email: 'reset@x.edu' });

      let message = null;
      for (let i = 0; i < 20 && !message; i++) {
        await new Promise((r) => setTimeout(r, 150));
        message = await latestMessageTo('reset@x.edu');
      }
      expect(message.subject).toMatch(/reset/i);
      const token = tokenFrom(linkFrom(message.text, '/reset-password'));
      expect(token).toBeTruthy();

      await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'brand-new-password' })
        .expect(200);

      expect((await login('reset@x.edu', 'brand-new-password')).status).toBe(200);
      expect((await login('reset@x.edu', 'oldpassword')).status).toBe(401);
    });

    it('cannot be replayed - a forwarded link is useless once used', async () => {
      await registerUser('replay@x.edu', 'oldpassword');
      await clearInbox();
      await request(app).post('/api/auth/forgot-password').send({ email: 'replay@x.edu' });

      let message = null;
      for (let i = 0; i < 20 && !message; i++) {
        await new Promise((r) => setTimeout(r, 150));
        message = await latestMessageTo('replay@x.edu');
      }
      const token = tokenFrom(linkFrom(message.text, '/reset-password'));

      await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'first-change' })
        .expect(200);

      const second = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'attacker-choice' });
      expect(second.status).toBe(400);
      expect((await login('replay@x.edu', 'first-change')).status).toBe(200);
    });

    it('invalidates an older link when a new one is requested', async () => {
      await registerUser('twice@x.edu', 'oldpassword');
      await clearInbox();

      await request(app).post('/api/auth/forgot-password').send({ email: 'twice@x.edu' });
      let first = null;
      for (let i = 0; i < 20 && !first; i++) {
        await new Promise((r) => setTimeout(r, 150));
        first = await latestMessageTo('twice@x.edu');
      }
      const firstToken = tokenFrom(linkFrom(first.text, '/reset-password'));

      await clearInbox();
      await request(app).post('/api/auth/forgot-password').send({ email: 'twice@x.edu' });
      let second = null;
      for (let i = 0; i < 20 && !second; i++) {
        await new Promise((r) => setTimeout(r, 150));
        second = await latestMessageTo('twice@x.edu');
      }
      const secondToken = tokenFrom(linkFrom(second.text, '/reset-password'));
      expect(secondToken).not.toBe(firstToken);

      // Only the newest link works, so an older leaked one is dead.
      const stale = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: firstToken, password: 'from-stale-link' });
      expect(stale.status).toBe(400);

      await request(app)
        .post('/api/auth/reset-password')
        .send({ token: secondToken, password: 'from-fresh-link' })
        .expect(200);
    });

    it('rejects a made-up token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'not-a-real-token', password: 'whatever123' });
      expect(res.status).toBe(400);
    });

    it('never stores the token itself, only its hash', async () => {
      await registerUser('hashed@x.edu');
      await clearInbox();
      await request(app).post('/api/auth/forgot-password').send({ email: 'hashed@x.edu' });

      let message = null;
      for (let i = 0; i < 20 && !message; i++) {
        await new Promise((r) => setTimeout(r, 150));
        message = await latestMessageTo('hashed@x.edu');
      }
      const token = tokenFrom(linkFrom(message.text, '/reset-password'));

      // A database leak must not yield working reset links.
      const { rows } = await db
        .getPool()
        .query('SELECT token_hash FROM auth_tokens WHERE purpose = $1', ['password_reset']);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.token_hash).not.toBe(token);
      expect(rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

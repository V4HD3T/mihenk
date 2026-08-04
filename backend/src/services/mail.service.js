/**
 * mail.service.js
 *
 * Sending email, and deciding what to do when it can't be sent.
 *
 * Three transports, chosen by configuration rather than by guessing:
 *   smtp    a real server (SMTP_HOST set)
 *   log     writes the message to the log instead of sending it - the default
 *           in development, so password reset works without an SMTP server and
 *           the link is visible in the console
 *   silent  drops it; used by the test suite
 *
 * There is deliberately no fallback from smtp to log. A production install that
 * quietly stopped sending password resets and wrote them to a log file instead
 * would be worse than one that fails loudly.
 */

const nodemailer = require('nodemailer');
const { config } = require('../config/env');
const logger = require('../logger');

let cached = null;

function transportFor(env) {
  if (env.MAIL_TRANSPORT === 'silent') return { kind: 'silent' };
  if (env.MAIL_TRANSPORT === 'log') return { kind: 'log' };

  if (!env.SMTP_HOST) {
    if (env.isProduction) {
      throw new Error(
        'SMTP_HOST is not set. Set it, or set MAIL_TRANSPORT=log to accept that no email is sent.'
      );
    }
    return { kind: 'log' };
  }

  return {
    kind: 'smtp',
    transporter: nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Implicit TLS on 465; STARTTLS is negotiated on everything else.
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    }),
  };
}

function getTransport() {
  if (!cached) cached = transportFor(config());
  return cached;
}

/** Test seam: forget the cached transport. */
function resetTransport() {
  cached = null;
}

async function send({ to, subject, text, html }) {
  const env = config();
  const transport = getTransport();

  if (transport.kind === 'silent') return { delivered: false, reason: 'silent' };

  if (transport.kind === 'log') {
    // The whole body, so a developer can follow the link out of the console.
    logger.info({ to, subject, text }, 'email (not sent: MAIL_TRANSPORT=log)');
    return { delivered: false, reason: 'log' };
  }

  await transport.transporter.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  logger.info({ to, subject }, 'email sent');
  return { delivered: true };
}

/**
 * Wraps a message in the same plain layout.
 *
 * Plain text alongside the HTML, because university mail clients vary wildly
 * and a password reset that renders as a blank page is a support ticket.
 */
function layout({ heading, body, actionUrl, actionLabel, footer }) {
  const text = [heading, '', body, '', actionLabel + ':', actionUrl, '', footer]
    .filter((l) => l !== undefined)
    .join('\n');

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;line-height:1.6;color:#1a1a1a">
  <h2 style="font-weight:600">${heading}</h2>
  <p>${body}</p>
  <p><a href="${actionUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">${actionLabel}</a></p>
  <p style="font-size:13px;color:#666">Or paste this link into your browser:<br><span style="word-break:break-all">${actionUrl}</span></p>
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
  <p style="font-size:13px;color:#666">${footer}</p>
</div>`;

  return { text, html };
}

async function sendPasswordReset({ to, name, url, expiresInMinutes }) {
  const { text, html } = layout({
    heading: 'Reset your CodeCloud password',
    body: `Hello ${name}, someone asked to reset the password for this account.`,
    actionUrl: url,
    actionLabel: 'Choose a new password',
    footer: `This link works once and expires in ${expiresInMinutes} minutes. If you didn't ask for it, you can ignore this message - your password has not changed.`,
  });
  return send({ to, subject: 'Reset your CodeCloud password', text, html });
}

async function sendEmailVerification({ to, name, url, expiresInHours }) {
  const { text, html } = layout({
    heading: 'Confirm your email address',
    body: `Hello ${name}, please confirm this address so we can reach you about your courses.`,
    actionUrl: url,
    actionLabel: 'Confirm my address',
    footer: `This link expires in ${expiresInHours} hours.`,
  });
  return send({ to, subject: 'Confirm your CodeCloud email address', text, html });
}

module.exports = {
  send,
  sendPasswordReset,
  sendEmailVerification,
  getTransport,
  resetTransport,
  layout,
};

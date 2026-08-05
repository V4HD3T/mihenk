/**
 * The Express application, with no I/O of its own.
 *
 * Deliberately separate from server.js: this module opens no ports, no Redis
 * connection and no WebSocket server, so tests can mount it with supertest and
 * exercise routing, validation, rate limiting and security headers without a
 * running Postgres or Redis. server.js is what turns it into a live server.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const crypto = require('crypto');

const authRoutes = require('./routes/auth.routes');
const problemsRoutes = require('./routes/problems.routes');
const submissionsRoutes = require('./routes/submissions.routes');
const examsRoutes = require('./routes/exams.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const usersRoutes = require('./routes/users.routes');
const integrityRoutes = require('./routes/integrity.routes');
const coursesRoutes = require('./routes/courses.routes');
const draftsRoutes = require('./routes/drafts.routes');
const logger = require('./logger');
const metrics = require('./metrics');
const openapi = require('./openapi');
const { config } = require('./config/env');

/**
 * @param {object} [envOverrides] Shallow-merged over the loaded configuration.
 *   Lets a test build an app with, say, a rate limit of 3 without mutating the
 *   process environment. Production callers pass nothing.
 */
/**
 * Things to refresh when a scrape arrives, rather than on a timer: gauges that
 * describe current state (queue depth, pool usage) are cheap to read on demand
 * and stale if polled on their own schedule. server.js registers these; tests
 * and the app itself work fine without them.
 */
const metricsHooks = {};

function createApp(envOverrides = {}) {
  const env = { ...config(), ...envOverrides };
  const app = express();

  // Behind a reverse proxy (nginx, a PaaS router) the client IP arrives in
  // X-Forwarded-For. Trusting exactly one hop keeps per-IP rate limiting
  // accurate without letting a client spoof the header outright.
  app.set('trust proxy', 1);

  app.use(helmet());

  // An API served on a different origin than the SPA needs explicit CORS.
  // Previously this defaulted to '*', which let any website on the internet
  // call the API with a user's credentials; now the allowed origins are an
  // explicit list from FRONTEND_ORIGIN.
  app.use(
    cors({
      origin: env.allowedOrigins,
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(metrics.httpMiddleware);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
      // Health checks would otherwise dominate the logs.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    })
  );

  const limiterOptions = {
    windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again shortly.' },
  };

  const globalLimiter = rateLimit({ ...limiterOptions, max: env.RATE_LIMIT_MAX });

  // Login/registration is the endpoint worth brute-forcing, so it gets a much
  // tighter budget than general API traffic.
  const authLimiter = rateLimit({
    ...limiterOptions,
    max: env.AUTH_RATE_LIMIT_MAX,
    message: { error: 'Too many authentication attempts. Please try again later.' },
  });

  // Each "Run" spawns a real compiler/interpreter on the server, so this is the
  // most expensive thing an authenticated user can trigger in a loop.
  const executeLimiter = rateLimit({
    ...limiterOptions,
    max: env.EXEC_RATE_LIMIT_MAX,
    message: { error: 'Too many code runs. Please wait a moment before running again.' },
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'codecloud-backend', time: new Date().toISOString() });
  });

  // The API's own description. Unauthenticated on purpose: it documents the
  // shape of the interface, not any data, and a client that cannot read it
  // before signing in cannot use it to sign in.
  app.get('/api/openapi.json', (req, res) => {
    res.json(openapi.document);
  });

  // Prometheus scrape endpoint.
  //
  // Queue depth, failure rates and host statistics are operational detail, not
  // public information, so this is gated on a bearer token. With no token
  // configured the endpoint is disabled outright rather than served openly -
  // the same fail-closed choice as the sandbox mode.
  app.get('/metrics', async (req, res) => {
    if (!env.METRICS_TOKEN) return res.status(404).json({ error: 'Endpoint not found' });
    const provided = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (provided !== env.METRICS_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

    try {
      if (metricsHooks.beforeScrape) await metricsHooks.beforeScrape();
      res.set('Content-Type', metrics.register.contentType);
      res.end(await metrics.register.metrics());
    } catch (err) {
      logger.error({ err }, 'Metrics scrape failed');
      res.status(500).end();
    }
  });

  app.use('/api', globalLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/submissions/execute', executeLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/problems', problemsRoutes);
  app.use('/api/submissions', submissionsRoutes);
  app.use('/api/exams', examsRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/integrity', integrityRoutes);
  app.use('/api/courses', coursesRoutes);
  app.use('/api/drafts', draftsRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err, reqId: req.id }, 'Unhandled request error');
    // Never echo err.message back: it can carry connection strings or SQL.
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

module.exports = { createApp, metricsHooks };

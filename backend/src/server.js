/**
 * Process entry point: turns the Express app into a live HTTP + WebSocket
 * server and bridges worker job completions back to connected browsers.
 *
 * The app itself lives in app.js (no I/O), which is what the test suite mounts.
 */

require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { QueueEvents } = require('bullmq');

const { createApp, metricsHooks } = require('./app');
const createConnection = require('./queue/redis');
const wsHub = require('./ws/hub');
const logger = require('./logger');
const metrics = require('./metrics');
const pool = require('./config/db');
const gradingQueue = require('./queue/gradingQueue');
const { config } = require('./config/env');

const env = config();
metrics.init('api');
const app = createApp();

// Queue depth and pool usage are read when a scrape arrives rather than on a
// timer of their own, so the numbers are current and cost nothing in between.
metricsHooks.beforeScrape = async () => {
  await metrics.collectQueueDepth(gradingQueue);
  metrics.collectDbPool(pool);
};
const server = http.createServer(app);

// The API and the WebSocket server share one HTTP server/port.
const wss = new WebSocketServer({ server, path: '/ws' });

/**
 * Authenticates a WebSocket handshake.
 *
 * The browser WebSocket API can't set an Authorization header, so the token
 * rides in the Sec-WebSocket-Protocol header instead of the query string it
 * used before v0.0.3 - URLs end up in proxy logs, access logs and Referer
 * headers, which is a poor place for a 7-day credential.
 */
function tokenFromHandshake(req) {
  const offered = (req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const idx = offered.indexOf('bearer');
  return idx !== -1 ? offered[idx + 1] : null;
}

wss.on('connection', (socket, req) => {
  try {
    const token = tokenFromHandshake(req);
    if (!token) throw new Error('missing token');
    const payload = jwt.verify(token, env.JWT_SECRET);
    wsHub.register(payload.id, socket);
  } catch {
    socket.close(1008, 'unauthorized');
  }
});

// A client that negotiates the "bearer" subprotocol expects the server to
// confirm it, otherwise the browser aborts the connection.
wss.on('headers', (headers) => {
  if (!headers.some((h) => h.toLowerCase().startsWith('sec-websocket-protocol'))) {
    headers.push('Sec-WebSocket-Protocol: bearer');
  }
});

// Bridges the (possibly separate-process) worker's job completions back to
// this API server's live WebSocket connections. QueueEvents listens on
// Redis pub/sub under the hood, so this works even when the worker that
// actually ran the job is a different OS process than this one.
const queueEvents = new QueueEvents('grading', { connection: createConnection() });
queueEvents.on('completed', ({ returnvalue }) => {
  try {
    const data = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
    if (data?.userId) {
      wsHub.sendToUser(data.userId, { type: 'submission_result', ...data });
    }
  } catch (err) {
    logger.error({ err }, 'WebSocket notify failed');
  }
});

server.listen(env.PORT, () => {
  logger.info(`Mihenk backend running on port ${env.PORT} (HTTP + WebSocket at /ws)`);
});

/**
 * Stop accepting new work, then let in-flight requests finish before exiting.
 * Without this a deploy/restart cuts active requests and open sockets dead.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);

  const timer = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
  timer.unref();

  try {
    for (const client of wss.clients) client.close(1001, 'server shutting down');
    await new Promise((resolve) => server.close(resolve));
    await queueEvents.close();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

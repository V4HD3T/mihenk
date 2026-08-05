/**
 * metricsServer.js
 *
 * A scrape endpoint for the grading processes.
 *
 * The API has always exposed /metrics through Express. The workers did not
 * expose anything at all - they recorded grading duration, queue wait, verdicts
 * and grading failures into a registry inside their own process, where nothing
 * could ever read them. Half the instrumentation existed and none of it was
 * reachable, which is worse than not having it: a dashboard built on those
 * series draws empty graphs, and an empty graph reads as "nothing is wrong".
 *
 * The same fail-closed rule as the API applies: with no METRICS_TOKEN the
 * endpoint is not served at all, rather than served openly.
 */

const http = require('http');
const client = require('prom-client');
const logger = require('./logger');
const { config } = require('./config/env');

/**
 * @param {object} options
 * @param {number} options.port
 * @param {() => Promise<string>} options.collect  the exposition text to serve
 * @param {string} [options.token]  defaults to METRICS_TOKEN; the environment is
 *   read once and cached at startup, so tests pass this explicitly rather than
 *   trying to change it afterwards
 * @returns {import('http').Server|null} null when no token is configured
 */
function startMetricsServer({ port, collect, token = config().METRICS_TOKEN }) {
  if (!token) {
    logger.info('METRICS_TOKEN is not set, so this process serves no metrics endpoint');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    if (req.url.split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    const provided = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (provided !== token) {
      res.writeHead(401).end();
      return;
    }
    try {
      const body = await collect();
      res.writeHead(200, { 'Content-Type': client.register.contentType });
      res.end(body);
    } catch (err) {
      logger.error({ err }, 'metrics scrape failed');
      res.writeHead(500).end();
    }
  });

  server.listen(port, () => logger.info({ port }, 'metrics endpoint listening'));
  // Never hold the process open on this alone.
  server.unref();
  return server;
}

module.exports = { startMetricsServer };

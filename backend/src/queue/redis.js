const IORedis = require('ioredis');
require('dotenv').config();
const { config } = require('../config/env');
const logger = require('../logger');

/**
 * Returns a NEW ioredis connection each time it's called. BullMQ's Queue,
 * Worker, and QueueEvents each want their own dedicated connection (they
 * issue blocking commands internally), so this is a factory, not a
 * shared singleton.
 */
function createConnection() {
  const env = config();
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null, // required by BullMQ
  });

  // ioredis reconnects on its own, but without a listener each failed attempt
  // dumps a raw stack trace to stderr (and an unhandled 'error' event would
  // take the process down). Route them through the logger as one tidy line.
  connection.on('error', (err) => {
    // AggregateError (what a failed multi-address connect produces) has an
    // empty .message, so fall back to the code before stringifying.
    logger.error(
      { reason: err.message || err.code || String(err), host: env.REDIS_HOST, port: env.REDIS_PORT },
      'Redis connection error'
    );
  });

  return connection;
}

module.exports = createConnection;

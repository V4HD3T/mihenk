const { Pool } = require('pg');
require('dotenv').config();
const { config } = require('./env');
const logger = require('../logger');

const env = config();

const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  // The pool size is the real ceiling on how many requests can touch the
  // database at once; the pg default of 10 is below the worker concurrency a
  // busy install runs with.
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  // Fail fast instead of queueing forever when the database is unreachable -
  // the same reasoning as the bounded enqueue in the grading queue.
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

module.exports = pool;

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
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

module.exports = pool;

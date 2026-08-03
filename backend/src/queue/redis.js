const IORedis = require('ioredis');
require('dotenv').config();

/**
 * Returns a NEW ioredis connection each time it's called. BullMQ's Queue,
 * Worker, and QueueEvents each want their own dedicated connection (they
 * issue blocking commands internally), so this is a factory, not a
 * shared singleton.
 */
function createConnection() {
  return new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null, // required by BullMQ
  });
}

module.exports = createConnection;

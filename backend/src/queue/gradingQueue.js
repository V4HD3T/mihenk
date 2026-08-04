const { Queue } = require('bullmq');
const createConnection = require('./redis');
const { config } = require('../config/env');

const gradingQueue = new Queue('grading', { connection: createConnection() });

/**
 * Enqueues a grading job, but refuses to wait forever.
 *
 * ioredis queues commands offline and retries indefinitely while it is
 * disconnected, so a Redis outage would otherwise leave `add()` pending for as
 * long as the outage lasts - and the HTTP request hanging with it, holding a
 * connection open and telling the student nothing. Bounding it turns a Redis
 * outage into a fast, honest error instead of a hung page.
 */
async function enqueueGrading(submissionId, timeoutMs = config().QUEUE_ENQUEUE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms enqueueing the grading job`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([gradingQueue.add('grade', { submissionId }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = gradingQueue;
module.exports.enqueueGrading = enqueueGrading;

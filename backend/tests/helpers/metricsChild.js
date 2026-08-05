/**
 * A stand-in for a grading worker, for the metrics aggregation tests.
 *
 * It does what worker.js does for metrics and nothing else: records a few
 * values and answers the supervisor's IPC request. Using the real worker here
 * would mean a Redis connection, a database and the sandbox, none of which the
 * thing under test involves.
 */

const metrics = require('../../src/metrics');

const index = Number(process.argv[2] || 0);
const language = ['python', 'java', 'go'][index % 3];

metrics.init(`worker-test-${index}`);

metrics.submissionsTotal.inc({ language });
metrics.verdictsTotal.inc({ verdict: 'accepted', language });
metrics.gradingDuration.observe({ language }, 1.5);
metrics.queueWaitDuration.observe(0.25);
// Two each, so the aggregation test can tell a sum from a single child's value.
metrics.gradingFailuresTotal.inc();
metrics.gradingFailuresTotal.inc();

// The same contract worker.js implements.
process.on('message', async (message) => {
  if (message?.type !== 'metrics-request') return;
  process.send({
    type: 'metrics-response',
    id: message.id,
    metrics: await metrics.register.getMetricsAsJSON(),
  });
});

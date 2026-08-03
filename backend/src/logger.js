/**
 * Structured logging.
 *
 * Everything that used to be console.log/console.error goes through this, so
 * logs are machine-parseable in production (JSON lines, ready for a log
 * aggregator) while staying readable in development.
 *
 * LOG_LEVEL controls verbosity (trace/debug/info/warn/error/fatal); tests set
 * it to "silent" so a passing suite doesn't bury its own output.
 */

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  // Never let a stray req/err object leak an Authorization header or password
  // into the logs - these paths are redacted wherever they appear.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'token',
      '*.token',
    ],
    censor: '[redacted]',
  },
});

module.exports = logger;

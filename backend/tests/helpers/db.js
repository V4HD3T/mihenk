/**
 * Test database helper.
 *
 * Integration tests run against a real PostgreSQL, because the thing they are
 * checking - that one course's content is invisible to another course's users -
 * lives entirely in SQL. Mocking the database would only test the mock.
 *
 * Point them at a database with TEST_DB_* (or DB_*) and they will rebuild its
 * schema from src/db/schema.sql before each run. Set TEST_DATABASE_URL=skip, or
 * simply leave Postgres unreachable, and the integration suite skips itself so
 * `npm test` still works on a laptop with no database.
 *
 * Locally:
 *   docker run -d --name codecloud-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=codecloud_test -p 55432:5432 postgres:16-alpine
 *   TEST_DB_PORT=55432 TEST_DB_NAME=codecloud_test npm test
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const dbConfig = {
  host: process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 5432),
  database: process.env.TEST_DB_NAME || 'codecloud_test',
  user: process.env.TEST_DB_USER || process.env.DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres',
};

let pool = null;

/**
 * True if a database is reachable, so suites can skip instead of failing.
 *
 * REQUIRE_TEST_DB=1 turns a missing database into a hard error instead. CI sets
 * it, because a silently skipped isolation suite would leave the build green
 * while the thing it protects is broken - the failure mode this whole file
 * exists to prevent.
 */
async function isAvailable() {
  const required = process.env.REQUIRE_TEST_DB === '1';
  if (process.env.TEST_DATABASE_URL === 'skip') {
    if (required) throw new Error('REQUIRE_TEST_DB=1 but TEST_DATABASE_URL=skip');
    return false;
  }
  const probe = new Pool({ ...dbConfig, connectionTimeoutMillis: 2000 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch (err) {
    if (required) {
      throw new Error(
        `REQUIRE_TEST_DB=1 but no database at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
        { cause: err }
      );
    }
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

/**
 * Applies the environment the app modules read at import time, so requiring
 * them later picks up this database rather than the developer's real one.
 */
function applyEnv() {
  process.env.DB_HOST = dbConfig.host;
  process.env.DB_PORT = String(dbConfig.port);
  process.env.DB_NAME = dbConfig.database;
  process.env.DB_USER = dbConfig.user;
  process.env.DB_PASSWORD = dbConfig.password;
}

function getPool() {
  if (!pool) pool = new Pool(dbConfig);
  return pool;
}

/** Rebuilds the schema from scratch - every run starts from a known state. */
async function resetSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql'), 'utf8');
  await getPool().query(sql);
}

async function close() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

module.exports = { dbConfig, isAvailable, applyEnv, getPool, resetSchema, close };

/**
 * migrate.js
 *
 * Applies any migrations/NNN_*.sql files this database hasn't seen yet, in
 * filename order, and records each one in the schema_migrations table.
 *
 *   npm run migrate         # apply pending migrations
 *   npm run migrate:status  # list applied/pending without changing anything
 *
 * Safe to re-run: already-applied files are skipped. A database created from
 * src/db/schema.sql starts with every shipped migration pre-recorded, so a
 * fresh install + migrate is a no-op rather than a double-apply.
 *
 * Requires PostgreSQL 12+: migrations may contain ALTER TYPE ... ADD VALUE,
 * which older versions refuse to run inside a transaction block.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // NNN_ prefix makes lexical order the intended apply order
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function run({ dryRun = false } = {}) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedSet(client);
    const all = migrationFiles();
    const pending = all.filter((f) => !applied.has(f));

    if (dryRun) {
      for (const f of all) {
        console.log(`${applied.has(f) ? '[applied]' : '[pending]'} ${f}`);
      }
      console.log(`\n${applied.size} applied, ${pending.length} pending.`);
      return;
    }

    if (pending.length === 0) {
      console.log('Database is up to date - no pending migrations.');
      return;
    }

    for (const filename of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      process.stdout.write(`Applying ${filename} ... `);
      // Each migration commits atomically together with its own bookkeeping row,
      // so an interrupted run can never record a migration it didn't finish.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }
    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    client.release();
  }
}

// Only touch the database when run as a script - importing this file (e.g. from
// a test that just wants migrationFiles()) must not apply anything.
if (require.main === module) {
  run({ dryRun: process.argv.includes('--status') })
    .then(() => pool.end())
    .catch((err) => {
      console.error('\nMigration failed:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { migrationFiles, run, MIGRATIONS_DIR };

/**
 * The migration runner, against a real PostgreSQL.
 *
 * This is the one code path that can destroy a production database: on an empty
 * database it loads schema.sql, which begins by dropping every table. The tests
 * that matter here are the ones proving it does NOT fire when there is data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('migration runner', () => {
  const dbName = 'codecloud_migrate_test';
  let admin;

  /** Runs the real CLI against a named database, as an operator would. */
  async function runMigrate(target) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve) => {
      const child = spawn('node', ['scripts/migrate.js'], {
        env: {
          ...process.env,
          DB_HOST: db.dbConfig.host,
          DB_PORT: String(db.dbConfig.port),
          DB_NAME: target,
          DB_USER: db.dbConfig.user,
          DB_PASSWORD: db.dbConfig.password,
          JWT_SECRET: 'migrate-test',
          LOG_LEVEL: 'silent',
        },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
    });
  }

  /**
   * A pool that will not crash the run while its database is being dropped.
   *
   * These tests end by dropping the database they just built, and
   * `DROP DATABASE ... WITH (FORCE)` terminates whatever backends are left. A
   * pool whose socket is still tearing down then receives a FATAL 57P01 —
   * "terminating connection due to administrator command" — which node-postgres
   * emits as an `error` event. With no listener that is an unhandled error, and
   * vitest fails the run even though every test passed: exactly what CI saw
   * once new test files shifted the timing enough to lose the race.
   *
   * The error is expected and means nothing here, so it is swallowed rather
   * than raced against with a sleep.
   */
  function makePool(database) {
    const pool = new Pool({ ...db.dbConfig, database });
    pool.on('error', () => {});
    return pool;
  }

  async function query(target, sql) {
    const pool = makePool(target);
    try {
      return await pool.query(sql);
    } finally {
      await pool.end();
    }
  }

  beforeAll(async () => {
    admin = makePool('postgres');
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    await db.close();
  });

  it('creates the whole schema on a completely empty database', async () => {
    // The numbered migrations describe changes *since* the first release, so
    // running them against an empty database used to fail on 002 with
    // "relation users does not exist" - which is what a first deployment does.
    const { code, out } = await runMigrate(dbName);
    expect(code).toBe(0);
    expect(out).toMatch(/Empty database detected/);

    const { rows } = await query(dbName, "SELECT to_regclass('public.users') AS t");
    expect(rows[0].t).not.toBeNull();
  });

  it('records every shipped migration, so nothing is re-applied', async () => {
    const { rows } = await query(dbName, 'SELECT filename FROM schema_migrations ORDER BY filename');
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.map((r) => r.filename)).toContain('008_similarity_archive.sql');
  });

  it('is a no-op when run again', async () => {
    const { code, out } = await runMigrate(dbName);
    expect(code).toBe(0);
    expect(out).toMatch(/up to date/);
    expect(out).not.toMatch(/Empty database detected/);
  });

  it('NEVER rebuilds the schema when the database holds data', async () => {
    await query(
      dbName,
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Do Not Delete', 'keep@x.edu', 'hash', 'teacher')`
    );

    const { code, out } = await runMigrate(dbName);
    expect(code).toBe(0);
    // The bootstrap loads schema.sql, which drops every table. If this ever
    // fires against a populated database it destroys the installation.
    expect(out).not.toMatch(/Empty database detected/);

    const { rows } = await query(dbName, "SELECT name FROM users WHERE email = 'keep@x.edu'");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Do Not Delete');
  });

  it('upgrades a v0.0.1-era database without touching its data', async () => {
    const legacy = 'codecloud_legacy_test';
    await admin.query(`DROP DATABASE IF EXISTS ${legacy} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${legacy}`);

    // The original schema: users/problems/exams/submissions, no courses, naive
    // timestamps, three languages.
    await query(
      legacy,
      `CREATE TYPE user_role AS ENUM ('student', 'teacher');
       CREATE TYPE language_type AS ENUM ('python', 'cpp', 'java');
       CREATE TYPE submission_status AS ENUM ('completed', 'error');
       CREATE TABLE users (
         id SERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL,
         email VARCHAR(150) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
         role user_role NOT NULL DEFAULT 'student',
         created_at TIMESTAMP NOT NULL DEFAULT NOW());
       CREATE TABLE problems (
         id SERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL, description TEXT NOT NULL,
         difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
         starter_code_python TEXT NOT NULL DEFAULT '',
         starter_code_cpp TEXT NOT NULL DEFAULT '',
         starter_code_java TEXT NOT NULL DEFAULT '',
         created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
         created_at TIMESTAMP NOT NULL DEFAULT NOW());
       CREATE TABLE test_cases (
         id SERIAL PRIMARY KEY,
         problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
         input TEXT NOT NULL DEFAULT '', expected_output TEXT NOT NULL,
         is_sample BOOLEAN NOT NULL DEFAULT FALSE, ord INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE exams (
         id SERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL,
         description TEXT NOT NULL DEFAULT '',
         created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
         start_time TIMESTAMP NOT NULL, end_time TIMESTAMP NOT NULL,
         duration_minutes INTEGER NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT NOW());
       CREATE TABLE exam_problems (
         exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
         problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
         points INTEGER NOT NULL DEFAULT 100, PRIMARY KEY (exam_id, problem_id));
       CREATE TABLE submissions (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
         exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
         language language_type NOT NULL, code TEXT NOT NULL,
         status submission_status NOT NULL DEFAULT 'completed',
         passed_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0,
         execution_time_ms INTEGER NOT NULL DEFAULT 0,
         submitted_at TIMESTAMP NOT NULL DEFAULT NOW());
       INSERT INTO users (name, email, password_hash, role)
         VALUES ('Old Teacher', 'old@x.edu', 'hash', 'teacher');
       INSERT INTO problems (title, description, created_by) VALUES ('Old Problem', 'd', 1);`
    );

    const { code, out } = await runMigrate(legacy);
    expect(code).toBe(0);
    expect(out).not.toMatch(/Empty database detected/);

    // The data survived, and the schema really did move forward.
    const users = await query(legacy, "SELECT name FROM users WHERE email = 'old@x.edu'");
    expect(users.rows[0].name).toBe('Old Teacher');

    const problems = await query(legacy, 'SELECT course_id FROM problems');
    expect(problems.rows[0].course_id).not.toBeNull(); // moved into the General course

    const languages = await query(legacy, 'SELECT unnest(enum_range(NULL::language_type)) AS l');
    expect(languages.rows.map((r) => r.l)).toContain('go');

    const times = await query(
      legacy,
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'exams' AND column_name = 'end_time'`
    );
    expect(times.rows[0].data_type).toBe('timestamp with time zone');

    await admin.query(`DROP DATABASE IF EXISTS ${legacy} WITH (FORCE)`).catch(() => {});
  }, 60000);
});

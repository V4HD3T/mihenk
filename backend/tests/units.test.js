import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import roles from '../src/services/roles.service.js';
import envModule from '../src/config/env.js';
import migrate from '../scripts/migrate.js';
import schemas from '../src/validation/schemas.js';

const { resolveRole } = roles;
const { loadEnv, DEFAULT_JWT_SECRET } = envModule;
const { migrationFiles } = migrate;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('resolveRole', () => {
  it('defaults to student when no invite code is given', () => {
    expect(resolveRole(undefined, 'secret')).toEqual({ role: 'student' });
  });

  it('grants teacher only for the exact configured code', () => {
    expect(resolveRole('secret', 'secret')).toEqual({ role: 'teacher' });
  });

  it('refuses a wrong invite code', () => {
    const result = resolveRole('guess', 'secret');
    expect(result.role).toBeUndefined();
    expect(result.error).toMatch(/invalid/i);
  });

  it('refuses teacher signup entirely when no code is configured', () => {
    const result = resolveRole('anything', undefined);
    expect(result.role).toBeUndefined();
    expect(result.error).toMatch(/disabled/i);
  });

  it('does not let a client escalate by sending a role (regression, v0.0.2)', () => {
    // The pre-0.0.3 bug: role came straight from the request body.
    const parsed = schemas.register.parse({
      name: 'Mallory',
      email: 'm@example.com',
      password: 'password1',
      role: 'teacher',
    });
    expect(parsed.role).toBeUndefined();
    expect(resolveRole(parsed.inviteCode, 'secret')).toEqual({ role: 'student' });
  });
});

describe('environment validation', () => {
  const base = { JWT_SECRET: 'a-real-secret' };

  it('applies defaults for anything not set', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.allowedOrigins).toEqual(['http://localhost:5173']);
  });

  it('fails loudly when JWT_SECRET is missing', () => {
    expect(() => loadEnv({})).toThrow(/JWT_SECRET/);
  });

  it('rejects a non-numeric port instead of silently using NaN', () => {
    expect(() => loadEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('refuses to start in production with the example secret', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET })).toThrow(
      /placeholder/i
    );
  });

  it('parses a comma-separated origin list', () => {
    const env = loadEnv({ ...base, FRONTEND_ORIGIN: 'https://a.edu, https://b.edu' });
    expect(env.allowedOrigins).toEqual(['https://a.edu', 'https://b.edu']);
  });
});

describe('migrations', () => {
  it('lists migration files in apply order', () => {
    const files = migrationFiles();
    expect(files).toContain('002_academic_integrity.sql');
    expect(files).toContain('003_cloud_execution.sql');
    expect([...files]).toEqual([...files].sort());
  });

  it('has every migration recorded in the fresh-install schema seed', () => {
    // Guards the v0.0.2 bug class: schema.sql drifting away from migrations/.
    const schema = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'db', 'schema.sql'),
      'utf8'
    );
    for (const file of migrationFiles()) {
      expect(schema).toContain(file);
    }
  });

  it('creates the columns and enum values the app actually writes', () => {
    const schema = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'db', 'schema.sql'),
      'utf8'
    );
    // A fresh install must support every language and status the code uses,
    // otherwise submitting code 500s - exactly what shipped in v0.0.2.
    for (const value of ['javascript', 'queued', 'running', 'results_json']) {
      expect(schema).toContain(value);
    }
    for (const lang of schemas.LANGUAGES) {
      expect(schema).toContain(`'${lang}'`);
    }
  });
});

describe('request schemas', () => {
  it('coerces numeric route params and rejects junk', () => {
    expect(schemas.idParam.parse({ id: '42' })).toEqual({ id: 42 });
    expect(schemas.idParam.safeParse({ id: 'abc' }).success).toBe(false);
    expect(schemas.idParam.safeParse({ id: '-1' }).success).toBe(false);
  });

  it('rejects whitespace-only code', () => {
    expect(schemas.executeCode.safeParse({ language: 'python', code: '   ' }).success).toBe(false);
  });

  it('rejects an unsupported language', () => {
    expect(schemas.executeCode.safeParse({ language: 'rust', code: 'fn main(){}' }).success).toBe(
      false
    );
  });

  it('accepts every language the execution engine supports', () => {
    for (const language of schemas.LANGUAGES) {
      expect(schemas.executeCode.safeParse({ language, code: 'x' }).success).toBe(true);
    }
  });

  it('normalises email casing and whitespace on login', () => {
    const parsed = schemas.login.parse({ email: '  USER@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('user@example.com');
  });
});

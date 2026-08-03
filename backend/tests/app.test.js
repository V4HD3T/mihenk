import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import schemas from '../src/validation/schemas.js';

const { createApp } = app;

describe('app wiring', () => {
  it('serves a health check', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns JSON, not HTML, for an unknown endpoint', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint not found');
  });

  it('sets security headers via helmet', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // helmet removes the framework fingerprint that Express advertises by default
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects a browser origin that is not in FRONTEND_ORIGIN', async () => {
    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    // The wildcard default was removed in v0.0.3: no allow-origin echoed back
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the configured frontend origin', async () => {
    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('authentication guards', () => {
  it('rejects unauthenticated access to a protected route', async () => {
    const res = await request(createApp()).get('/api/submissions/my');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed bearer token', async () => {
    const res = await request(createApp())
      .get('/api/submissions/my')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});

describe('request validation', () => {
  it('rejects a registration with a bad email before touching the database', async () => {
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'not-an-email', password: 'secret123' });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d) => d.field === 'email')).toBe(true);
  });

  it('rejects a too-short password', async () => {
    const res = await request(createApp())
      .post('/api/auth/register')
      .send({ name: 'Test', email: 'a@b.com', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 6/i);
  });

  it('ignores a client-supplied role field', async () => {
    // The schema strips unknown keys, so "role" can no longer reach the handler.
    const parsed = schemas.register.parse({
      name: 'Test',
      email: 'a@b.com',
      password: 'secret123',
      role: 'teacher',
    });
    expect(parsed.role).toBeUndefined();
  });

  it('reports which registration modes the server offers', async () => {
    const res = await request(createApp()).get('/api/auth/registration-options');
    expect(res.status).toBe(200);
    expect(res.body.teacherRegistrationEnabled).toBe(true);
  });
});

describe('rate limiting', () => {
  it('starts rejecting auth attempts once the budget is spent', async () => {
    // Invalid bodies still count against the limiter, so this never reaches Postgres.
    const app = createApp({ AUTH_RATE_LIMIT_MAX: 3 });
    const send = () => request(app).post('/api/auth/login').send({});

    const first = await Promise.all([send(), send(), send()]);
    for (const res of first) expect(res.status).toBe(400);

    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('keeps a separate, tighter budget for code execution', async () => {
    const app = createApp({ EXEC_RATE_LIMIT_MAX: 2 });
    const send = () => request(app).post('/api/submissions/execute').send({});

    // Unauthenticated, so these are 401s - but they still consume the budget.
    await send();
    await send();
    const blocked = await send();
    expect(blocked.status).toBe(429);
  });
});

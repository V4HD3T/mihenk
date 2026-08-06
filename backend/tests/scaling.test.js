import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import poolModule from '../src/workerPool.js';
import similarity from '../src/services/similarity.service.js';

const { createApp } = app;
const { desiredWorkers } = poolModule;
const { tokenize, computeFingerprint, compareFingerprints } = similarity;

describe('worker pool scaling policy', () => {
  const opts = { min: 1, max: 8, perWorker: 10 };

  it('sits at the minimum when there is nothing to do', () => {
    expect(desiredWorkers(0, opts)).toBe(1);
    expect(desiredWorkers(-5, opts)).toBe(1);
  });

  it('does not add a worker until one is genuinely saturated', () => {
    expect(desiredWorkers(10, opts)).toBe(1);
    expect(desiredWorkers(11, opts)).toBe(2);
  });

  it('grows roughly linearly with the backlog', () => {
    expect(desiredWorkers(45, opts)).toBe(5);
    expect(desiredWorkers(71, opts)).toBe(8);
  });

  it('never exceeds the maximum, however deep the queue', () => {
    expect(desiredWorkers(500, opts)).toBe(8);
    expect(desiredWorkers(1_000_000, opts)).toBe(8);
  });

  it('never drops below the minimum', () => {
    expect(desiredWorkers(1, { min: 3, max: 8, perWorker: 10 })).toBe(3);
  });

  it('honours a pool pinned to one size', () => {
    const fixed = { min: 4, max: 4, perWorker: 10 };
    expect(desiredWorkers(0, fixed)).toBe(4);
    expect(desiredWorkers(999, fixed)).toBe(4);
  });
});

describe('metrics endpoint', () => {
  it('is disabled, not public, when no token is configured', async () => {
    const res = await request(createApp({ METRICS_TOKEN: undefined })).get('/metrics');
    expect(res.status).toBe(404);
  });

  it('rejects a missing or wrong token', async () => {
    const withToken = createApp({ METRICS_TOKEN: 'right' });
    expect((await request(withToken).get('/metrics')).status).toBe(401);
    expect(
      (await request(withToken).get('/metrics').set('Authorization', 'Bearer wrong')).status
    ).toBe(401);
  });

  it('serves Prometheus text to a correct token', async () => {
    const res = await request(createApp({ METRICS_TOKEN: 'right' }))
      .get('/metrics')
      .set('Authorization', 'Bearer right');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/mihenk_/);
  });

  it('does not count itself as an API route with unbounded cardinality', async () => {
    // Route labels come from the matched route, not the raw URL, so
    // /api/problems/1 and /api/problems/2 share one series.
    const res = await request(createApp({ METRICS_TOKEN: 'right' }))
      .get('/metrics')
      .set('Authorization', 'Bearer right');
    expect(res.text).not.toMatch(/route="\/api\/problems\/\d+"/);
  });
});

describe('similarity tokenizer: triple-quoted strings (regression, v0.0.2-v0.0.7)', () => {
  const norm = (code) => tokenize(code, 'python').map((t) => t.normalized);

  it('treats a multi-line docstring as a single literal', () => {
    const code = [
      'def solve():',
      '    """',
      '    Uses binary search over the sorted array.',
      '    Complexity: O(n log n) overall.',
      '    """',
      '    return 42',
    ].join('\n');
    // Before the fix this produced ~20 extra ID and punctuation tokens, because
    // the prose inside the docstring was tokenized as if it were code.
    expect(norm(code)).toEqual(['def', 'ID', '(', ')', ':', 'STR', 'return', 'NUM']);
  });

  it('handles triple single quotes too', () => {
    expect(norm("s = '''triple single'''")).toEqual(['ID', '=', 'STR']);
  });

  it('still handles ordinary strings', () => {
    expect(norm('x = "hi" + \'there\'')).toEqual(['ID', '=', 'STR', '+', 'STR']);
  });

  it('cannot be defeated by padding a copy with a long docstring', () => {
    const original = [
      'def binary_search(arr, target):',
      '    lo, hi = 0, len(arr) - 1',
      '    while lo <= hi:',
      '        mid = (lo + hi) // 2',
      '        if arr[mid] == target:',
      '            return mid',
      '        elif arr[mid] < target:',
      '            lo = mid + 1',
      '        else:',
      '            hi = mid - 1',
      '    return -1',
    ].join('\n');
    const padded = `"""\n${'Padding prose that says nothing about the code.\n'.repeat(10)}"""\n${original}`;

    const sim = compareFingerprints(
      computeFingerprint(original, 'python').fingerprints,
      computeFingerprint(padded, 'python').fingerprints
    ).similarity;
    expect(sim).toBeGreaterThan(95);
  });

  it('still scores genuinely different programs low', () => {
    const a = 'def f(n):\n    return sum(range(n))';
    const b = 'def g(s):\n    return "".join(reversed(s))';
    const sim = compareFingerprints(
      computeFingerprint(a, 'python').fingerprints,
      computeFingerprint(b, 'python').fingerprints
    ).similarity;
    expect(sim).toBeLessThan(50);
  });
});

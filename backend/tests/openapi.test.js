/**
 * The OpenAPI document has to describe the API that exists.
 *
 * A specification written by hand is worth exactly as long as it stays true,
 * and the way it stops being true is that someone adds an endpoint and does not
 * add the paragraph. So the document is not trusted: the live Express router is
 * walked and the two sets of endpoints are compared in both directions. An
 * undocumented route fails this, and so does a documented route that no longer
 * exists — the second kind is worse, because it sends a reader to write code
 * against something that will 404.
 *
 * These are unit tests: no database, no network. The app is constructed, its
 * routing table read, and nothing is called.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import pkg from '../package.json';

let document, routeTable, app;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'openapi-test-only';
  process.env.LOG_LEVEL = 'silent';
  const [openapiModule, tableModule, appModule] = await Promise.all([
    import('../src/openapi.js'),
    import('../src/routeTable.js'),
    import('../src/app.js'),
  ]);
  document = openapiModule.default.document;
  routeTable = tableModule.default.routeTable;
  app = appModule.default.createApp();
});

/** `/api/problems/{id}` -> `/api/problems/:id` */
function toExpressPath(specPath) {
  return specPath.replace(/\{(\w+)\}/g, ':$1');
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Every `METHOD /path` the document describes, in Express spelling. */
function documentedRoutes() {
  const out = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      if (item[method]) out.push(`${method.toUpperCase()} ${toExpressPath(path)}`);
    }
  }
  return out.sort();
}

describe('the OpenAPI document and the application agree', () => {
  it('describes every route the application serves', () => {
    const undocumented = routeTable(app).filter((r) => !documentedRoutes().includes(r));
    expect(undocumented).toEqual([]);
  });

  it('describes no route the application does not serve', () => {
    const served = routeTable(app);
    const phantom = documentedRoutes().filter((r) => !served.includes(r));
    expect(phantom).toEqual([]);
  });

  /**
   * The route table reconstructs each router's mount path from a regexp Express
   * builds internally, which is not a public API. If a future Express changes
   * that shape the reconstruction silently yields nothing, both comparisons
   * above would go on passing against an empty set, and the document would stop
   * being checked without anything going red. This is the tripwire.
   */
  it('reads a plausible routing table at all', () => {
    const table = routeTable(app);
    expect(table.length).toBeGreaterThan(40);
    expect(table).toContain('POST /api/auth/login');
    expect(table).toContain('GET /api/problems/:id');
    expect(table).toContain('PUT /api/exams/:id/accommodations/:userId');
  });
});

describe('the document is well formed', () => {
  it('is OpenAPI 3.1 and carries the package version', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(pkg.version);
  });

  it('every $ref resolves', () => {
    const missing = [];
    const seen = new Set();
    const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((n, p) => n?.[p], document);

    const walk = (node, path) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          if (resolve(value) === undefined) missing.push(`${value} (at ${path})`);
        } else {
          walk(value, `${path}/${key}`);
        }
      }
    };
    walk(document, '');
    expect(missing).toEqual([]);
  });

  it('every operation says what it is and what it returns', () => {
    const incomplete = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const where = `${method.toUpperCase()} ${path}`;
        if (!op.summary) incomplete.push(`${where}: no summary`);
        if (!op.tags?.length) incomplete.push(`${where}: no tag`);
        const codes = Object.keys(op.responses || {});
        if (codes.length === 0) incomplete.push(`${where}: no responses`);
        if (!codes.some((c) => c.startsWith('2'))) incomplete.push(`${where}: no success response`);
      }
    }
    expect(incomplete).toEqual([]);
  });

  it('every path parameter in a URL is declared', () => {
    const undeclared = [];
    for (const [path, item] of Object.entries(document.paths)) {
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const declared = [...(item.parameters || []), ...(op.parameters || [])]
          .filter((p) => p.in === 'path')
          .map((p) => p.name);
        for (const name of inPath) {
          if (!declared.includes(name)) {
            undeclared.push(`${method.toUpperCase()} ${path}: {${name}}`);
          }
        }
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('every tag used is declared', () => {
    const declared = new Set(document.tags.map((t) => t.name));
    const used = new Set();
    for (const item of Object.values(document.paths)) {
      for (const method of METHODS) {
        for (const tag of item[method]?.tags || []) used.add(tag);
      }
    }
    expect([...used].filter((t) => !declared.has(t))).toEqual([]);
  });
});

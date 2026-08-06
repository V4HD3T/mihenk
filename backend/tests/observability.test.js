/**
 * The dashboard and the alerts must reference metrics that exist.
 *
 * A Grafana panel querying a metric nobody exports draws an empty graph, which
 * looks like "nothing is happening" rather than "this panel is broken" — and an
 * alert on a renamed metric never fires, which looks like "everything is fine".
 * Both fail silently and in the reassuring direction, which is the worst way for
 * monitoring to break.
 *
 * So every `mihenk_*` name in ops/ is resolved against the registry the
 * application actually builds.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

const opsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ops');

const dashboardText = readFileSync(join(opsDir, 'grafana', 'dashboard.json'), 'utf8');
const alertsText = readFileSync(join(opsDir, 'prometheus', 'alerts.yml'), 'utf8');
const scrapeText = readFileSync(join(opsDir, 'prometheus', 'prometheus.yml'), 'utf8');

let exported;

beforeAll(async () => {
  const metrics = (await import('../src/metrics.js')).default;
  // The default metrics (event loop, heap, GC) only exist once init() has run,
  // and the dashboard uses several of them.
  metrics.init('observability-test');
  const all = await metrics.register.getMetricsAsJSON();
  exported = new Set(all.map((m) => m.name));
});

/**
 * Prometheus exposes a histogram as three series - `_bucket`, `_sum`, `_count` -
 * and a counter may be queried with or without its `_total`. A query naming any
 * of those is naming a metric that exists.
 */
function resolves(name) {
  if (exported.has(name)) return true;
  const withoutSuffix = name.replace(/_(bucket|sum|count)$/, '');
  return exported.has(withoutSuffix) || exported.has(`${withoutSuffix}_total`);
}

function namesIn(text) {
  return [...new Set([...text.matchAll(/\bmihenk_[a-z0-9_]+/g)].map((m) => m[0]))].sort();
}

describe('the dashboard queries metrics that exist', () => {
  it('references at least a dozen of them', () => {
    // A tripwire on the extraction itself: a regexp that matched nothing would
    // leave the checks below passing over an empty list.
    expect(namesIn(dashboardText).length).toBeGreaterThan(10);
  });

  it('every referenced metric resolves', () => {
    const unknown = namesIn(dashboardText).filter((n) => !resolves(n));
    expect(unknown).toEqual([]);
  });

  it('is valid JSON with a stable uid', () => {
    const parsed = JSON.parse(dashboardText);
    // Grafana keys a provisioned dashboard on its uid; changing it orphans the
    // old copy and silently creates a second one.
    expect(parsed.uid).toBe('mihenk-overview');
    expect(parsed.panels.length).toBeGreaterThan(0);
  });

  it('every panel has a query and a title', () => {
    const parsed = JSON.parse(dashboardText);
    const broken = parsed.panels
      .filter((p) => !p.title || !(p.targets || []).some((t) => t.expr))
      .map((p) => p.id);
    expect(broken).toEqual([]);
  });
});

describe('the alert rules reference metrics that exist', () => {
  it('references several of them', () => {
    expect(namesIn(alertsText).length).toBeGreaterThan(5);
  });

  it('every referenced metric resolves', () => {
    const unknown = namesIn(alertsText).filter((n) => !resolves(n));
    expect(unknown).toEqual([]);
  });

  it('every alert has a severity and says what to do about it', () => {
    // Parsed by shape rather than with a YAML library: the rules file is the
    // only YAML in the backend and this is cheaper than a dependency.
    const alerts = [
      ...alertsText.matchAll(/- alert: (\w+)([\s\S]*?)(?=\n {6}- alert: |\n {2}- name: |$)/g),
    ];
    expect(alerts.length).toBeGreaterThan(5);

    const incomplete = [];
    for (const [, name, body] of alerts) {
      if (!/severity: (critical|warning)/.test(body)) incomplete.push(`${name}: no severity`);
      if (!/summary:/.test(body)) incomplete.push(`${name}: no summary`);
      if (!/\bfor: /.test(body)) incomplete.push(`${name}: fires instantly, with no 'for'`);
    }
    expect(incomplete).toEqual([]);
  });
});

/**
 * Not a PromQL parser - promtool is that, and it runs against these files
 * outside the test suite. This catches the typo class that would otherwise be
 * found only when Prometheus refuses to load the rules at deploy time: an
 * unbalanced expression, or a function name that does not exist.
 */
describe('the expressions are plausible PromQL', () => {
  const PROMQL_FUNCTIONS = new Set([
    'histogram_quantile',
    'rate',
    'irate',
    'increase',
    'sum',
    'avg',
    'min',
    'max',
    'count',
    'topk',
    'bottomk',
    'abs',
    'ceil',
    'floor',
    'round',
    'clamp_max',
    'clamp_min',
    'delta',
    'idelta',
    'predict_linear',
    'absent',
    'time',
    'vector',
    'label_replace',
  ]);

  // Keywords that take a parenthesised list and so look like calls to the
  // pattern below: `sum(...) by (le)`, `foo and on (job) bar`.
  const PROMQL_KEYWORDS = new Set([
    'by',
    'without',
    'on',
    'ignoring',
    'group_left',
    'group_right',
    'and',
    'or',
    'unless',
  ]);

  function expressions() {
    const fromAlerts = [...alertsText.matchAll(/expr: >-\n([\s\S]*?)(?=\n {8}\w|\n {6}\w)/g)].map(
      (m) => m[1]
    );
    const inlineAlerts = [...alertsText.matchAll(/expr: (?!>-)(.+)/g)].map((m) => m[1]);
    const fromDashboard = JSON.parse(dashboardText).panels.flatMap((p) =>
      (p.targets || []).map((t) => t.expr).filter(Boolean)
    );
    return [...fromAlerts, ...inlineAlerts, ...fromDashboard];
  }

  it('finds every expression in both files', () => {
    // Tripwire: a regexp that stopped matching would leave the checks below
    // silently passing over nothing.
    expect(expressions().length).toBeGreaterThan(18);
  });

  it('every expression balances its brackets', () => {
    const unbalanced = [];
    for (const expr of expressions()) {
      const depth = { ')': 0, '}': 0, ']': 0 };
      const open = { '(': ')', '{': '}', '[': ']' };
      for (const ch of expr) {
        if (open[ch]) depth[open[ch]]++;
        else if (ch in depth && --depth[ch] < 0) depth[ch] = -Infinity;
      }
      if (Object.values(depth).some((n) => n !== 0)) unbalanced.push(expr.trim());
    }
    expect(unbalanced).toEqual([]);
  });

  it('every function called exists', () => {
    const unknown = new Set();
    for (const expr of expressions()) {
      for (const [, name] of expr.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) {
        if (!PROMQL_FUNCTIONS.has(name) && !PROMQL_KEYWORDS.has(name)) unknown.add(name);
      }
    }
    expect([...unknown]).toEqual([]);
  });
});

describe('the scrape configuration matches the application', () => {
  it('loads the rules file it ships alongside', () => {
    expect(scrapeText).toContain('/etc/prometheus/alerts.yml');
  });

  it('scrapes the path the app actually serves, with a bearer token', () => {
    expect(scrapeText).toContain('metrics_path: /metrics');
    expect(scrapeText).toContain('type: Bearer');
  });

  it('uses the job name the availability alert asserts on', () => {
    // MihenkAPIDown is written against up{job="mihenk-api"}; a renamed
    // job would leave that alert permanently silent.
    expect(scrapeText).toContain('job_name: mihenk-api');
    expect(alertsText).toContain('up{job="mihenk-api"} == 0');
  });
});

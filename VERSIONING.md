# Versioning and support

Mihenk follows [Semantic Versioning](https://semver.org/). This document says
what that actually means here, because "semver" on its own does not tell you
which changes are breaking — that depends on what counts as the interface, and
that is a decision rather than a fact.

## What is public

These are the things a change to which is a breaking change:

| Surface | Where it is defined |
|---|---|
| The HTTP API | `GET /api/openapi.json`, generated from `backend/src/openapi.js` |
| The WebSocket message shapes | `backend/src/ws/hub.js` |
| Environment variables | `backend/src/config/env.js`, `.env.production.example` |
| The database schema, as migrated | `backend/migrations/`, `backend/src/db/schema.sql` |
| The CLI entry points | the `scripts` block of `backend/package.json` |
| Exported metric names and labels | `backend/src/metrics.js` |

Everything else is internal: module layout, function signatures inside the
backend, React component structure, CSS class names, the contents of the
`mihenk-*-sandbox` images, and the exact wording of any message. Depending on
those is depending on an implementation detail, and they change in patch
releases.

## What each number means

**Major** — an existing, documented use stops working the way it did:

- an endpoint removed, renamed, or given a narrower contract
- a response field removed, or its type changed
- an environment variable removed, or its default changed in a way that alters
  behaviour on an existing install
- a migration that loses data, or that cannot be applied to the previous version
- a metric renamed or relabelled, which silently breaks dashboards and alerts
- a permission tightened so that a call that used to succeed now fails

That last one is worth stating explicitly, because it is the awkward case.
v0.1.2 sealed exam problems until the exam starts, which broke a request that
had previously succeeded. That was a security fix and it shipped in a patch
release, because the previous behaviour was a defect rather than a contract. The
rule: **a fix to a security defect is not a breaking change, whatever it
breaks**, and it will be described as such in the changelog rather than hidden
in one.

**Minor** — new capability, existing uses unaffected: a new endpoint, a new
optional field or parameter, a new environment variable with a default that
preserves current behaviour, a new metric, an additive migration.

**Patch** — a fix or an internal change with no interface effect.

Before 1.0, this project used `0.x.y` with `x` as the effective major. That is
over; from 1.0.0 the numbers mean what is written above.

## Upgrading

Every release is expected to be installable over the one before it:

```bash
git fetch --tags && git checkout v<version>
docker compose build
docker compose run --rm api npm run migrate
docker compose up -d
```

`npm run migrate` is the single command for both a new install and an existing
one. It refuses to rebuild a schema over existing data, and applies only the
migrations that have not run. Skipping intermediate versions works as long as
each migration between them is applied, which running it once does.

Take a backup first — `scripts/backup.sh` — and read the changelog entry for
anything under **Known limitations** before upgrading a live install mid-term.

### Downgrading

Not supported. Migrations are forward-only: there are no `down` scripts, because
a half-written reversal of a data migration is more dangerous than not having
one. To go back, restore the backup taken before the upgrade.

## What is not covered

- **No security-fix backports.** Fixes land on `main` and go out in the next
  release. There is no maintained branch for older versions, so running an old
  version means running its known defects.
- **No stability promise for anything under "internal" above**, including the
  frontend's structure and the sandbox images' contents.
- **No supported horizontal scale-out beyond one host.** Workers on other
  machines pull from the same Redis queue and this works, but the deployment
  documentation, the compose file and the dashboard all describe a single host,
  and that is what is tested.
- **`SANDBOX_MODE=host` is not for production**, on any platform. It has no
  isolation, is documented as a development convenience, and does not work on
  macOS at all.

## How the interface is kept honest

The documents that describe the public surface are checked against the code
rather than trusted, because a specification is worth having only for as long as
it is true:

- `backend/tests/openapi.test.js` walks the live Express router and fails if the
  OpenAPI document and the application disagree about which endpoints exist, in
  either direction.
- `backend/tests/observability.test.js` resolves every `mihenk_*` name in the
  Grafana dashboard and the alerting rules against the registry the application
  actually builds, so a renamed metric breaks the build instead of quietly
  emptying a graph or silencing an alert.
- `backend/tests/migrate.integration.test.js` applies the migration path to both
  a fresh database and a populated one.

If you change the public surface, one of these will tell you.

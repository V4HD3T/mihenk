# CodeCloud

**Cloud-Based Multi-Platform Coding Education and Exam System**
**Version 1.0.0**

A coding education platform where students write, compile, and test Python, C++, Java,
JavaScript, C and Go code directly in the browser, and teachers create problems/exams, grade
automatically, and track progress through analytics dashboards. Grading runs on a Redis-backed
job queue with horizontally-scalable workers and real-time WebSocket results, and
academic-integrity tooling (code-similarity screening and exam-session monitoring) is layered
on top.

## Folders

- **`backend/`** — Node.js/Express API, PostgreSQL, multi-language code execution engine. See `backend/README.md`.
- **`frontend/`** — React (Vite) interface, Monaco code editor. See `frontend/README.md`.
- **`ops/`** — Prometheus scrape config and alerting rules, Grafana dashboard and provisioning.

## Deploy it

```bash
cp .env.production.example .env    # fill in JWT_SECRET and DB_PASSWORD
docker compose up -d
docker compose run --rm api npm run migrate

# grading workers run on the host - see backend/README.md for why
cd backend && npm ci && npm run sandbox:build
DB_HOST=127.0.0.1 REDIS_HOST=127.0.0.1 SANDBOX_MODE=docker npm run worker:pool
```

Backups: `./scripts/backup.sh`. Restore: `./scripts/restore.sh <file>`.
Full deployment, TLS and upgrade notes are in `backend/README.md`.
Upgrade rules and what counts as a breaking change: `VERSIONING.md`.

### Monitoring

```bash
printf '%s' "$METRICS_TOKEN" > ops/prometheus/metrics-token
docker compose --profile monitoring up -d      # Grafana on :3000
```

`/metrics` does not exist at all unless `METRICS_TOKEN` is set — on the API and on the
grading workers alike. The dashboard and the alerting rules are provisioned from `ops/`,
and the metric names in them are checked against the application's own registry by
`backend/tests/observability.test.js`, so a renamed metric fails the build rather than
quietly emptying a graph.

### API documentation

The OpenAPI 3.1 description is served by any running instance at `/api/openapi.json`, and
is generated from `backend/src/openapi.js`. It is not trusted to stay true:
`backend/tests/openapi.test.js` walks the live Express router and fails if the document and
the application disagree about which endpoints exist, in either direction.

## Develop it

```bash
# 1) Database (fresh install) - PostgreSQL 12+
createdb codecloud
psql -U postgres -d codecloud -f backend/src/db/schema.sql
# Upgrading an existing database instead? Don't re-run schema.sql - it drops every table:
#   cd backend && npm run migrate

# 2) Redis (grading queue)
redis-server &                # or: service redis-server start

# 3) Backend
cd backend
npm install
cp .env.example .env
npm run sandbox:build       # per-language execution containers (needs Docker)
npm test                    # automated suite (no PostgreSQL/Redis/Docker needed)
npm run dev                 # API + WebSocket -> http://localhost:4000
npm run worker              # grading worker, in a separate terminal (run more to scale up)

# 4) Frontend (in a separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev     # http://localhost:5173
```

**Running submitted code.** By default every compile and test case runs inside a throwaway,
network-less Docker container (`SANDBOX_MODE=docker`), so the host needs Docker but no language
toolchains. Set `SANDBOX_MODE=host` to run code directly on your machine instead — convenient
without Docker, but it then needs `python3`, `g++`/`gcc`, a JDK and `node` installed, and it is
not safe for untrusted users. See `backend/README.md`.

**Language:** the interface is available in Turkish and English, switchable from the top bar.

**Accounts:** signing up creates a student. Teacher accounts require the server's
`TEACHER_INVITE_CODE` (see `backend/README.md`) — the client cannot choose its own role.

**Courses:** teachers create a course and share its join code; students enter that code to enrol.
Problems and exams belong to a course, and you only ever see the courses you are in.

## Feature coverage (mapped to the original project brief)

| Requested feature | Implementation |
|---|---|
| Real-time code writing/compiling/testing in the browser | Monaco editor + `/api/submissions/execute` |
| Multi-language support | `codeExecution.service.js` — Python, C++, Java, JavaScript, C and Go, all tested live |
| Instant evaluation via automated test cases | Redis/BullMQ grading queue → `runTestCases()` → WebSocket push |
| Teacher: user management | `/api/users/students` + Students page |
| Teacher: exam creation | `/api/exams` + exam creation form |
| Teacher: automatic grading | Queue-based grading, results pushed live over WebSocket |
| Progress-tracking analytics dashboards | `/api/analytics/*` + Recharts visualizations |
| Academic integrity (code similarity + exam monitoring) | `similarity.service.js` (Winnowing) + `/api/integrity/*` |
| Cloud-native execution (scalable, matching the original "cloud computing" brief) | BullMQ/Redis queue + horizontally-scalable `npm run worker` processes |
| Safe execution of untrusted code | Per-run Docker containers: no network, read-only rootfs, memory/CPU/pid limits, unprivileged uid |
| Per-class separation of students and content | Courses + enrolment: students see only the courses they joined, teachers only the ones they own |
| Exam integrity and fairness | Randomised per-student problem pools, tab/paste/fullscreen monitoring, per-student time extensions, teacher grade overrides |
| Grading that doesn't punish formatting | Per-problem output checkers (float tolerance, unordered, regex) and classified verdicts explaining each failure |
| Absorbing an exam-day rush | Autoscaling worker pool sized to the queue, with Prometheus metrics; measured at 60 simultaneous submissions graded in 17s on one laptop |

## Scope and limitations of this release

This is an **end-to-end working MVP/prototype, tested against a real PostgreSQL database** —
not a scaffold or mockup. The following flows all work as shipped: register → log in → create
a problem → write/run code → submit/auto-grade → create an exam → analytics.

v0.0.3 added the operational groundwork for running this somewhere real: validated input,
per-IP rate limiting, security headers, an explicit CORS allowlist, structured logging,
graceful shutdown, an automated test suite and CI — plus fixes for two bugs that made a fresh
v0.0.2 install unable to accept a submission at all (see `CHANGELOG.md`).

v0.0.4 closed the last item from the original v0.0.1 production notes: submitted code now runs
in per-run containers with no network, a read-only root filesystem, memory/CPU caps and a
process limit. That containment is verified rather than assumed — `npm run sandbox:verify` runs
real hostile submissions (fork bomb, memory bomb, outbound network, writes outside the work
directory) and CI fails the build if any of them escapes.

v0.0.5 introduced courses. Problems and exams now belong to a course, and access follows
enrolment: a student sees only their own courses, a teacher only the ones they created. Before
this, every authenticated user could read every problem, exam and student on the server. The
rules are covered by 21 integration tests against a real PostgreSQL, which CI runs on every push.

v0.0.6 built out the exam itself: randomised per-student problem pools, accessibility time
extensions, teacher grade overrides, autosaved drafts and fullscreen-exit monitoring. It also
fixed a bug present since v0.0.1 - every timestamp was stored without a time zone, so exam
windows were off by the server's UTC offset (invisible on a UTC host, three hours wrong on a
Turkish one).

v0.0.7 deepened grading itself. Output is judged by a per-problem checker rather than one string
comparison, so a correct answer is no longer failed for float formatting or for listing a set in a
different order, and a failure now says whether it was a wrong answer, a timeout, an out-of-memory
or a crash. Go joins as a sixth language.

v0.0.8 made the system observable and elastic: Prometheus metrics from the API and every worker,
a supervisor that sizes the worker pool to the backlog (measured growing 1 → 6 workers under 60
simultaneous submissions), and a load test that exercises the real pipeline rather than a mock. It
also added a cross-semester plagiarism archive, so this term's work can be screened against
previous cohorts and not only against classmates.

v0.0.9 made it deployable: a compose stack that brings up Postgres, Redis, the API and nginx in
one command, production images for the app itself, verified backup and restore, and an upgrade
procedure. Fixing it along the way: the documented first-deploy command didn't work, because the
numbered migrations describe changes *since* the first release and there was nothing for them to
build on — `npm run migrate` now creates the schema on an empty database and refuses to touch one
that holds data.

v0.1.0 is the first beta. The frontend went from zero tests to a suite covering the critical
flows, which immediately found that not one form label in the application was associated with its
input - twenty of them - so the interface was unusable with a screen reader. Password reset and
email confirmation arrived, verified end to end against a real SMTP server. The interface is now
Turkish and English, with the two catalogues held in sync by a test.

v0.1.1 finished the translation and gave the frontend the linter it had gone ten releases
without. The linter's first run reported 47 problems, and the accessibility rules found that
v0.1.0's label fix had been applied mechanically: one `id` was assigned inside a `.map()`, so
every test-case row shared it, and one `htmlFor` pointed at an element that did not exist. The
teacher pages joined the axe suite, which immediately found a broken heading order. Dates had
been formatted `en-US` everywhere, so a Turkish reader saw 03/04/2026 for 4 March.

Still worth adding before a high-risk public deployment: HTTPS, a managed PostgreSQL/Redis
instance (e.g. RDS/ElastiCache), centralized log aggregation, and — if the threat model warrants
a stronger boundary than a shared kernel — gVisor or a Firecracker micro-VM under the container
layer.

## Changelog and versioning

Release history is in `CHANGELOG.md`. What each version number commits to, what counts as
the public interface, and how to upgrade: `VERSIONING.md`.

## Next steps

If it's useful, I can also prepare a university-format project report (Word) and presentation
(PowerPoint) for this project — as with the earlier "Pazaryeri" project.

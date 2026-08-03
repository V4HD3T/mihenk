# CodeCloud

**Cloud-Based Multi-Platform Coding Education and Exam System**
**Version 0.0.3**

A coding education platform where students write, compile, and test Python, C++, Java,
JavaScript, and C code directly in the browser, and teachers create problems/exams, grade
automatically, and track progress through analytics dashboards. Grading runs on a Redis-backed
job queue with horizontally-scalable workers and real-time WebSocket results, and
academic-integrity tooling (code-similarity screening and exam-session monitoring) is layered
on top.

## Folders

- **`backend/`** — Node.js/Express API, PostgreSQL, multi-language code execution engine. See `backend/README.md`.
- **`frontend/`** — React (Vite) interface, Monaco code editor. See `frontend/README.md`.

## Quick Start

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
npm test                    # automated suite (no PostgreSQL/Redis needed)
npm run dev                 # API + WebSocket -> http://localhost:4000
npm run worker              # grading worker, in a separate terminal (run more to scale up)

# 4) Frontend (in a separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev     # http://localhost:5173
```

The server machine must have `python3`, `g++`/`gcc` (C++17/C17), a JDK (`javac`), `node`, and
`redis-server` installed — see `backend/README.md` for details. To exercise the execution and
similarity engines against those toolchains directly, run `npm run test:exec` and
`npm run test:similarity`.

**Accounts:** signing up creates a student. Teacher accounts require the server's
`TEACHER_INVITE_CODE` (see `backend/README.md`) — the client cannot choose its own role.

## Feature coverage (mapped to the original project brief)

| Requested feature | Implementation |
|---|---|
| Real-time code writing/compiling/testing in the browser | Monaco editor + `/api/submissions/execute` |
| Multi-language support | `codeExecution.service.js` — Python, C++, Java, JavaScript, and C, all tested live |
| Instant evaluation via automated test cases | Redis/BullMQ grading queue → `runTestCases()` → WebSocket push |
| Teacher: user management | `/api/users/students` + Students page |
| Teacher: exam creation | `/api/exams` + exam creation form |
| Teacher: automatic grading | Queue-based grading, results pushed live over WebSocket |
| Progress-tracking analytics dashboards | `/api/analytics/*` + Recharts visualizations |
| Academic integrity (code similarity + exam monitoring) | `similarity.service.js` (Winnowing) + `/api/integrity/*` |
| Cloud-native execution (scalable, matching the original "cloud computing" brief) | BullMQ/Redis queue + horizontally-scalable `npm run worker` processes |

## Scope and limitations of this release

This is an **end-to-end working MVP/prototype, tested against a real PostgreSQL database** —
not a scaffold or mockup. The following flows all work as shipped: register → log in → create
a problem → write/run code → submit/auto-grade → create an exam → analytics.

v0.0.3 added the operational groundwork for running this somewhere real: validated input,
per-IP rate limiting, security headers, an explicit CORS allowlist, structured logging,
graceful shutdown, an automated test suite and CI — plus fixes for two bugs that made a fresh
v0.0.2 install unable to accept a submission at all (see `CHANGELOG.md`).

Before moving this to a publicly-accessible "cloud" environment with untrusted users, the main
remaining piece is sandboxing (see "Cloud execution architecture" and "Sandbox architecture and
security note" in `backend/README.md`): move code execution into separate,
network-disconnected Docker containers, similar to the examples in `backend/docker/`. That's
the one part of the original architecture notes this project doesn't run live, since it needs a
container runtime. Also still worth adding: HTTPS, a managed PostgreSQL/Redis instance (e.g.
RDS/ElastiCache), centralized log aggregation, and database-backed integration tests.

## Changelog

See `CHANGELOG.md`.

## Next steps

If it's useful, I can also prepare a university-format project report (Word) and presentation
(PowerPoint) for this project — as with the earlier "Pazaryeri" project.

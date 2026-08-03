# CodeCloud

**Cloud-Based Multi-Platform Coding Education and Exam System**
**Version 0.0.2**

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
# 1) Database (fresh install)
createdb codecloud
psql -U postgres -d codecloud -f backend/src/db/schema.sql
# Upgrading an existing database instead? Run whichever migrations you're missing, in order:
#   psql -U postgres -d codecloud -f backend/migrations/002_academic_integrity.sql
#   psql -U postgres -d codecloud -f backend/migrations/003_cloud_execution.sql

# 2) Redis (grading queue)
redis-server &                # or: service redis-server start

# 3) Backend
cd backend
npm install
cp .env.example .env
npm run test               # runs the execution engine live against all 5 languages
npm run test:similarity    # runs the code-similarity engine's test suite
npm run dev                 # API + WebSocket -> http://localhost:4000
npm run worker              # grading worker, in a separate terminal (run more to scale up)

# 4) Frontend (in a separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev     # http://localhost:5173
```

The server machine must have `python3`, `g++`/`gcc` (C++17/C17), a JDK (`javac`), `node`, and
`redis-server` installed — see `backend/README.md` for details.

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

Before moving this to a real, publicly-accessible "cloud" environment with multiple untrusted
users, one thing is still recommended (see "Cloud execution architecture" and "Sandbox
architecture and security note" in `backend/README.md` for details): move code execution into
separate, network-disconnected Docker containers, similar to the examples in `backend/docker/`
— that's the one piece of the original architecture notes this project doesn't run live, since
it needs a container runtime. Everything else from those notes (the grading queue and
horizontally-scaled workers) is implemented and tested as of v0.0.2. Also still worth adding:
rate limiting, HTTPS, a managed PostgreSQL/Redis instance (e.g. RDS/ElastiCache), and
centralized logging.

## Changelog

See `CHANGELOG.md`.

## Next steps

If it's useful, I can also prepare a university-format project report (Word) and presentation
(PowerPoint) for this project — as with the earlier "Pazaryeri" project.

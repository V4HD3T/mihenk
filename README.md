# CodeCloud

**Cloud-Based Multi-Platform Coding Education and Exam System**
**Version 0.0.1**

A coding education platform where students write, compile, and test Python, C++, and Java
code directly in the browser, and teachers create problems/exams, grade automatically, and
track progress through analytics dashboards.

## Folders

- **`backend/`** — Node.js/Express API, PostgreSQL, multi-language code execution engine. See `backend/README.md`.
- **`frontend/`** — React (Vite) interface, Monaco code editor. See `frontend/README.md`.

## Quick Start

```bash
# 1) Database
createdb codecloud
psql -U postgres -d codecloud -f backend/src/db/schema.sql

# 2) Backend
cd backend
npm install
cp .env.example .env
npm run test    # runs the execution engine live against Python/C++/Java
npm run dev     # http://localhost:4000

# 3) Frontend (in a separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev     # http://localhost:5173
```

The server machine must have `python3`, `g++` (C++17), and a JDK (`javac`) installed — see
`backend/README.md` for details.

## Feature coverage (mapped to the original project brief)

| Requested feature | Implementation |
|---|---|
| Real-time code writing/compiling/testing in the browser | Monaco editor + `/api/submissions/execute` |
| Python, C++, Java support | `codeExecution.service.js` — all three tested live |
| Instant evaluation via automated test cases | `/api/submissions` → `runTestCases()` |
| Teacher: user management | `/api/users/students` + Students page |
| Teacher: exam creation | `/api/exams` + exam creation form |
| Teacher: automatic grading | Test-based scoring at submission time |
| Progress-tracking analytics dashboards | `/api/analytics/*` + Recharts visualizations |

## Scope and limitations of this release

This is an **end-to-end working MVP/prototype, tested against a real PostgreSQL database** —
not a scaffold or mockup. The following flows all work as shipped: register → log in → create
a problem → write/run code → submit/auto-grade → create an exam → analytics.

Before moving this to a real, publicly-accessible "cloud" environment with multiple untrusted
users, the following is recommended (see the "Sandbox architecture and security note" section
in `backend/README.md` for details):

- Move code execution into separate, network-disconnected containers, similar to the examples in `backend/docker/`
- Queue execution requests and dispatch them to horizontally-scaled workers
- Add rate limiting, HTTPS, a managed PostgreSQL instance (e.g. RDS/Cloud SQL), and centralized logging

## Changelog

See `CHANGELOG.md`.

## Next steps

If it's useful, I can also prepare a university-format project report (Word) and presentation
(PowerPoint) for this project — as with the earlier "Pazaryeri" project.

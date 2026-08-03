# CodeCloud - Backend

**Version 0.0.2**

Node.js/Express API for the Cloud-Based Multi-Platform Coding Education and Exam System.

## Features

- JWT-based authentication, role-based authorization (student / teacher)
- Sandboxed execution engine that compiles and runs **Python, C++, Java, JavaScript, and C**
  (timeouts and memory limits per run)
- Problem (exercise) management with visible/hidden test cases
- "Run" (synchronous, free-form stdin) and "Submit" (queued, automatic grading) endpoints
- **Cloud-native grading (new in 0.0.2):** submissions are graded by a Redis-backed job queue
  (BullMQ) consumed by one or more separate worker processes, with results pushed to the
  browser over WebSocket (polling fallback included) - see "Cloud execution architecture" below
- Exam creation, time-window enforcement, results table
- Analytics endpoints for both teachers and students
- Student list / progress tracking for teachers
- Academic integrity: Winnowing-based code-similarity screening across a class's submissions,
  plus tab-switch/paste monitoring during active exams

## Setup

```bash
npm install
cp .env.example .env   # edit with your own values
```

### Database

PostgreSQL must be installed and running.

**New installation:**
```bash
createdb codecloud
psql -U postgres -d codecloud -f src/db/schema.sql
```

**Upgrading an existing v0.0.1 database** (keeps your data — do not re-run `schema.sql`, it drops
and recreates every table). Both migrations ship in v0.0.2; run them in order:
```bash
psql -U postgres -d codecloud -f migrations/002_academic_integrity.sql
psql -U postgres -d codecloud -f migrations/003_cloud_execution.sql
```

### Running

CodeCloud now needs **three** things running: PostgreSQL, Redis, and two Node processes (the
API server and at least one grading worker).

```bash
redis-server &          # or: service redis-server start

npm run dev              # API + WebSocket server -> http://localhost:4000
npm run worker           # grading worker, in a separate terminal
```

Health check: `GET /api/health`. Run more than one `npm run worker` (same machine or different
ones) to grade more submissions concurrently — they all pull from the same Redis queue, so no
extra coordination is needed.

## Required system tools on the server

The code execution engine expects the following three tools to be installed **on the server machine**:

| Language | Required tool                        |
|----------|----------------------------------------|
| Python   | `python3`                              |
| C++      | `g++` (with C++17 support)             |
| Java     | JDK (`javac` + `java`, version 17+)    |
| JavaScript | `node` (already required to run the app itself) |
| C        | `gcc` (with C17 support)               |

Ubuntu/Debian: `apt install python3 g++ gcc openjdk-21-jdk-headless redis-server`

## API Endpoints (summary)

| Method | Path                                | Description                                | Access     |
|--------|---------------------------------------|----------------------------------------------|------------|
| POST   | /api/auth/register                  | Register                                    | -          |
| POST   | /api/auth/login                     | Log in                                      | -          |
| GET    | /api/auth/me                        | Current session info                        | Authenticated |
| GET    | /api/problems                       | List problems                               | Authenticated |
| GET    | /api/problems/:id                   | Problem detail                              | Authenticated |
| POST   | /api/problems                       | Create a problem                            | Teacher |
| PUT    | /api/problems/:id                   | Update a problem                            | Teacher |
| DELETE | /api/problems/:id                   | Delete a problem                            | Teacher |
| POST   | /api/problems/:id/testcases         | Add a test case                             | Teacher |
| POST   | /api/submissions/execute            | Run code (not saved)                        | Authenticated |
| POST   | /api/submissions                    | Queue code for grading (returns 202 immediately) | Authenticated |
| GET    | /api/submissions/:id                | Poll a submission's status/result (fallback for WebSocket) | Authenticated |
| GET    | /api/submissions/my                 | My own submission history                   | Authenticated |
| GET    | /api/submissions/problem/:id        | All submissions for a problem               | Teacher |
| POST   | /api/exams                          | Create an exam                              | Teacher |
| GET    | /api/exams                          | List exams                                  | Authenticated |
| GET    | /api/exams/:id                      | Exam detail                                 | Authenticated |
| GET    | /api/exams/:id/results              | Exam results table                          | Teacher |
| GET    | /api/analytics/overview             | Class-wide statistics                       | Teacher |
| GET    | /api/analytics/me                   | Personal progress statistics                | Authenticated |
| GET    | /api/users/students                 | Student list                                | Teacher |
| GET    | /api/integrity/problem/:id/similarity | Class-wide code-similarity report         | Teacher |
| GET    | /api/integrity/compare/:idA/:idB    | Side-by-side comparison with highlighted matches | Teacher |
| POST   | /api/integrity/events               | Log a tab-switch/paste event during an exam | Authenticated |
| GET    | /api/integrity/exam/:id             | Per-student integrity summary for an exam   | Teacher |

## Academic integrity engine

`src/services/similarity.service.js` implements **Winnowing** (the local-fingerprinting
algorithm behind MOSS): source is tokenized (comments dropped, string literals and identifiers
normalized, language keywords preserved so renaming variables doesn't defeat it), grouped into
overlapping k-grams, hashed, and a robust minimal subset of those hashes is selected as each
submission's fingerprint. Two submissions are compared by fingerprint overlap.

**Why this doesn't just flag the whole class on easy problems:** short exercises legitimately
have only one or two reasonable solutions, so raw pairwise similarity is often moderate across
*everyone*. `computeClassReport()` therefore computes the median pairwise similarity within a
problem+language group as a baseline, and only marks a pair "notable" when it clears both an
absolute floor (60%) and a margin above that baseline (+20 points). The full, unfiltered ranking
is always returned too — the threshold only controls the highlight, never what the teacher can see.

This is a screening aid, not a verdict; `test-similarity.js` documents and checks this behavior
directly (identical/renamed/re-stringed code stays matched, unrelated code stays low, a class
of independently-similar trivial solutions produces zero flags, and a genuine copy embedded in
a varied class gets flagged). Run it with `npm run test:similarity`.

Exam-session monitoring (`POST /api/integrity/events`) logs tab-visibility changes and paste
events client-side during an active exam window; it is intentionally a *logging* signal for the
teacher to review, not an automatic block — pasting isn't disabled, since client-side blocking is
trivial to bypass and would mostly just be a false sense of security.

## Cloud execution architecture (new in 0.0.2)

Grading no longer happens inline in the HTTP request. `POST /api/submissions` validates the
request, writes a `queued` row, and enqueues a job on a Redis-backed BullMQ queue - then
responds immediately (`202`). A separate **worker process** (`src/worker.js`, started with
`npm run worker`) consumes jobs, runs them through the same execution engine as before, and
writes the result back to Postgres. The API process listens for job completion via BullMQ's
`QueueEvents` (itself backed by Redis pub/sub) and pushes the result to the submitting user's
browser over WebSocket (`/ws`); the client also polls `GET /api/submissions/:id` as a fallback
in case the socket never connects.

Why this matters for "cloud": the worker is a separate OS process from the API server by
design, so scaling grading throughput is just "run more `npm run worker` processes" - on the
same machine or different ones, with no code changes and no coordination between them beyond
the shared Redis queue. The interactive "Run" button (`/api/submissions/execute`) intentionally
stays synchronous, since that's a single user waiting on one ad-hoc execution; the queue exists
for the case that actually needs it, a burst of exam submissions arriving at once.

## Sandbox architecture and security note

`src/services/codeExecution.service.js` writes submitted code to a temporary directory, compiles
it if needed (C++/Java/C), and runs it constrained by `timeout` plus a per-language memory limit
(`ulimit -v`, or the runtime's own heap flag for Java/Node, which otherwise conflict with it).
This is **sufficient protection for a single-machine prototype/demo** and has been tested against
infinite loops, compile errors, and malformed output across all five languages.

One deliberate choice worth calling out: this service does **not** use `ulimit -u` (process-count
limiting) to contain runaway forking. `ulimit -u` is a per-*user* limit on Linux, not a
per-process-tree one - on a host where the same user already owns a non-trivial number of
processes/threads (which a Node/JVM-heavy dev box easily does), setting it low from inside a
spawned shell can unpredictably starve unrelated processes on that same host, not just the
sandboxed one. Process-count containment belongs at the OS/container layer instead, correctly
namespaced per-container - see `--pids-limit` in `backend/docker/*.Dockerfile`.

**Still recommended before production** (real, untrusted multi-tenant traffic): isolate every
run in its own network-disconnected, resource-limited container, similar to the examples in
`backend/docker/*.Dockerfile` (or a gVisor/Firecracker micro-VM) — this is the one piece from the
v0.0.1 production notes that v0.0.2 doesn't yet close, since it requires a container runtime this
project doesn't assume you have. The other half of that original recommendation, queueing and
horizontally-scaled workers, is what v0.0.2 adds.

## Environment Variables

See `.env.example`. In particular, always change `JWT_SECRET` in production.

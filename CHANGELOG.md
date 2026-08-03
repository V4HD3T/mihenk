# Changelog

All notable changes to this project are documented in this file.

## [0.0.4] - Container-Isolated Execution

Closes the last open item from the original v0.0.1 production notes: submitted
code no longer runs on the host.

### Added
- **Per-run Docker sandboxing.** Every compile and every test case executes in
  its own throwaway container with `--network=none`, a read-only root
  filesystem, a memory cap (with matching swap cap), a CPU share,
  `--pids-limit`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, an
  unprivileged uid, and a single bind mount for the run's work directory.
  `backend/docker/*.Dockerfile` went from reference material to the images the
  system actually runs on.
- **`SANDBOX_MODE`** selects the backend: `docker` (required for untrusted
  users), `host` (the pre-0.0.4 behaviour, development only), or `auto`.
  `docker` **fails closed** - if no daemon is reachable, submissions error out
  rather than silently running unconfined, because a grading failure is
  recoverable and a silent loss of isolation is not.
- **`npm run sandbox:build` / `sandbox:check`** build the five language images
  and confirm each toolchain runs as the unprivileged container user.
- **`npm run sandbox:verify`** pushes deliberately hostile submissions through
  the real engine - outbound network, fork bomb, memory bomb, writes outside
  the work directory, an infinite loop, a privilege-escalation attempt - and
  exits non-zero if any escapes. **CI runs it on Linux on every push**, so a
  regression in the security flags breaks the build instead of quietly
  weakening the sandbox.
- Unit tests pinning every security flag, so the lint/test job protects them
  even though it has no Docker daemon.
- Per-container tuning: `SANDBOX_MEMORY_MB`, `SANDBOX_JAVA_MEMORY_MB`,
  `SANDBOX_CPUS`, `SANDBOX_PIDS_LIMIT`, `SANDBOX_TMPFS_MB`,
  `SANDBOX_IMAGE_PREFIX`.

### Verified
Measured against real containers, not assumed: outbound network refused; host
paths unreachable and `/etc/shadow` unreadable; writes outside the work
directory refused; fork bomb stopped at the pid ceiling (62 of 64); memory bomb
OOM-killed (exit 137); infinite loop cut off by the wall clock; uid stays 10001.
All five languages compile and run correctly under the full flag set.

### Changed
- With `SANDBOX_MODE=docker` the host no longer needs any language toolchain -
  compilers and runtimes live in the images. Only `SANDBOX_MODE=host` still
  requires `python3`/`g++`/`gcc`/`javac`/`node` locally.
- Grading uses **one container per test case rather than one per submission**.
  Benchmarked at ~159 ms/test versus ~82 ms/test for reusing a container via
  `docker exec`; the ~2x faster option was deliberately rejected because a
  shared container lets a stray process, leftover file or exhausted pid budget
  from one test change the result of the next, and a wrong grade is worse than
  a slower one. Grading is queued, so nothing user-facing waits on it.
  (Figures measured on macOS, where containers run in a VM; Linux is faster.)
- On timeout the container is killed by name, not just the `docker run` client
  - killing the client would otherwise leave the container running.

### Known limitations (tracked for future versions)
- Containers share the host kernel; a stronger boundary (gVisor, Firecracker)
  and per-language seccomp profiles are the next step for a high-risk
  deployment
- `SANDBOX_MODE=host` depends on GNU coreutils' `timeout`, which macOS does not
  ship, so that backend has never worked on a Mac (pre-existing since v0.0.1,
  now documented). The docker backend works there, and is the default.
- No course/enrollment model: problems and exams are still global to every user
- Database-backed integration tests still to come
- No password reset or email verification

## [0.0.3] - Correctness & Security Hardening

No new end-user features. This release fixes two bugs that made a fresh install
unusable or unsafe, and adds the operational groundwork (validation, rate
limiting, logging, tests, CI) that the earlier versions skipped.

### Fixed
- **A fresh install could not accept a single submission.** `src/db/schema.sql`
  had drifted from `migrations/`: it never got migration 003's changes, so a
  database created the way the README documented had no `queued`/`running`
  submission states, no `javascript`/`c` languages, no `results_json` and no
  starter-code columns for the new languages - while the code inserts
  `status = 'queued'` on every submit. Only databases upgraded from v0.0.1 via
  the migration files worked. `schema.sql` is now the complete current-state
  schema, and a test asserts it stays in sync with `migrations/`.
- **`GET /api/submissions/my` returned 500 for every caller.** v0.0.2 added the
  polling route `GET /:id` above it, so Express matched `/my` as `id="my"` and
  handed Postgres a non-integer id. The literal routes are now registered
  before the parameterised one, with a comment explaining why the order matters.

### Security
- **Anyone could register as a teacher.** `POST /api/auth/register` took `role`
  straight from the request body, so a single crafted request granted access to
  every submission, similarity report and student record in the system. Role is
  now decided server-side: an account is a student unless the request carries
  the configured `TEACHER_INVITE_CODE`, and teacher signup is disabled outright
  when no code is set.
- CORS no longer falls back to `*`. `FRONTEND_ORIGIN` is an explicit
  comma-separated allowlist; unlisted origins are refused.
- Rate limiting (`express-rate-limit`) with a tight budget on login/registration
  and a separate one on `/api/submissions/execute`, which spawns a real
  compiler per call.
- Standard security headers via `helmet`.
- The WebSocket JWT moved from the URL query string to the
  `Sec-WebSocket-Protocol` header - URLs end up in proxy logs, access logs and
  `Referer` headers, which is a poor place for a 7-day credential.
- The server refuses to boot in production while `JWT_SECRET` is still the
  placeholder from `.env.example`.
- Error responses no longer echo internal error messages, and logs redact
  authorization headers, passwords and tokens.

### Added
- **Migration runner**: `npm run migrate` applies pending migrations and records
  them in a new `schema_migrations` table; `npm run migrate:status` shows what
  is applied vs pending. Safe to re-run, and a no-op on a fresh install.
- **Request validation** with zod on every endpoint that takes input, so
  malformed requests are rejected with a per-field 400 before reaching Postgres.
- **Structured logging** with pino, including a per-request id.
- **Graceful shutdown** for both processes: the API drains in-flight requests
  and closes sockets, and the worker finishes the submissions it is grading
  instead of stranding them in `running`.
- **Validated configuration**: every environment variable is parsed and checked
  at startup, so a typo fails immediately with a readable message.
- **Automated tests** (`npm test`, 31 cases) covering routing, validation,
  security headers, CORS, rate limiting and both fixed bugs as regressions.
  They need no PostgreSQL or Redis, so they run anywhere.
- **GitHub Actions CI** running backend lint + tests and a frontend build.
- ESLint and Prettier configuration.

### Changed
- `npm test` now runs the automated suite. The live execution-engine harness,
  which needs Python/g++/JDK/Node installed, moved to `npm run test:exec`.
- The signup form no longer offers a role toggle; it shows a teacher
  invite-code field only when the server reports one is accepted
  (`GET /api/auth/registration-options`).

### Known limitations (tracked for future versions)
- Docker-based per-run isolation is still reference-only (`backend/docker/`) -
  scheduled next
- No course/enrollment model: problems and exams are still global to every user
- Tests cover the HTTP layer; database-backed integration tests still to come
- No password reset or email verification

## [0.0.2] - Academic Integrity & Cloud Execution

This release bundles two feature tracks on top of the initial version: academic-integrity
tooling and a cloud-native, queue-based execution architecture.

### Added

#### Academic integrity
- **Code-similarity screening** (`similarity.service.js`): a Winnowing-based fingerprinting
  engine (the algorithm behind MOSS) that tokenizes submissions per-language, normalizes
  identifiers/strings/numbers while preserving language keywords, and compares submissions by
  fingerprint overlap. Resistant to variable renaming, reformatting, and changed string content.
- **Class-relative baseline flagging**: rather than a fixed similarity threshold, each problem's
  pairwise similarities are compared against that problem's own median, so trivial exercises
  (where every correct solution looks alike) don't flag the whole class - only pairs that are
  unusually alike *relative to their classmates* are marked "notable".
  - `GET /api/integrity/problem/:id/similarity` - full pairwise report per language
  - `GET /api/integrity/compare/:idA/:idB` - side-by-side comparison with highlighted matched regions
  - New teacher page: Similarity Report (`/teacher/similarity/:id`), linked from each problem
- **Exam-session integrity monitoring**: tab-switch (Page Visibility API) and paste events are
  logged client-side during an active exam and surfaced to the teacher as a per-student summary
  on the exam results page. Logging only, never blocking - pasting still works, it's just visible
  to the teacher afterward. Students see a plain-language notice that monitoring is active.
  - `POST /api/integrity/events`, `GET /api/integrity/exam/:id`
- New `integrity_events` table; additive migration at `backend/migrations/002_academic_integrity.sql`
  for upgrading an existing v0.0.1 database without losing data.
- `test-similarity.js` (`npm run test:similarity`): validates the similarity engine against
  identical/renamed/re-stringed/unrelated code and against both a "trivial problem, nobody
  flagged" and a "genuine copy inside a varied class, correctly flagged" scenario.

#### Cloud-native execution
- **Asynchronous, queue-based grading**: `POST /api/submissions` now enqueues a job on a
  Redis-backed BullMQ queue and responds immediately (`202 queued`) instead of grading inline.
  A separate worker process (`src/worker.js`, `npm run worker`) consumes jobs and writes results
  back to Postgres — run multiple worker processes to scale grading throughput horizontally,
  with no code changes and no coordination beyond the shared queue.
- **Real-time results over WebSocket**: the API server listens for job completions via BullMQ's
  `QueueEvents` (Redis pub/sub) and pushes results to the submitting student's browser at `/ws` —
  proven to work even when the worker that graded the job is a different OS process than the API
  server. `GET /api/submissions/:id` remains available as a polling fallback.
- **Two new languages**: JavaScript (Node) and C (gcc) join Python, C++, and Java in both the
  execution engine and the similarity/plagiarism engine.
- New `npm run worker` / `npm run worker:dev` scripts; new `REDIS_HOST`, `REDIS_PORT`, and
  `WORKER_CONCURRENCY` environment variables.
- Additive migration at `backend/migrations/003_cloud_execution.sql` (new submission states,
  new languages, per-test-case result storage, new-language starter code columns) for upgrading
  an existing database without losing data.

### Changed
- `codeExecution.service.js` no longer applies `ulimit -u` (process-count limiting). It turned
  out to be a per-*user*, not per-process-tree, limit on Linux — unsafe on a host where the same
  user already owns a non-trivial number of processes/threads, where it can misfire and starve
  unrelated processes rather than just the sandboxed one. Wall-clock `timeout` and per-language
  memory limits remain; genuine process-count containment is documented as belonging to the
  container layer (`--pids-limit`, already used in `backend/docker/*.Dockerfile`).

### Known limitations (tracked for future versions)
- Docker-based per-run isolation is still a reference-only recommendation (`backend/docker/`),
  not wired into the app — the queue/worker split this version adds is the horizontal-scaling
  half of that story, not the sandboxing half
- No autoscaling of worker processes based on queue depth (manual for now)
- Go and other additional languages are natural next additions given the now-proven pattern,
  but are not included in this version
- No randomized/per-student problem-pool assignment (still a possible future addition)
- No fullscreen-exit detection during exams (tab-switch and paste only)
- Similarity comparison is pairwise per problem; does not yet check against a cross-semester
  submission archive or the public web
- String-literal handling is heuristic (doesn't special-case Python triple-quoted strings)

## [0.0.1] - Initial Release

First working end-to-end version of CodeCloud, tested against a live PostgreSQL database.

### Added
- User authentication (register/login) with JWT, role-based access for students and teachers
- Multi-language code execution engine (Python, C++, Java) with compile-error handling, timeouts,
  memory limits, and fork-bomb protection
- Problem (exercise) management with sample and hidden test cases
- "Run" (free-form input) and "Submit" (automatic grading against all test cases) flows
- Exam creation with time-window enforcement and a results table
- Teacher dashboard: problem management, exam management, per-problem submission views, student list
- Student dashboard: problem browser, exam list, exam-taking flow
- Analytics dashboards for both teachers (class-wide) and students (personal progress), built with Recharts
- React frontend with a Monaco-based code editor and a bubble-sheet-inspired test result indicator
- Example production Dockerfiles for sandboxed per-language execution (not wired into the app yet)

### Known limitations (tracked for future versions)
- Code execution is isolated with `timeout` + `ulimit` on a single host; not yet containerized per run
- No queueing system for concurrent submissions at scale
- No plagiarism/code-similarity detection
- No exam-integrity monitoring (tab-switch detection, etc.)

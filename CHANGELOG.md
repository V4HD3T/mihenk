# Changelog

All notable changes to this project are documented in this file.

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

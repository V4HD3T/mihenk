# Changelog

All notable changes to this project are documented in this file.

## [0.0.9] - Deployable

Eight releases of features that could only run on a developer's laptop. This one
makes the thing installable.

### Added
- **A compose stack**: `docker compose up -d` brings up Postgres, Redis, the API
  and nginx serving the built SPA. Health checks, restart policies, persistent
  volumes, and Postgres/Redis bound to loopback so the host's workers can reach
  them and nothing else can.
- **Production images for the application itself** - distinct from the sandbox
  images, which only ever held language toolchains. Multi-stage, no dev
  dependencies, unprivileged user, `tini` as init (the worker spawns a `docker`
  process per test case, and their exited children otherwise accumulate).
- **nginx** serving the SPA and proxying `/api` and `/ws` on one origin, so the
  browser never makes a cross-origin request and the built assets carry no
  hardcoded API hostname. `/metrics` is deliberately not proxied.
- **Backup and restore** (`scripts/backup.sh`, `scripts/restore.sh`). The backup
  verifies its own output and deletes a dump that is truncated or missing the
  schema, because an unreadable backup is worse than none and you find out at
  the worst moment. Restore requires typing the database name.
- **Deployment, TLS, upgrade and rollback documentation**, including why the
  grading workers run on the host by default.
- `EXEC_WORK_DIR`, so a containerised worker can put its work directory
  somewhere the host daemon resolves to the same place.

### Fixed
- **The documented first-deploy command didn't work.** `npm run migrate` on a
  new database failed with `relation "users" does not exist`: the numbered
  migrations describe changes *since* the first release, and there was no base
  schema for them to build on. `migrate` now creates the schema on a genuinely
  empty database, making it the single correct command for both a fresh install
  and an upgrade. It detects emptiness strictly and **refuses to rebuild a
  database that holds anything** - that path loads `schema.sql`, which drops
  every table, so it is covered by tests that assert it does not fire.
- Postgres and Redis were not reachable from the host, so the documented default
  layout - workers on the host - could not have worked. They are now published
  on 127.0.0.1 only.

### Decided, with the cost written down
A containerised worker needs the host's Docker socket, and mounting it grants
root-equivalent access to the host: verified by starting a second container that
bind-mounts `/` and reads arbitrary files. For a project whose purpose is
sandboxing untrusted code, that is a poor trade, so **workers on the host are
the default** and the containerised worker is an opt-in compose profile with the
risk documented rather than hidden.

The same experiment surfaced a second trap: the daemon resolves bind-mount paths
on the *host*, so a containerised worker using its own temp directory hands the
sandbox an **empty** directory - every submission then fails with "file not
found", which reads like a broken grading engine rather than a mounting mistake.

### Verified
The whole stack was brought up from nothing and driven end to end through nginx:
teacher registered, course and problem created, student enrolled with a join
code, submission graded 3/3 in 1.0s by a host worker running real sandbox
containers. Metrics confirmed unreachable through nginx and reachable inside the
network. Backup taken, every user, course, problem and submission deleted, then
restored - all of it came back and the app kept serving. 167 tests, including
new ones covering the bootstrap path both ways.

### Known limitations (tracked for future versions)
- No TLS inside the stack; terminate it in front (documented)
- Single-host only - no multi-node orchestration
- No automated backup schedule; wire `backup.sh` into cron or a timer yourself
- The frontend still has no tests (next release)

## [0.0.8] - Scale and Observability

### Added
- **Prometheus metrics** at `GET /metrics`, from both the API and each worker:
  queue depth by state, grading duration, queue wait, verdict counts, HTTP
  timings, database pool usage and the usual Node runtime statistics. Queue
  depth and pool usage are read when a scrape arrives rather than on their own
  timer, so the numbers are current. The endpoint is behind `METRICS_TOKEN`,
  and with no token configured it is **disabled** rather than public.
- **Autoscaling worker pool** (`npm run worker:pool`). A supervisor runs grading
  workers and sizes the pool to the backlog: idle at `WORKER_POOL_MIN`, up to
  `WORKER_POOL_MAX` during a rush. It grows immediately, because the backlog is
  already waiting, and shrinks only after the queue has stayed quiet for several
  ticks, so a lull between two waves doesn't cost a rebuild. A worker that dies
  on its own is replaced. Workers on other machines are unaffected - this
  manages its own host only.
- **Cross-semester similarity archive.** A finished course's submissions can be
  archived with their fingerprints, and a later cohort screened against them.
  Until now screening only compared a student against their own classmates, so a
  solution handed down from last year was invisible. The code is copied rather
  than referenced, so the archive outlives the course; it belongs to the teacher
  who created it and is never shared between teachers.
- **A load test** (`npm run loadtest`) that drives the real API and waits for
  real workers, so its numbers include queueing, container startup, compilation
  and the database.
- **Connection pool tuning**: `DB_POOL_MAX` (default raised from pg's 10 to 20),
  idle and connection timeouts. The pool size is the real ceiling on concurrent
  database work, and the default sat below the worker concurrency it serves.

### Fixed
- **A Python docstring was tokenized as code by the similarity engine.** Triple-
  quoted strings weren't recognised, so a docstring was read as an empty string,
  then its prose as ordinary identifiers, then another empty string - a six-line
  docstring injected about twenty fake tokens into the fingerprint. That both
  manufactured similarity between two students who documented their work and let
  a real match be diluted by padding with prose. Listed as a known limitation
  since v0.0.2.
- **The archive screening would have produced false accusations.** The class
  report scores a pair by `max(percentA, percentB)`, which is right there
  because a uniformly high score on a trivial problem is cancelled by the
  class-relative median. The archive has no such baseline, and `max` is badly
  behaved across size differences: a one-line program whose whole fingerprint
  sits inside a twelve-line solution scored 100%. Measured on exactly that case
  - max 100%, min 14%, while a genuine renamed copy scores 94% either way - so
  archive screening requires the shared part to be a large fraction of *both*
  submissions, and ignores fingerprints too small to carry signal. The class
  report is unchanged.

### Measured
A burst of 60 simultaneous submissions on one laptop (6 workers max, Python,
three test cases each, every test in its own container):

| | |
|---|---|
| accepted | mean 0.06s, p95 0.07s |
| end to end | mean 12.4s, p50 13.6s, p95 16.5s |
| throughput | 3.5 submissions/second, all 60 graded in 17s |
| autoscaling | pool grew 1 → 6 workers on a backlog of 60 |

The API absorbs the burst instantly; the time is grading, which is what the
queue exists to smooth out.

### Known limitations (tracked for future versions)
- No Grafana dashboard shipped, only the metrics to build one from
- The pool supervisor scales one host; scaling across machines is still manual
- Archive screening compares whole submissions, not per-function fragments
- No alerting rules provided

## [0.0.7] - Evaluation Engine

Grading was a single string comparison. That marks plenty of correct answers
wrong, and told a student nothing about why their submission failed.

### Added
- **Output checkers**, chosen per problem. `exact` remains the default, so
  existing problems are graded exactly as before.
  - `float` - numeric comparison within a tolerance (absolute *or* relative, so
    it works near zero and at 1e12). `0.1 + 0.2` printing
    `0.30000000000000004` now passes against `0.3`.
  - `unordered_lines` / `unordered_tokens` - for answers that are a set with no
    correct order, compared as multisets so duplicates still matter.
  - `case_insensitive` - for `YES`/`Yes`.
  - `regex` - the whole output must match the pattern, not merely contain it.
- **Verdicts.** A failure is now classified as wrong answer, time limit,
  memory limit, runtime error, compile error or output limit, with a readable
  reason ("Segmentation fault - an invalid memory access", "token 3: expected
  1.5, got 1.7"). Shown to the student, and stored on the submission. Safe to
  show for hidden tests too: a verdict says how the run ended, never what the
  expected output was.
- **Per-problem time and memory limits**, so a deliberately heavy problem can
  be given more room without loosening the limits server-wide.
- **A separate, larger budget for compiling** (`EXEC_COMPILE_TIME_LIMIT_SEC`,
  default 30s). Compile and run shared one budget before, which is wrong in
  both directions: a heavily-templated C++ file can legitimately take longer to
  compile than the problem's entire run budget.
- **Go**, as a sixth language, with sandbox image, similarity-engine keywords
  and starter code.

### Fixed
- **The test suite was intermittently red.** Both integration suites rebuild the
  schema in `beforeAll` against the same database, and vitest runs files in
  parallel by default - so one suite could drop the tables the other was using.
  Test files now run one at a time; the whole suite still finishes in ~2s.

### Notes on the Go image
A cold Go build cache costs **31.7s per compile** on a `--cpus=0.5` container,
because Go rebuilds the standard library whenever `GOCACHE` is empty - which,
with a fresh tmpfs per run, is every submission. That blew past the compile
timeout and failed every Go submission. The image now bakes a warm 31 MB cache
in at build time, bringing a compile to **~0.3s**, and it stays read-only at
runtime.

### Verified
All six languages compile and run end-to-end through the container sandbox
(Go 713ms, Java 2.2s, the rest under a second). Every checker and every verdict
was exercised against real containers, including deliberately hitting the memory
cap and the wall clock. 47 new unit tests cover grading correctness alone -
138 total, run five times consecutively to confirm the flakiness is gone.

### Known limitations (tracked for future versions)
- Problems are still stdin/stdout only; function-signature problems (write a
  function, we supply the harness) are a larger change and not started
- No per-test-case checker override; the checker is per problem
- No performance/complexity testing beyond the wall clock
- Rust and C# were considered alongside Go but not included

## [0.0.6] - Exam Experience

### Fixed
- **Exam windows were wrong by the server's UTC offset.** Present since v0.0.1.
  Every instant was stored in a `TIMESTAMP` (without time zone) column: the API
  writes ISO-8601 instants, PostgreSQL kept the UTC wall clock and discarded the
  offset, and the driver read that value back as *local* time. The round trip
  therefore shifted every timestamp by the app server's offset. On a UTC server
  this is invisible, which is how it survived five releases; on a server at
  UTC+3 an exam scheduled to end at 17:00 stopped accepting submissions at
  14:00. `006_timestamptz.sql` converts every point-in-time column to
  `TIMESTAMPTZ`, and a regression test asserts an exam reads back the exact
  instant it was given.
- **A Redis outage hung every submission request.** `POST /api/submissions`
  awaited an enqueue that ioredis retries indefinitely while disconnected, so
  the request never returned. Enqueueing is now bounded
  (`QUEUE_ENQUEUE_TIMEOUT_MS`, default 5s); on failure the submission is marked
  `error` rather than left claiming to be `queued`, and the caller gets a 503
  telling them to retry.

### Added
- **Randomised per-student problem pools.** An exam can set
  `problems_per_student`, and each student is dealt that many problems at
  random from the exam's pool. The deal is stored, not re-derived, so it is
  stable across reloads and devices, cannot change mid-exam if the problem list
  is edited, and can be audited by the teacher
  (`GET /api/exams/:id/assignments`). Submitting an answer to a problem you
  weren't dealt is refused.
- **Per-student time extensions** for accessibility accommodations
  (`PUT /api/exams/:id/accommodations/:userId`). The student's effective
  deadline is computed in one place and honoured everywhere the window is
  checked - submitting, loading the exam, and integrity logging - so it cannot
  be granted on one endpoint and ignored on another. The exam page counts down
  against the student's own deadline.
- **Teacher grade overrides** (`PUT/DELETE /api/exams/:id/grades/:userId/:problemId`).
  Auto-grading compares stdout exactly, so it is unforgiving about a formatting
  difference in an otherwise correct answer; this is the escape hatch. The
  results table returns the final score, the automatic score and who changed it.
- **Draft autosave.** In-progress code is saved as the student types and
  restored on return, so a refresh, a dropped connection or a browser crash
  mid-exam no longer loses everything since the last submit. Drafts are private
  to their author, and exam drafts are kept separate from practice drafts for
  the same problem.
- **Fullscreen-exit detection** joins tab-switch and paste monitoring. Logged as
  a signal for the teacher, never an automatic block.

### Verified
Against real PostgreSQL 16 and Redis 7: 26 new integration tests covering pool
stability and per-student variation, accommodation grant/revoke, override
precedence, draft isolation and the timezone regression - 91 tests total. The
timezone regression test was itself checked by reverting the column type, which
failed 6 tests. CI now runs a Redis service alongside Postgres so the submission
happy path is genuinely exercised.

### Known limitations (tracked for future versions)
- No late-submission policy (an exam either accepts a submission or does not)
- Overrides are per problem; no rubric or partial-credit breakdown within one
- Fullscreen is monitored, not enforced - the exam page does not request it
- No teaching-assistant role; a course still has exactly one owning teacher

## [0.0.5] - Courses and Enrollment

Until now the system had no notion of a class: every authenticated user could
see every problem, exam and student on the server, and any teacher could edit
or delete any other teacher's content. Content now belongs to a course, and you
only see the courses you are in.

### Added
- **Courses and enrollments.** A course has a title, term and a join code;
  students enrol by entering that code. Problems and exams belong to exactly
  one course.
  - `GET/POST /api/courses`, `GET/PUT /api/courses/:id`
  - `POST /api/courses/join` - enrol with a join code
  - `GET /api/courses/:id/roster`, `DELETE /api/courses/:id/roster/:userId`
  - `POST /api/courses/:id/regenerate-code` - invalidate a leaked code
- Join codes avoid characters that get misread when copied off a slide or read
  aloud (no `0`/`O`, no `1`/`I`/`L`).
- Course pages in the frontend: students join by code and see their courses;
  teachers create courses, share the code and manage the roster.
- **Database-backed integration tests** (21 cases) covering the isolation rules
  against a real PostgreSQL - the previous release listed these as missing.
  CI runs them against a Postgres service container, and `REQUIRE_TEST_DB=1`
  makes CI fail rather than skip them if the database is unreachable.

### Security
Every endpoint that returns course-owned content is now scoped. Previously each
of these leaked across the whole installation:
- Students only see problems, exams and submissions for courses they are
  enrolled in; anything else is a 404, indistinguishable from not existing.
- Teachers only see and modify content in courses they own - including
  problems, test cases, exams, exam results, submission lists, similarity
  reports and exam-integrity summaries. Before this, any teacher account could
  edit or delete any problem on the server.
- `GET /api/users/students` returns only students enrolled in the caller's own
  courses, not every account on the server.
- Analytics count only the caller's own courses.
- An exam can only contain problems from its own course, so a teacher can't
  pull another course's problem into an exam and expose it.
- A course's join code is only ever returned to the teacher who owns it.

### Migration
`004_courses.sql` is additive and lossless. Existing problems and exams are
moved into a single "General" course, and every existing user is enrolled in
it, so an upgraded installation behaves exactly as it did before until the
teacher creates real courses. Re-running the migration is a no-op.

### Verified
Against a real PostgreSQL 16: fresh install from `schema.sql`, upgrade from a
v0.0.1 database through every migration, and 21 isolation tests. The isolation
tests were themselves checked by deliberately disabling the scoping rule, which
failed 10 of them - confirming they detect the regression they exist to catch.

### Known limitations (tracked for future versions)
- No teaching-assistant role: a course has exactly one owning teacher
- No CSV roster import; students enrol themselves with the join code
- Course archiving hides a course from joining but does not archive its content
- Containers share the host kernel (see v0.0.4)
- No password reset or email verification

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

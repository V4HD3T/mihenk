# CodeCloud - Backend

**Version 0.0.8**

Node.js/Express API for the Cloud-Based Multi-Platform Coding Education and Exam System.

## Features

- JWT-based authentication, role-based authorization (student / teacher)
- Sandboxed execution engine that compiles and runs **Python, C++, Java, JavaScript, C and Go**
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
- Hardened request handling (new in 0.0.3): schema-validated input, per-IP rate limiting,
  security headers, an origin allowlist, and structured request logging
- **Container-isolated execution (new in 0.0.4):** every compile and test case runs in its own
  throwaway Docker container with no network, a read-only root filesystem, memory/CPU caps and a
  process limit - see "Sandbox architecture" below
- **Courses and enrolment (new in 0.0.5):** problems and exams belong to a course; students see
  only the courses they joined, teachers only the courses they own - see "Courses" below
- **Exam experience (new in 0.0.6):** randomised per-student problem pools, per-student time
  extensions, teacher grade overrides, autosaved drafts and fullscreen-exit monitoring - see
  "Sitting an exam" below
- **Evaluation depth (new in 0.0.7):** output checkers (float tolerance, unordered, regex,
  case-insensitive), classified verdicts with a readable reason, and per-problem limits - see
  "How answers are judged" below
- **Scale and observability (new in 0.0.8):** Prometheus metrics, an autoscaling worker pool and
  a cross-semester plagiarism archive - see "Running at scale" below

## Setup

```bash
npm install
cp .env.example .env   # edit with your own values
```

### Database

PostgreSQL **12 or newer** must be installed and running.

**New installation:**
```bash
createdb codecloud
psql -U postgres -d codecloud -f src/db/schema.sql
```
`schema.sql` is the complete current schema - it already contains everything in
`migrations/`, and records those migrations as applied.

**Upgrading an existing database** (keeps your data — do not re-run `schema.sql`, it drops and
recreates every table):
```bash
npm run migrate          # applies whatever this database is missing, in order
npm run migrate:status   # shows applied vs pending without changing anything
```

### Sandbox images

Submitted code runs inside per-language containers, so build those images once per machine that
runs a grading worker:

```bash
npm run sandbox:build     # builds all six (a few GB of base images the first time)
npm run sandbox:check     # confirms each image's toolchain runs as the unprivileged user
npm run sandbox:verify    # runs hostile submissions and fails if any escapes containment
```

Then set `SANDBOX_MODE=docker` in `.env`. Without Docker you can develop with `SANDBOX_MODE=host`,
which runs code directly on your machine — fine for solo work, unsafe for untrusted users.

### Accounts and roles

Registration creates a **student** account. To create a teacher, set
`TEACHER_INVITE_CODE` in `.env` and supply that code on the signup form; the
server assigns the role, never the client. Leaving `TEACHER_INVITE_CODE` unset
disables teacher self-registration entirely.

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
extra coordination is needed. On a machine that should size itself to the load, run
`npm run worker:pool` instead of `npm run worker` (see "Running at scale").

Both processes shut down gracefully on `SIGINT`/`SIGTERM`: the API drains in-flight requests and
the worker finishes the submissions it is currently grading, so a restart never strands a
submission in the `running` state.

### Tests and linting

```bash
npm test                 # automated suite - no PostgreSQL, Redis or Docker required
npm run lint
npm run sandbox:verify   # real containment checks - needs Docker and the sandbox images
npm run test:exec        # live execution engine, needs python3/g++/gcc/javac/node installed
npm run test:similarity  # similarity engine's own scenario checks
```

`npm test` covers routing, validation, auth guards, security headers, CORS and rate limiting by
mounting the Express app directly (`src/app.js` deliberately opens no ports or connections, which
is what makes this possible).

It also contains the integration suites - course isolation and exam experience - which need a
real PostgreSQL, because the rules they check (who can see what, whose exam window is open) live
entirely in SQL and mocking the database would only test the mock. They **skip** when no database
is reachable, so `npm test` still works on a laptop without one:

```bash
docker run -d --name codecloud-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=codecloud_test -p 55432:5432 postgres:16-alpine
docker run -d --name codecloud-redis -p 56379:6379 redis:7-alpine

TEST_DB_PORT=55432 TEST_REDIS_PORT=56379 npm test
```

Redis is only needed for the handful of assertions that submit code successfully, since that path
enqueues a grading job; without it those specific tests fail fast rather than hanging.

Set `REQUIRE_TEST_DB=1` to turn a missing database into a failure instead of a skip. CI sets it,
because a green build with silently skipped isolation tests is precisely the false confidence
they exist to prevent. The suite rebuilds the schema from `src/db/schema.sql` on every run, so it
must point at a throwaway database - never your development one.

## Required system tools on the server

**With `SANDBOX_MODE=docker` (recommended):** only Docker is required. Every language toolchain
lives inside its sandbox image, so the host needs no compilers at all.

Ubuntu/Debian: `apt install docker.io redis-server`

**With `SANDBOX_MODE=host`:** the toolchains must be installed on the machine itself, because
submitted code runs directly on it:

| Language | Required tool                        |
|----------|----------------------------------------|
| Python   | `python3`                              |
| C++      | `g++` (with C++17 support)             |
| Java     | JDK (`javac` + `java`, version 17+)    |
| JavaScript | `node` (already required to run the app itself) |
| C        | `gcc` (with C17 support)               |
| Go       | `go` (1.21+)                           |

Ubuntu/Debian: `apt install python3 g++ gcc openjdk-21-jdk-headless golang-go redis-server`

It also needs GNU coreutils' `timeout`, which enforces the per-run wall clock. That is present
on Linux but **not on macOS**, so `SANDBOX_MODE=host` does not work on a Mac out of the box —
every run exits 127. Use `SANDBOX_MODE=docker` there (it works fine under Docker Desktop), or
install coreutils if you specifically need the host backend. This applies equally to
`npm run test:exec`.

`npm run test:exec` and `npm run test:similarity` exercise the engines against the host
toolchains directly, so they need the table above regardless of `SANDBOX_MODE`.

## API Endpoints (summary)

| Method | Path                                | Description                                | Access     |
|--------|---------------------------------------|----------------------------------------------|------------|
| POST   | /api/auth/register                  | Register (student, or teacher with an invite code) | -   |
| POST   | /api/auth/login                     | Log in                                      | -          |
| GET    | /api/auth/me                        | Current session info                        | Authenticated |
| GET    | /api/auth/registration-options      | Whether this server accepts a teacher invite code | -    |
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
| POST   | /api/integrity/archive/course/:id   | Archive a finished course for future screening | Owning teacher |
| GET    | /api/integrity/archive              | Cohorts you have archived                   | Teacher |
| DELETE | /api/integrity/archive/:label       | Drop an archived cohort                     | Teacher |
| GET    | /api/integrity/problem/:id/archive-matches | Screen a problem against the archive | Owning teacher |
| GET    | /metrics                            | Prometheus metrics                          | METRICS_TOKEN |
| GET    | /api/courses                        | Courses you teach or are enrolled in        | Authenticated |
| POST   | /api/courses                        | Create a course                             | Teacher |
| GET    | /api/courses/:id                    | Course detail (join code: owner only)       | Enrolled / owner |
| PUT    | /api/courses/:id                    | Update or archive a course                  | Owning teacher |
| POST   | /api/courses/join                   | Enrol using a join code                     | Authenticated |
| GET    | /api/courses/:id/roster             | Students enrolled in a course               | Owning teacher |
| DELETE | /api/courses/:id/roster/:userId     | Remove a student from a course              | Owning teacher |
| POST   | /api/courses/:id/regenerate-code    | Invalidate the current join code            | Owning teacher |
| GET    | /api/exams/:id/assignments          | Who was dealt which problems (randomised exams) | Owning teacher |
| GET    | /api/exams/:id/accommodations       | Who has extra time                          | Owning teacher |
| PUT    | /api/exams/:id/accommodations/:userId | Grant/change extra time (0 removes)       | Owning teacher |
| PUT    | /api/exams/:id/grades/:userId/:problemId | Override the automatic grade           | Owning teacher |
| DELETE | /api/exams/:id/grades/:userId/:problemId | Fall back to the automatic grade       | Owning teacher |
| PUT    | /api/drafts                         | Autosave in-progress code                   | Authenticated (own) |
| GET    | /api/drafts?problem_id=&exam_id=    | Restore in-progress code                    | Authenticated (own) |
| DELETE | /api/drafts?problem_id=&exam_id=    | Discard a draft                             | Authenticated (own) |

## Courses

Every problem and exam belongs to exactly one course, and that is what access is derived from:

- **Students** see the problems, exams and submissions of courses they are enrolled in. Anything
  else returns 404 - a course you are not in is indistinguishable from one that does not exist.
- **Teachers** see and modify only courses they created, including that course's problems, test
  cases, exams, results, similarity reports and roster.
- A course's **join code** is the credential for entering it, so it is only ever returned to the
  owning teacher. `POST /api/courses/:id/regenerate-code` invalidates a leaked one.
- An exam may only contain problems from its own course, so a problem cannot be exposed to
  another cohort by putting it in the wrong exam.

`src/services/courseAccess.service.js` is the single place that answers "which courses may this
user see?", so the rule cannot drift between the many queries that need it.

Before v0.0.5 none of this existed: every authenticated user could read every problem, exam and
student on the server, and any teacher could edit or delete any other teacher's content.
Upgrading is lossless - `004_courses.sql` moves existing content into one "General" course and
enrols every existing user in it, so an upgraded installation behaves exactly as it did before.

## Running at scale

### Metrics

`GET /metrics` serves Prometheus text from the API and from each worker, each labelled with its
own `role` so they don't overwrite each other's series.

Worth watching during an exam:

| Metric | Question it answers |
|---|---|
| `codecloud_queue_depth{state="waiting"}` | is the backlog growing faster than it drains? |
| `codecloud_queue_wait_seconds` | how long is a student waiting before grading even starts? |
| `codecloud_grading_duration_seconds` | how long does grading itself take, by language? |
| `codecloud_verdicts_total` | a sudden spike in `runtime_error` usually means the problem, not the students |
| `codecloud_grading_failures_total` | jobs that threw - an infrastructure problem, not a wrong answer |
| `codecloud_enqueue_failures_total` | submissions that couldn't be queued at all, e.g. Redis down |
| `codecloud_db_pool_connections{state="waiting"}` | requests queueing for a database connection |

The endpoint requires `METRICS_TOKEN` as a bearer token. Leave the variable unset and the
endpoint is **disabled**, not public - queue depth and failure rates are operational detail.

### Autoscaling workers

```bash
npm run worker:pool     # supervisor: sizes the pool to the backlog
```

A course sits idle for weeks, then two hundred students submit within ten minutes. Running enough
workers for the exam wastes the machine the rest of the term; running enough for the quiet weeks
means the exam queue takes far too long to drain.

The supervisor forks the same `src/worker.js` you would start by hand — nothing about grading
changes, only how many workers exist. It grows immediately (the backlog is already waiting) and
shrinks only after `WORKER_POOL_SCALE_DOWN_TICKS` quiet intervals, so a lull between two waves of
submissions doesn't cost the startup time of rebuilding the pool. A worker that dies on its own is
replaced. Workers on *other* machines pull from the same Redis queue and are unaffected; this
supervisor manages its own host only.

Tune with `WORKER_POOL_MIN`, `WORKER_POOL_MAX` and `WORKER_POOL_BACKLOG_PER_WORKER`.

### Load testing

```bash
npm run loadtest -- --students 100 --invite <TEACHER_INVITE_CODE>
```

Drives the real API and waits for real workers, so the numbers include queueing, container
startup, compilation and the database. Point it at a test install: it creates throwaway accounts,
and registering a class trips the production auth rate limit (which is the limiter working
correctly - give the target install headroom for the run).

Measured on one laptop, 60 simultaneous submissions, max 6 workers, Python with three test cases
each: submissions accepted in 0.06s mean, graded end-to-end in 12.4s mean / 16.5s p95, throughput
3.5/second, and the pool scaled 1 → 6 workers. The API absorbs the burst instantly; the elapsed
time is grading, which is exactly what the queue exists to smooth out.

## Cross-semester plagiarism archive

The class report compares a student against their classmates. That never sees a solution handed
down from last year's cohort, which is the most common way work gets reused in a course that runs
every term.

```
POST   /api/integrity/archive/course/:id        keep a finished course's submissions
GET    /api/integrity/archive                   what you have archived
DELETE /api/integrity/archive/:label            drop a cohort
GET    /api/integrity/problem/:id/archive-matches   screen this problem against the archive
```

The archive stores a copy of the code and its fingerprint, so it survives the original course
being deleted. It belongs to the teacher who created it and is never shared between teachers.

**Scoring is deliberately stricter here than in the class report.** The class report scores a pair
by `max(percentA, percentB)`, which is right there because a uniformly high score on a trivial
problem is cancelled out by the class-relative median. The archive has no such baseline, and `max`
misbehaves when two submissions differ in size: a one-line program whose entire fingerprint sits
inside a twelve-line solution scores 100%. Measured on exactly that case — max 100%, min 14%,
while a genuine renamed copy of the same solution scores 94% either way. So archive screening
requires the shared part to be a large fraction of **both** submissions, and ignores fingerprints
too small to carry any signal. A false accusation costs far more than a missed match.

## How answers are judged

Grading asks two separate questions: did the program **run** successfully, and is its **output**
correct? Conflating them is what made every failure look identical before v0.0.7.

### Checkers

A checker is chosen per problem. `exact` is the default and is what every problem used before
v0.0.7, so nothing changes for existing content.

| Checker | Accepts | Use it when |
|---|---|---|
| `exact` | identical output, after trailing-whitespace normalisation | the answer is a single exact string |
| `case_insensitive` | any capitalisation | `YES`/`Yes` are both fine |
| `float` | numbers within `checker_config.tolerance` (default 1e-6) | the answer involves decimals |
| `unordered_lines` | the same lines in any order | the answer is a set of lines |
| `unordered_tokens` | the same values in any order, ignoring line breaks | the answer is a set of values |
| `regex` | output matching the pattern in full | several answers are acceptable |

`float` compares by absolute *or* relative tolerance, because neither alone works across scales:
1e-6 absolute is meaningless at 1e12, and 1e-6 relative is meaningless near zero. Non-numeric
tokens in the expected output are compared literally, so a problem can mix labels and numbers
("area: 3.14"). `regex` anchors the pattern to the whole output - printing the right answer
surrounded by noise is not a correct answer.

### Verdicts

| Verdict | Meaning |
|---|---|
| `accepted` | ran cleanly and the output checked out |
| `wrong_answer` | ran cleanly, output didn't check out |
| `time_limit_exceeded` | the wall clock ran out |
| `memory_limit_exceeded` | OOM-killed by the container, or the runtime reported it |
| `runtime_error` | non-zero exit, with the signal explained where possible |
| `compile_error` | never got as far as running |
| `output_limit_exceeded` | printed far more than expected - usually a runaway loop |

Verdicts are shown for hidden test cases as well as sample ones: a verdict describes how the run
ended, never what the expected output was.

### Limits

`time_limit_sec` and `memory_limit_mb` on a problem override the server defaults for that problem
only. Compiling has its own, larger budget (`EXEC_COMPILE_TIME_LIMIT_SEC`, default 30s) - a
heavily-templated C++ file can legitimately take longer to compile than the problem's whole run
budget.

## Sitting an exam

**Randomised pools.** An exam with `problems_per_student` set deals each student that many
problems at random from its pool. The deal is written to `exam_assignments` the first time the
student opens the exam rather than re-derived from a seed, because it has to be stable across
reloads and devices, must not change if the teacher edits the problem list mid-exam, and has to
be auditable when a student questions their paper (`GET /api/exams/:id/assignments`). Answering a
problem you weren't dealt is refused.

**Time extensions.** `exam_accommodations` grants a student extra minutes. `examSession.service.js`
computes the effective deadline in one place and every window check goes through it - submitting,
loading the exam and integrity logging - so an accommodation cannot be honoured on one endpoint
and silently ignored on another. The student's exam page counts down against their own deadline.

**Grade overrides.** Auto-grading compares stdout exactly, so a correct answer with a trailing
formatting difference scores zero. A teacher can set the score directly; the results table shows
the final score, the automatic one, and who changed it, so an override is never invisible.

**Drafts.** Code is autosaved as the student types and restored on return, so a refresh or a
dropped connection mid-exam doesn't lose it. Drafts are private to their author - no endpoint
exposes one student's draft to anyone else, including teachers - and an exam draft is stored
separately from a practice draft for the same problem.

**Monitoring.** Tab switches, pasted code and fullscreen exits are logged during the exam window
and surfaced per student to the teacher. All three are signals to review, never automatic blocks:
client-side blocking is trivial to bypass and would only be a false sense of security.

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

## Sandbox architecture (containers, new in 0.0.4)

Every compile and every test case runs inside its own throwaway Docker container. This is the
isolation boundary that makes it safe to accept code from people you don't trust — it closes the
last open item from the original v0.0.1 production notes.

`src/services/sandbox.js` builds the container invocation; `codeExecution.service.js` decides
what command to run. The command string is identical in both backends, so compile/run semantics
never drift between them.

**What each container gets:**

| Flag | Why |
|---|---|
| `--network=none` | No network interface at all — submitted code cannot phone home, fetch a payload, or reach other services |
| `--memory` / `--memory-swap` | Hard memory cap; equal swap stops the cap being escaped by spilling to swap |
| `--pids-limit` | Correctly namespaced process-count containment — this is what makes a fork bomb a contained failure |
| `--read-only` | Everything outside the mounted work directory is immutable |
| `--tmpfs=/tmp:noexec,nosuid` | Compilers need scratch space; `noexec` stops a payload being written there and run |
| `--cap-drop=ALL` + `--security-opt=no-new-privileges` | No capabilities, no escalation through setuid binaries |
| `--user 10001:10001` | Unprivileged; never root |
| single `-v` bind mount | Only the per-run work directory is exposed from the host |

**Verifying it, rather than trusting it.** `npm run sandbox:verify` pushes deliberately hostile
submissions through the real engine — outbound network, fork bomb, memory bomb, writes outside
the work directory, an infinite loop, a privilege-escalation attempt — and exits non-zero if any
of them escapes. CI runs it on Linux on every push, so a regression in the security flags breaks
the build. The unit tests in `tests/sandbox.test.js` separately pin every flag above, since CI's
lint/test job has no Docker daemon.

Measured containment on the reference setup: network blocked, host paths unreachable, writes
outside the work directory refused, fork bomb stopped at the pid ceiling, memory bomb OOM-killed
(exit 137), infinite loop cut off by the wall clock, uid stays 10001.

**One container per test case, not per submission.** Benchmarked on a macOS dev machine at ~159
ms/test versus ~82 ms/test for reusing a single container via `docker exec` — the reuse option is
about twice as fast and was deliberately not chosen. Sharing a container across test cases lets a
stray background process, a leftover file or an exhausted pid budget from one test change the
result of the next, and a wrong grade is worse than a slower one. Grading is queued, so nobody is
waiting on the difference. (Those figures come from a Mac, where containers run inside a VM and
bind mounts go through virtiofs; native Linux is faster.)

**The host backend.** `SANDBOX_MODE=host` keeps the pre-0.0.4 behaviour — a child process bounded
by `timeout` plus `ulimit -v`. It exists for development on machines without Docker and is **not
safe for untrusted users**. Note that it deliberately does not attempt process-count limiting via
`ulimit -u`: that limit is per-*user*, not per-process-tree, so on a host where the same user
already owns many processes it can starve unrelated work instead of just the sandbox. Genuine
process-count containment requires the container layer, which is exactly what `--pids-limit`
provides above.

`SANDBOX_MODE=docker` **fails closed**: if the daemon is unreachable, submissions error out
instead of silently falling back to the weaker backend. `auto` does fall back, which is why it
is for development only.

**Still worth adding for a high-risk deployment:** a stronger kernel boundary than containers
share — gVisor or a Firecracker micro-VM — plus seccomp profiles tuned per language.

## Environment Variables

See `.env.example`. Every variable is validated at startup, so a typo or a missing required value
fails immediately with a readable message instead of surfacing later as a confusing runtime error.

Two of them matter for safety:

- `JWT_SECRET` — the server **refuses to start** in production while this is still the placeholder
  from `.env.example`, since anyone who has read the repo could otherwise forge tokens.
- `TEACHER_INVITE_CODE` — controls who can create a teacher account. Unset means teacher
  self-registration is off.

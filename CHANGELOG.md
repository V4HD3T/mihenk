# Changelog

All notable changes to this project are documented in this file.

## [2.2.0] - Marks, Not Counts

v0.0.7 moved grading from one string comparison to a checker per problem, and
scored the result by counting test cases. Counting is the part that stayed
wrong: a one-line edge case counted as much as the case that checks the
algorithm, so a student who solved the problem and missed an empty-input check
scored *below* one who got the algorithm wrong and happened to handle empty
input. Both were 2/3 and 1/3 the wrong way round.

### Added
- **A weight per test case.** What a case is worth is now the teacher's
  decision. Every existing case weighs 1, which makes the weighted score
  identical to the count it replaces, so no problem anywhere is re-marked by
  this release.

  0 is allowed and useful: a case that must pass to be graded at all but carries
  no marks of its own.
- **Rubric sections.** Cases can share a label, and a submission comes back with
  the score broken down by it. A bare 7/10 is a mark; "edge cases 0/2" is the
  thing to go and fix. Sections appear only where a teacher wrote them - an
  unlabelled group says nothing the count above it did not already say, so it is
  not rendered.
- **A checker per test case.** v0.0.7 made the checker a property of the
  problem, which is right for most problems and wrong for any that asks for more
  than one kind of answer: "print the mean, then the sorted values" wants a float
  tolerance on the first line and an exact comparison on the rest, and could have
  neither.

  A case with no checker of its own is stored as NULL rather than as a copy of
  the problem's, so changing the problem's checker later still moves it. The
  config travels with the checker and never mixes - a tolerance chosen for the
  problem's `float` is not handed to a different checker on a case.

`passed_count` and `total_count` keep their meaning exactly: they count test
cases, they are on the public API, and plenty of the interface reads them. The
weighted score is recorded beside them. On a submission graded before this
release it is NULL - unknown rather than zero - and every reader falls back to
the counts. Backfilling would have been a lie about work that was never weighed.

Weights and section names reach students for hidden cases too. What a question
is worth is the marking scheme, not the answer to it, and a student who cannot
see that the edge cases carry a tenth of the marks cannot tell a near miss from
a wrong approach.

### Upgrading
Additive. `npm run migrate` applies `011_weighted_grading.sql`. Rehearsed against
a populated v2.1.0 database: existing cases came out weighing 1 with a NULL
checker and no section, the problem's own checker untouched, the old submission's
weighted score NULL beside an intact 2/2, and a second run a no-op.

### Verified
287 backend tests (was 268) and 59 frontend (was 57), both lint suites clean,
production build green, backend suite run against a real PostgreSQL.

### Note on a mutation that got away
Mutation-tested as usual, and the third mutation is the one worth writing down.
Making the grading loop ignore a test case's own checker entirely - so the
problem's always won - **passed all eight integration tests**. They asserted that
weights and checkers were stored and returned, and never that grading used them.

The reason is structural: the decision lived inline in the loop that runs the
containers, so the only way to reach it was through Docker, and a decision that
can only be tested with Docker is a decision that does not get tested. It is a
named function now, and the mutation fails three tests - including one that runs
the same output through both answers and asserts the verdicts differ, because
asserting on the checker's *name* would not have caught a wiring mistake that
never reaches the comparison.

The other mutations behaved: reading a missing weight as 0 (which would mark
every pre-upgrade problem out of nothing) failed one test, ignoring weights in
favour of the pass count failed two, leaking the problem's config into a case's
own checker failed one, and on the interface, rendering unlabelled sections
failed one while rendering no sections at all failed another.

### Known limitations
- Weights are per test case, so partial credit within a *single* case - half
  marks for output that is close - is still not expressible.
- A section is a label with no order of its own; sections come out in the order
  their first case appears.
- Exam results use the weighted score where one exists and the counts where it
  does not, so a paper spanning the upgrade mixes both. The migration cannot fix
  this without inventing weights for work already graded.
- Nothing verifies that a problem's weights add up to anything in particular. A
  paper marked out of 7 is a valid paper.
- No performance or complexity testing beyond the wall clock, which was the
  third item v0.0.7 left open and is not addressed here.

## [2.1.0] - Exam Paper Control

Four things a teacher could not decide about their own exam. The first is the
last open security item in the project: v0.1.2 sealed exam papers until the exam
starts, and wrote down the hole it could not close.

### Security
- **A make-up sitting published its paper to the students still due to take it.**
  An exam had no roster, so "has this started?" was asked of the *course* rather
  than of the sitting. Two sittings of one paper - a make-up a day later, which
  is the ordinary reason to schedule one - therefore shared visibility: the
  moment the first sitting opened, its questions became readable by everyone in
  the course, including exactly the people who had not sat it yet.

  Reproduced against a real database before the fix, in the arrangement that
  produces it: one paper, two sittings, one running and one tomorrow.

  ```
  GET  /api/problems/:id   -> 200   description: "SECRET BODY OF ..."
  POST /api/submissions    -> 202   (graded against the hidden tests)
  ```

  The second line is the worse one, for the same reason it was in v0.1.2:
  reading the paper gives you the questions, submitting tells you whether your
  answer is right.

  An exam now has a roster. **An empty roster means the whole course sits the
  exam**, which is what every exam that exists today does, so nothing changes
  for any of them. Naming people narrows both the paper and the exam itself: a
  student not on the roster gets 404 for the exam, and it does not appear in
  their list at all. Listing it without its problems would still tell the main
  cohort that a second sitting of their paper is scheduled, and when.

  A roster may only name students already enrolled in the course. Otherwise it
  would be a second, quieter enrolment path - a way to hand someone a course's
  paper without ever putting them in the course.

### Added
- **The order of the questions.** Problems came back ordered by primary key, so
  a paper ran in the order its questions happened to be written, and a warm-up
  added last sorted to the end. The order the teacher arranges is now the order
  of the paper, including for a randomised exam, which keeps the relative order
  of whatever subset a student was dealt.
- **Marks per question.** The column has existed since v0.0.6 and nothing could
  set it; 100 was divided evenly and that was that. Marks are now hand-settable,
  and a paper does not have to be out of 100. Left alone, the even split is
  unchanged - and the client sends no marks at all in that case rather than its
  own copy of the arithmetic, because two implementations of the remainder rule
  is one too many.
- **Late submissions.** An exam either accepted a submission or refused it, so
  work that landed forty seconds after the deadline scored what work that was
  never written scored. An exam can now define a grace period and what it costs.

  Lateness and extra time are deliberately different things: the late window is
  measured from the student's *effective* deadline, so an accommodation and a
  grace period add rather than overlap. Extra time says the deadline was never
  really at that hour for this student; lateness says they missed it and it cost
  them.

  Both are recorded on the submission rather than recomputed at read time. A
  grade that moves because someone edited an accommodation, or lowered the
  penalty, weeks after the paper was marked is not a grade anyone can defend.
  A grade override still outranks the penalty, which is how a teacher waives one.
- **Editing an exam** (`PUT /api/exams/:id`), which is what makes the three
  above usable on a paper that already exists. The paper is replaced wholesale
  rather than merged: a partial update of an ordered list is where "save" and
  "what is on screen" drift apart. Deals held for a problem dropped from the
  paper are discarded, so nobody is shown a question that is no longer on it.

### Upgrading
Additive. `npm run migrate` applies `010_exam_paper_control.sql`; every column
it adds defaults to the previous behaviour, and no exam gains a roster. Rehearsed
against a populated v2.0.1 database: data intact, `position` backfilled to the
order those papers were already displayed in, and a second run is a no-op.

### Verified
268 backend tests (was 241) and 57 frontend tests (was 50), both lint suites
clean, production build green, and the full backend suite run against a real
PostgreSQL rather than skipped - 258 of the 268 execute, the remaining 10 needing
an SMTP catcher.

Mutation-tested. Making the roster clause always true - v2.0.1's behaviour,
written so the SQL stays valid and the bind parameter is still used - failed six
tests, and the two that matter failed by *reproducing the leak*: `200` where the
paper should have been invisible, `202` where a practice submission should have
been refused. Ordering the paper by problem id failed the ordering test; sending
computed marks when the teacher had not set any failed the test that says the
client must stay out of that arithmetic.

The first attempt at that mutation was wrong and is worth recording: deleting
the roster clause outright left an unused bind parameter, so every query 500'd
and the tests failed for the wrong reason. A mutation that breaks the code
instead of changing its meaning proves nothing, and it looked exactly like
success.

### Known limitations
- A roster is a list of names, not a rule. Rescheduling one student into a
  second sitting means editing both rosters by hand.
- `problems_per_student` deals from the whole pool, so two sittings of one paper
  can deal the same subset to both. The rosters keep them apart, not the deal.
- The late window is per exam, not per problem, and the penalty is flat rather
  than scaled by how late the work was.
- Marks are per question. There is still no rubric or partial credit *within* a
  question - that remains where v0.0.6 left it.
- `POST /api/auth/resend-verification` is still unreachable, for the reason
  given in v0.2.0.

## [2.0.1] - The Checker Gets a Deadline

Closes the one item v0.1.2 listed and left open: the `regex` checker compiled a
teacher-supplied pattern and ran it with no bound, in the worker process rather
than inside a container. It is the only place in the system where input that is
not a student's submission executes outside the sandbox.

### Fixed
- **A catastrophically backtracking checker pattern pinned a grading worker.**
  `(a+)+` against sixty-four characters does not finish in any useful sense of
  the word, and nothing was going to stop it: the match holds the thread, so the
  worker takes no further jobs, answers no IPC, and reports no metrics for as
  long as the process lives.

  The failure mode that matters is not an attack. A teacher writing a pattern
  for "one or more words, optionally spaced" reaches for `(\w+\s?)*` by ordinary
  reasoning, and it is exponential. With the pool sized to the queue since
  v0.0.8, a few submissions against that problem take out workers one at a time
  while the backlog they are measured against keeps growing — the supervisor
  responds by starting more workers into the same pattern. During an exam that
  is a stopped queue, and the alert it trips (`MihenkQueueBacklog`) describes
  the symptom rather than the cause.

  The match now runs under a 250 ms deadline. **No pattern changes meaning** —
  the engine, the dialect and the anchoring are exactly what they were, so
  lookahead and backreferences still work and no existing problem is affected.

  A timed-out match fails the test case and says why, in the same shape a
  malformed pattern has failed since v0.0.7. It fails closed on purpose: the
  answer was never judged, so calling it correct would hide the fault. The
  wording states that the fault is in the problem and not in the submission,
  because a student reads it too and a teacher can lift it with the grade
  override that v0.2.0 added.

### Note on the mechanism
V8 does not yield while matching, so a runaway pattern cannot be bounded by
anything written in ordinary JavaScript: a timer, an `AbortSignal` or a
`Promise.race` all wait their turn behind a match that never returns. The
deadline therefore comes from `node:vm`, whose timeout is a watchdog inside the
isolate that V8's regex engine does check. The pattern crosses into that context
as data and never as source text — interpolating it into the snippet would turn
a checker into an `eval`.

This was measured rather than assumed, on both Node majors the project runs:
22, which the images are built from, and 24, which CI uses. Four catastrophic
shapes, all four interrupted on both.

### Verified
241 backend tests (was 235) and 50 frontend tests, both lint suites clean,
production build green.

Mutation-tested, as usual. Reporting a timed-out match as a pass: five tests
failed. Dropping the `timeout` option and leaving everything else in place: the
suite **never finished** and had to be killed from outside after 30 s — vitest's
own five-second per-test timeout could not fire either, which is the same fact
about the event loop that the defect was made of, and the reason a test that
merely measured elapsed time would not have been enough.

Cost of the machinery on patterns that behave: ~42 µs per check, against the
~159 ms a test case already spends starting its container.

## [2.0.0] - Mihenk

The project is renamed from CodeCloud to **Mihenk**. A *mihenk taşı* is a
touchstone: the stone you rub gold against, judging its purity by the streak it
leaves. That is what this system does to a submission, so the name is the thing.
"CodeCloud" described the hosting, and described it the same way a dozen other
projects do.

No behaviour changes. This is a major release because the name reaches into
things `VERSIONING.md` calls the public interface, and pretending otherwise
would be exactly the sort of quiet break that document exists to prevent.

### Breaking

**Read this before upgrading an existing install.** In order of how much they
cost to get wrong:

1. **The compose project name changed, which orphans your data volumes.**
   `docker compose` prefixes volume names with the project, so `codecloud` gave
   you `codecloud_postgres-data` and `mihenk` looks for `mihenk_postgres-data`.
   Bringing the new stack up over an old install therefore starts with an
   **empty database** and leaves the real one untouched but unused. It looks
   like total data loss and is not, which is arguably worse — you find out after
   the students do.

   Either keep the old project name:

   ```bash
   docker compose -p codecloud up -d      # or: COMPOSE_PROJECT_NAME=codecloud
   ```

   or migrate the volumes deliberately: back up with `scripts/backup.sh` on the
   old stack, bring up the new one, restore with `scripts/restore.sh`.

2. **`DB_NAME` and `DB_USER` defaults changed** from `codecloud` to `mihenk`. An
   install that relied on the defaults must now set them explicitly to keep
   pointing at the database it already has.

3. **Every metric was renamed**, `codecloud_*` → `mihenk_*`. The dashboard and
   alerting rules in `ops/` are updated in step, but any dashboard or alert you
   wrote yourself goes blank and silent rather than erroring. The Grafana
   dashboard `uid` is now `mihenk-overview`, so it provisions as a new dashboard
   and the old one remains until deleted. Alert rule names changed too
   (`CodeCloudAPIDown` → `MihenkAPIDown`), which matters if anything routes on
   them.

4. **Browser storage keys changed**, so **every signed-in user is signed out
   once** and has to sign in again. Nothing is lost; unsubmitted drafts live on
   the server, not in the browser.

5. **Image names changed**: `codecloud-api`/`codecloud-web` → `mihenk-api`/
   `mihenk-web`, and the sandbox images are now `mihenk-<language>-sandbox`
   (`SANDBOX_IMAGE_PREFIX` default `mihenk`). Run `npm run sandbox:build`, or
   retag what you have. Grading **fails closed** against missing images rather
   than running unsandboxed, so a missed rebuild is a stopped queue, not a
   security hole.

6. `CODECLOUD_VERSION` → `MIHENK_VERSION`, and `MAIL_FROM` now defaults to
   `Mihenk <no-reply@mihenk.local>`.

### Unchanged
- The database schema. No migration ships with this release, and none is needed.
- Every HTTP route, request and response body. `/api/openapi.json` reports the
  new title and version; nothing else about it moved.
- The WebSocket contract.

### Note on this file
Earlier entries still say CodeCloud, and the v1.0.0 entry still names
`codecloud_worker_pool_size`. Both are left alone deliberately: they record what
was true when they were written, and editing history to match the present is how
a changelog stops being evidence.

### Verified
235 backend tests and 50 frontend tests, both lint suites clean, 7/7 sandbox
containment checks against rebuilt images, production build green. 56 files
rewritten; zero occurrences of the old name remain outside this file.

## [1.0.0] - Documented and Observable

The last three releases closed the functional gaps. This one closes the gap
between what the system does and what anyone outside it can find out: the API is
described, the metrics are reachable, and the version number now means something
specific.

Writing the dashboard is what exposed the release's largest defect. The workers
had been instrumented since v0.0.8 and nothing could read any of it.

### Added
- **An OpenAPI 3.1 description of every endpoint**, served at
  `/api/openapi.json`. All 54 routes, with the two rules that run through the
  whole API — course scoping, and the exam seal — stated once in the
  introduction rather than repeated per path.

  It is not trusted to stay true. A test walks the live Express router and fails
  if the document and the application disagree about which endpoints exist, **in
  either direction**: an undocumented route fails, and so does a documented one
  that no longer exists. The second is the worse failure, because it sends a
  reader to write code against a 404.
- **A Grafana dashboard and Prometheus alerting rules**, provisioned from `ops/`
  and wired into `docker compose --profile monitoring`. Nine alerts, each one
  written for something a person would act on: the API unreachable, no workers
  running, the queue backing up, submissions waiting too long to start, grading
  jobs throwing, submissions that could not be queued at all, the database pool
  saturated, the event loop blocked, and 5xx above 5%.
- **`VERSIONING.md`** — what counts as the public interface, what each number
  means, how to upgrade, and what is explicitly not covered (no backports, no
  downgrades, no supported multi-host scale-out).

### Fixed
- **The grading workers exposed no metrics at all.** Every counter they keep —
  grading duration, queue wait, verdicts, grading failures — was written to a
  registry inside a forked process with nothing able to read it, and
  `codecloud_worker_pool_size` was a gauge that no code anywhere ever set,
  because `workerPool.js` did not import the metrics module.

  Half the instrumentation existed and none of it was reachable, which is worse
  than not having it: a dashboard built on those series draws empty graphs, and
  an empty graph reads as "nothing is happening" rather than "this is not wired
  up". Found by writing the dashboard and asking where each series would come
  from.

  Workers now answer the pool over IPC and the pool serves one aggregated
  endpoint, so N workers do not contend for a port. A worker started on its own
  serves its own. Both are fail-closed in the same way the API already was:
  without `METRICS_TOKEN` there is no listener, not an open one.

### Verified
235 backend tests (was 207) and 50 frontend tests, both lint suites clean, 7/7
sandbox containment checks against real containers, production build green,
`docker compose --profile monitoring config` valid, and both Prometheus files
checked by `promtool` itself — `SUCCESS: /etc/prometheus/prometheus.yml is valid
prometheus config file syntax` and `SUCCESS: 9 rules found`.

The aggregation is tested with real forked children and a real HTTP request —
the thing under test is the IPC and the socket, and mocking either would only
test the mock. Mutation-tested as usual: undocumenting an endpoint, documenting
one that does not exist, breaking the route-table reconstruction, adding a route
without documenting it, renaming a metric out from under the dashboard, removing
an alert's `for:`, unbalancing a PromQL expression, misspelling a PromQL
function, dropping the pool-size gauge, ignoring the children's metrics, and
disabling the token check were each introduced deliberately and the suite
watched to fail. Fourteen mutations, fourteen catches.

### Known limitations
- `promtool` validates syntax, not meaning: it confirms the rules parse and the
  functions exist, and the test suite confirms every metric named is one the
  application exports. Neither can tell you a threshold is wrong.
- The dashboard assumes one API instance and one worker pool on one host, which
  is the deployment the compose file describes.
- `POST /api/auth/resend-verification` is documented but still has no interface,
  for the reason given in v0.2.0.
- Alert thresholds are guesses calibrated to a single-host install with a class
  of a few hundred. They are the first thing to tune against a real exam.

## [0.2.0] - Teacher Control

The audit that produced v0.1.2 turned up something other than bugs: the backend
was roughly a release ahead of the interface. Extra time, grade overrides,
randomised exam pools, the cross-semester archive and problem editing were all
built, tested and documented, and all of them were reachable only with curl.
Four of them were listed as shipped features. This release is almost entirely
frontend — it adds no endpoints, because the endpoints were already there.

### Added
- **Editing a problem.** `PUT /api/problems/:id` had existed since v0.0.1 with
  nothing calling it, so correcting a typo in a title meant deleting the
  problem and writing it again — which deleted every submission against it.
  Test cases are managed separately when editing, through their own endpoints,
  and the form says so: they save the moment you add or remove one, rather than
  on Save with the rest.
- **Extra time.** Minutes added to one student's deadline for one exam. The
  countdown, the submission window and the integrity logging already honoured
  an accommodation everywhere; there was simply no way to grant one.
- **Grade overrides**, with the automatic result kept on screen beside the mark
  being changed, and a revert back to it.
- **Randomised exam pools.** `problems_per_student` has dealt each student a
  random subset since v0.0.6. The exam form never sent the field, so no exam
  ever used it. The control appears once more than one problem is selected,
  since it means nothing otherwise.
- **The deal, auditable.** Who was given which problems, for when a student
  questions their paper.
- **The screening archive.** Keeping a finished course for comparison against
  future cohorts, listing what is kept, and deleting a cohort. The similarity
  report now also shows matches against previous years, which the class-relative
  report cannot see: a solution handed down from last year looks unremarkable
  beside this year's classmates.
- **Course editing and archiving.** The archived badge has been rendered on the
  course card since v0.0.5, with nothing able to set the flag it displayed.
- **A student's own submission history**, and a **student detail page** for
  teachers, linked from the student list.

### Changed
- **Routes are code-split.** This release roughly doubled the amount of
  interface, and the whole application was one chunk that every visitor
  downloaded before seeing a login form — including the charting library and
  the teacher's administration screens, which a signed-out visitor cannot
  reach. The entry chunk drops from **739.83 kB to 258.25 kB** (gzip 212.58 kB
  to 87.44 kB); Recharts now sits in the Analytics chunk, fetched on the way to
  that page.
- The teacher panel is split into components rather than one 570-line file,
  which is also what let the forms be shared between creating and editing.
- The course editor carries an accessible name. Several course cards can each
  have an editor open, and the create form above them has identically labelled
  fields; without a name they are one indistinguishable pile of "Course title".

### Fixed
- **`auth.forgotSent` existed in no catalogue.** The forgot-password page shows
  it when the request fails, so a network error rendered the literal string
  `auth.forgotSent` where a sentence belonged — and, since the success path
  shows a proper message, made a failure visibly different from a success on
  the one page whose entire design is that they look identical. Found by the
  new key test, not by reading.
- Heading order on the teacher panel went `h1` to `h3` again after the forms
  were extracted into components — the same defect v0.1.1 fixed, reintroduced
  by moving the code. Caught by the axe test that v0.1.1 added.

### Verified
50 frontend tests (was 34) and 207 backend tests, both lint suites clean, 7/7
sandbox containment checks, production build green, `npm ci` clean in both
packages.

Every new behaviour was mutation-tested: sending a partial body on save,
dropping `problems_per_student` from the request, saving an accommodation
without its note, allowing the last test case to be deleted, and misspelling a
translation key were each introduced deliberately and the suite watched to
fail. Six mutations, six catches. The tests assert on the request the page
sends, because a page that renders a form and posts nothing is exactly what
this release existed to fix and would have looked finished in a screenshot.

A new test resolves every literal `t('...')` key in the source against the
catalogue. With 350 keys across 29 components, a typo renders the key itself on
screen, and that is how `auth.forgotSent` had survived.

### Known limitations
- `POST /api/auth/resend-verification` is still unreachable. Offering the
  button needs to know whether the address is unverified, and the JWT payload
  carries only `{ id, name, email, role }` — so doing it properly means the
  server exposing verification status, which is a backend change rather than
  the wiring-up this release is. An unconditional button would be noise for
  everyone already verified.
- Exam problems cannot be reordered, and per-problem points are still divided
  evenly rather than set by hand.
- The archive screens on a fixed 70% threshold with no way to tune it per
  problem.

## [0.1.2] - Exam Integrity

An audit of the API turned up the defect this project most needed not to have:
a scheduled exam's questions could be read by any enrolled student before the
exam started. Ten releases of sandboxing, similarity screening and tab-switch
logging sat on top of a paper that anyone in the class could open the night
before.

### Security
- **Exam papers are sealed until the exam opens.** Every access check asked one
  question — is this user in the problem's course? — and an exam's problems
  belong to that course by construction. So `GET /api/problems/:id` returned
  the full description, starter code and sample tests of tomorrow's exam to
  anyone enrolled, `GET /api/problems` listed it by title, and
  `GET /api/exams/:id` handed over the paper. Reproduced against a real
  database before the fix, with an exam scheduled for the following day:

  ```
  GET /api/problems/:id  ->  200
  description: "THE SECRET EXAM QUESTION TEXT"
  starter:     "# secret starter"
  ```

  A problem in no exam is practice material and stays visible. A problem in an
  exam becomes visible when one of its exams starts, and stays visible
  afterwards so students can review their paper. Teachers are never gated.
- **Submitting was a better leak than reading.** The exam-window check only ran
  when a submission carried an `exam_id`. Submitting the same problem as
  ordinary practice skipped it, ran the *hidden* tests and reported which
  passed — an oracle for the paper rather than merely a copy of it. The
  visibility gate now sits on the problem lookup that both paths share.
- **Looking early no longer deals the paper.** On a randomised exam
  (`problems_per_student`), the exam view assigns each student their subset on
  first read and stores it. A student who peeked the night before settled their
  own deal early and could revise exactly those questions. Nothing is dealt
  before the exam opens.
- **Join codes come from `crypto.randomInt`,** not `Math.random()`. A join code
  is a capability — it enrols the holder and opens the course's content — and
  V8's generator is fast rather than unpredictable, so a teacher handing out
  several codes was publishing the state that produces the next one. Guessing
  was never the threat (31^8 codes against a 300-request budget); predicting
  was. `randomInt` rejection-samples, so the 31-character alphabet stays
  uniform.

### Fixed
- **A student's progress denominator counted the whole server.** Every other
  query on the analytics route was scoped to the caller; `totalProblems` was
  `SELECT COUNT(*) FROM problems`. A student enrolled in one course holding one
  problem was shown "0 / 4" on an installation with four, which is both the
  wrong number and a running total of the whole deployment.
- **Teachers saw each other's submission counts.** `/api/users/students`
  restricted *which students* it listed but joined submissions on `user_id`
  alone, so the counts beside each name totalled that student's work across
  every course they take. The detail endpoint beside it, `/students/:id`, had
  scoped this correctly since v0.0.5 — the rule was known, just not applied
  evenly.
- **Exam papers were not worth 100.** Points were `floor(100 / n)` per problem,
  so a three-problem exam totalled 99, six totalled 96 and seven totalled 98.
  The remainder is now spread one point at a time, leaving every problem within
  a point of every other.

### Verified
207 backend tests (was 177) and 34 frontend tests, both lint suites clean, 7/7
sandbox containment checks against real containers, production build green, and
`npm ci` from a clean tree in both packages.

Every fix in this release was written test-first and then **mutation-tested**:
the fix was deliberately reverted and the suite watched to fail. Six mutations,
six catches — except that the first version of the join-code uniformity test
did *not* catch a biased `byte % 31` generator. Its 15% per-character tolerance
was looser than the 9.1% skew it existed to detect, and no per-character
tolerance can separate that skew from noise across 31 characters. It was
replaced with a chi-square test over the whole alphabet (uniform ≈ 30, biased
≈ 180, threshold 90) and re-mutated: caught 3/3, clean 5/5.

### Known limitations
- Two sittings of one paper in the same course — a make-up exam a day later —
  share visibility, because an exam has no roster of its own. Once the first
  sitting opens, its problems are readable by everyone in the course. Per-exam
  rosters would fix this and are not modelled.
- A submission naming a not-yet-started exam now answers 404 rather than the
  window check's 403 "this exam has not started yet", because the problem
  lookup fails first. That is the intended answer — "not yours" and "not yet"
  stay indistinguishable — and the request is unreachable from the interface.
  A submission to an exam that has *ended* still gets the explanatory 403.
- The `regex` checker compiles a teacher-supplied pattern with no timeout, in
  the worker process rather than inside a container. A catastrophically
  backtracking pattern would pin a worker. Teacher-authored and so not urgent,
  but it is the one place teacher input executes outside the sandbox.

## [0.1.1] - Linted and Translated

v0.1.0 shipped a frontend that no linter had ever read, and a translation that
stopped halfway. This closes both, and the tooling immediately found that
v0.1.0's own accessibility fix had been applied without running anything.

### Added
- **ESLint on the frontend**, with `react`, `react-hooks` and `jsx-a11y`, wired
  into CI ahead of the tests. Ten releases, 3,203 lines of JSX, no linter; the
  first run reported 47 problems.
- **Accessibility coverage for the teacher pages.** The panel and the roster
  carry most of the app's form controls and were not in the axe suite. Both are
  now rendered with their forms open — a collapsed form is an unchecked one.
- **`dateLocale()`**, so dates follow the interface language.

### Fixed
- **Every test-case row rendered the same DOM `id`.** v0.1.0 added
  `id="teacherpanel-test-cases"` inside a `.map()`, so with three test cases
  three inputs claimed one id and the label pointed at whichever the browser
  found first. Ids in repeated rows are now derived per row from `useId()`.
- **A label pointing at nothing.** The "sample" checkbox's `htmlFor` named
  `teacherpanel-updatetestcase-idx-is-sample-e-target-ch`, an id that existed
  nowhere in the app. A `htmlFor` that resolves to no element also suppresses
  the implicit association from wrapping the input, so the checkbox had no
  accessible name at all.
- **Broken heading order on the teacher panel** — `h1` straight to `h3`, found
  by the new axe test on its first run. Heading level is how a screen-reader
  user navigates a page.
- **Dates were formatted `en-US` in seven places** regardless of language.
  `03/04/2026` is 4 March to a Turkish reader and 3 April to an American one,
  with nothing on screen to say which — an exam start time that reads as the
  wrong month is worse than an untranslated one.
- The six starter-code boxes were hand-written with slugified ids, which left
  the C++ field wearing `...-c-starter-code` and the C field `...-c-starter-code-2`.
  They are generated from a list now, so the ids cannot drift from their labels.
- Buttons repeated per row — "delete", "remove", "regenerate",
  "view side-by-side" — now name their subject in the accessible label. A
  screen reader previously announced a column of identical "delete"s.

### Changed
- **Translation finished**: 109 catalogue keys to 274, and 58 hardcoded English
  strings to zero. The teacher panel, analytics, exam results, similarity
  report, roster, student pages and the two auth fallback messages are now
  translated; so are placeholders and `aria-label`s, which the v0.1.0 pass had
  skipped even on pages it otherwise covered. Several pages had catalogue
  entries written for them that were never wired up.
- The student "no join code" test now asserts the code *value* is absent while
  the server deliberately over-shares it, rather than matching the phrase "join
  code" — which also appears on the student's own join field, and is not a leak.
  The stronger form was confirmed by reverting the `isTeacher` guard.
- The frontend pins the ESLint 9 line while the backend is on 10: neither
  `eslint-plugin-react` nor `eslint-plugin-jsx-a11y` declares support for 10,
  and dropping the accessibility rules to unify the major would give up the
  only rules here that have caught a real defect.

### Deliberately not enabled
`jsx-a11y/control-has-associated-label` looks like the rule for "an input with
no label", and it reported 33 of them. It cannot follow a `htmlFor`/`id` pair
across two elements, so most of those were correctly labelled fields. It is off,
and axe — which resolves the association properly and runs on every page in the
suite — is what holds that line instead. Verified by deleting a label and
watching axe fail with "Form elements must have labels".

### Verified
177 backend tests, 34 frontend tests (was 32), both lint suites clean, 7/7
sandbox containment checks against real containers, production build green.
Three mutation tests: a label removed, an English string left in the Turkish
catalogue, and the join-code guard reverted — each failed the test meant to
catch it. Bundle grew 726.4 KB to 739.8 KB (gzip 208.7 to 212.6).

### Known limitations (tracked for future versions)
- The bundle is still one chunk; no code splitting
- Turkish translations are mine, not a native reviewer's; the teacher-facing
  wording in particular would benefit from a read-through by an instructor
- axe catches structural problems, not everything a screen-reader user would hit
- `react-hooks/exhaustive-deps` is a warning, not an error — there are no
  current violations, but it is not enforced

## [0.1.0] - First Beta

Nine releases of backend depth on a frontend nobody had ever tested. This one
closes that, adds the half of account management that was missing, and makes the
interface usable in Turkish.

### Added
- **A frontend test suite.** 23 source files had zero tests; there are now 32,
  covering sign-up and sign-in, joining a course, solving a problem (starter
  code, draft restore, verdict display), language switching and the recovery
  pages - plus an axe accessibility check on every page they touch. Wired into
  CI.
- **Password reset and email confirmation**, over SMTP. Verified end to end
  against a real SMTP server: the link is pulled out of the delivered message
  and used, rather than asserting that a function was called.
- **Turkish and English**, switchable from the top bar and remembered. A test
  holds the two catalogues to the same key set, checks no Turkish string is
  still the English original, and checks placeholders survive translation - the
  three ways translations rot.

### Fixed
- **Not one form label in the application was associated with its input.**
  Twenty labels, zero `htmlFor`, zero input `id`s. A screen reader announced
  unlabelled fields, so the interface could not be filled in without sight.
  The frontend tests found this on their first run, which is a fair summary of
  what nine releases without them had cost.
- The language picker on the solve page was six unlabelled buttons with no
  indication of which was active. It is now a labelled group with `aria-pressed`.

### Security
- `forgot-password` answers identically whether or not the address exists.
  Anything else turns it into a way to test who has an account - for a
  university install, who is enrolled.
- Only the SHA-256 hash of a reset or verification token is stored, so a
  database leak yields no working links.
- Redeeming a token is a single `UPDATE ... RETURNING` that both checks and
  consumes it, so a forwarded link cannot be replayed and two simultaneous
  requests cannot both succeed.
- Requesting a new link invalidates the outstanding one.
- With no `SMTP_HOST`, production **refuses to start** rather than quietly
  writing password resets to a log file. Development logs them, so the flow
  works without a mail server and the link is visible in the console.

### Verified
177 backend tests and 32 frontend tests. Account recovery ran against a real
SMTP catcher, including the replay, supersession and no-enumeration properties;
CI now runs one alongside Postgres and Redis so those stay covered.

### Known limitations (tracked for future versions)
- Only the highest-traffic pages are translated so far; the teacher panel and
  analytics still contain English strings
- `REQUIRE_EMAIL_VERIFICATION` defaults to off - turning it on locks out anyone
  whose address never received mail
- No email for anything else yet (exam reminders, grade posted)
- Accessibility is checked by axe, which catches structural problems but not
  everything a person using a screen reader would find

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

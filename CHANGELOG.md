# Changelog

All notable changes to this project are documented in this file.

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

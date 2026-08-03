# CodeCloud - Backend

**Version 0.0.1**

Node.js/Express API for the Cloud-Based Multi-Platform Coding Education and Exam System.

## Features

- JWT-based authentication, role-based authorization (student / teacher)
- Sandboxed execution engine that compiles and runs **Python, C++, and Java** (timeouts, memory limits, process limits)
- Problem (exercise) management with visible/hidden test cases
- "Run" (free-form stdin) and "Submit" (automatic grading) endpoints
- Exam creation, time-window enforcement, results table
- Analytics endpoints for both teachers and students
- Student list / progress tracking for teachers

## Setup

```bash
npm install
cp .env.example .env   # edit with your own values
```

### Database

PostgreSQL must be installed and running. Then:

```bash
createdb codecloud
psql -U postgres -d codecloud -f src/db/schema.sql
```

### Running

```bash
npm run dev     # with node --watch (development)
npm start       # production
```

Runs on `http://localhost:4000` by default. Health check: `GET /api/health`.

## Required system tools on the server

The code execution engine expects the following three tools to be installed **on the server machine**:

| Language | Required tool                        |
|----------|----------------------------------------|
| Python   | `python3`                              |
| C++      | `g++` (with C++17 support)             |
| Java     | JDK (`javac` + `java`, version 17+)    |

Ubuntu/Debian: `apt install python3 g++ openjdk-21-jdk-headless`

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
| POST   | /api/submissions                    | Submit code (automatic grading)             | Authenticated |
| GET    | /api/submissions/my                 | My own submission history                   | Authenticated |
| GET    | /api/submissions/problem/:id        | All submissions for a problem               | Teacher |
| POST   | /api/exams                          | Create an exam                              | Teacher |
| GET    | /api/exams                          | List exams                                  | Authenticated |
| GET    | /api/exams/:id                      | Exam detail                                 | Authenticated |
| GET    | /api/exams/:id/results              | Exam results table                          | Teacher |
| GET    | /api/analytics/overview             | Class-wide statistics                       | Teacher |
| GET    | /api/analytics/me                   | Personal progress statistics                | Authenticated |
| GET    | /api/users/students                 | Student list                                | Teacher |

## Sandbox architecture and security note

`src/services/codeExecution.service.js` writes submitted code to a temporary directory, compiles it if needed (C++/Java), and runs it constrained by `timeout` + `ulimit` (virtual memory, process count). This is **sufficient protection for a single-machine prototype/demo** and has been tested against: infinite loops, compile errors, fork bombs, and malformed output.

**Before moving to production** (real, untrusted multi-tenant traffic), it is recommended to isolate every run in its own network-disconnected, resource-limited container, similar to the examples in `backend/docker/*.Dockerfile` (or a gVisor/Firecracker micro-VM); queueing execution requests (BullMQ/Redis) and dispatching them to horizontally-scaled workers also keeps the API server isolated from the direct impact of running arbitrary code.

## Environment Variables

See `.env.example`. In particular, always change `JWT_SECRET` in production.

# CodeCloud - Frontend

**Version 0.0.2**

React interface for the Cloud-Based Multi-Platform Coding Education and Exam System.

## Setup

```bash
npm install
cp .env.example .env   # update the backend URL if needed
npm run dev
```

Runs on `http://localhost:5173` by default and expects the backend to be running at
`http://localhost:4000` (override with `VITE_API_URL` in `.env`).

## Pages

| Path                          | Description                                              |
|--------------------------------|------------------------------------------------------------|
| `/login`, `/register`          | Log in / sign up                                          |
| `/` (student)                  | Problem list                                               |
| `/` (teacher)                  | Teacher dashboard — problem and exam management            |
| `/problem/:id`                 | Code editor, Run / Submit, automatic grading                |
| `/my-exams`, `/exam/:id`       | Exam list and exam-taking (student) / results table (teacher) |
| `/students`                    | Student list (teacher)                                      |
| `/teacher/similarity/:id`      | Code-similarity report for a problem, with side-by-side diff (teacher) |
| `/analytics`                   | Personal progress (student) / class analytics (teacher)     |

## Technical notes

- Code editor: **Monaco Editor** (`@monaco-editor/react`) — the same editor engine used by VS Code.
  Supports Python, C++, Java, JavaScript, and C.
- Submitting code ("Submit ✓") is asynchronous: the server responds immediately with a `queued`
  status, and the result arrives either via a live WebSocket push (`useSubmissionSocket` hook) or,
  as a fallback, by polling `GET /submissions/:id` every 1.5s — whichever resolves first wins.
- Charts: **Recharts**.
- Test results are shown with filled/empty "bubble" indicators inspired by Scantron-style
  bubble sheets (`ResultBubbles` component) — the platform's signature visual element.
- The auth token is stored in `localStorage`; an `axios` interceptor attaches it to every
  request and redirects to the login page on a 401 response.

## Production build

```bash
npm run build
```

Serve the `dist/` folder from any static file host (Nginx, Vercel, Netlify, S3+CloudFront).

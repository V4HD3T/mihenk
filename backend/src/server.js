require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { QueueEvents } = require('bullmq');

const authRoutes = require('./routes/auth.routes');
const problemsRoutes = require('./routes/problems.routes');
const submissionsRoutes = require('./routes/submissions.routes');
const examsRoutes = require('./routes/exams.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const usersRoutes = require('./routes/users.routes');
const integrityRoutes = require('./routes/integrity.routes');
const createConnection = require('./queue/redis');
const wsHub = require('./ws/hub');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'codecloud-backend', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/problems', problemsRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/integrity', integrityRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Server error' });
});

// The API and the WebSocket server share one HTTP server/port.
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket, req) => {
  try {
    const { searchParams } = new URL(req.url, 'http://localhost');
    const token = searchParams.get('token');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    wsHub.register(payload.id, socket);
  } catch {
    socket.close(); // missing/invalid token
  }
});

// Bridges the (possibly separate-process) worker's job completions back to
// this API server's live WebSocket connections. QueueEvents listens on
// Redis pub/sub under the hood, so this works even when the worker that
// actually ran the job is a different OS process than this one.
const queueEvents = new QueueEvents('grading', { connection: createConnection() });
queueEvents.on('completed', ({ returnvalue }) => {
  try {
    const data = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
    if (data?.userId) {
      wsHub.sendToUser(data.userId, { type: 'submission_result', ...data });
    }
  } catch (err) {
    console.error('WebSocket notify error:', err);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`CodeCloud backend running on port ${PORT} (HTTP + WebSocket at /ws)`);
});

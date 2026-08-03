/**
 * In-memory registry mapping userId -> that user's open WebSocket
 * connection(s) on THIS server process. A user can have more than one tab
 * open, so each user maps to a Set of sockets.
 */
const connections = new Map();

function register(userId, socket) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId).add(socket);

  socket.on('close', () => {
    connections.get(userId)?.delete(socket);
    if (connections.get(userId)?.size === 0) connections.delete(userId);
  });
}

/** Sends payload to every open socket for userId. Returns true if at least one socket got it. */
function sendToUser(userId, payload) {
  const sockets = connections.get(userId);
  if (!sockets || sockets.size === 0) return false;
  const message = JSON.stringify(payload);
  let sent = false;
  for (const socket of sockets) {
    if (socket.readyState === 1 /* OPEN */) {
      socket.send(message);
      sent = true;
    }
  }
  return sent;
}

module.exports = { register, sendToUser };

import { useEffect, useRef } from 'react';

function wsUrl() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
  return apiUrl.replace(/^http/, 'ws').replace(/\/api\/?$/, '/ws');
}

/**
 * Opens a WebSocket connection scoped to the lifetime of the calling
 * component and invokes onResult(payload) whenever a "submission_result"
 * push arrives. This is the fast path for grading feedback; callers should
 * still keep a polling fallback for when the socket never connects (e.g.
 * a proxy that blocks WebSocket upgrades).
 */
export function useSubmissionSocket(onResult) {
  const callbackRef = useRef(onResult);
  callbackRef.current = onResult;

  useEffect(() => {
    const token = localStorage.getItem('codecloud_token');
    if (!token) return;

    let socket;
    try {
      socket = new WebSocket(`${wsUrl()}?token=${token}`);
    } catch {
      return; // WebSocket unsupported/blocked - polling fallback still covers this
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'submission_result') callbackRef.current(data);
      } catch {
        /* ignore malformed messages */
      }
    };

    return () => socket.close();
  }, []);
}

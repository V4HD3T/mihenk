/**
 * Role assignment for new accounts.
 *
 * Until v0.0.3 the register endpoint did `role === 'teacher' ? 'teacher' : 'student'`
 * with `role` taken straight from the request body - so anyone who could reach
 * /api/auth/register could mint themselves a teacher account and read every
 * submission, similarity report and student record in the system.
 *
 * Now `teacher` requires the server-side invite code, and when no code is
 * configured teacher signup is disabled entirely rather than left open.
 */

/**
 * @param {string|undefined} inviteCode        code supplied by the client
 * @param {string|undefined} teacherInviteCode code configured on the server;
 *   undefined means teacher signup is switched off. Passed in explicitly rather
 *   than read from config here, so the caller's intent is visible and the
 *   "no code configured" case is directly testable.
 */
function resolveRole(inviteCode, teacherInviteCode) {
  if (!inviteCode) return { role: 'student' };
  if (!teacherInviteCode) {
    return { error: 'Teacher registration is disabled on this server' };
  }
  if (inviteCode !== teacherInviteCode) {
    return { error: 'Invalid teacher invite code' };
  }
  return { role: 'teacher' };
}

module.exports = { resolveRole };

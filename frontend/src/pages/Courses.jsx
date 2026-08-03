import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/**
 * Courses page.
 *
 * Students join with the code their teacher gives out and see only the courses
 * they're enrolled in; teachers create courses and hand out the join code.
 */
export default function Courses() {
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [joinCode, setJoinCode] = useState('');
  const [newCourse, setNewCourse] = useState({ title: '', description: '', term: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/courses');
      setCourses(data.courses);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/courses/join', { joinCode: joinCode.trim() });
      setNotice(`You joined ${data.course.title}.`);
      setJoinCode('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not join that course');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await api.post('/courses', newCourse);
      setNewCourse({ title: '', description: '', term: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the course');
    } finally {
      setCreating(false);
    }
  };

  const regenerate = async (courseId) => {
    try {
      await api.post(`/courses/${courseId}/regenerate-code`);
      setNotice('A new join code was generated. The old one no longer works.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not regenerate the code');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">Courses</h1>
      <p className="text-inkmuted mb-8">
        {isTeacher
          ? 'Problems and exams belong to a course. Share a join code to let students in.'
          : 'You only see problems and exams for the courses you have joined.'}
      </p>

      {error && <div className="mb-6 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}
      {notice && <div className="mb-6 text-sm bg-surface border border-line px-4 py-2.5 rounded-card">{notice}</div>}

      {isTeacher ? (
        <form onSubmit={handleCreate} className="mb-10 p-5 rounded-card border border-line bg-surface">
          <h2 className="font-medium mb-4">Create a course</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <input
              required
              value={newCourse.title}
              onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
              placeholder="Course title"
              className="px-4 py-2.5 rounded-card border border-line bg-paper focus:border-primary outline-none"
            />
            <input
              value={newCourse.term}
              onChange={(e) => setNewCourse({ ...newCourse, term: e.target.value })}
              placeholder="Term (e.g. 2026 Spring)"
              className="px-4 py-2.5 rounded-card border border-line bg-paper focus:border-primary outline-none"
            />
            <button
              type="submit"
              disabled={creating}
              className="py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create course'}
            </button>
          </div>
          <input
            value={newCourse.description}
            onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })}
            placeholder="Description (optional)"
            className="mt-3 w-full px-4 py-2.5 rounded-card border border-line bg-paper focus:border-primary outline-none"
          />
        </form>
      ) : (
        <form onSubmit={handleJoin} className="mb-10 p-5 rounded-card border border-line bg-surface">
          <h2 className="font-medium mb-4">Join a course</h2>
          <div className="flex gap-3">
            <input
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Join code, e.g. K7QP2XRT"
              className="flex-1 px-4 py-2.5 rounded-card border border-line bg-paper font-mono tracking-wider focus:border-primary outline-none"
            />
            <button
              type="submit"
              className="px-6 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
            >
              Join
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-inkmuted">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-inkmuted">
          {isTeacher ? 'No courses yet — create one above.' : 'You have not joined any courses yet.'}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {courses.map((c) => (
            <div key={c.id} className="p-5 rounded-card border border-line bg-surface">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{c.title}</h3>
                  {c.term && <p className="text-xs text-inkmuted mt-0.5">{c.term}</p>}
                </div>
                {c.archived && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-line text-inkmuted">
                    archived
                  </span>
                )}
              </div>

              {c.description && <p className="text-sm text-inkmuted mt-2">{c.description}</p>}

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-inkmuted">
                <span>{c.problem_count} problems</span>
                {isTeacher && <span>{c.student_count} students</span>}
                {!isTeacher && c.teacher_name && <span>{c.teacher_name}</span>}
              </div>

              {isTeacher && c.join_code && (
                <div className="mt-4 pt-4 border-t border-line">
                  <p className="text-xs text-inkmuted mb-1.5">Join code — share this with students</p>
                  <div className="flex items-center gap-2">
                    <code className="px-3 py-1.5 rounded-card bg-paper border border-line font-mono tracking-widest">
                      {c.join_code}
                    </code>
                    <button
                      onClick={() => regenerate(c.id)}
                      className="text-xs text-primary hover:underline"
                      title="Invalidates the current code"
                    >
                      regenerate
                    </button>
                  </div>
                </div>
              )}

              {isTeacher && (
                <Link
                  to={`/courses/${c.id}/roster`}
                  className="inline-block mt-4 text-sm text-primary font-medium hover:underline"
                >
                  View roster →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

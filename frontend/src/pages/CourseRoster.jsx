import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';

/** Who is enrolled in one course, with the option to remove someone. */
export default function CourseRoster() {
  const { id } = useParams();
  const [course, setCourse] = useState(null);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, rosterRes] = await Promise.all([
        api.get(`/courses/${id}`),
        api.get(`/courses/${id}/roster`),
      ]);
      setCourse(courseRes.data.course);
      setStudents(rosterRes.data.students);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load the roster');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (userId, name) => {
    // Unenrolling hides the course's content from them again, so confirm first.
    if (!window.confirm(`Remove ${name} from this course? They will lose access to its problems and exams.`)) {
      return;
    }
    try {
      await api.delete(`/courses/${id}/roster/${userId}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove the student');
    }
  };

  if (loading) return <div className="max-w-4xl mx-auto px-6 py-10 text-inkmuted">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link to="/courses" className="text-sm text-primary hover:underline">
        ← Courses
      </Link>
      <h1 className="font-display text-3xl font-semibold mt-3 mb-1">{course?.title}</h1>
      <p className="text-inkmuted mb-8">
        {students.length} {students.length === 1 ? 'student' : 'students'} enrolled
        {course?.join_code && (
          <>
            {' · join code '}
            <code className="font-mono tracking-widest">{course.join_code}</code>
          </>
        )}
      </p>

      {error && <div className="mb-6 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}

      {students.length === 0 ? (
        <p className="text-inkmuted">
          Nobody has joined yet. Share the join code above to enrol students.
        </p>
      ) : (
        <div className="rounded-card border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Submissions</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 text-inkmuted">{s.email}</td>
                  <td className="px-4 py-3 text-inkmuted">{s.submission_count}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(s.id, s.name)}
                      className="text-xs text-error hover:underline"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

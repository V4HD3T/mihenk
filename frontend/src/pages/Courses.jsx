import { useEffect, useState, useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n/index.jsx';

/**
 * Courses page.
 *
 * Students join with the code their teacher gives out and see only the courses
 * they're enrolled in; teachers create courses and hand out the join code.
 */
export default function Courses() {
  const { user } = useAuth();
  const t = useT();
  const uid = useId();
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
      setError(err.response?.data?.error || t('courses.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/courses/join', { joinCode: joinCode.trim() });
      setNotice(t('courses.joined', { course: data.course.title }));
      setJoinCode('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('courses.joinFailed'));
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
      setError(err.response?.data?.error || t('courses.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const regenerate = async (courseId) => {
    try {
      await api.post(`/courses/${courseId}/regenerate-code`);
      setNotice(t('courses.regenerated'));
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('courses.regenerateFailed'));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">{t('courses.title')}</h1>
      <p className="text-inkmuted mb-8">
        {isTeacher ? t('courses.teacherSubtitle') : t('courses.studentSubtitle')}
      </p>

      {error && <div className="mb-6 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}
      {notice && <div className="mb-6 text-sm bg-surface border border-line px-4 py-2.5 rounded-card">{notice}</div>}

      {isTeacher ? (
        <form onSubmit={handleCreate} className="mb-10 p-5 rounded-card border border-line bg-surface">
          <h2 className="font-medium mb-4">{t('courses.create')}</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor={`${uid}-title`} className="sr-only">
                {t('courses.courseTitle')}
              </label>
              <input
                id={`${uid}-title`}
                required
                value={newCourse.title}
                onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
                placeholder={t('courses.courseTitle')}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-paper focus:border-primary outline-none"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-term`} className="sr-only">
                {t('courses.term')}
              </label>
              <input
                id={`${uid}-term`}
                value={newCourse.term}
                onChange={(e) => setNewCourse({ ...newCourse, term: e.target.value })}
                placeholder={t('courses.termPlaceholder')}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-paper focus:border-primary outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {creating ? t('courses.creating') : t('courses.createAction')}
            </button>
          </div>
          <label htmlFor={`${uid}-description`} className="sr-only">
            {t('courses.descriptionOptional')}
          </label>
          <input
            id={`${uid}-description`}
            value={newCourse.description}
            onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })}
            placeholder={t('courses.descriptionOptional')}
            className="mt-3 w-full px-4 py-2.5 rounded-card border border-line bg-paper focus:border-primary outline-none"
          />
        </form>
      ) : (
        <form onSubmit={handleJoin} className="mb-10 p-5 rounded-card border border-line bg-surface">
          <h2 className="font-medium mb-4">{t('courses.join')}</h2>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor={`${uid}-join`} className="sr-only">
                {t('courses.joinCodeLabel')}
              </label>
              <input
                id={`${uid}-join`}
                required
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder={t('courses.joinCodePlaceholder')}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-paper font-mono tracking-wider focus:border-primary outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
            >
              {t('courses.joinAction')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : courses.length === 0 ? (
        <p className="text-inkmuted">{isTeacher ? t('courses.noneTeacher') : t('courses.noneStudent')}</p>
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
                    {t('courses.archived')}
                  </span>
                )}
              </div>

              {c.description && <p className="text-sm text-inkmuted mt-2">{c.description}</p>}

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-inkmuted">
                <span>{t('courses.problems', { count: c.problem_count })}</span>
                {isTeacher && <span>{t('courses.students', { count: c.student_count })}</span>}
                {!isTeacher && c.teacher_name && <span>{c.teacher_name}</span>}
              </div>

              {isTeacher && c.join_code && (
                <div className="mt-4 pt-4 border-t border-line">
                  <p className="text-xs text-inkmuted mb-1.5">{t('courses.joinCode')}</p>
                  <div className="flex items-center gap-2">
                    <code className="px-3 py-1.5 rounded-card bg-paper border border-line font-mono tracking-widest">
                      {c.join_code}
                    </code>
                    {/* One "regenerate" per course card: the accessible name has
                        to say which course, or they are indistinguishable. */}
                    <button
                      onClick={() => regenerate(c.id)}
                      className="text-xs text-primary hover:underline"
                      title={t('courses.regenerateTitle')}
                      aria-label={t('courses.regenerateNamed', { course: c.title })}
                    >
                      {t('courses.regenerate')}
                    </button>
                  </div>
                </div>
              )}

              {isTeacher && (
                <Link
                  to={`/courses/${c.id}/roster`}
                  className="inline-block mt-4 text-sm text-primary font-medium hover:underline"
                >
                  {t('courses.viewRoster')}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

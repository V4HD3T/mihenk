import { useId, useState } from 'react';
import api from '../../api/axios';
import { useT } from '../../i18n/index.jsx';
import CourseSelect from './CourseSelect.jsx';

export default function ExamForm({ problems, courses, onCreated }) {
  const t = useT();
  const uid = useId();
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [selectedProblems, setSelectedProblems] = useState([]);
  const [randomise, setRandomise] = useState(false);
  const [perStudent, setPerStudent] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleProblem = (id) =>
    setSelectedProblems((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  // Only the chosen course's problems can go in the exam.
  const courseProblems = problems.filter((p) => String(p.course_id) === String(courseId));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/exams', {
        course_id: Number(courseId),
        title,
        description,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        duration_minutes: Number(duration),
        problem_ids: selectedProblems,
        // The server ignores a value that doesn't actually narrow the pool, but
        // sending it only when asked for keeps the intent in the request.
        ...(randomise && perStudent < selectedProblems.length
          ? { problems_per_student: Number(perStudent) }
          : {}),
      });
      setTitle('');
      setDescription('');
      setStartTime('');
      setEndTime('');
      setCourseId('');
      setSelectedProblems([]);
      setRandomise(false);
      setPerStudent(1);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || t('teacher.createExamFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-card p-6 bg-surface space-y-4">
      <h2 className="font-display text-lg font-medium">{t('teacher.newExamHeading')}</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <CourseSelect
          value={courseId}
          onChange={(v) => {
            // Switching course clears the selection: an exam may only contain
            // problems from its own course, which the server enforces too.
            setCourseId(v);
            setSelectedProblems([]);
          }}
          courses={courses}
        />
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-title`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.examTitle')}
          </label>
          <input
            id={`${uid}-title`}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-description`} className="text-xs text-inkmuted uppercase tracking-wide">
          {t('teacher.examDescription')}
        </label>
        <textarea
          id={`${uid}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
        />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${uid}-start`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.start')}
          </label>
          <input
            id={`${uid}-start`}
            required
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-end`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.end')}
          </label>
          <input
            id={`${uid}-end`}
            required
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-duration`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.duration')}
          </label>
          <input
            id={`${uid}-duration`}
            required
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
      </div>

      <div>
        <span className="text-xs text-inkmuted uppercase tracking-wide mb-2 block" id={`${uid}-problems-label`}>
          {t('teacher.problemsToInclude')}
        </span>
        {!courseId ? (
          <p className="text-sm text-inkmuted">{t('teacher.pickCourseFirst')}</p>
        ) : courseProblems.length === 0 ? (
          <p className="text-sm text-inkmuted">{t('teacher.courseHasNoProblems')}</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-problems-label`}>
            {courseProblems.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => toggleProblem(p.id)}
                aria-pressed={selectedProblems.includes(p.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedProblems.includes(p.id)
                    ? 'bg-primary text-white border-primary'
                    : 'border-line text-inkmuted hover:border-ink'
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The randomised pool has existed server-side since v0.0.6 with no way
          to ask for it. It only means anything when it narrows the pool, so the
          control appears once there are at least two problems to choose from. */}
      {selectedProblems.length > 1 && (
        <div className="border border-line rounded-card p-4 bg-paper">
          <label htmlFor={`${uid}-randomise`} className="flex items-center gap-2 text-sm">
            <input
              id={`${uid}-randomise`}
              type="checkbox"
              checked={randomise}
              onChange={(e) => setRandomise(e.target.checked)}
            />
            {t('teacher.randomisePool')}
          </label>
          {randomise && (
            <div className="mt-3">
              <label htmlFor={`${uid}-per-student`} className="text-xs text-inkmuted uppercase tracking-wide">
                {t('teacher.problemsPerStudent')}
              </label>
              <input
                id={`${uid}-per-student`}
                type="number"
                min={1}
                max={selectedProblems.length - 1}
                value={perStudent}
                onChange={(e) => setPerStudent(e.target.value)}
                className="w-24 mt-1 block px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
              />
              <p className="text-xs text-inkmuted mt-1.5">
                {t('teacher.randomiseHelp', {
                  perStudent,
                  total: selectedProblems.length,
                })}
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={saving || selectedProblems.length === 0}
        className="px-5 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
      >
        {saving ? t('teacher.saving') : t('teacher.createExam')}
      </button>
    </form>
  );
}

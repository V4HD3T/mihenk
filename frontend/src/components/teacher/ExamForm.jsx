import { useCallback, useEffect, useId, useState } from 'react';
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
  // Empty means "divide 100 evenly", which is what the server does when the
  // field is absent. Kept as a separate flag rather than inferred from the
  // values so that clearing a box doesn't silently switch the whole paper back
  // to an even split.
  const [customMarks, setCustomMarks] = useState(false);
  const [marks, setMarks] = useState({});
  const [lateWindow, setLateWindow] = useState(0);
  const [latePenalty, setLatePenalty] = useState(0);
  // Empty roster = the whole course sits it, which is the default and by far
  // the common case.
  const [wholeCourse, setWholeCourse] = useState(true);
  const [enrolled, setEnrolled] = useState([]);
  const [sitters, setSitters] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleProblem = (id) =>
    setSelectedProblems((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  /** Moves one question up or down the paper. */
  const moveProblem = (index, delta) =>
    setSelectedProblems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  // Only the chosen course's problems can go in the exam.
  const courseProblems = problems.filter((p) => String(p.course_id) === String(courseId));
  const titleOf = (id) => problems.find((p) => p.id === id)?.title || '';

  // Even split, remainder spread one point at a time - shown so the teacher can
  // see what they are overriding. Mirrors the server, which is authoritative.
  const evenMarks = selectedProblems.map((_, i) => {
    const base = Math.floor(100 / selectedProblems.length);
    return base + (i < 100 - base * selectedProblems.length ? 1 : 0);
  });
  const markFor = (id, index) => (customMarks ? (marks[id] ?? evenMarks[index]) : evenMarks[index]);
  const markTotal = selectedProblems.reduce((sum, id, i) => sum + Number(markFor(id, i) || 0), 0);

  const loadEnrolled = useCallback(async () => {
    if (!courseId) return setEnrolled([]);
    try {
      const res = await api.get(`/courses/${courseId}/roster`);
      setEnrolled(res.data?.students || []);
    } catch {
      setEnrolled([]);
    }
  }, [courseId]);

  useEffect(() => {
    loadEnrolled();
  }, [loadEnrolled]);

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
        // Ordered: position N in this array is question N on the paper.
        problem_ids: selectedProblems,
        // Omitted entirely for an even split, so the server keeps doing the
        // arithmetic and the two cannot disagree about the remainder.
        ...(customMarks
          ? { points: selectedProblems.map((id, i) => Number(markFor(id, i))) }
          : {}),
        late_window_minutes: Number(lateWindow) || 0,
        late_penalty_percent: Number(latePenalty) || 0,
        // Absent means the whole course, which is what the server assumes.
        ...(wholeCourse ? {} : { user_ids: sitters }),
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
      setCustomMarks(false);
      setMarks({});
      setLateWindow(0);
      setLatePenalty(0);
      setWholeCourse(true);
      setSitters([]);
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

      {/* The paper itself: the order the questions are asked in, and what each
          is worth. Both were decided by the database before v2.1.0 - problems
          came back in primary-key order and 100 was split evenly. */}
      {selectedProblems.length > 0 && (
        <div className="border border-line rounded-card p-4 bg-paper space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-inkmuted uppercase tracking-wide" id={`${uid}-paper-label`}>
              {t('teacher.paperOrder')}
            </span>
            <label htmlFor={`${uid}-custom-marks`} className="flex items-center gap-2 text-sm">
              <input
                id={`${uid}-custom-marks`}
                type="checkbox"
                checked={customMarks}
                onChange={(e) => setCustomMarks(e.target.checked)}
              />
              {t('teacher.setMarksByHand')}
            </label>
          </div>
          <ol className="space-y-2" aria-labelledby={`${uid}-paper-label`}>
            {selectedProblems.map((id, index) => (
              <li key={id} className="flex items-center gap-2">
                <span className="text-sm text-inkmuted w-6 shrink-0">{index + 1}.</span>
                <span className="text-sm flex-1 truncate">{titleOf(id)}</span>
                {customMarks && (
                  <>
                    <label htmlFor={`${uid}-mark-${id}`} className="sr-only">
                      {t('teacher.marksForQuestion', { title: titleOf(id) })}
                    </label>
                    <input
                      id={`${uid}-mark-${id}`}
                      type="number"
                      min={0}
                      max={1000}
                      value={markFor(id, index)}
                      onChange={(e) => setMarks((prev) => ({ ...prev, [id]: e.target.value }))}
                      className="w-20 px-2 py-1 rounded-card border border-line focus:border-primary outline-none text-sm"
                    />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => moveProblem(index, -1)}
                  disabled={index === 0}
                  aria-label={t('teacher.moveUp', { title: titleOf(id) })}
                  className="px-2 py-1 rounded-card border border-line text-inkmuted hover:border-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveProblem(index, 1)}
                  disabled={index === selectedProblems.length - 1}
                  aria-label={t('teacher.moveDown', { title: titleOf(id) })}
                  className="px-2 py-1 rounded-card border border-line text-inkmuted hover:border-ink disabled:opacity-30"
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p className="text-xs text-inkmuted">{t('teacher.paperTotal', { total: markTotal })}</p>
        </div>
      )}

      {/* Who sits it. An exam with no roster is sat by the whole course, which
          is what every exam did before this release. Naming people is what makes
          a second sitting of the same paper safe to schedule: the students who
          have not taken it yet cannot see it at all. */}
      {courseId && (
        <div className="border border-line rounded-card p-4 bg-paper space-y-3">
          <span className="text-xs text-inkmuted uppercase tracking-wide block" id={`${uid}-sitters-label`}>
            {t('teacher.whoSits')}
          </span>
          <div role="radiogroup" aria-labelledby={`${uid}-sitters-label`} className="space-y-2">
            <label htmlFor={`${uid}-whole-course`} className="flex items-center gap-2 text-sm">
              <input
                id={`${uid}-whole-course`}
                type="radio"
                name={`${uid}-sitters`}
                checked={wholeCourse}
                onChange={() => setWholeCourse(true)}
              />
              {t('teacher.wholeCourse')}
            </label>
            <label htmlFor={`${uid}-some-students`} className="flex items-center gap-2 text-sm">
              <input
                id={`${uid}-some-students`}
                type="radio"
                name={`${uid}-sitters`}
                checked={!wholeCourse}
                onChange={() => setWholeCourse(false)}
              />
              {t('teacher.namedStudents')}
            </label>
          </div>
          {!wholeCourse &&
            (enrolled.length === 0 ? (
              <p className="text-sm text-inkmuted">{t('teacher.courseHasNoStudents')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {enrolled.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() =>
                      setSitters((prev) =>
                        prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                      )
                    }
                    aria-pressed={sitters.includes(s.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      sitters.includes(s.id)
                        ? 'bg-primary text-white border-primary'
                        : 'border-line text-inkmuted hover:border-ink'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}

      {/* Late submissions. Both default to the old behaviour: an exam that says
          nothing about lateness accepts nothing late. */}
      <div className="border border-line rounded-card p-4 bg-paper">
        <span className="text-xs text-inkmuted uppercase tracking-wide block mb-2">
          {t('teacher.lateHeading')}
        </span>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-late-window`} className="text-xs text-inkmuted">
              {t('teacher.lateWindow')}
            </label>
            <input
              id={`${uid}-late-window`}
              type="number"
              min={0}
              max={1440}
              value={lateWindow}
              onChange={(e) => setLateWindow(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-late-penalty`} className="text-xs text-inkmuted">
              {t('teacher.latePenalty')}
            </label>
            <input
              id={`${uid}-late-penalty`}
              type="number"
              min={0}
              max={100}
              value={latePenalty}
              onChange={(e) => setLatePenalty(e.target.value)}
              disabled={Number(lateWindow) === 0}
              className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none disabled:opacity-50"
            />
          </div>
        </div>
        <p className="text-xs text-inkmuted mt-2">
          {Number(lateWindow) === 0 ? t('teacher.lateOff') : t('teacher.lateHelp', { minutes: lateWindow, penalty: latePenalty })}
        </p>
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

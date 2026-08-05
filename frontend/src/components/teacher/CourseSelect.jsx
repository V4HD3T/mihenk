import { useId } from 'react';
import { useT } from '../../i18n/index.jsx';

/**
 * Every problem and exam belongs to a course as of v0.0.5, so both creation
 * forms need the teacher to pick one first.
 */
export default function CourseSelect({ value, onChange, courses, disabled }) {
  const t = useT();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-inkmuted uppercase tracking-wide">
        {t('teacher.course')}
      </label>
      <select
        id={id}
        required
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none disabled:opacity-60"
      >
        <option value="">{t('teacher.selectCourse')}</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
            {c.term ? ` (${c.term})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

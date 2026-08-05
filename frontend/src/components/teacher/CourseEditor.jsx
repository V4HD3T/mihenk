import { useId, useState } from 'react';
import api from '../../api/axios';
import { useT } from '../../i18n/index.jsx';

/**
 * Renaming a course, and archiving one.
 *
 * `PUT /api/courses/:id` has accepted all of this since v0.0.5. The archived
 * badge was rendered on the course card from the same release, with nothing in
 * the interface able to set the flag it displayed.
 */
export default function CourseEditor({ course, onSaved, onCancel }) {
  const t = useT();
  const uid = useId();
  const [title, setTitle] = useState(course.title);
  const [term, setTerm] = useState(course.term || '');
  const [description, setDescription] = useState(course.description || '');
  const [archived, setArchived] = useState(Boolean(course.archived));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put(`/courses/${course.id}`, { title, term, description, archived });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || t('courses.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    // Named, because the create form above and every other course card's
    // editor carry the same field labels; without it they are one
    // indistinguishable pile of "Course title" to anyone navigating by form.
    <form
      onSubmit={save}
      aria-label={t('courses.editNamed', { course: course.title })}
      className="mt-4 pt-4 border-t border-line space-y-3"
    >
      <div>
        <label htmlFor={`${uid}-title`} className="text-xs text-inkmuted uppercase tracking-wide">
          {t('courses.courseTitle')}
        </label>
        <input
          id={`${uid}-title`}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full mt-1 px-3 py-2 rounded-card border border-line bg-paper focus:border-primary outline-none"
        />
      </div>
      <div>
        <label htmlFor={`${uid}-term`} className="text-xs text-inkmuted uppercase tracking-wide">
          {t('courses.term')}
        </label>
        <input
          id={`${uid}-term`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="w-full mt-1 px-3 py-2 rounded-card border border-line bg-paper focus:border-primary outline-none"
        />
      </div>
      <div>
        <label htmlFor={`${uid}-description`} className="text-xs text-inkmuted uppercase tracking-wide">
          {t('courses.descriptionOptional')}
        </label>
        <textarea
          id={`${uid}-description`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full mt-1 px-3 py-2 rounded-card border border-line bg-paper focus:border-primary outline-none"
        />
      </div>
      <div>
        <label htmlFor={`${uid}-archived`} className="flex items-center gap-2 text-sm">
          <input
            id={`${uid}-archived`}
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t('courses.archiveCourse')}
        </label>
        <p className="text-xs text-inkmuted mt-1">{t('courses.archiveHelp')}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-error bg-error-bg px-3 py-2 rounded-card">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-card bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {saving ? t('teacher.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-card border border-line text-sm font-medium hover:border-ink transition-colors"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';
import ProblemForm from '../components/teacher/ProblemForm.jsx';
import ExamForm from '../components/teacher/ExamForm.jsx';

export default function TeacherPanel() {
  const t = useT();
  const { language } = useI18n();
  const [tab, setTab] = useState('problems');
  const [problems, setProblems] = useState([]);
  const [exams, setExams] = useState([]);
  const [courses, setCourses] = useState([]);
  // null = closed, 'new' = the create form, a number = editing that problem.
  const [problemForm, setProblemForm] = useState(null);
  const [showExamForm, setShowExamForm] = useState(false);

  const loadProblems = () => api.get('/problems').then(({ data }) => setProblems(data.problems));
  const loadExams = () => api.get('/exams').then(({ data }) => setExams(data.exams));
  const loadCourses = () => api.get('/courses').then(({ data }) => setCourses(data.courses));

  useEffect(() => {
    loadProblems();
    loadExams();
    loadCourses();
  }, []);

  const handleDeleteProblem = async (id, title) => {
    if (!confirm(t('teacher.confirmDeleteProblem', { title }))) return;
    await api.delete(`/problems/${id}`);
    loadProblems();
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-6">{t('teacher.title')}</h1>

      <div
        className="flex gap-1.5 bg-surface border border-line rounded-full p-1 w-fit mb-6"
        role="group"
        aria-label={t('teacher.sections')}
      >
        {[
          { key: 'problems', label: t('nav.problems') },
          { key: 'exams', label: t('teacher.tabExams') },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
              tab === item.key ? 'bg-primary text-white' : 'text-inkmuted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'problems' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-inkmuted text-sm">{t('teacher.problemCount', { count: problems.length })}</p>
            <button
              onClick={() => setProblemForm(problemForm === 'new' ? null : 'new')}
              className="px-4 py-2 rounded-card border border-ink text-sm font-medium hover:bg-ink hover:text-white transition-colors"
            >
              {problemForm === 'new' ? t('teacher.closeForm') : t('teacher.newProblem')}
            </button>
          </div>

          {problemForm !== null && (
            <ProblemForm
              // Remounting on a change of target resets every field; without
              // it, switching from one problem to another would keep the first
              // one's values until the fetch came back.
              key={problemForm}
              courses={courses}
              problemId={problemForm === 'new' ? null : problemForm}
              onSaved={() => {
                setProblemForm(null);
                loadProblems();
              }}
              onCancel={() => setProblemForm(null)}
            />
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            {problems.map((p) => (
              <div
                key={p.id}
                className="border border-line rounded-card p-4 bg-surface flex items-start justify-between"
              >
                <div>
                  <Link to={`/problem/${p.id}`} className="font-medium hover:text-primary transition-colors">
                    {p.title}
                  </Link>
                  <p className="text-xs text-inkmuted font-mono mt-1">
                    {t(`teacher.difficultyValue.${p.difficulty}`)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {/* Editing a problem was impossible until v0.2.0: a typo in a
                      title meant deleting it and taking its submissions too. */}
                  <button
                    onClick={() => setProblemForm(p.id)}
                    aria-label={t('teacher.editProblemNamed', { title: p.title })}
                    className="text-xs text-primary hover:underline"
                  >
                    {t('teacher.edit')}
                  </button>
                  <Link
                    to={`/teacher/similarity/${p.id}`}
                    className="text-xs text-warning hover:underline whitespace-nowrap"
                  >
                    {t('teacher.similarity')}
                  </Link>
                  <Link
                    to={`/teacher/submissions/${p.id}`}
                    className="text-xs text-primary hover:underline whitespace-nowrap"
                  >
                    {t('teacher.submissions')}
                  </Link>
                  {/* The name goes in the accessible label: a list of identical
                      "delete" buttons tells a screen-reader user nothing. */}
                  <button
                    onClick={() => handleDeleteProblem(p.id, p.title)}
                    aria-label={t('teacher.deleteProblemNamed', { title: p.title })}
                    className="text-xs text-error hover:underline"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'exams' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-inkmuted text-sm">{t('teacher.examCount', { count: exams.length })}</p>
            <button
              onClick={() => setShowExamForm(!showExamForm)}
              className="px-4 py-2 rounded-card border border-ink text-sm font-medium hover:bg-ink hover:text-white transition-colors"
            >
              {showExamForm ? t('teacher.closeForm') : t('teacher.newExam')}
            </button>
          </div>

          {showExamForm && (
            <ExamForm
              problems={problems}
              courses={courses}
              onCreated={() => {
                setShowExamForm(false);
                loadExams();
              }}
            />
          )}

          <div className="space-y-3">
            {exams.map((e) => (
              <div
                key={e.id}
                className="border border-line rounded-card p-4 bg-surface flex items-center justify-between"
              >
                <div>
                  <p className="font-medium">
                    {e.title}
                    {e.problems_per_student && (
                      <span className="ml-2 text-xs font-mono px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                        {t('teacher.randomisedBadge', { count: e.problems_per_student })}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-inkmuted font-mono mt-1">
                    {t('teacher.examMeta', {
                      problems: e.problem_count,
                      participants: e.participant_count,
                      start: new Date(e.start_time).toLocaleString(dateLocale(language)),
                    })}
                  </p>
                </div>
                <div className="flex gap-3 whitespace-nowrap">
                  <Link to={`/teacher/exam/${e.id}`} className="text-sm text-primary hover:underline">
                    {t('teacher.manage')}
                  </Link>
                  <Link to={`/exam/${e.id}`} className="text-sm text-primary hover:underline">
                    {t('teacher.viewResults')}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

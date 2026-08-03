import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import api from '../api/axios';
import CodeEditor from '../components/CodeEditor';
import ResultBubbles from '../components/ResultBubbles';

const LANGUAGES = [
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
];

export default function ProblemSolve() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const examId = searchParams.get('exam');

  const [problem, setProblem] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/problems/${id}`).then(({ data }) => {
      setProblem(data.problem);
      setTestCases(data.testCases);
      setCode(data.problem.starter_code_python || '');
    });
  }, [id]);

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    if (!problem) return;
    const starterMap = {
      python: problem.starter_code_python,
      cpp: problem.starter_code_cpp,
      java: problem.starter_code_java,
    };
    setCode(starterMap[lang] || '');
  };

  const handleRun = async () => {
    setRunning(true);
    setError('');
    setSubmitResult(null);
    try {
      const { data } = await api.post('/submissions/execute', { language, code, stdin });
      setRunResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred while running the code');
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    setRunResult(null);
    try {
      const { data } = await api.post('/submissions', {
        problem_id: Number(id),
        exam_id: examId ? Number(examId) : undefined,
        language,
        code,
      });
      setSubmitResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred during submission');
    } finally {
      setSubmitting(false);
    }
  };

  if (!problem) return <div className="max-w-6xl mx-auto px-6 py-10 text-inkmuted">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {examId && (
        <Link to={`/exam/${examId}`} className="text-sm text-primary hover:underline mb-4 inline-block">
          ← Back to exam
        </Link>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: problem statement */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h1 className="font-display text-2xl font-semibold">{problem.title}</h1>
            <span className="text-xs font-mono px-2 py-1 rounded-full bg-warning-bg text-warning capitalize">
              {problem.difficulty}
            </span>
          </div>
          <p className="text-ink/80 leading-relaxed whitespace-pre-wrap mb-6">{problem.description}</p>

          <h2 className="font-medium text-sm uppercase tracking-wide text-inkmuted mb-3">Sample Test Cases</h2>
          <div className="space-y-3">
            {testCases.map((tc, i) => (
              <div key={tc.id} className="border border-line rounded-card overflow-hidden">
                <div className="text-xs font-mono px-3 py-1.5 bg-ink/5 text-inkmuted">Sample {i + 1}</div>
                <div className="grid grid-cols-2 divide-x divide-line font-mono text-sm">
                  <div className="p-3">
                    <div className="text-xs text-inkmuted mb-1">Input</div>
                    <pre className="whitespace-pre-wrap">{tc.input || '(none)'}</pre>
                  </div>
                  <div className="p-3">
                    <div className="text-xs text-inkmuted mb-1">Expected Output</div>
                    <pre className="whitespace-pre-wrap">{tc.expected_output}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: editor + execution */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1.5 bg-surface border border-line rounded-full p-1">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  onClick={() => handleLanguageChange(l.value)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    language === l.value ? 'bg-primary text-white' : 'text-inkmuted hover:text-ink'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <CodeEditor language={language} value={code} onChange={setCode} />

          <div className="mt-3">
            <label className="text-xs text-inkmuted uppercase tracking-wide">Input (stdin) — for "Run"</label>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              rows={2}
              className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-sm bg-surface focus:border-primary outline-none"
              placeholder="Enter the input your program will read"
            />
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={handleRun}
              disabled={running || submitting}
              className="flex-1 py-2.5 rounded-card border border-ink text-ink font-medium hover:bg-ink hover:text-white transition-colors disabled:opacity-50"
            >
              {running ? 'Running…' : '▶ Run'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={running || submitting}
              className="flex-1 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {submitting ? 'Grading…' : 'Submit ✓'}
            </button>
          </div>

          {error && <div className="mt-4 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}

          {runResult && (
            <div className="mt-4 border border-line rounded-card overflow-hidden">
              <div className="bg-ink text-white/70 text-xs font-mono px-4 py-2">console output</div>
              <div className="p-4 font-mono text-sm space-y-2 bg-surface">
                {runResult.stage === 'compile' ? (
                  <div className="text-error whitespace-pre-wrap">{runResult.stderr}</div>
                ) : (
                  <>
                    <div>
                      <span className="text-inkmuted">stdout: </span>
                      <pre className="whitespace-pre-wrap inline">{runResult.stdout || '(empty)'}</pre>
                    </div>
                    {runResult.stderr && (
                      <div className="text-error">
                        <span className="text-inkmuted">stderr: </span>
                        <pre className="whitespace-pre-wrap inline">{runResult.stderr}</pre>
                      </div>
                    )}
                    {runResult.timedOut && <div className="text-warning">⏱ Timed out</div>}
                    <div className="text-xs text-inkmuted">{runResult.executionTimeMs} ms</div>
                  </>
                )}
              </div>
            </div>
          )}

          {submitResult && (
            <div className="mt-4 border border-line rounded-card p-4 bg-surface">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">
                  {submitResult.passedCount} / {submitResult.totalCount} tests passed
                </span>
                <span
                  className={`text-xs font-mono px-2 py-1 rounded-full ${
                    submitResult.passedCount === submitResult.totalCount
                      ? 'bg-success-bg text-success'
                      : 'bg-error-bg text-error'
                  }`}
                >
                  {submitResult.passedCount === submitResult.totalCount ? 'PASSED' : 'INCOMPLETE'}
                </span>
              </div>
              <ResultBubbles results={submitResult.results} totalCount={submitResult.totalCount} />
              {submitResult.compileError && (
                <pre className="mt-3 text-xs text-error whitespace-pre-wrap font-mono">{submitResult.compileError}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

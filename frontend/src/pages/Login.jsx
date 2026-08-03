import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await login(email, password);
    if (success) navigate('/');
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Left panel: brand / pitch */}
      <div className="hidden md:flex flex-col justify-between bg-ink text-white p-12">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-ink font-mono text-xs font-bold">
            &gt;_
          </span>
          <span className="font-display text-xl font-semibold">CodeCloud</span>
        </div>
        <div>
          <h1 className="font-display text-4xl leading-tight font-medium mb-6">
            Write your code,
            <br />
            compile it instantly,
            <br />
            <span className="italic text-white/60">see the result.</span>
          </h1>
          <p className="text-white/60 max-w-sm leading-relaxed">
            Solve exercises in Python, C++, and Java, take your teachers' exams, and get instant
            feedback with automatic grading.
          </p>
        </div>
        <div className="flex gap-6 font-mono text-xs text-white/40">
          <span>PYTHON</span>
          <span>C++</span>
          <span>JAVA</span>
        </div>
      </div>

      {/* Right panel: form */}
      <div className="flex items-center justify-center p-8 bg-paper">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold mb-1">Welcome back</h2>
          <p className="text-inkmuted text-sm mb-8">Log in to your account and pick up where you left off.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder="you@university.edu"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <p className="text-sm text-inkmuted mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

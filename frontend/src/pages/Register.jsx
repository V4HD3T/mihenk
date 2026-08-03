import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register, loading, error } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await register(name, email, password, role);
    if (success) navigate('/');
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between bg-ink text-white p-12">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-ink font-mono text-xs font-bold">
            &gt;_
          </span>
          <span className="font-display text-xl font-semibold">CodeCloud</span>
        </div>
        <div>
          <h1 className="font-display text-4xl leading-tight font-medium mb-6">
            Cloud-based
            <br />
            coding education
            <br />
            <span className="italic text-white/60">in one platform.</span>
          </h1>
          <p className="text-white/60 max-w-sm leading-relaxed">
            Teachers create exercises and exams with automatic grading; students write code in
            the browser and see results instantly.
          </p>
        </div>
        <div className="flex gap-6 font-mono text-xs text-white/40">
          <span>AUTOMATIC GRADING</span>
          <span>ANALYTICS</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-paper">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold mb-1">Create an account</h2>
          <p className="text-inkmuted text-sm mb-8">Join as a student or a teacher.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Full name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder="Your full name"
              />
            </div>
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
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder="At least 6 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'student', label: 'Student' },
                  { value: 'teacher', label: 'Teacher' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setRole(opt.value)}
                    className={`py-2.5 rounded-card border text-sm font-medium transition-colors ${
                      role === opt.value
                        ? 'border-primary bg-primary text-white'
                        : 'border-line text-inkmuted hover:border-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-sm text-inkmuted mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

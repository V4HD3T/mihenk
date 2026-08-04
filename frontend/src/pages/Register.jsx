import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n/index.jsx';
import api from '../api/axios';

export default function Register() {
  const t = useT();
  const { register, loading, error } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [teacherEnabled, setTeacherEnabled] = useState(false);

  // Only offer the invite-code field if this server actually accepts one.
  useEffect(() => {
    api
      .get('/auth/registration-options')
      .then(({ data }) => setTeacherEnabled(Boolean(data.teacherRegistrationEnabled)))
      .catch(() => setTeacherEnabled(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await register(name, email, password, inviteCode.trim());
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
          <h2 className="font-display text-2xl font-semibold mb-1">{t('auth.createAccount')}</h2>
          <p className="text-inkmuted text-sm mb-8">
            {teacherEnabled
              ? t('auth.joinAsStudentOrTeacher')
              : t('auth.createStudentAccount')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium mb-1.5">{t('auth.fullName')}</label>
              <input
                id="register-name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder={t('auth.fullNamePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="register-email" className="block text-sm font-medium mb-1.5">Email</label>
              <input
                id="register-email"
                name="email"
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="register-password" className="block text-sm font-medium mb-1.5">Password</label>
              <input
                id="register-password"
                name="password"
                autoComplete="new-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder={t('auth.passwordPlaceholder')}
              />
            </div>

            {teacherEnabled && (
              <div>
                <label htmlFor="register-invite" className="block text-sm font-medium mb-1.5">
                  Teacher invite code{' '}
                  <span className="text-inkmuted font-normal">(optional)</span>
                </label>
                <input
                  id="register-invite"
                  name="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                  placeholder="Leave empty to join as a student"
                  autoComplete="off"
                />
                <p className="text-xs text-inkmuted mt-1.5">
                  Ask your institution for this code. Without it you'll be registered as a student.
                </p>
              </div>
            )}

            {error && (
              <div className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {loading ? t('auth.creating') : t('auth.createAccountAction')}
            </button>
          </form>

          <p className="text-sm text-inkmuted mt-6">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

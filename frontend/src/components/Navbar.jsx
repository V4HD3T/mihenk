import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n, LANGUAGES } from '../i18n/index.jsx';

/** Switches the interface language and remembers the choice. */
function LanguagePicker() {
  const { language, setLanguage, t } = useI18n();
  return (
    <>
      <label htmlFor="language-picker" className="sr-only">
        {t('nav.language')}
      </label>
      <select
        id="language-picker"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="text-sm bg-transparent border border-line rounded-full px-2 py-1 text-inkmuted hover:text-ink focus:border-primary outline-none"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </>
  );
}

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 text-sm rounded-full transition-colors ${
          isActive ? 'bg-primary text-white' : 'text-inkmuted hover:bg-ink/5 hover:text-ink'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur border-b border-line">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white font-mono text-xs font-bold">
              &gt;_
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">CodeCloud</span>
          </NavLink>
          <nav aria-label="Main" className="hidden md:flex items-center gap-1">
            {user.role === 'student' && (
              <>
                <NavItem to="/">{t('nav.problems')}</NavItem>
                <NavItem to="/courses">{t('nav.courses')}</NavItem>
                <NavItem to="/my-exams">{t('nav.myExams')}</NavItem>
                <NavItem to="/analytics">{t('nav.myProgress')}</NavItem>
              </>
            )}
            {user.role === 'teacher' && (
              <>
                <NavItem to="/">{t('nav.dashboard')}</NavItem>
                <NavItem to="/courses">{t('nav.courses')}</NavItem>
                <NavItem to="/students">{t('nav.students')}</NavItem>
                <NavItem to="/analytics">{t('nav.analytics')}</NavItem>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <LanguagePicker />
          <span className="hidden sm:block text-sm text-inkmuted">
            {user.name} <span className="text-line">·</span>{' '}
            <span className="font-mono text-xs uppercase">{user.role === 'teacher' ? 'teacher' : 'student'}</span>
          </span>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="text-sm px-3 py-1.5 rounded-full border border-line text-inkmuted hover:border-ink hover:text-ink transition-colors"
          >
            {t('nav.logOut')}
          </button>
        </div>
      </div>
    </header>
  );
}

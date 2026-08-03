import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
          <nav className="hidden md:flex items-center gap-1">
            {user.role === 'student' && (
              <>
                <NavItem to="/">Problems</NavItem>
                <NavItem to="/my-exams">My Exams</NavItem>
                <NavItem to="/analytics">My Progress</NavItem>
              </>
            )}
            {user.role === 'teacher' && (
              <>
                <NavItem to="/">Dashboard</NavItem>
                <NavItem to="/students">Students</NavItem>
                <NavItem to="/analytics">Analytics</NavItem>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
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
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}

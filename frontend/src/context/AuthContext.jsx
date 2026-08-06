import { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Safe because main.jsx mounts I18nProvider outside this one, so that these
  // fallback messages are translated like everything else the user reads.
  const t = useT();
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('mihenk_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const persist = (user, token) => {
    localStorage.setItem('mihenk_token', token);
    localStorage.setItem('mihenk_user', JSON.stringify(user));
    setUser(user);
  };

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', { email, password });
      persist(data.user, data.token);
      return true;
    } catch (err) {
      setError(err.response?.data?.error || t('auth.loginFailed'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [t]);

  // The server decides the role: an account is a student unless the request
  // carries a valid teacher invite code, so there is no `role` field to send.
  const register = useCallback(async (name, email, password, inviteCode) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/auth/register', {
        name,
        email,
        password,
        ...(inviteCode ? { inviteCode } : {}),
      });
      persist(data.user, data.token);
      return true;
    } catch (err) {
      setError(err.response?.data?.error || t('auth.registerFailed'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [t]);

  const logout = useCallback(() => {
    localStorage.removeItem('mihenk_token');
    localStorage.removeItem('mihenk_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, register, logout, setError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

import { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('codecloud_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const persist = (user, token) => {
    localStorage.setItem('codecloud_token', token);
    localStorage.setItem('codecloud_user', JSON.stringify(user));
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
      setError(err.response?.data?.error || 'Login failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(err.response?.data?.error || 'Registration failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('codecloud_token');
    localStorage.removeItem('codecloud_user');
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

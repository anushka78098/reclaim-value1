import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

// Older versions kept the assistant chat in the browser under one shared key, which is
// why every account on a device saw the same history. It now lives on the server per
// account; this removes whatever the old version left behind.
function forgetLegacyChat() {
  try { sessionStorage.removeItem('rv_chat'); localStorage.removeItem('rv_chat'); } catch { /* storage blocked */ }
}
forgetLegacyChat();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState({ materials: {}, cities: [] });
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    forgetLegacyChat();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    api('/meta').then(setMeta).catch(() => {});
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, [logout]);

  const value = useMemo(() => ({
    user,
    meta,
    loading,
    setUser,
    logout,
    async login(email, password) {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      forgetLegacyChat();
      setToken(d.token);
      setUser(d.user);
      return d.user;
    },
    async register(form) {
      const d = await api('/auth/register', { method: 'POST', body: form });
      forgetLegacyChat();
      setToken(d.token);
      setUser(d.user);
      return d.user;
    },
  }), [user, meta, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

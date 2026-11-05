import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, UNAUTHORIZED_EVENT, type Permission, type User } from '../lib/api';
import { clearFlyover, markFlyoverPending } from '../lib/flyover';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<User>;
  acceptInvite: (token: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
  /** After an own-profile edit (the role always comes from the server). */
  replaceUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then((r) => alive && setUser(r.user))
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => alive && setLoading(false));
    // Any 401 from the API means the session ended (expired, revoked, deactivated).
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email: string, password: string, remember = false) => {
    const { user } = await api.auth.login(email, password, remember);
    markFlyoverPending();
    setUser(user);
    return user;
  }, []);

  const acceptInvite = useCallback(async (token: string, password: string) => {
    const { user } = await api.auth.acceptInvite(token, password);
    markFlyoverPending();
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      clearFlyover();
      setUser(null);
    }
  }, []);

  const can = useCallback((p: Permission) => !!user?.permissions.includes(p), [user]);

  const value = useMemo(
    () => ({ user, loading, login, acceptInvite, logout, can, replaceUser: setUser }),
    [user, loading, login, acceptInvite, logout, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

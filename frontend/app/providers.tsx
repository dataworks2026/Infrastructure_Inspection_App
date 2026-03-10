'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import { User } from '@/types';
import { getUser, saveUser, getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';

/* ── Shared user context ── */
interface UserCtxType {
  user: User | null;
  refreshUser: (updated: User) => void;
}
const UserCtx = createContext<UserCtxType>({ user: null, refreshUser: () => {} });
export const useCurrentUser = () => useContext(UserCtx).user;
export const useRefreshUser = () => useContext(UserCtx).refreshUser;

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime:    5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnMount: 'always',
      },
    },
  }));

  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Immediately hydrate from localStorage so UI doesn't flash empty
    const cached = getUser();
    if (cached) setUser(cached);

    // Then sync fresh data from server (fixes stale tokens / missing fields)
    if (getToken()) {
      authApi.me().then((fresh: User) => {
        setUser(fresh);
        saveUser(fresh);
      }).catch(() => {
        // Token invalid or server down — leave cached user in place
      });
    }
  }, []);

  // Called after a successful PATCH /auth/me to sync context + localStorage
  const refreshUser = useCallback((updated: User) => {
    setUser(updated);
    saveUser(updated);   // updates USER_KEY only, never touches the JWT token
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <UserCtx.Provider value={{ user, refreshUser }}>
        {children}
      </UserCtx.Provider>
    </QueryClientProvider>
  );
}

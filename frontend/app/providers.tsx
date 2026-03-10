'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import { User } from '@/types';
import { getUser, saveUser } from '@/lib/auth';

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
  useEffect(() => { setUser(getUser()); }, []);

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

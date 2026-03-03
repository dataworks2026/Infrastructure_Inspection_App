'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, createContext, useContext, useEffect } from 'react';
import { User } from '@/types';
import { getUser } from '@/lib/auth';

/* ── Shared user context (avoids re-reading localStorage per component) ── */
const UserCtx = createContext<User | null>(null);
export const useCurrentUser = () => useContext(UserCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10 * 60_000,      // 10 min — data stays fresh across nav
        gcTime:    20 * 60_000,      // 20 min garbage collection
        retry: 1,
        refetchOnWindowFocus: false, // prevents re-fetch on alt-tab
        refetchOnMount: false,       // if data exists in cache, use it — no re-fetch on every mount
      },
    },
  }));

  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { setUser(getUser()); }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <UserCtx.Provider value={user}>
        {children}
      </UserCtx.Provider>
    </QueryClientProvider>
  );
}

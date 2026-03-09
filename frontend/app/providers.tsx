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
        staleTime: 30_000,           // 30s — refetch when stale on next access
        gcTime:    5 * 60_000,       // 5 min garbage collection
        retry: 1,
        refetchOnWindowFocus: true,  // refetch when user comes back to tab
        refetchOnMount: 'always',    // always refetch on page navigation
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

'use client';
import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { isAuthenticated } from '@/lib/auth';
import { assetsApi, inspectionsApi, dashboardApi } from '@/lib/api';
import Sidebar from '@/components/layout/Sidebar';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CommandPalette from '@/components/ui/CommandPalette';
import { ToastProvider } from '@/components/ui/Toast';
import { Search } from 'lucide-react';

// On the server useLayoutEffect doesn't exist — fall back to useEffect there.
// On the CLIENT, useLayoutEffect fires synchronously before the browser paints,
// so the user never sees the "spinner" state even for a single frame.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const queryClient = useQueryClient();

  // Start false — matches server HTML so hydration succeeds.
  // useIsomorphicLayoutEffect immediately flips it to true (before first paint)
  // if the user is authenticated, so no spinner flash ever occurs.
  const [checked, setChecked] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const handleToggleSidebar = useCallback(() => setSidebarCollapsed(p => !p), []);

  // ── Runs synchronously before first browser paint ───────────────────────
  useIsomorphicLayoutEffect(() => {
    if (isAuthenticated()) {
      setChecked(true);
    } else {
      router.replace('/login');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Prefetch all key data the moment auth is confirmed ──────────────────
  // Primes the React Query cache so any page navigated to is instant.
  useEffect(() => {
    if (!checked) return;
    queryClient.prefetchQuery({ queryKey: ['assets'],      queryFn: assetsApi.list });
    queryClient.prefetchQuery({ queryKey: ['inspections'], queryFn: inspectionsApi.list });
    queryClient.prefetchQuery({ queryKey: ['dashboard'],   queryFn: dashboardApi.overview });
  }, [checked, queryClient]);

  // Spinner shown only while genuinely unauthenticated (redirecting to /login)
  if (!checked) {
    return (
      <div className="flex min-h-screen bg-mira-bg items-center justify-center">
        <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-mira-bg">
        <Sidebar collapsed={sidebarCollapsed} onToggle={handleToggleSidebar} />

        {/* Main area */}
        <div
          className="flex-1 flex flex-col min-h-screen transition-all duration-300"
          style={{ marginLeft: sidebarCollapsed ? '64px' : '260px' }}
        >
          {/* Top bar */}
          <header className="sticky top-0 z-20 page-header-bar h-12 flex items-center justify-between px-8">
            <Breadcrumbs />

            {/* Search shortcut hint */}
            <button
              onClick={() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
              }}
              className="flex items-center gap-2 text-[12px] text-slate-400 hover:text-slate-300 bg-card-dark/60 border border-card-border hover:border-card-border-hover px-3 py-1.5 rounded-lg transition-all group"
            >
              <Search size={13} className="text-slate-500 group-hover:text-slate-400" />
              <span>Search...</span>
              <span className="ml-1 flex items-center gap-0.5">
                <kbd className="bg-slate-700 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-mono">⌘</kbd>
                <kbd className="bg-slate-700 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-mono">K</kbd>
              </span>
            </button>
          </header>

          {/* Page content */}
          <main className="flex-1 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Global overlays */}
      <CommandPalette />
    </ToastProvider>
  );
}

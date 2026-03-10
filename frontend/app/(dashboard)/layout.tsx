'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { isAuthenticated } from '@/lib/auth';
import { assetsApi, inspectionsApi, dashboardApi } from '@/lib/api';
import Sidebar from '@/components/layout/Sidebar';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CommandPalette from '@/components/ui/CommandPalette';
import { ToastProvider } from '@/components/ui/Toast';
import { Search } from 'lucide-react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (isAuthenticated()) {
      setChecked(true);
    } else {
      router.replace('/login');
    }
  }, []);

  // Listen for sidebar collapse changes by observing its width
  useEffect(() => {
    if (!checked) return;
    const sidebar = document.querySelector('aside');
    if (!sidebar) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSidebarCollapsed(entry.contentRect.width < 100);
      }
    });
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, [checked]);

  useEffect(() => {
    if (!checked) return;
    queryClient.prefetchQuery({ queryKey: ['assets'],      queryFn: () => assetsApi.list() });
    queryClient.prefetchQuery({ queryKey: ['inspections'], queryFn: () => inspectionsApi.list() });
    queryClient.prefetchQuery({ queryKey: ['dashboard'],   queryFn: () => dashboardApi.overview() });
  }, [checked, queryClient]);

  if (!checked) {
    return (
      <div className="flex min-h-screen bg-mira-bg items-center justify-center">
        <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sidebarWidth = sidebarCollapsed ? 64 : 240;

  return (
    <ToastProvider>
      <div className="min-h-screen bg-mira-bg">
        <Sidebar />

        {/* Main area - offset by sidebar width */}
        <div
          className="flex flex-col min-h-screen"
          style={{
            marginLeft: sidebarWidth,
            transition: 'margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Top bar */}
          <header
            className="sticky top-0 z-20 page-header-bar flex items-center justify-between flex-shrink-0"
            style={{ height: 48, padding: '0 24px' }}
          >
            <Breadcrumbs />
            <button
              onClick={() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
              }}
              className="flex items-center gap-2 text-[12px] text-slate-400 hover:text-slate-300 bg-card-dark/60 border border-card-border hover:border-card-border-hover px-3 py-1.5 rounded-lg transition-all group"
            >
              <Search size={13} className="text-slate-300 group-hover:text-slate-100" />
              <span>Search...</span>
              <span className="ml-1 flex items-center gap-0.5">
                <kbd className="bg-slate-700 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-mono">⌘</kbd>
                <kbd className="bg-slate-700 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-mono">K</kbd>
              </span>
            </button>
          </header>

          {/* Page content - takes remaining height, scrolls internally */}
          <main className="flex-1 overflow-y-auto" style={{ padding: '20px 24px 24px' }}>
            <div className="max-w-[1400px] mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>

      <CommandPalette />
    </ToastProvider>
  );
}

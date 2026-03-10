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
  const [sidebarW, setSidebarW] = useState(240);

  useIsomorphicLayoutEffect(() => {
    if (isAuthenticated()) {
      setChecked(true);
    } else {
      router.replace('/login');
    }
  }, []);

  // Track sidebar width via ResizeObserver
  useEffect(() => {
    if (!checked) return;
    const sidebar = document.querySelector('aside');
    if (!sidebar) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSidebarW(entry.contentRect.width);
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

  return (
    <ToastProvider>
      <div className="min-h-screen bg-mira-bg">
        <Sidebar />

        {/* Main area - flush against sidebar */}
        <div
          className="min-h-screen flex flex-col"
          style={{
            marginLeft: sidebarW,
            transition: 'margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Top bar - compact, themed, sticky */}
          <header className="sticky top-0 z-20 flex-shrink-0 flex items-center justify-between page-header-bar"
            style={{ height: 44, padding: '0 20px' }}>
            <Breadcrumbs />
            <button
              onClick={() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
              }}
              className="search-btn flex items-center gap-2 text-[11px] px-3 py-1 rounded-lg"
            >
              <Search size={12} />
              <span>Search...</span>
              <span className="ml-1 flex items-center gap-0.5">
                <kbd className="search-kbd">⌘</kbd>
                <kbd className="search-kbd">K</kbd>
              </span>
            </button>
          </header>

          {/* Page content - scrolls naturally with body */}
          <main className="flex-1" style={{ padding: '16px 20px 40px' }}>
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

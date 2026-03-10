'use client';
import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { isAuthenticated } from '@/lib/auth';
import { assetsApi, inspectionsApi, dashboardApi } from '@/lib/api';
import Sidebar from '@/components/layout/Sidebar';
import CommandPalette from '@/components/ui/CommandPalette';
import { ToastProvider } from '@/components/ui/Toast';
import AppTour, { useAppTour } from '@/components/ui/AppTour';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 64;
const TRANSITION = 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const [checked, setChecked]     = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const tour = useAppTour();

  const toggleSidebar = useCallback(() => setCollapsed(c => !c), []);

  useIsomorphicLayoutEffect(() => {
    if (isAuthenticated()) {
      setChecked(true);
    } else {
      router.replace('/login');
    }
  }, []);

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

  const sidebarW = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <ToastProvider>
      <div className="min-h-screen bg-mira-bg">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} onStartTour={tour.start} />

        {/* Main area - flush against sidebar */}
        <div
          className="min-h-screen flex flex-col"
          style={{ marginLeft: sidebarW, transition: TRANSITION }}
        >
          <main className="flex-1" style={{ padding: '16px 20px 40px' }}>
            <div className="max-w-[1400px] mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>

      <CommandPalette />
      <AppTour active={tour.active} onClose={tour.stop} />
    </ToastProvider>
  );
}

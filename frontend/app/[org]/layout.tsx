'use client';
import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { isAuthenticated, getOrgSlug, saveUser } from '@/lib/auth';
import { assetsApi, inspectionsApi, dashboardApi, authApi } from '@/lib/api';
import type { User } from '@/types';
import Sidebar from '@/components/layout/Sidebar';
import CommandPalette from '@/components/ui/CommandPalette';
import { ToastProvider } from '@/components/ui/Toast';
import AppTour, { useAppTour } from '@/components/ui/AppTour';
import { Menu } from 'lucide-react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 64;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router      = useRouter();
  const params      = useParams();
  const pathname    = usePathname();
  const urlOrg      = typeof params?.org === 'string' ? params.org : '';
  const queryClient = useQueryClient();
  const [checked, setChecked]     = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const tour = useAppTour();

  const toggleSidebar = useCallback(() => setCollapsed(c => !c), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Swap the org segment of the current URL for the one the user belongs to,
  // keeping the rest of the path: /wrong-org/assets/123 -> /gov-island/assets/123
  const toOwnOrg = useCallback((slug: string) => {
    const rest = pathname.split('/').slice(2).join('/');
    return `/${slug}${rest ? `/${rest}` : ''}`;
  }, [pathname]);

  useIsomorphicLayoutEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }
    const slug = getOrgSlug();
    if (!slug) {
      // Session predates org-scoped URLs — resolve the slug from the server so
      // existing logins keep working instead of being bounced to /login.
      authApi.me()
        .then((fresh: User) => {
          saveUser(fresh);
          if (!fresh.organization_slug) { router.replace('/login'); return; }
          if (fresh.organization_slug !== urlOrg) {
            router.replace(toOwnOrg(fresh.organization_slug));
          } else {
            setChecked(true);
          }
        })
        .catch(() => router.replace('/login'));
      return;
    }
    // The API scopes every response by the JWT's org, so a foreign slug in the
    // URL exposes nothing — but correct it so the URL always matches the data.
    if (slug !== urlOrg) {
      router.replace(toOwnOrg(slug));
      return;
    }
    setChecked(true);
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
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          onStartTour={tour.start}
          mobileOpen={mobileOpen}
          onMobileClose={closeMobile}
        />

        {/* Mobile top bar with hamburger */}
        <div className="fixed top-0 left-0 right-0 z-20 lg:hidden flex items-center gap-3 px-4 py-3 bg-mira-bg/95 backdrop-blur-md"
          style={{ borderBottom: '1px solid rgba(203,213,225,0.4)' }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-slate-200/60"
            style={{ color: '#082E29' }}>
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Mira Intel" className="w-7 h-7 object-contain"
              style={{ filter: 'drop-shadow(0 0 4px rgba(8,145,178,0.3))' }} />
            <span className="text-[13px] font-black tracking-wide" style={{ color: '#082E29' }}>MIRA INTEL</span>
          </div>
        </div>

        {/* CSS-driven margin for desktop sidebar */}
        <style>{`
          .dashboard-main {
            margin-left: 0;
            padding-top: 56px;
          }
          @media (min-width: 1024px) {
            .dashboard-main {
              margin-left: ${sidebarW}px;
              padding-top: 0;
              transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
          }
        `}</style>

        <div className="dashboard-main min-h-screen flex flex-col">
          <main className="flex-1 px-4 sm:px-5 lg:px-6 py-5 pb-10">
            {children}
          </main>
        </div>
      </div>

      <CommandPalette />
      <AppTour active={tour.active} onClose={tour.stop} />
    </ToastProvider>
  );
}

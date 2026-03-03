'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { memo, useCallback } from 'react';
import {
  LayoutDashboard, Building2, ClipboardList, Upload, FileText,
  LogOut, Map, Box, GitCompareArrows, Flame, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { clearAuth } from '@/lib/auth';
import { useCurrentUser } from '@/app/providers';
import clsx from 'clsx';

const NAV_ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/dashboard',    label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/assets',       label: 'Assets',      icon: Building2 },
  { href: '/map',          label: 'Map',         icon: Map },
  { href: '/inspections',  label: 'Inspections', icon: ClipboardList },
  { href: '/upload',       label: 'Upload',      icon: Upload },
  { href: '/reports',      label: 'Reports',     icon: FileText },
];

const TWIN_ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/digital-twin',         label: 'Overview',  icon: Box },
  { href: '/digital-twin/viewer',  label: '3D Viewer', icon: Box },
  { href: '/digital-twin/compare', label: 'Compare',   icon: GitCompareArrows },
  { href: '/digital-twin/heatmap', label: 'Heatmap',  icon: Flame },
];

/** Mira Intel logo — uses actual logo.png from /public */
function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="Mira Intel"
      width={size}
      height={size}
      style={{ objectFit: 'contain', flexShrink: 0 }}
      priority
    />
  );
}

/** Navigation link — memoized to avoid re-render when sibling updates */
const NavLink = memo(function NavLink({
  href, label, icon: Icon, active, variant, collapsed,
}: {
  href: string; label: string; icon: React.ElementType;
  active: boolean; variant?: 'twin'; collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={true}
      title={collapsed ? label : undefined}
      className={clsx(
        'flex items-center rounded-lg text-[13px] font-medium transition-all',
        collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-4 py-2.5',
        variant === 'twin'
          ? (active
            ? 'bg-gradient-to-r from-sky-500/20 to-blue-500/20 text-sky-300 shadow-sm'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
          : (active
            ? 'bg-sky-500/20 text-sky-300 shadow-sm'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
      )}
    >
      <Icon size={18} strokeWidth={active ? 2 : 1.5} />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
});

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();

  const handleLogout = useCallback(() => {
    clearAuth();
    router.replace('/login');
  }, [router]);

  return (
    <aside
      className="bg-mira-sidebar shadow-sidebar flex flex-col min-h-screen fixed left-0 top-0 z-30 transition-all duration-300 overflow-hidden"
      style={{ width: collapsed ? '64px' : '260px' }}
    >
      {/* Brand row */}
      <div className={clsx(
        'border-b border-white/10 flex items-center',
        collapsed ? 'flex-col gap-2 py-4 px-2' : 'px-4 py-5 gap-3',
      )}>
        {/* Logo icon — always visible */}
        <LogoMark size={collapsed ? 32 : 36} />

        {/* Text — hidden when collapsed */}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-white tracking-tight leading-none">MIRA INTEL</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-[0.12em] mt-0.5">Inspection Platform</div>
          </div>
        )}

        {/* Toggle chevron button */}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx(
            'rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center',
            collapsed ? 'w-8 h-8' : 'w-7 h-7 ml-auto flex-shrink-0',
          )}
        >
          {collapsed
            ? <ChevronRight size={15} />
            : <ChevronLeft  size={15} />
          }
        </button>
      </div>

      {/* Navigation */}
      <nav className={clsx('flex-1 py-5 overflow-y-auto space-y-1', collapsed ? 'px-2' : 'px-3')}>
        {/* Section label */}
        {!collapsed && (
          <div className="px-3 mb-3">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.15em]">Menu</span>
          </div>
        )}

        {NAV_ITEMS.map(({ href, label, icon }) => {
          const active = pathname === href || (pathname.startsWith(href + '/') && href !== '/');
          return (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={active}
              collapsed={collapsed}
            />
          );
        })}

        {/* Digital Twin section */}
        {!collapsed && (
          <div className="px-3 mt-6 mb-3">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.15em]">Digital Twin</span>
          </div>
        )}
        {collapsed && <div className="my-3 mx-auto w-5 h-px bg-white/10" />}

        {TWIN_ITEMS.map(({ href, label, icon }) => {
          const active = pathname === href;
          return (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={active}
              variant="twin"
              collapsed={collapsed}
            />
          );
        })}
      </nav>

      {/* User section */}
      <div className={clsx('border-t border-white/10', collapsed ? 'p-2' : 'p-4')}>
        {!collapsed ? (
          <>
            <div className="flex items-center gap-3 mb-3 px-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-xs font-bold text-white shadow-md flex-shrink-0">
                {user?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-200 truncate">
                  {user?.full_name || user?.email || '\u00A0'}
                </div>
                <div className="text-[11px] text-slate-500 capitalize">
                  {user?.role || '\u00A0'}
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 text-[12px] text-slate-500 hover:text-red-400 transition-colors py-1.5 px-2 rounded-md hover:bg-white/5"
            >
              <LogOut size={14} /> Sign out
            </button>
          </>
        ) : (
          /* Collapsed: just avatar + logout stacked */
          <div className="flex flex-col items-center gap-2">
            <div
              title={user?.full_name || user?.email || 'User'}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-xs font-bold text-white shadow-md cursor-default"
            >
              {user?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default memo(Sidebar);

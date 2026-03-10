'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { memo, useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, Building2, ClipboardList, Upload, FileText,
  LogOut, Map, Box, GitCompareArrows, Flame, ChevronLeft, ChevronRight,
  Settings,
} from 'lucide-react';
import { clearAuth } from '@/lib/auth';
import { useCurrentUser } from '@/app/providers';

const TEAL  = '#082E29';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

const NAV_ITEMS = [
  { href: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/assets',      label: 'Assets',      icon: Building2 },
  { href: '/map',         label: 'Map',         icon: Map },
  { href: '/inspections', label: 'Inspections', icon: ClipboardList },
  { href: '/upload',      label: 'Upload',      icon: Upload },
  { href: '/reports',     label: 'Reports',     icon: FileText },
];

const TWIN_ITEMS = [
  { href: '/digital-twin',         label: 'Overview',  icon: Box },
  { href: '/digital-twin/viewer',  label: '3D Viewer', icon: Box },
  { href: '/digital-twin/compare', label: 'Compare',   icon: GitCompareArrows },
  { href: '/digital-twin/heatmap', label: 'Heatmap',   icon: Flame },
];

function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl flex-shrink-0 bg-white"
      style={{ width: size, height: size, padding: Math.round(size * 0.1) }}>
      <img src="/logo.png" alt="Mira Intel"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}

const NavLink = memo(function NavLink({
  href, label, icon: Icon, active, small, collapsed,
}: {
  href: string; label: string; icon: React.ElementType;
  active: boolean; small?: boolean; collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className="sidebar-nav-link flex items-center gap-3 rounded-xl group relative"
      style={{
        padding: collapsed ? '10px 0' : '10px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        ...(active
          ? { background: 'rgba(147,197,253,0.12)', color: BLUE }
          : { color: small ? '#5B8A78' : '#A5D4BB' }),
      }}
    >
      <Icon size={small ? 15 : 17} style={{ flexShrink: 0 }}
        className="transition-colors group-hover:text-[#93C5FD]" />
      {!collapsed && (
        <span className={`${small ? 'text-[12px]' : 'text-[13px]'} font-semibold truncate transition-colors group-hover:text-[#93C5FD]`}>
          {label}
        </span>
      )}
      {active && (
        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-l-full"
          style={{ background: BLUE }} />
      )}
    </Link>
  );
});

export default memo(function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const [collapsed, setCollapsed] = useState(false);
  const [hoverToggle, setHoverToggle] = useState(false);

  const handleLogout = useCallback(() => {
    clearAuth();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        setCollapsed(c => !c);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? 'U';

  const w = collapsed ? 64 : 240;

  return (
    <>
      <aside
        className="fixed top-0 left-0 bottom-0 z-30 flex flex-col flex-shrink-0 overflow-hidden"
        style={{
          width: w,
          background: TEAL,
          transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Logo row */}
        <div className="flex items-center gap-3 flex-shrink-0"
          style={{
            padding: collapsed ? '16px 15px' : '16px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
          <LogoMark size={34} />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-black tracking-wide truncate" style={{ color: '#F0FDF4', letterSpacing: '0.04em' }}>
                MIRA INTEL
              </p>
              <p className="text-[9px] font-medium truncate" style={{ color: '#6B9A87', letterSpacing: '0.06em' }}>
                INSPECTION PLATFORM
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ padding: collapsed ? '16px 8px' : '16px 10px' }}>

          {!collapsed && (
            <p className="px-3 mb-2 text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: '#3D6B5E' }}>
              Menu
            </p>
          )}
          <div className="space-y-0.5">
            {NAV_ITEMS.map(({ href, label, icon }) => (
              <NavLink key={href} href={href} label={label} icon={icon} collapsed={collapsed}
                active={pathname === href || (href !== '/dashboard' && pathname.startsWith(href))} />
            ))}
          </div>

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {!collapsed ? (
              <div className="px-3 mb-2 flex items-center gap-2">
                <p className="text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: '#3D6B5E' }}>
                  Digital Twin
                </p>
                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: 'rgba(147,197,253,0.12)', color: '#93C5FD' }}>
                  Soon
                </span>
              </div>
            ) : (
              <div className="mx-auto mb-2" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
            )}
            <div className="space-y-0.5">
              {TWIN_ITEMS.map(({ label, icon: Icon }) => (
                <div key={label} title={collapsed ? `${label} (coming soon)` : undefined}
                  className="flex items-center gap-3 rounded-xl cursor-not-allowed select-none opacity-40"
                  style={{
                    padding: collapsed ? '10px 0' : '10px 12px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  }}>
                  <Icon size={15} style={{ flexShrink: 0, color: '#5B8A78' }} />
                  {!collapsed && (
                    <span className="text-[12px] font-semibold truncate" style={{ color: '#5B8A78' }}>{label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom: user + actions */}
        <div className="flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: collapsed ? '12px 8px' : '12px 10px' }}>
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
                  style={{ background: BRAND, color: 'white' }}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate" style={{ color: '#F0FDF4' }}>
                    {user?.full_name || user?.email || '\u00A0'}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: '#6B9A87' }}>
                    {user?.organization_name || user?.role || '\u00A0'}
                  </p>
                </div>
              </div>
              <Link href="/settings"
                className="sidebar-nav-link flex items-center gap-3 px-3 py-2 rounded-xl group"
                style={{ color: '#6B9A87' }}>
                <Settings size={15} className="flex-shrink-0 transition-colors group-hover:text-[#93C5FD]" />
                <span className="text-[12px] font-semibold transition-colors group-hover:text-[#93C5FD]">Settings</span>
              </Link>
              <button onClick={handleLogout}
                className="sidebar-nav-link w-full flex items-center gap-3 px-3 py-2 rounded-xl group"
                style={{ color: '#6B9A87' }}>
                <LogOut size={15} className="flex-shrink-0 transition-colors group-hover:text-red-400" />
                <span className="text-[12px] font-semibold transition-colors group-hover:text-red-400">Sign out</span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div title={user?.full_name || user?.email || 'User'}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black"
                style={{ background: BRAND, color: 'white' }}>
                {initials}
              </div>
              <Link href="/settings" title="Settings"
                className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-white/10"
                style={{ color: '#6B9A87' }}>
                <Settings size={15} />
              </Link>
              <button onClick={handleLogout} title="Sign out"
                className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-red-500/10"
                style={{ color: '#6B9A87' }}>
                <LogOut size={15} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Floating collapse/expand toggle on sidebar edge */}
      <button
        onClick={() => setCollapsed(c => !c)}
        onMouseEnter={() => setHoverToggle(true)}
        onMouseLeave={() => setHoverToggle(false)}
        className="sidebar-toggle-btn fixed z-40 flex items-center justify-center"
        style={{
          left: w - 12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 24,
          height: 48,
          borderRadius: '0 8px 8px 0',
          background: hoverToggle ? '#0891B2' : TEAL,
          border: `1px solid ${hoverToggle ? '#0891B2' : 'rgba(255,255,255,0.15)'}`,
          borderLeft: 'none',
          color: hoverToggle ? 'white' : '#6B9A87',
          cursor: 'pointer',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: hoverToggle ? '2px 0 12px rgba(8,145,178,0.3)' : '2px 0 8px rgba(0,0,0,0.15)',
        }}
        title={collapsed ? 'Expand sidebar (press [)' : 'Collapse sidebar (press [)'}
      >
        {collapsed
          ? <ChevronRight size={14} style={{ transition: 'transform 0.2s', transform: hoverToggle ? 'translateX(1px)' : 'none' }} />
          : <ChevronLeft size={14} style={{ transition: 'transform 0.2s', transform: hoverToggle ? 'translateX(-1px)' : 'none' }} />
        }
      </button>
    </>
  );
});

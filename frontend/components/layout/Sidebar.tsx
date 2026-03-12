'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { memo, useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, Building2, ClipboardList, Upload, FileText,
  LogOut, Map, Box, GitCompareArrows, Flame, ChevronLeft, ChevronRight,
  Settings, Search, HelpCircle, X,
} from 'lucide-react';
import { clearAuth } from '@/lib/auth';
import { useCurrentUser } from '@/app/providers';

const TEAL  = '#082E29';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

const NAV_ITEMS = [
  { href: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard, tourId: 'nav-dashboard' },
  { href: '/assets',      label: 'Assets',      icon: Building2,       tourId: 'nav-assets' },
  { href: '/map',         label: 'Map',         icon: Map,             tourId: 'nav-map' },
  { href: '/inspections', label: 'Inspections', icon: ClipboardList,   tourId: 'nav-inspections' },
  { href: '/upload',      label: 'Upload',      icon: Upload,          tourId: 'nav-upload' },
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
    <div className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size, height: size,
        filter: 'drop-shadow(0 0 6px rgba(8,145,178,0.5)) drop-shadow(0 0 14px rgba(147,197,253,0.3))',
      }}>
      <img src="/logo.png" alt="Mira Intel"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}

const NavLink = memo(function NavLink({
  href, label, icon: Icon, active, small, collapsed, tourId, onClick,
}: {
  href: string; label: string; icon: React.ElementType;
  active: boolean; small?: boolean; collapsed: boolean; tourId?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      data-tour={tourId}
      onClick={onClick}
      className="sidebar-nav-link flex items-center gap-3 rounded-xl group relative"
      style={{
        padding: collapsed ? '10px 0' : '10px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        ...(active
          ? { background: 'rgba(147,197,253,0.12)', color: BLUE }
          : { color: small ? '#5B8A78' : '#A5D4BB' }),
      }}
    >
      <Icon size={small ? 17 : 19} style={{ flexShrink: 0 }}
        className="transition-colors group-hover:text-[#93C5FD]" />
      {!collapsed && (
        <span className="text-[13px] font-semibold truncate transition-colors group-hover:text-[#93C5FD]">
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

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onStartTour?: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default memo(function Sidebar({ collapsed, onToggle, onStartTour, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const [isDesktop, setIsDesktop] = useState(true);

  // Track screen size
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleLogout = useCallback(() => {
    clearAuth();
    router.replace('/login');
  }, [router]);

  // Keyboard shortcut: press [ to toggle (desktop only)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        onToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);

  // Close mobile sidebar on route change
  useEffect(() => {
    onMobileClose();
  }, [pathname, onMobileClose]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [mobileOpen]);

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? 'U';

  // On desktop, use collapsed state. On mobile, sidebar is always full-width drawer.
  const isCollapsed = isDesktop && collapsed;
  const w = isCollapsed ? 64 : 240;

  const handleNavClick = useCallback(() => {
    if (!isDesktop) onMobileClose();
  }, [isDesktop, onMobileClose]);

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
      />

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 flex flex-col flex-shrink-0 overflow-hidden
          z-50 lg:z-30
          transition-transform duration-300 ease-out lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          width: isDesktop ? w : 240,
          background: TEAL,
          ...(isDesktop ? { transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)' } : {}),
        }}
      >
        {/* Logo row */}
        <div className="flex items-center gap-3 flex-shrink-0"
          style={{
            padding: isCollapsed ? '16px 15px' : '16px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
          <LogoMark size={34} />
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-black tracking-wide truncate" style={{ color: '#F0FDF4', letterSpacing: '0.04em' }}>
                MIRA INTEL
              </p>
              <p className="text-[10px] font-medium truncate" style={{ color: '#6B9A87', letterSpacing: '0.06em' }}>
                INSPECTION PLATFORM
              </p>
            </div>
          )}
          {/* Mobile close button */}
          {!isDesktop && (
            <button
              onClick={onMobileClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors ml-auto"
              style={{ color: '#6B9A87' }}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* Search trigger */}
        <div style={{ padding: isCollapsed ? '8px 8px 0' : '8px 10px 0' }}>
          <button
            onClick={() => {
              onMobileClose();
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
            }}
            data-tour="search-trigger"
            className="sidebar-nav-link flex items-center gap-2.5 rounded-xl w-full"
            style={{
              padding: isCollapsed ? '9px 0' : '9px 12px',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#6B9A87',
            }}
            title={isCollapsed ? 'Search (⌘K)' : undefined}
          >
            <Search size={16} style={{ flexShrink: 0 }} />
            {!isCollapsed && (
              <>
                <span className="text-[12px] font-semibold flex-1 text-left">Search...</span>
                <span className="flex items-center gap-0.5 ml-auto">
                  <kbd className="text-[9px] font-bold px-1 py-px rounded" style={{ background: 'rgba(255,255,255,0.08)', color: '#5B8A78' }}>⌘</kbd>
                  <kbd className="text-[9px] font-bold px-1 py-px rounded" style={{ background: 'rgba(255,255,255,0.08)', color: '#5B8A78' }}>K</kbd>
                </span>
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ padding: isCollapsed ? '16px 8px' : '16px 10px' }}>

          {!isCollapsed && (
            <p className="px-3 mb-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: '#3D6B5E' }}>
              Menu
            </p>
          )}
          <div className="space-y-0.5">
            {NAV_ITEMS.map(({ href, label, icon, tourId }) => (
              <NavLink key={href} href={href} label={label} icon={icon} collapsed={isCollapsed}
                tourId={tourId} onClick={handleNavClick}
                active={pathname === href || (href !== '/dashboard' && pathname.startsWith(href))} />
            ))}
          </div>

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {!isCollapsed ? (
              <div className="px-3 mb-2 flex items-center gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: '#3D6B5E' }}>
                  Digital Twin
                </p>
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: 'rgba(147,197,253,0.12)', color: '#93C5FD' }}>
                  Soon
                </span>
              </div>
            ) : (
              <div className="mx-auto mb-2" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
            )}
            <div className="space-y-0.5">
              {TWIN_ITEMS.map(({ label, icon: Icon }) => (
                <div key={label} title={isCollapsed ? `${label} (coming soon)` : undefined}
                  className="flex items-center gap-3 rounded-xl cursor-not-allowed select-none opacity-40"
                  style={{
                    padding: isCollapsed ? '10px 0' : '10px 12px',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                  }}>
                  <Icon size={17} style={{ flexShrink: 0, color: '#5B8A78' }} />
                  {!isCollapsed && (
                    <span className="text-[13px] font-semibold truncate" style={{ color: '#5B8A78' }}>{label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom: user + actions */}
        <div className="flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: isCollapsed ? '12px 8px' : '12px 10px' }}>
          {!isCollapsed ? (
            <>
              <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-black flex-shrink-0"
                  style={{ background: BRAND, color: 'white' }}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: '#F0FDF4' }}>
                    {user?.full_name || user?.email || '\u00A0'}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: '#6B9A87' }}>
                    {user?.organization_name || user?.role || '\u00A0'}
                  </p>
                </div>
              </div>
              {onStartTour && (
                <button onClick={() => { onStartTour(); onMobileClose(); }}
                  className="sidebar-nav-link w-full flex items-center gap-3 px-3 py-2 rounded-xl group"
                  style={{ color: '#6B9A87' }}>
                  <HelpCircle size={17} className="flex-shrink-0 transition-colors group-hover:text-[#93C5FD]" />
                  <span className="text-[13px] font-semibold transition-colors group-hover:text-[#93C5FD]">Take a Tour</span>
                </button>
              )}
              <Link href="/settings" onClick={handleNavClick}
                className="sidebar-nav-link flex items-center gap-3 px-3 py-2 rounded-xl group"
                style={{ color: '#6B9A87' }}>
                <Settings size={17} className="flex-shrink-0 transition-colors group-hover:text-[#93C5FD]" />
                <span className="text-[13px] font-semibold transition-colors group-hover:text-[#93C5FD]">Settings</span>
              </Link>
              <button onClick={handleLogout}
                className="sidebar-nav-link w-full flex items-center gap-3 px-3 py-2 rounded-xl group"
                style={{ color: '#6B9A87' }}>
                <LogOut size={17} className="flex-shrink-0 transition-colors group-hover:text-red-400" />
                <span className="text-[13px] font-semibold transition-colors group-hover:text-red-400">Sign out</span>
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div title={user?.full_name || user?.email || 'User'}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-black"
                style={{ background: BRAND, color: 'white' }}>
                {initials}
              </div>
              {onStartTour && (
                <button onClick={onStartTour} title="Take a Tour"
                  className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-white/10"
                  style={{ color: '#6B9A87' }}>
                  <HelpCircle size={17} />
                </button>
              )}
              <Link href="/settings" title="Settings"
                className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-white/10"
                style={{ color: '#6B9A87' }}>
                <Settings size={17} />
              </Link>
              <button onClick={handleLogout} title="Sign out"
                className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-red-500/10"
                style={{ color: '#6B9A87' }}>
                <LogOut size={17} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Desktop: Floating circle toggle on sidebar edge */}
      <button
        onClick={onToggle}
        className="sidebar-toggle-circle fixed z-40 hidden lg:flex"
        style={{
          left: w - 14,
          top: '50%',
          transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        title={collapsed ? 'Expand sidebar (press [)' : 'Collapse sidebar (press [)'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </>
  );
});

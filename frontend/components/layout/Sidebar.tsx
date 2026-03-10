'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { memo, useCallback, useState } from 'react';
import {
  LayoutDashboard, Building2, ClipboardList, Upload, FileText,
  LogOut, Map, Box, GitCompareArrows, Flame, ChevronLeft, ChevronRight, Settings,
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
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative"
      style={active
        ? { background: 'rgba(147,197,253,0.12)', color: BLUE }
        : { color: small ? '#5B8A78' : '#A5D4BB' }
      }
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

  const handleLogout = useCallback(() => {
    clearAuth();
    router.replace('/login');
  }, [router]);

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? 'U';

  const w = collapsed ? 64 : 220;

  return (
    <aside className="flex flex-col h-screen flex-shrink-0 transition-all duration-300"
      style={{ width: w, background: TEAL, borderRight: '1px solid rgba(255,255,255,0.06)' }}>

      {/* ── Logo row ── */}
      <div className="flex items-center gap-3 px-4 py-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
        <button onClick={() => setCollapsed(c => !c)}
          className="rounded-lg flex items-center justify-center transition-colors hover:bg-white/10 flex-shrink-0"
          style={{ width: 26, height: 26, color: '#6B9A87' }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">

        {!collapsed && (
          <p className="px-3 mb-2 text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: '#3D6B5E' }}>
            Menu
          </p>
        )}
        {NAV_ITEMS.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} label={label} icon={icon} collapsed={collapsed}
            active={pathname === href || (href !== '/dashboard' && pathname.startsWith(href))} />
        ))}

        {/* Digital Twin section — coming soon, non-clickable */}
        <div className="pt-4">
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
          {TWIN_ITEMS.map(({ label, icon: Icon }) => (
            <div key={label} title={collapsed ? `${label} (coming soon)` : undefined}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-not-allowed select-none opacity-40">
              <Icon size={15} style={{ flexShrink: 0, color: '#5B8A78' }} />
              {!collapsed && (
                <span className="text-[12px] font-semibold truncate" style={{ color: '#5B8A78' }}>{label}</span>
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* ── Bottom: user + actions ── */}
      <div className="px-2 py-3 space-y-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2.5 px-3 py-2.5 mb-1">
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
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group"
              style={{ color: '#6B9A87' }}>
              <Settings size={15} className="flex-shrink-0 transition-colors group-hover:text-[#93C5FD]" />
              <span className="text-[12px] font-semibold transition-colors group-hover:text-[#93C5FD]">Settings</span>
            </Link>
            <button onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group"
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
  );
});

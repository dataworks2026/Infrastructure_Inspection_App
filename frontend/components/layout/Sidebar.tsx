'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { memo, useCallback, useState } from 'react';
import {
  LayoutDashboard, Building2, ClipboardList, Upload, FileText,
  LogOut, Map, ChevronLeft, ChevronRight, Settings,
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

/** Mira Intel logo — uses logo.png in a white rounded container */
function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl flex-shrink-0 bg-white overflow-hidden"
      style={{ width: size, height: size }}>
      <img
        src="/logo.png"
        alt="Mira Intel"
        width={size}
        height={size}
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}

const NavLink = memo(function NavLink({
  href, label, icon: Icon, active, collapsed,
}: {
  href: string; label: string; icon: React.ElementType;
  active: boolean; collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative"
      style={active
        ? { background: 'rgba(147,197,253,0.1)', color: BLUE }
        : { color: '#A5D4BB' }
      }
    >
      <Icon
        size={17}
        style={{ flexShrink: 0, color: active ? BLUE : '#A5D4BB' }}
        className="transition-colors group-hover:text-[#93C5FD]"
      />
      {!collapsed && (
        <span className="text-[13px] font-semibold truncate transition-colors group-hover:text-[#93C5FD]">
          {label}
        </span>
      )}
      {active && (
        <span
          className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-l-full"
          style={{ background: BLUE }}
        />
      )}
    </Link>
  );
});

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useCurrentUser();
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
    <aside
      className="flex flex-col h-screen flex-shrink-0 transition-all duration-300"
      style={{ width: w, background: TEAL, borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* ── Logo row ── */}
      <div className="flex items-center gap-3 px-4 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <LogoMark size={34} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[13px] font-black tracking-wide truncate" style={{ color: '#F0FDF4', letterSpacing: '0.04em' }}>
              MIRA INTEL
            </p>
            <p className="text-[9px] font-medium truncate" style={{ color: '#6B9A87', letterSpacing: '0.06em' }}>
              INSPECTION PLATFORM
            </p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            icon={icon}
            active={pathname === href || (href !== '/dashboard' && pathname.startsWith(href))}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* ── Bottom: user + collapse ── */}
      <div className="px-2 py-3 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
          style={{ color: '#6B9A87', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight size={15} style={{ flexShrink: 0 }} />
            : <ChevronLeft  size={15} style={{ flexShrink: 0 }} />}
          {!collapsed && <span className="text-[12px] font-medium">Collapse</span>}
        </button>

        {/* Settings */}
        <Link
          href="/settings"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
          style={{ color: '#6B9A87' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#A5D4BB'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#6B9A87'; }}
          title="Profile Settings"
        >
          <Settings size={15} style={{ flexShrink: 0 }} />
          {!collapsed && <span className="text-[12px] font-medium">Settings</span>}
        </Link>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
          style={{ color: '#6B9A87', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#A5D4BB'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#6B9A87'; }}
          title="Sign out"
        >
          <LogOut size={15} style={{ flexShrink: 0 }} />
          {!collapsed && <span className="text-[12px] font-medium">Sign out</span>}
        </button>

        {/* User avatar */}
        <div
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 12 }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-[11px] font-black"
            style={{ background: BRAND }}
          >
            {initials}
          </div>
          {!collapsed && user && (
            <div className="min-w-0">
              <p className="text-[11px] font-semibold truncate" style={{ color: '#C8E6D4' }}>
                {user.full_name || user.email}
              </p>
              {user.full_name && (
                <p className="text-[9px] truncate" style={{ color: '#6B9A87' }}>{user.email}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

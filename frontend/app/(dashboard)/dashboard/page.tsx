'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, sensorsApi, missionsApi, assetsApi, type LiveMission } from '@/lib/api';
import { resolveTwinForUser } from '@/lib/twinMap';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Building2, ArrowRight,
  Wind, Waves, Anchor, Shield,
  Activity, Thermometer, RefreshCw, Map, ClipboardList,
  Maximize2, Box, AlertTriangle, TrendingDown,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { DashboardAssetHealth } from '@/types';
import CvAccuracyWidget from '@/components/dashboard/CvAccuracyWidget';

/* ── Dynamic import of 3D scene (no SSR — Three.js needs browser) ── */
const TurbineScene = dynamic(
  () => import('../digital-twin/viewer/TurbineScene'),
  { ssr: false, loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ background: '#0A1A2F' }}>
      <div className="flex flex-col items-center gap-3">
        <Box size={32} className="animate-pulse" style={{ color: '#0891B2' }} />
        <p className="text-[12px] font-semibold" style={{ color: '#6B9A87' }}>Loading 3D scene…</p>
      </div>
    </div>
  )}
);

/* ── Org-aware twin iframe.
   Fetches the user's assets and resolves the right photogrammetric twin per
   org via lib/twinMap.ts. Falls back gracefully while the assets request is
   in flight (renders the dark canvas so the layout doesn't jump). */
function DashboardTwinIframe() {
  const { data: assets } = useQuery({
    queryKey: ['assets-for-twin'],
    queryFn: () => assetsApi.list(),
  });
  const twin = resolveTwinForUser(assets ?? []);
  if (!twin) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
        No twin available for this account yet
      </div>
    );
  }
  return (
    <iframe
      src={`/twin/?mid=${twin.mid}&name=${encodeURIComponent(twin.name)}`}
      title={`${twin.name} digital twin`}
      className="w-full h-full block border-0"
      allow="fullscreen"
    />
  );
}

const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

/* ── Severity config ── */
const SEV: Record<string, { color: string; bg: string; border: string; label: string }> = {
  S4: { color: '#B71C1C', bg: '#FEF2F2', border: '#FECACA', label: 'Severe'   },
  S3: { color: '#FF7043', bg: '#FFF3E0', border: '#FFCCBC', label: 'Advanced' },
  S2: { color: '#E6A817', bg: '#FFFBEB', border: '#FDE68A', label: 'Moderate' },
  S1: { color: '#4CAF50', bg: '#F0FDF4', border: '#BBF7D0', label: 'Minor'    },
};

const INFRA_ICON: Record<string, React.ElementType> = {
  wind_turbine: Wind, coastal: Waves, pier: Anchor,
};
const INFRA_LABEL: Record<string, string> = {
  wind_turbine: 'Wind Turbine', coastal: 'Coastal', pier: 'Pier & Dock', railway: 'Railway',
};
const INFRA_COLOR: Record<string, string> = {
  wind_turbine: '#0EA5E9', coastal: '#06B6D4', pier: '#3B82F6', railway: '#6366F1',
};

/* ── Normalize legacy S0 → S1 ── */
const normSev = (s: string | null | undefined): string | null => {
  if (!s) return null;
  if (s === 'S0' || s === '0') return 'S1';
  const map: Record<string,string> = { '1':'S1','2':'S2','3':'S3','4':'S4' };
  return map[s] || s;
};

/* ── Wind direction helper ── */
function windDirLabel(deg: number | null | undefined): string {
  if (deg == null) return '';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/* ── Severity horizontal bar + chips (for asset rows) ── */
function SevBar({ counts }: { counts: Record<string, number> }) {
  const items = ['S1', 'S2', 'S3', 'S4'] as const;
  const total = items.reduce((s, k) => s + (counts[k] || 0), 0);

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="hidden lg:flex h-2 rounded-full overflow-hidden" style={{ width: 80, background: '#EDF6F0' }}>
        {total > 0 && items.map(k => {
          const pct = ((counts[k] || 0) / total) * 100;
          return pct > 0 ? (
            <div key={k} style={{ width: `${pct}%`, background: SEV[k].color, minWidth: 3 }} />
          ) : null;
        })}
      </div>
      <div className="flex items-center gap-1">
        {items.map(k => {
          const count = counts[k] || 0;
          const s = SEV[k];
          const active = count > 0;
          return (
            <span key={k}
              className="inline-flex items-center gap-[3px] text-[10px] font-bold pl-1.5 pr-2 py-[3px] rounded-full whitespace-nowrap"
              style={{
                background: active ? s.bg : '#F8FAFB',
                color: active ? s.color : '#B0C4BC',
                border: `1px solid ${active ? s.border : '#E2EDE8'}`,
              }}>
              <span className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                style={{ background: active ? s.color : '#CBD5D0' }} />
              {k}
              <span className="font-black tabular-nums ml-[1px]">{count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ── Asset health row ── */
function AssetRow({ asset, sevCounts }: { asset: DashboardAssetHealth; sevCounts?: Record<string, number> }) {
  const Icon = INFRA_ICON[asset.infrastructure_type] || Building2;
  const typeColor = INFRA_COLOR[asset.infrastructure_type] || '#64748B';
  return (
    <Link href={`/assets/${asset.id}`}
      className="interactive-row flex items-center gap-3 px-5 py-3.5 group"
      style={{ borderBottom: '1px solid #EDF6F0' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: typeColor + '15', border: `1px solid ${typeColor}30` }}>
        <Icon size={16} style={{ color: typeColor }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate group-hover:text-[#0891B2] transition-colors" style={{ color: TEAL }}>
          {asset.name}
        </p>
        <span className="text-[11px]" style={{ color: '#6B9A87' }}>
          {INFRA_LABEL[asset.infrastructure_type] || asset.infrastructure_type}
        </span>
      </div>
      {sevCounts ? (
        <SevBar counts={sevCounts} />
      ) : (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0"
          style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
          <Shield size={9} /> Clean
        </span>
      )}
      <ArrowRight size={14} style={{ color: '#C8E6D4' }}
        className="flex-shrink-0 group-hover:text-[#0891B2] group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

/* ── Env metric pill ── */
function EnvPill({ icon, label, value, unit, color }: {
  icon: React.ReactNode; label: string; value: number | null | undefined; unit: string; color: string;
}) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer hover:scale-[1.02] transition-transform"
      style={{ background: color + '08', border: `1px solid ${color}18` }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 relative"
        style={{ background: color + '15' }}>
        {icon}
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-[1.5px] ring-white" />
      </div>
      <div className="leading-none">
        <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color }}>{label}</p>
        <p className="text-[15px] font-black leading-tight whitespace-nowrap" style={{ color: TEAL }}>
          {Number.isInteger(value) ? value : value.toFixed(1)}
          <span className="text-[10px] font-semibold ml-0.5" style={{ color: '#6B9A87' }}>{unit}</span>
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════ */
export default function DashboardPage() {
  const [selectedPin, setSelectedPin] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.overview,
    refetchInterval: 120_000,
  });

  const { data: liveMissionsData } = useQuery({
    queryKey: ['live-missions'],
    queryFn: dashboardApi.getLiveMissions,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const liveMissions: LiveMission[] = liveMissionsData?.live_missions ?? [];

  const queryClient = useQueryClient();
  const { data: envData, isFetching: envFetching } = useQuery({
    queryKey: ['sensors-live'],
    queryFn: sensorsApi.getLive,
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const sensorEnv = useMemo(() => {
    const raw = envData?.assets || {};
    const first = Object.values(raw)[0] as any;
    if (!first) return null;
    return {
      wave_height: first.wave_height_m,
      wave_period: first.wave_period_s,
      temperature: first.temperature_f,
      wind_speed: first.wind_speed_kn,
      wind_direction: first.wind_direction_deg,
    };
  }, [envData]);

  const images = data?.recent_analyzed_images || [];
  const assetHealth = data?.asset_health || [];

  const assetSevCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    for (const img of images) {
      const key = img.asset_id;
      if (!counts[key]) counts[key] = { S1: 0, S2: 0, S3: 0, S4: 0 };
      for (const det of (img.detections || [])) {
        const s = normSev(det.severity);
        if (s && counts[key][s] !== undefined) counts[key][s]++;
      }
    }
    return counts;
  }, [images]);

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: TEAL }}>Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Platform overview and recent activity</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="interactive-chip flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: MINT, color: '#6B9A87', border: '1px solid #C8E6D4' }}>
            <Activity size={13} style={{ color: BRAND }} />
            {data?.total_inspections ?? 0} inspections
          </div>
        </div>
      </div>

      {/* Live Missions widget removed per request */}

      {/* ── 3 Shortcut Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Assets */}
        <Link href="/assets"
          className="interactive-card bg-white rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 group hover:shadow-md transition-all"
          style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND + '12' }}>
            <Building2 size={20} style={{ color: BRAND }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[22px] font-black leading-tight" style={{ color: TEAL }}>{data?.active_assets ?? 0}</p>
            <p className="text-[11px] font-semibold" style={{ color: '#6B9A87' }}>Active Assets</p>
          </div>
          <ArrowRight size={16} className="flex-shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" style={{ color: BRAND }} />
        </Link>

        {/* Map */}
        <Link href="/map"
          className="interactive-card bg-white rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 group hover:shadow-md transition-all"
          style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#10B98112' }}>
            <Map size={20} style={{ color: '#10B981' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-black leading-tight" style={{ color: TEAL }}>Map View</p>
            <p className="text-[11px] font-semibold" style={{ color: '#6B9A87' }}>Explore locations</p>
          </div>
          <ArrowRight size={16} className="flex-shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" style={{ color: '#10B981' }} />
        </Link>

        {/* Inspections */}
        <Link href="/inspections"
          className="interactive-card bg-white rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 group hover:shadow-md transition-all"
          style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#6366F112' }}>
            <ClipboardList size={20} style={{ color: '#6366F1' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-black leading-tight" style={{ color: TEAL }}>Inspections</p>
            <p className="text-[11px] font-semibold" style={{ color: '#6B9A87' }}>View all inspections</p>
          </div>
          <ArrowRight size={16} className="flex-shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" style={{ color: '#6366F1' }} />
        </Link>
      </div>

      {/* ── Asset Health (left) + Sensors Card (right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4" data-tour="dashboard-health">

        {/* Asset Health Card */}
        <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #EDF6F0' }}>
            <div className="flex items-center gap-2">
              <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>Asset Health</h2>
              {sensorEnv && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  LIVE
                </span>
              )}
            </div>
            <Link href="/assets" className="interactive-link text-[11px] font-bold flex items-center gap-1"
              style={{ color: BRAND }}>
              View all <ArrowRight size={10} />
            </Link>
          </div>
          {/* Severity Legend */}
          <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0" style={{ background: '#FAFCFB', borderBottom: '1px solid #EDF6F0' }}>
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#9AB8AD' }}>Severity:</span>
            {(['S1', 'S2', 'S3', 'S4'] as const).map(k => {
              const s = SEV[k];
              return (
                <span key={k} className="inline-flex items-center gap-1 text-[9px] font-semibold">
                  <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span style={{ color: s.color }}>{k}</span>
                  <span style={{ color: '#9AB8AD' }}>{s.label}</span>
                </span>
              );
            })}
          </div>
          {assetHealth.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 flex-1">
              <Building2 size={26} style={{ color: '#C8E6D4' }} />
              <p className="text-[13px]" style={{ color: '#6B9A87' }}>No assets yet</p>
              <Link href="/assets" className="text-[11px] font-bold" style={{ color: BRAND }}>Create one →</Link>
            </div>
          ) : (
            <div>
              {assetHealth.map(a => <AssetRow key={a.id} asset={a} sevCounts={assetSevCounts[a.id]} />)}
            </div>
          )}
        </div>

        {/* Right column: Sensors + CV Accuracy */}
        <div className="flex flex-col gap-4">
        {/* Sensors Card */}
        <Link href="/sensors"
          className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-all"
          style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #EDF6F0' }}>
            <div className="flex items-center gap-2">
              <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>Live Conditions</h2>
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                LIVE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); queryClient.invalidateQueries({ queryKey: ['sensors-live'] }); }}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all hover:scale-105"
                style={{ background: '#EDF6F0', color: '#6B9A87', border: '1px solid #C8E6D4' }}
                title="Refresh">
                <RefreshCw size={10} className={envFetching ? 'animate-spin' : ''} />
              </button>
              <span className="text-[11px] font-bold flex items-center gap-1 group-hover:opacity-70 transition-opacity"
                style={{ color: BRAND }}>
                Sensors <ArrowRight size={10} />
              </span>
            </div>
          </div>
          <div className="px-4 py-3 flex-1 flex flex-col gap-2">
            <p className="text-[11px] font-semibold" style={{ color: '#6B9A87' }}>
              Governor&apos;s Island, NY
            </p>
            <p className="text-[9px] font-medium" style={{ color: '#9AB8AD' }}>
              Source: NOAA CO-OPS &amp; NDBC Buoys
            </p>
            {sensorEnv ? (
              <div className="grid grid-cols-2 gap-2 flex-1">
                <EnvPill icon={<Waves size={15} style={{ color: '#0891B2' }} />}
                  label="Sea Level" value={sensorEnv.wave_height} unit="m" color="#0891B2" />
                <EnvPill icon={<Activity size={15} style={{ color: '#6366F1' }} />}
                  label="Tidal" value={sensorEnv.wave_period} unit="s" color="#6366F1" />
                <EnvPill icon={<Thermometer size={15} style={{ color: '#EF4444' }} />}
                  label="Temp" value={sensorEnv.temperature} unit="°F" color="#EF4444" />
                <EnvPill icon={<Wind size={15} style={{ color: '#0EA5E9' }} />}
                  label="Wind" value={sensorEnv.wind_speed}
                  unit={sensorEnv.wind_direction != null ? windDirLabel(sensorEnv.wind_direction) : 'kn'}
                  color="#0EA5E9" />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[12px]" style={{ color: '#9AB8AD' }}>Loading sensor data…</p>
              </div>
            )}
          </div>
        </Link>

        {/* CV Model Accuracy */}
        <CvAccuracyWidget />
        </div>
      </div>

      {/* ── Digital Twin 3D Viewer ── */}
      <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #C8E6D4' }}>
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #EDF6F0' }}>
          <div className="flex items-center gap-2">
            <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>3D Viewer / Model</h2>
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#EDE9FE', color: '#7C3AED', border: '1px solid #DDD6FE' }}>
              <Box size={8} />
              3D
            </span>
          </div>
          <Link href="/digital-twin/viewer"
            className="interactive-link text-[11px] font-bold flex items-center gap-1 hover:opacity-70 transition-opacity"
            style={{ color: BRAND }}>
            <Maximize2 size={10} />
            Full Viewer <ArrowRight size={10} />
          </Link>
        </div>
        <div className="relative bg-[#0A1A2F]"
          style={{ height: 'calc(100vh - 28rem)', minHeight: 220, maxHeight: 500 }}>
          {/* Real photogrammetric twin — iframed standalone viewer.
              The src is resolved per-logged-in-user from their first asset → twin
              mapping so different orgs see their own twin (gov_island → Yankee Pier,
              brooklyn → BAT Pier 4 v1, etc.). */}
          <DashboardTwinIframe />

          {/* ── Glass overlay: stats on 3D ── */}
          <div className="absolute inset-0 pointer-events-none z-10">

            {/* Top-left: Health Score */}
            <div className="absolute top-3 left-3 pointer-events-auto">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl backdrop-blur-md"
                style={{ background: 'rgba(8,46,41,0.65)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="relative w-10 h-10 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15" fill="none" stroke="#10B981" strokeWidth="3"
                      strokeDasharray={`${87 * 0.942} ${100 * 0.942}`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white">87</span>
                </div>
                <div className="leading-none">
                  <p className="text-[10px] font-black text-white">Health Score</p>
                  <p className="text-[9px] font-semibold" style={{ color: '#10B981' }}>Good Condition</p>
                </div>
              </div>
            </div>

            {/* Top-right: Severity summary */}
            <div className="absolute top-3 right-3 pointer-events-auto">
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl backdrop-blur-md"
                style={{ background: 'rgba(8,46,41,0.65)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {(['S1', 'S2', 'S3', 'S4'] as const).map(k => {
                  const pinCounts = { S1: 0, S2: 5, S3: 4, S4: 3 };
                  const count = pinCounts[k];
                  const s = SEV[k];
                  return (
                    <span key={k} className="inline-flex items-center gap-[3px] text-[9px] font-bold px-1.5 py-[2px] rounded-full"
                      style={{ background: count > 0 ? s.color + '30' : 'rgba(255,255,255,0.08)', color: count > 0 ? s.color : 'rgba(255,255,255,0.3)' }}>
                      <span className="w-[5px] h-[5px] rounded-full" style={{ background: count > 0 ? s.color : 'rgba(255,255,255,0.2)' }} />
                      {k} <span className="font-black">{count}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Bottom-left: Structures */}
            <div className="absolute bottom-3 left-3 pointer-events-auto">
              <div className="flex flex-col gap-1 px-3 py-2 rounded-xl backdrop-blur-md"
                style={{ background: 'rgba(8,46,41,0.65)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-[8px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Structures</p>
                {[
                  { name: 'Seawall', health: 78, defects: 4, color: '#FF7043' },
                  { name: 'Riprap', health: 82, defects: 3, color: '#E6A817' },
                  { name: 'Timber Pier', health: 71, defects: 5, color: '#FF7043' },
                ].map(s => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-white w-16 truncate">{s.name}</span>
                    <div className="w-12 h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                      <div className="h-full rounded-full" style={{ width: `${s.health}%`, background: s.health >= 80 ? '#10B981' : s.health >= 70 ? '#E6A817' : '#EF4444' }} />
                    </div>
                    <span className="text-[9px] font-black tabular-nums" style={{ color: s.health >= 80 ? '#10B981' : s.health >= 70 ? '#E6A817' : '#EF4444' }}>{s.health}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom-right: Quick stats */}
            <div className="absolute bottom-3 right-3 pointer-events-auto">
              <div className="flex items-center gap-3 px-3 py-2 rounded-xl backdrop-blur-md"
                style={{ background: 'rgba(8,46,41,0.65)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={11} style={{ color: '#EF4444' }} />
                  <div className="leading-none">
                    <p className="text-[12px] font-black text-white">12</p>
                    <p className="text-[8px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Defects</p>
                  </div>
                </div>
                <div className="w-[1px] h-6" style={{ background: 'rgba(255,255,255,0.15)' }} />
                <div className="flex items-center gap-1.5">
                  <TrendingDown size={11} style={{ color: '#FF7043' }} />
                  <div className="leading-none">
                    <p className="text-[12px] font-black text-white">3</p>
                    <p className="text-[8px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Critical</p>
                  </div>
                </div>
                <div className="w-[1px] h-6" style={{ background: 'rgba(255,255,255,0.15)' }} />
                <div className="flex items-center gap-1.5">
                  <Activity size={11} style={{ color: '#0891B2' }} />
                  <div className="leading-none">
                    <p className="text-[12px] font-black text-white">3</p>
                    <p className="text-[8px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Surveys</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

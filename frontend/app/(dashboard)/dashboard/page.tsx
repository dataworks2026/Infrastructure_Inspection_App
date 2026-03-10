'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Building2, ClipboardList, AlertTriangle, ImageIcon, ArrowRight,
  ChevronLeft, ChevronRight, Wind, Waves, Train, Anchor, Shield,
} from 'lucide-react';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, Tooltip as RechartTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import type { DashboardAnalyzedImage, DashboardAssetHealth } from '@/types';

// ── Exergy3 palette ────────────────────────────────────────────────────────────
const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

const SEV: Record<string, { color: string; bg: string; border: string; label: string }> = {
  S3: { color: '#EF4444', bg: '#FEF2F2', border: '#FECACA', label: 'Critical' },
  S2: { color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A', label: 'Major'    },
  S1: { color: '#EAB308', bg: '#FEFCE8', border: '#FEF08A', label: 'Minor'    },
  S0: { color: '#10B981', bg: '#F0FDF4', border: '#BBF7D0', label: 'None'     },
};

const INFRA_ICON: Record<string, React.ElementType> = {
  wind_turbine: Wind,
  coastal: Waves,
  pier: Anchor,
  railway: Train,
};
const INFRA_LABEL: Record<string, string> = {
  wind_turbine: 'Wind Turbine',
  coastal: 'Coastal',
  pier: 'Pier & Dock',
  railway: 'Railway',
};
const INFRA_COLOR: Record<string, string> = {
  wind_turbine: '#0EA5E9',
  coastal: '#06B6D4',
  pier: '#3B82F6',
  railway: '#6366F1',
};

// ── Severity badge ─────────────────────────────────────────────────────────────
function SevBadge({ sev }: { sev: string | null }) {
  if (!sev) return null;
  const s = SEV[sev];
  if (!s) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {sev} <span className="font-normal opacity-75">{s.label}</span>
    </span>
  );
}

// ── KPI card (Exergy3 light) ───────────────────────────────────────────────────
function KPICard({
  label, value, sub, icon, accentColor, ringPct,
}: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; accentColor: string; ringPct?: number;
}) {
  const r = 20; const circ = 2 * Math.PI * r;
  const dash = ringPct != null ? circ * (1 - ringPct / 100) : circ;
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm flex flex-col gap-3"
      style={{ border: `1px solid #C8E6D4` }}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#6B9A87' }}>{label}</p>
        {ringPct != null ? (
          <div className="relative w-11 h-11 flex-shrink-0">
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r={r} fill="none" stroke="#C8E6D4" strokeWidth="3.5" />
              <circle cx="22" cy="22" r={r} fill="none" stroke={accentColor} strokeWidth="3.5"
                strokeDasharray={circ} strokeDashoffset={dash}
                strokeLinecap="round" transform="rotate(-90 22 22)"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black"
              style={{ color: TEAL }}>{ringPct}%</span>
          </div>
        ) : (
          <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: accentColor + '18', color: accentColor }}>
            {icon}
          </span>
        )}
      </div>
      <div className="text-[32px] font-black leading-none tracking-tight" style={{ color: TEAL }}>
        {value}
      </div>
      {sub && <p className="text-[11px]" style={{ color: '#6B9A87' }}>{sub}</p>}
      <div className="h-0.5 rounded-full mt-auto" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }} />
    </div>
  );
}

// ── Inspection image card ──────────────────────────────────────────────────────
function ImageCard({ img }: { img: DashboardAnalyzedImage }) {
  const sev = img.max_severity ? SEV[img.max_severity] : null;
  return (
    <Link href={`/inspections/${img.inspection_id}`}
      className="bg-white rounded-2xl overflow-hidden shadow-sm flex flex-col group transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ border: '1px solid #C8E6D4' }}>
      {/* Image */}
      <div className="relative h-40 bg-slate-100 overflow-hidden">
        <img src={img.url} alt={img.filename}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={e => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23EDF6F0"/><text x="50" y="55" text-anchor="middle" font-size="30" fill="%236B9A87">📷</text></svg>'; }} />
        {/* Detection count badge */}
        {img.detection_count > 0 ? (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 text-white text-[11px] font-black px-2 py-1 rounded-full shadow-sm"
            style={{ background: sev?.color || '#6B9A87' }}>
            <AlertTriangle size={10} /> {img.detection_count}
          </div>
        ) : (
          <div className="absolute top-2.5 right-2.5 text-[11px] font-black px-2 py-1 rounded-full shadow-sm"
            style={{ background: '#10B981', color: 'white' }}>
            ✓ Clean
          </div>
        )}
      </div>
      {/* Info */}
      <div className="p-3.5 flex flex-col gap-1.5 flex-1">
        <p className="text-[12px] font-bold truncate" style={{ color: TEAL }}>{img.inspection_name}</p>
        <p className="text-[11px] truncate" style={{ color: '#6B9A87' }}>{img.asset_name}</p>
        <div className="flex items-center justify-between mt-auto pt-1">
          <SevBadge sev={img.max_severity} />
          {!img.max_severity && (
            <span className="text-[10px] font-semibold" style={{ color: '#10B981' }}>No issues</span>
          )}
          <ArrowRight size={12} style={{ color: '#6B9A87' }}
            className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

// ── Asset health row ───────────────────────────────────────────────────────────
function AssetRow({ asset }: { asset: DashboardAssetHealth }) {
  const Icon = INFRA_ICON[asset.infrastructure_type] || Building2;
  const typeColor = INFRA_COLOR[asset.infrastructure_type] || '#64748B';
  const sev = asset.worst_severity;
  const borderColor = sev === 'S3' ? '#EF4444' : sev === 'S2' ? '#F59E0B' : sev === 'S1' ? '#EAB308' : '#10B981';
  return (
    <Link href={`/assets/${asset.id}`}
      className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#F7FCF9] transition-colors group border-l-[3px]"
      style={{ borderLeftColor: borderColor }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: typeColor + '15', border: `1px solid ${typeColor}30` }}>
        <Icon size={14} style={{ color: typeColor }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate group-hover:text-[#0891B2] transition-colors"
          style={{ color: TEAL }}>{asset.name}</p>
        <p className="text-[11px]" style={{ color: '#6B9A87' }}>
          {INFRA_LABEL[asset.infrastructure_type] || asset.infrastructure_type}
          {' · '}{asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {asset.total_detections > 0 ? (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' }}>
            {asset.total_detections} det.
          </span>
        ) : (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1"
            style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
            <Shield size={10} /> Clean
          </span>
        )}
        <SevBadge sev={asset.worst_severity} />
        <ArrowRight size={12} style={{ color: '#C8E6D4' }}
          className="group-hover:text-[#0891B2] group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.overview,
    refetchInterval: 120_000,
  });

  const [imgPage, setImgPage] = useState(0);
  const PER_PAGE = 3;

  if (isLoading) return <DashboardSkeleton />;

  const images = data?.recent_analyzed_images || [];
  const assetHealth = data?.asset_health || [];
  const sevBreakdown = data?.severity_breakdown || {};
  const totalPages = Math.max(1, Math.ceil(images.length / PER_PAGE));
  const visibleImages = images.slice(imgPage * PER_PAGE, imgPage * PER_PAGE + PER_PAGE);

  // Severity donut data
  const sevDonut = Object.entries(sevBreakdown).map(([k, v]) => ({
    name: `${k} ${SEV[k]?.label || k}`, value: v, color: SEV[k]?.color || '#64748B',
  }));

  // Inspections by status bar — always show all 3 statuses so chart never has a single floating bar
  const statusCounts = (data?.recent_inspections || []).reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});
  const barData = [
    { status: 'completed',  count: statusCounts.completed  || 0 },
    { status: 'pending',    count: statusCounts.pending    || 0 },
    { status: 'processing', count: statusCounts.processing || 0 },
  ];
  const barColors: Record<string, string> = { completed: '#10B981', pending: '#F59E0B', processing: BRAND };

  const tooltipStyle = {
    contentStyle: { background: '#FFFFFF', border: '1px solid #C8E6D4', borderRadius: 10, fontSize: 12, boxShadow: '0 4px 20px rgba(8,46,41,0.08)' },
    labelStyle: { color: TEAL, fontWeight: 700 },
    itemStyle: { color: TEAL },
  };

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-black tracking-tight" style={{ color: TEAL }}>Dashboard</h1>
        <p className="text-xs mt-0.5" style={{ color: '#6B9A87' }}>Platform overview and recent activity</p>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Fleet Health"
          value={`${data?.fleet_health_pct ?? 0}%`}
          sub={`${data?.active_assets ?? 0} of ${data?.total_assets ?? 0} assets active`}
          icon={<Building2 size={16} />}
          accentColor={TEAL}
          ringPct={data?.fleet_health_pct ?? 0}
        />
        <KPICard
          label="Active Assets"
          value={data?.active_assets ?? 0}
          sub={`${data?.total_assets ?? 0} total`}
          icon={<Building2 size={16} />}
          accentColor={BRAND}
        />
        <KPICard
          label="Total Detections"
          value={data?.total_detections ?? 0}
          sub={`across ${data?.total_inspections ?? 0} inspections`}
          icon={<AlertTriangle size={16} />}
          accentColor="#EF4444"
        />
        <KPICard
          label="Images Analyzed"
          value={data?.total_images ?? 0}
          sub={`${data?.pending_inspections ?? 0} pending`}
          icon={<ImageIcon size={16} />}
          accentColor={BLUE}
        />
      </div>

      {/* ── Image Carousel + Severity Donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Image carousel — 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
                Recent Inspections
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: '#A5D4BB' }}>
                {images.length} analyzed image{images.length !== 1 ? 's' : ''}
              </p>
            </div>
            {images.length > PER_PAGE && (
              <div className="flex items-center gap-2">
                <button onClick={() => setImgPage(p => Math.max(0, p - 1))} disabled={imgPage === 0}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                  style={{ background: MINT, color: TEAL }}>
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[11px] font-bold" style={{ color: '#6B9A87' }}>{imgPage + 1}/{totalPages}</span>
                <button onClick={() => setImgPage(p => Math.min(totalPages - 1, p + 1))} disabled={imgPage === totalPages - 1}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                  style={{ background: MINT, color: TEAL }}>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          {images.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: MINT }}>
                <ImageIcon size={24} style={{ color: '#6B9A87' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: '#6B9A87' }}>No analyzed images yet</p>
              <Link href="/upload" className="text-xs font-bold" style={{ color: BRAND }}>Upload your first inspection →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {visibleImages.map(img => <ImageCard key={img.id} img={img} />)}
            </div>
          )}
        </div>

        {/* Severity donut */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>Severity Mix</h2>
          </div>
          {sevDonut.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={sevDonut} cx="50%" cy="50%" innerRadius={35} outerRadius={55}
                    dataKey="value" paddingAngle={3}>
                    {sevDonut.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <RechartTooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {sevDonut.map((d, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[11px]" style={{ color: '#6B9A87' }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="text-[12px] font-black font-mono" style={{ color: TEAL }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Shield size={28} style={{ color: '#10B981' }} />
              <p className="text-xs font-semibold" style={{ color: '#10B981' }}>No defects detected</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Asset Health Table ── */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #C8E6D4' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #EDF6F0' }}>
          <h2 className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>Asset Health</h2>
          <Link href="/assets" className="text-xs font-bold flex items-center gap-1 transition-colors hover:opacity-80"
            style={{ color: BRAND }}>
            View all <ArrowRight size={11} />
          </Link>
        </div>
        {assetHealth.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Building2 size={28} style={{ color: '#C8E6D4' }} />
            <p className="text-sm" style={{ color: '#6B9A87' }}>No assets yet</p>
            <Link href="/assets" className="text-xs font-bold" style={{ color: BRAND }}>Create one →</Link>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#EDF6F0' }}>
            {assetHealth.map(a => <AssetRow key={a.id} asset={a} />)}
          </div>
        )}
      </div>

      {/* ── Inspections by Status ── */}
      {barData.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <h2 className="text-[11px] font-black uppercase tracking-wider mb-4" style={{ color: '#6B9A87' }}>
            Inspections by Status
          </h2>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={barData} barCategoryGap="40%">
              <CartesianGrid strokeDasharray="3 3" stroke="#EDF6F0" vertical={false} />
              <XAxis dataKey="status" tick={{ fill: '#6B9A87', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#A5D4BB', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartTooltip {...tooltipStyle} cursor={{ fill: 'rgba(8,46,41,0.04)' }} />
              <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                {barData.map((e, i) => <Cell key={i} fill={barColors[e.status] || '#C8E6D4'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}

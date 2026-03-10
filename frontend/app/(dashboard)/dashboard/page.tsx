'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Building2, AlertTriangle, ImageIcon, ArrowRight,
  Wind, Waves, Train, Anchor, Shield, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, Tooltip as RechartTooltip, ResponsiveContainer,
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
  wind_turbine: Wind, coastal: Waves, pier: Anchor, railway: Train,
};
const INFRA_LABEL: Record<string, string> = {
  wind_turbine: 'Wind Turbine', coastal: 'Coastal', pier: 'Pier & Dock', railway: 'Railway',
};
const INFRA_COLOR: Record<string, string> = {
  wind_turbine: '#0EA5E9', coastal: '#06B6D4', pier: '#3B82F6', railway: '#6366F1',
};

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

// ── KPI card ───────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, icon, accentColor }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; accentColor: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm flex flex-col gap-3"
      style={{ border: '1px solid #C8E6D4' }}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#6B9A87' }}>{label}</p>
        <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: accentColor + '18', color: accentColor }}>
          {icon}
        </span>
      </div>
      <div className="text-[32px] font-black leading-none tracking-tight" style={{ color: TEAL }}>
        {value}
      </div>
      {sub && <p className="text-[11px]" style={{ color: '#6B9A87' }}>{sub}</p>}
      <div className="h-0.5 rounded-full mt-auto" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }} />
    </div>
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
        <p className="text-[13px] font-bold truncate group-hover:text-[#0891B2] transition-colors" style={{ color: TEAL }}>
          {asset.name}
        </p>
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

// ── Small image thumbnail card ─────────────────────────────────────────────────
function ThumbCard({ img }: { img: DashboardAnalyzedImage }) {
  const sev = img.max_severity ? SEV[img.max_severity] : null;
  return (
    <Link href={`/inspections/${img.inspection_id}`}
      className="flex-shrink-0 w-36 rounded-xl overflow-hidden shadow-sm group transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ border: '1px solid #C8E6D4' }}>
      {/* Thumbnail */}
      <div className="relative h-24 bg-slate-100 overflow-hidden">
        <img src={img.url} alt={img.filename}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={e => {
            (e.target as HTMLImageElement).src =
              'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23EDF6F0"/><text x="50" y="55" text-anchor="middle" font-size="28" fill="%236B9A87">📷</text></svg>';
          }}
        />
        {img.detection_count > 0 ? (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-sm"
            style={{ background: sev?.color || '#6B9A87' }}>
            <AlertTriangle size={8} /> {img.detection_count}
          </div>
        ) : (
          <div className="absolute top-1.5 right-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full"
            style={{ background: '#10B981', color: 'white' }}>
            ✓
          </div>
        )}
      </div>
      {/* Label */}
      <div className="px-2 py-1.5" style={{ background: 'white' }}>
        <SevBadge sev={img.max_severity} />
        {!img.max_severity && (
          <span className="text-[10px] font-semibold" style={{ color: '#10B981' }}>No issues</span>
        )}
        <p className="text-[10px] truncate mt-0.5" style={{ color: '#6B9A87' }}>{img.inspection_name}</p>
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

  if (isLoading) return <DashboardSkeleton />;

  const images       = data?.recent_analyzed_images || [];
  const assetHealth  = data?.asset_health || [];
  const sevBreakdown = data?.severity_breakdown || {};

  // Group images by asset (most severe already sorted by backend)
  const imagesByAsset = useMemo(() => {
    const groups: Record<string, { asset_id: string; asset_name: string; images: DashboardAnalyzedImage[] }> = {};
    for (const img of images) {
      const key = img.asset_id || img.asset_name;
      if (!groups[key]) groups[key] = { asset_id: img.asset_id, asset_name: img.asset_name, images: [] };
      groups[key].images.push(img);
    }
    // Sort each group: S3 first
    const sevRank: Record<string, number> = { S3: 0, S2: 1, S1: 2, S0: 3 };
    return Object.values(groups).map(g => ({
      ...g,
      images: [...g.images].sort((a, b) =>
        (sevRank[a.max_severity || ''] ?? 4) - (sevRank[b.max_severity || ''] ?? 4)
      ),
    }));
  }, [images]);

  // Severity donut
  const sevDonut = Object.entries(sevBreakdown).map(([k, v]) => ({
    name: `${k} ${SEV[k]?.label || k}`, value: v as number, color: SEV[k]?.color || '#64748B',
  }));

  const tooltipStyle = {
    contentStyle: { background: '#FFFFFF', border: '1px solid #C8E6D4', borderRadius: 10, fontSize: 12 },
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

      {/* ── KPI Row (3 cards, no Fleet Health) ── */}
      <div className="grid grid-cols-3 gap-4">
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

      {/* ── Asset Health Table (moved up) ── */}
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

      {/* ── Per-asset image carousels (below Asset Health) ── */}
      {imagesByAsset.length > 0 ? (
        <div className="space-y-4">
          {imagesByAsset.map(group => (
            <div key={group.asset_id || group.asset_name} className="bg-white rounded-2xl shadow-sm overflow-hidden"
              style={{ border: '1px solid #C8E6D4' }}>
              {/* Asset header */}
              <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #EDF6F0', background: MINT }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-black" style={{ color: TEAL }}>{group.asset_name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: '#C8E6D4', color: TEAL }}>
                    {group.images.length} image{group.images.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {group.asset_id && (
                  <Link href={`/assets/${group.asset_id}`}
                    className="flex items-center gap-1 text-[11px] font-bold transition-colors hover:opacity-80"
                    style={{ color: BRAND }}>
                    View asset <ChevronRight size={12} />
                  </Link>
                )}
              </div>
              {/* Horizontal scroll */}
              <div className="flex gap-3 px-5 py-4 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                {group.images.map(img => <ThumbCard key={img.id} img={img} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm p-10 flex flex-col items-center gap-3" style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: MINT }}>
            <ImageIcon size={24} style={{ color: '#6B9A87' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: '#6B9A87' }}>No analyzed images yet</p>
          <Link href="/upload" className="text-xs font-bold" style={{ color: BRAND }}>Upload your first inspection →</Link>
        </div>
      )}

      {/* ── Severity Donut (bottom) ── */}
      {sevDonut.length > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center gap-6">
            <div className="flex-shrink-0">
              <h2 className="text-[11px] font-black uppercase tracking-wider mb-3" style={{ color: '#6B9A87' }}>Severity Mix</h2>
              <ResponsiveContainer width={120} height={120}>
                <PieChart>
                  <Pie data={sevDonut} cx="50%" cy="50%" innerRadius={30} outerRadius={50}
                    dataKey="value" paddingAngle={3}>
                    {sevDonut.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <RechartTooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-2">
              {sevDonut.map((d, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[12px]" style={{ color: '#6B9A87' }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    {d.name}
                  </span>
                  <span className="text-[13px] font-black font-mono ml-4" style={{ color: TEAL }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

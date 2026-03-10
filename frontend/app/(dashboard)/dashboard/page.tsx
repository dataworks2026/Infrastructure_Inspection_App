'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Building2, AlertTriangle, ImageIcon, ArrowRight,
  Wind, Waves, Train, Anchor, Shield, ChevronRight, ChevronLeft,
  Activity, TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, Tooltip as RechartTooltip, ResponsiveContainer,
} from 'recharts';
import type { DashboardAnalyzedImage, DashboardAssetHealth } from '@/types';

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
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {sev} <span className="font-normal opacity-75">{s.label}</span>
    </span>
  );
}

/* ── KPI card ── */
function KPICard({ label, value, sub, icon, accentColor }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; accentColor: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2 min-w-0"
      style={{ border: '1px solid #C8E6D4' }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: '#6B9A87' }}>{label}</p>
        <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: accentColor + '18', color: accentColor }}>
          {icon}
        </span>
      </div>
      <div className="text-[28px] font-black leading-none tracking-tight" style={{ color: TEAL }}>
        {value}
      </div>
      {sub && <p className="text-[10px] truncate" style={{ color: '#6B9A87' }}>{sub}</p>}
      <div className="h-0.5 rounded-full mt-auto" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }} />
    </div>
  );
}

/* ── Asset health row ── */
function AssetRow({ asset }: { asset: DashboardAssetHealth }) {
  const Icon = INFRA_ICON[asset.infrastructure_type] || Building2;
  const typeColor = INFRA_COLOR[asset.infrastructure_type] || '#64748B';
  const sev = asset.worst_severity;
  const borderColor = sev === 'S3' ? '#EF4444' : sev === 'S2' ? '#F59E0B' : sev === 'S1' ? '#EAB308' : '#10B981';
  return (
    <Link href={`/assets/${asset.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-[#F7FCF9] transition-colors group border-l-[3px]"
      style={{ borderLeftColor: borderColor }}>
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: typeColor + '15', border: `1px solid ${typeColor}30` }}>
        <Icon size={13} style={{ color: typeColor }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-bold truncate group-hover:text-[#0891B2] transition-colors" style={{ color: TEAL }}>
          {asset.name}
        </p>
        <p className="text-[10px] truncate" style={{ color: '#6B9A87' }}>
          {INFRA_LABEL[asset.infrastructure_type] || asset.infrastructure_type}
          {' · '}{asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {asset.total_detections > 0 ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' }}>
            {asset.total_detections} det.
          </span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
            <Shield size={9} /> Clean
          </span>
        )}
        <SevBadge sev={asset.worst_severity} />
        <ArrowRight size={11} style={{ color: '#C8E6D4' }}
          className="group-hover:text-[#0891B2] group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}

/* ── Per-asset carousel card ── */
function AssetCarouselCard({
  group,
}: {
  group: { asset_id: string; asset_name: string; images: DashboardAnalyzedImage[] };
}) {
  const [idx, setIdx] = useState(0);
  const imgs = group.images;
  const img = imgs[idx];
  if (!img) return null;

  const sev = img.max_severity ? SEV[img.max_severity] : null;
  const totalDetections = imgs.reduce((sum, i) => sum + i.detection_count, 0);
  const worstSev = imgs.find(i => i.max_severity)?.max_severity ?? null;
  const borderAccent = worstSev === 'S3' ? '#EF4444' : worstSev === 'S2' ? '#F59E0B' : worstSev === 'S1' ? '#EAB308' : '#C8E6D4';

  const prev = () => setIdx(i => Math.max(0, i - 1));
  const next = () => setIdx(i => Math.min(imgs.length - 1, i + 1));

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col min-w-0"
      style={{ border: `1px solid ${borderAccent}` }}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ background: MINT, borderBottom: '1px solid #C8E6D4' }}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black truncate" style={{ color: TEAL }}>{group.asset_name}</p>
          <p className="text-[9px] mt-0.5" style={{ color: '#6B9A87' }}>
            {imgs.length} image{imgs.length !== 1 ? 's' : ''}&nbsp;·&nbsp;
            <span style={{ color: totalDetections > 0 ? '#EF4444' : '#10B981', fontWeight: 700 }}>
              {totalDetections} detection{totalDetections !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        {group.asset_id && (
          <Link href={`/assets/${group.asset_id}`}
            className="flex items-center gap-0.5 text-[9px] font-bold ml-2 flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: BRAND }}>
            View <ChevronRight size={9} />
          </Link>
        )}
      </div>

      {/* Image carousel */}
      <div className="relative bg-slate-100 overflow-hidden flex-shrink-0" style={{ aspectRatio: '4/3' }}>
        <img
          src={img.url}
          alt={img.filename}
          className="w-full h-full object-cover transition-opacity duration-200"
          onError={e => {
            (e.target as HTMLImageElement).src =
              'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23EDF6F0"/><text x="50" y="55" text-anchor="middle" font-size="28" fill="%236B9A87">📷</text></svg>';
          }}
        />

        {/* Detection badge */}
        {img.detection_count > 0 ? (
          <div className="absolute top-2 right-2 flex items-center gap-1 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-md"
            style={{ background: sev?.color || '#EF4444' }}>
            <AlertTriangle size={9} /> {img.detection_count}
          </div>
        ) : (
          <div className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full shadow-md"
            style={{ background: '#10B981', color: 'white' }}>
            Clean
          </div>
        )}

        {/* Carousel controls */}
        {imgs.length > 1 && (
          <>
            <button
              onClick={prev}
              disabled={idx === 0}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-all"
              style={{
                background: 'rgba(255,255,255,0.92)',
                opacity: idx === 0 ? 0.35 : 1,
                cursor: idx === 0 ? 'default' : 'pointer',
              }}>
              <ChevronLeft size={12} style={{ color: TEAL }} />
            </button>
            <button
              onClick={next}
              disabled={idx === imgs.length - 1}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-all"
              style={{
                background: 'rgba(255,255,255,0.92)',
                opacity: idx === imgs.length - 1 ? 0.35 : 1,
                cursor: idx === imgs.length - 1 ? 'default' : 'pointer',
              }}>
              <ChevronRight size={12} style={{ color: TEAL }} />
            </button>
          </>
        )}

        {/* Dots */}
        {imgs.length > 1 && imgs.length <= 9 && (
          <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1 pointer-events-none">
            {imgs.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className="w-1.5 h-1.5 rounded-full transition-all pointer-events-auto"
                style={{ background: i === idx ? 'white' : 'rgba(255,255,255,0.45)' }}
              />
            ))}
          </div>
        )}

        {/* Counter */}
        <div className="absolute bottom-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(8,46,41,0.65)', color: 'white' }}>
          {idx + 1}/{imgs.length}
        </div>
      </div>

      {/* Image info */}
      <div className="px-3 py-2.5 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SevBadge sev={img.max_severity} />
          {!img.max_severity && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
              <Shield size={8} /> Clean
            </span>
          )}
          {img.detection_count > 0 && (
            <span className="text-[9px] font-semibold" style={{ color: '#6B9A87' }}>
              {img.detection_count} det.
            </span>
          )}
        </div>
        <p className="text-[10px] font-medium truncate" style={{ color: '#6B9A87' }}>{img.inspection_name}</p>
        <p className="text-[9px] truncate font-mono" style={{ color: '#9AB8AD' }}>{img.filename}</p>
      </div>
    </div>
  );
}

/* ── All detections table ── */
function DetectionsTable({ images }: { images: DashboardAnalyzedImage[] }) {
  const allWithDetections = images.filter(i => i.detection_count > 0);
  if (allWithDetections.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #C8E6D4' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EDF6F0' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} style={{ color: '#EF4444' }} />
          <h2 className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
            All Detections
          </h2>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' }}>
          {allWithDetections.reduce((s, i) => s + i.detection_count, 0)} total
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" style={{ color: TEAL }}>
          <thead>
            <tr style={{ background: MINT, borderBottom: '1px solid #C8E6D4' }}>
              <th className="text-left px-4 py-2 font-bold text-[9px] uppercase tracking-wider" style={{ color: '#6B9A87' }}>Image</th>
              <th className="text-left px-4 py-2 font-bold text-[9px] uppercase tracking-wider" style={{ color: '#6B9A87' }}>Asset</th>
              <th className="text-left px-4 py-2 font-bold text-[9px] uppercase tracking-wider" style={{ color: '#6B9A87' }}>Inspection</th>
              <th className="text-center px-4 py-2 font-bold text-[9px] uppercase tracking-wider" style={{ color: '#6B9A87' }}>Severity</th>
              <th className="text-center px-4 py-2 font-bold text-[9px] uppercase tracking-wider" style={{ color: '#6B9A87' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {allWithDetections.map((img) => (
              <tr key={img.id} className="hover:bg-[#F7FCF9] transition-colors"
                style={{ borderBottom: '1px solid #EDF6F0' }}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-slate-100">
                      <img src={img.url} alt="" className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                    <span className="truncate font-mono text-[10px]" style={{ color: '#6B9A87' }}>{img.filename}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-semibold truncate">{img.asset_name}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="truncate" style={{ color: '#6B9A87' }}>{img.inspection_name}</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <SevBadge sev={img.max_severity} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className="font-black text-[12px]" style={{ color: '#EF4444' }}>{img.detection_count}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Main page ── */
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.overview,
    refetchInterval: 120_000,
  });

  const images = data?.recent_analyzed_images || [];

  const imagesByAsset = useMemo(() => {
    const groups: Record<string, { asset_id: string; asset_name: string; images: DashboardAnalyzedImage[] }> = {};
    for (const img of images) {
      const key = img.asset_id || img.asset_name;
      if (!groups[key]) groups[key] = { asset_id: img.asset_id, asset_name: img.asset_name, images: [] };
      groups[key].images.push(img);
    }
    const sevRank: Record<string, number> = { S3: 0, S2: 1, S1: 2, S0: 3 };
    return Object.values(groups)
      .map(g => ({
        ...g,
        images: [...g.images].sort((a, b) =>
          (sevRank[a.max_severity || ''] ?? 4) - (sevRank[b.max_severity || ''] ?? 4) ||
          b.detection_count - a.detection_count
        ),
      }))
      .sort((a, b) => {
        const worstA = sevRank[a.images[0]?.max_severity || ''] ?? 4;
        const worstB = sevRank[b.images[0]?.max_severity || ''] ?? 4;
        return worstA - worstB;
      });
  }, [images]);

  if (isLoading) return <DashboardSkeleton />;

  const assetHealth  = data?.asset_health || [];
  const sevBreakdown = data?.severity_breakdown || {};

  const sevDonut = Object.entries(sevBreakdown).map(([k, v]) => ({
    name: `${k} ${SEV[k]?.label || k}`, value: v as number, color: SEV[k]?.color || '#64748B',
  }));

  const tooltipStyle = {
    contentStyle: { background: '#FFFFFF', border: '1px solid #C8E6D4', borderRadius: 10, fontSize: 12 },
    labelStyle: { color: TEAL, fontWeight: 700 },
    itemStyle: { color: TEAL },
  };

  const carouselAssets = imagesByAsset.slice(0, 3);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight" style={{ color: TEAL }}>Dashboard</h1>
          <p className="text-[11px] mt-0.5" style={{ color: '#6B9A87' }}>Platform overview and recent activity</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: MINT, color: '#6B9A87', border: '1px solid #C8E6D4' }}>
            <Activity size={11} style={{ color: BRAND }} />
            <span>{data?.total_inspections ?? 0} inspections</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: MINT, color: '#6B9A87', border: '1px solid #C8E6D4' }}>
            <TrendingUp size={11} style={{ color: '#10B981' }} />
            <span>{data?.fleet_health_pct ?? 0}% fleet health</span>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-3 gap-4">
        <KPICard label="Active Assets" value={data?.active_assets ?? 0}
          sub={`${data?.total_assets ?? 0} total`} icon={<Building2 size={15} />} accentColor={BRAND} />
        <KPICard label="Total Detections" value={data?.total_detections ?? 0}
          sub={`across ${data?.total_inspections ?? 0} inspections`} icon={<AlertTriangle size={15} />} accentColor="#EF4444" />
        <KPICard label="Images Analyzed" value={data?.total_images ?? 0}
          sub={`${data?.pending_inspections ?? 0} pending`} icon={<ImageIcon size={15} />} accentColor={BLUE} />
      </div>

      {/* Two-column: Asset Health + Severity Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Asset Health - 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #EDF6F0' }}>
            <h2 className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>Asset Health</h2>
            <Link href="/assets" className="text-[10px] font-bold flex items-center gap-1 transition-colors hover:opacity-80"
              style={{ color: BRAND }}>
              View all <ArrowRight size={10} />
            </Link>
          </div>
          {assetHealth.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 flex-1">
              <Building2 size={24} style={{ color: '#C8E6D4' }} />
              <p className="text-[12px]" style={{ color: '#6B9A87' }}>No assets yet</p>
              <Link href="/assets" className="text-[10px] font-bold" style={{ color: BRAND }}>Create one →</Link>
            </div>
          ) : (
            <div className="divide-y overflow-y-auto" style={{ borderColor: '#EDF6F0', maxHeight: 280 }}>
              {assetHealth.map(a => <AssetRow key={a.id} asset={a} />)}
            </div>
          )}
        </div>

        {/* Severity Donut - 1/3 width */}
        {sevDonut.length > 0 ? (
          <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col" style={{ border: '1px solid #C8E6D4' }}>
            <h2 className="text-[11px] font-black uppercase tracking-wider mb-3" style={{ color: '#6B9A87' }}>Severity Mix</h2>
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={sevDonut} cx="50%" cy="50%" innerRadius={32} outerRadius={55}
                    dataKey="value" paddingAngle={3}>
                    {sevDonut.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <RechartTooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-1.5">
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
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col items-center justify-center" style={{ border: '1px solid #C8E6D4' }}>
            <Activity size={24} style={{ color: '#C8E6D4' }} />
            <p className="text-[11px] mt-2" style={{ color: '#6B9A87' }}>No severity data</p>
          </div>
        )}
      </div>

      {/* 3 Asset image carousels */}
      {carouselAssets.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
              Most Affected Images
            </h2>
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: '#EDF6F0', color: '#6B9A87' }}>
              Top {carouselAssets.length} asset{carouselAssets.length !== 1 ? 's' : ''} by severity
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {carouselAssets.map(group => (
              <AssetCarouselCard key={group.asset_id || group.asset_name} group={group} />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm p-8 flex flex-col items-center gap-3"
          style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: MINT }}>
            <ImageIcon size={20} style={{ color: '#6B9A87' }} />
          </div>
          <p className="text-[12px] font-semibold" style={{ color: '#6B9A87' }}>No analyzed images yet</p>
          <Link href="/upload" className="text-[10px] font-bold" style={{ color: BRAND }}>Upload your first inspection →</Link>
        </div>
      )}

      {/* All Detections Table */}
      <DetectionsTable images={images} />

    </div>
  );
}

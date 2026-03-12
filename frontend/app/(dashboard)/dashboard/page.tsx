'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, environmentalApi } from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Building2, AlertTriangle, ImageIcon, ArrowRight,
  Wind, Waves, Train, Anchor, Shield, ChevronRight, ChevronLeft,
  Activity, TrendingUp, Thermometer, RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, Tooltip as RechartTooltip, ResponsiveContainer,
} from 'recharts';
import type { DashboardAnalyzedImage, DashboardAssetHealth, DashboardDetection } from '@/types';

const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

/* ── Damage-type color palette (matches inspections page) ── */
const DAMAGE_PALETTE = [
  { key: ['biological', 'algae', 'growth'], stroke: '#059669', light: '#D1FAE5' },
  { key: ['marine'],                         stroke: '#0891B2', light: '#CFFAFE' },
  { key: ['corrosion', 'rust', 'oxidat'],    stroke: '#EA580C', light: '#FFEDD5' },
  { key: ['crack', 'fracture', 'split'],     stroke: '#DC2626', light: '#FEE2E2' },
  { key: ['spall', 'delam', 'peel'],         stroke: '#7C3AED', light: '#EDE9FE' },
  { key: ['impact', 'dent', 'deform'],       stroke: '#2563EB', light: '#DBEAFE' },
];
const DAMAGE_DEFAULT = { stroke: '#64748B', light: '#F1F5F9' };

function getDamageColor(damageType: string) {
  const k = (damageType || '').toLowerCase();
  return DAMAGE_PALETTE.find(p => p.key.some(kw => k.includes(kw))) ?? DAMAGE_DEFAULT;
}

const SEV: Record<string, { color: string; bg: string; border: string; label: string }> = {
  S4: { color: '#B71C1C', bg: '#FEF2F2', border: '#FECACA', label: 'Severe'   },
  S3: { color: '#FF7043', bg: '#FFF3E0', border: '#FFCCBC', label: 'Advanced' },
  S2: { color: '#E6A817', bg: '#FFFBEB', border: '#FDE68A', label: 'Moderate' },
  S1: { color: '#4CAF50', bg: '#F0FDF4', border: '#BBF7D0', label: 'Minor'    },
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
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {sev} {s.label}
    </span>
  );
}

/* ── KPI card ── */
function KPICard({ label, value, sub, icon, accentColor }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; accentColor: string;
}) {
  return (
    <div className="interactive-card bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2 min-w-0"
      style={{ border: '1px solid #C8E6D4' }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider truncate" style={{ color: '#6B9A87' }}>{label}</p>
        <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: accentColor + '18', color: accentColor }}>
          {icon}
        </span>
      </div>
      <div className="text-[28px] font-black leading-none tracking-tight" style={{ color: TEAL }}>
        {value}
      </div>
      {sub && <p className="text-[11px] truncate" style={{ color: '#6B9A87' }}>{sub}</p>}
      <div className="h-0.5 rounded-full mt-auto" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44)` }} />
    </div>
  );
}

/* ── Wind direction helper ── */
function windDirLabel(deg: number | null | undefined): string {
  if (deg == null) return '';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/* ── Env metric pill (with green live dot) ── */
function EnvPill({ icon, label, value, unit, color }: {
  icon: React.ReactNode; label: string; value: number | null | undefined; unit: string; color: string;
}) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl"
      style={{ background: color + '0A', border: `1px solid ${color}20` }}>
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 relative"
        style={{ background: color + '15' }}>
        {icon}
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-[1.5px] ring-white" />
      </div>
      <div className="leading-none">
        <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: color }}>{label}</p>
        <p className="text-[14px] font-black leading-tight whitespace-nowrap" style={{ color: TEAL }}>
          {Number.isInteger(value) ? value : value.toFixed(1)}
          <span className="text-[10px] font-semibold ml-0.5" style={{ color: '#6B9A87' }}>{unit}</span>
        </p>
      </div>
    </div>
  );
}

/* ── Asset health row (with live env data) ── */
function AssetRow({ asset, env }: { asset: DashboardAssetHealth; env?: any }) {
  const Icon = INFRA_ICON[asset.infrastructure_type] || Building2;
  const typeColor = INFRA_COLOR[asset.infrastructure_type] || '#64748B';
  return (
    <Link href={`/assets/${asset.id}`}
      className="interactive-row flex items-center gap-3 px-5 py-3.5 group"
      style={{ borderBottom: '1px solid #EDF6F0' }}>
      {/* Icon */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: typeColor + '15', border: `1px solid ${typeColor}30` }}>
        <Icon size={16} style={{ color: typeColor }} />
      </div>
      {/* Name + meta — takes up left half */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate group-hover:text-[#0891B2] transition-colors" style={{ color: TEAL }}>
          {asset.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px]" style={{ color: '#6B9A87' }}>
            {INFRA_LABEL[asset.infrastructure_type] || asset.infrastructure_type}
          </span>
          {asset.total_detections > 0 ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: '#FEF2F2', color: '#EF4444', border: '1px solid #FECACA' }}>
              {asset.total_detections} det.
            </span>
          ) : (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0"
              style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
              <Shield size={9} /> Clean
            </span>
          )}
          <SevBadge sev={asset.worst_severity} />
        </div>
      </div>
      {/* Env metrics — right half */}
      {env ? (
        <div className="flex items-center gap-2 flex-shrink-0 mr-1">
          <EnvPill icon={<Waves size={14} style={{ color: '#0891B2' }} />}
            label="Sea Level" value={env.wave_height} unit="m" color="#0891B2" />
          <EnvPill icon={<Activity size={14} style={{ color: '#6366F1' }} />}
            label="Tidal" value={env.wave_period} unit="s" color="#6366F1" />
          <EnvPill icon={<Thermometer size={14} style={{ color: '#EF4444' }} />}
            label="Temp" value={env.temperature} unit="°F" color="#EF4444" />
          <EnvPill icon={<Wind size={14} style={{ color: '#0EA5E9' }} />}
            label="Wind" value={env.wind_speed}
            unit={env.wind_direction != null ? `${windDirLabel(env.wind_direction)}` : 'mph'}
            color="#0EA5E9" />
        </div>
      ) : (
        <ArrowRight size={14} style={{ color: '#C8E6D4' }}
          className="flex-shrink-0 group-hover:text-[#0891B2] group-hover:translate-x-0.5 transition-all" />
      )}
    </Link>
  );
}

/* ── Image with SVG bounding-box overlay (matches inspections page colors) ── */
function BboxOverlayImage({ img }: { img: DashboardAnalyzedImage }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const dets = img.detections || [];

  return (
    <>
      <img
        src={img.url}
        alt={img.filename}
        className="w-full h-full object-cover"
        style={{ transition: 'opacity 0.2s ease' }}
        onLoad={e => {
          const el = e.currentTarget;
          setDims({ w: el.naturalWidth, h: el.naturalHeight });
        }}
        onError={e => {
          (e.target as HTMLImageElement).src =
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23EDF6F0"/><text x="50" y="55" text-anchor="middle" font-size="28" fill="%236B9A87">📷</text></svg>';
        }}
      />
      {dims && dets.length > 0 && (() => {
        const visible = dets.filter((d: any) => d.confidence >= 0.20);
        const scale = dims.w / 700;
        const strokeW = Math.max(2, 2.5 * scale);

        // Compute label rects, then nudge overlaps
        const labelH = Math.round(22 * scale);
        const labelPad = Math.round(6 * scale);
        const labels = visible.map((d: any) => {
          const { x1, y1, x2, y2 } = d.bbox;
          const conf = d.confidence;
          const sev = d.severity || '';
          const mainLabel = sev ? `${sev} ${d.damage_type}` : d.damage_type;
          const mainFontSize = Math.round(13 * scale);
          const mainCharW = mainFontSize * 0.58;
          const labelW = mainLabel.length * mainCharW + labelPad * 2;
          let labelY = y1 >= labelH + 3 * scale ? y1 - labelH - 2 * scale : y2 + 2 * scale;
          const labelX = Math.max(0, Math.min(x1, dims.w - labelW - 2));
          return { d, mainLabel, mainFontSize, mainCharW, labelW, labelH, labelX, labelY };
        });
        // Nudge overlapping labels
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const a = labels[i], b = labels[j];
            if (Math.abs(a.labelY - b.labelY) < labelH * 0.85 &&
                a.labelX < b.labelX + b.labelW && b.labelX < a.labelX + a.labelW) {
              b.labelY = a.labelY + labelH + 2 * scale;
              if (b.labelY > dims.h - labelH) b.labelY = a.labelY - labelH - 2 * scale;
            }
          }
        }

        return (
          <svg
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {labels.map((l, i) => {
              const { d, mainLabel, mainFontSize, labelW, labelH: lH, labelX, labelY } = l;
              const cfg = getDamageColor(d.damage_type);
              const { x1, y1, x2, y2 } = d.bbox;
              const bw = x2 - x1;
              const bh = y2 - y1;
              const conf = d.confidence;
              // >50% = bold & visible, <50% = faint
              const hi = conf >= 0.5;
              const fillOp = hi ? 0.12 : 0.04;
              const strokeOp = hi ? 0.9 : 0.3;
              const cornerOp = hi ? 0.95 : 0.35;
              const labelBgOp = hi ? 0.85 : 0.45;

              return (
                <g key={i}>
                  <rect x={x1} y={y1} width={bw} height={bh}
                    fill={cfg.stroke} fillOpacity={fillOp} rx={2 * scale} />
                  <rect x={x1} y={y1} width={bw} height={bh}
                    fill="none" stroke={cfg.stroke} strokeWidth={strokeW}
                    strokeOpacity={strokeOp} rx={2 * scale} />
                  <line x1={x1} y1={y1 + bh * 0.12} x2={x1} y2={y1} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <line x1={x1} y1={y1} x2={x1 + bw * 0.12} y2={y1} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <line x1={x2} y1={y2 - bh * 0.12} x2={x2} y2={y2} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <line x1={x2} y1={y2} x2={x2 - bw * 0.12} y2={y2} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <rect x={labelX + 1} y={labelY + 1} width={labelW} height={lH}
                    fill="rgba(0,0,0,0.25)" rx={4 * scale} />
                  <rect x={labelX} y={labelY} width={labelW} height={lH}
                    fill={cfg.stroke} fillOpacity={labelBgOp} rx={4 * scale} />
                  <text x={labelX + labelPad} y={labelY + lH * 0.72}
                    fontSize={mainFontSize} fill="white"
                    fontFamily="system-ui,-apple-system,sans-serif"
                    fontWeight="700" letterSpacing="0.2">
                    {mainLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        );
      })()}
    </>
  );
}

/* ── Per-asset carousel card ── */
function AssetCarouselCard({
  group,
}: {
  group: { asset_id: string; asset_name: string; images: DashboardAnalyzedImage[] };
}) {
  const [idx, setIdx] = useState(0);
  const imgs = group.images.slice(0, 10); // max 10 per asset
  const img = imgs[idx];

  const totalDetections = imgs.reduce((sum, i) => sum + i.detection_count, 0);
  const worstSev = imgs.find(i => i.max_severity)?.max_severity ?? null;
  const borderAccent = worstSev === 'S3' ? '#EF4444' : worstSev === 'S2' ? '#F59E0B' : worstSev === 'S1' ? '#EAB308' : '#C8E6D4';

  const prev = () => setIdx(i => Math.max(0, i - 1));
  const next = () => setIdx(i => Math.min(imgs.length - 1, i + 1));

  if (!img) {
    return (
      <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col min-w-0"
        style={{ border: '1px solid #C8E6D4', minWidth: 280 }}>
        <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{ background: MINT, borderBottom: '1px solid #C8E6D4' }}>
          <p className="text-[12px] font-black truncate" style={{ color: TEAL }}>{group.asset_name}</p>
          {group.asset_id && (
            <Link href={`/assets/${group.asset_id}`}
              className="flex items-center gap-0.5 text-[10px] font-bold ml-2 flex-shrink-0 hover:opacity-70"
              style={{ color: BRAND }}>
              View <ChevronRight size={11} />
            </Link>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2" style={{ aspectRatio: '4/3' }}>
          <ImageIcon size={30} style={{ color: '#C8E6D4' }} />
          <p className="text-[12px] font-medium" style={{ color: '#6B9A87' }}>No images analyzed yet</p>
          <Link href="/upload" className="text-[11px] font-bold" style={{ color: BRAND }}>Upload images →</Link>
        </div>
      </div>
    );
  }

  const sev = img.max_severity ? SEV[img.max_severity] : null;

  return (
    <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col min-w-0"
      style={{ border: `1px solid ${borderAccent}`, minWidth: 280 }}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ background: MINT, borderBottom: '1px solid #C8E6D4' }}>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black truncate" style={{ color: TEAL }}>{group.asset_name}</p>
          <p className="text-[10px] mt-0.5" style={{ color: '#6B9A87' }}>
            {imgs.length} image{imgs.length !== 1 ? 's' : ''}&nbsp;·&nbsp;
            <span style={{ color: totalDetections > 0 ? '#EF4444' : '#10B981', fontWeight: 700 }}>
              {totalDetections} detection{totalDetections !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        {group.asset_id && (
          <Link href={`/assets/${group.asset_id}`}
            className="flex items-center gap-0.5 text-[10px] font-bold ml-2 flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ color: BRAND }}>
            View <ChevronRight size={11} />
          </Link>
        )}
      </div>

      {/* Image carousel */}
      <div className="relative bg-slate-100 overflow-hidden flex-shrink-0" style={{ aspectRatio: '4/3' }}>
        <BboxOverlayImage img={img} />

        {/* Detection badge */}
        {img.detection_count > 0 ? (
          <div className="absolute top-2 right-2 flex items-center gap-1 text-white text-[11px] font-black px-2 py-0.5 rounded-full shadow-md"
            style={{ background: sev?.color || '#EF4444' }}>
            <AlertTriangle size={11} /> {img.detection_count}
          </div>
        ) : (
          <div className="absolute top-2 right-2 text-[11px] font-black px-2 py-0.5 rounded-full shadow-md"
            style={{ background: '#10B981', color: 'white' }}>
            Clean
          </div>
        )}

        {/* Carousel controls */}
        {imgs.length > 1 && (
          <>
            <button onClick={prev} disabled={idx === 0}
              className="carousel-arrow absolute left-1.5 top-1/2 -translate-y-1/2"
              style={{ opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? 'default' : 'pointer' }}>
              <ChevronLeft size={14} style={{ color: TEAL }} />
            </button>
            <button onClick={next} disabled={idx === imgs.length - 1}
              className="carousel-arrow absolute right-1.5 top-1/2 -translate-y-1/2"
              style={{ opacity: idx === imgs.length - 1 ? 0.3 : 1, cursor: idx === imgs.length - 1 ? 'default' : 'pointer' }}>
              <ChevronRight size={14} style={{ color: TEAL }} />
            </button>
          </>
        )}

        {/* Progress bar instead of dots for 10 images */}
        {imgs.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <div className="h-full transition-all duration-300 ease-out"
              style={{
                width: `${((idx + 1) / imgs.length) * 100}%`,
                background: sev?.color || BRAND,
              }} />
          </div>
        )}

        {/* Counter */}
        <div className="absolute bottom-2 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(8,46,41,0.7)', color: 'white' }}>
          {idx + 1}/{imgs.length}
        </div>
      </div>

      {/* Image info */}
      <div className="px-3 py-2.5 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SevBadge sev={img.max_severity} />
          {!img.max_severity && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
              <Shield size={8} /> Clean
            </span>
          )}
          {img.detection_count > 0 && (
            <span className="text-[10px] font-semibold" style={{ color: '#6B9A87' }}>
              {img.detection_count} det.
            </span>
          )}
        </div>
        {/* Damage type breakdown */}
        {img.damage_types && img.damage_types.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {img.damage_types.map((dt) => (
              <span key={dt.damage_type}
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
                {dt.damage_type} ({dt.count})
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] font-medium truncate" style={{ color: '#6B9A87' }}>{img.inspection_name}</p>
        <p className="text-[10px] truncate font-mono" style={{ color: '#9AB8AD' }}>{img.filename}</p>
      </div>
    </div>
  );
}

/* ── Scrollable carousel row ── */
function CarouselRow({ groups }: { groups: { asset_id: string; asset_name: string; images: DashboardAnalyzedImage[] }[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  };

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -340 : 340, behavior: 'smooth' });
  };

  // Check on mount + resize
  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showArrows = groups.length > 3;

  return (
    <div className="relative">
      {/* Left scroll arrow */}
      {showArrows && canScrollLeft && (
        <button onClick={() => scroll('left')}
          className="carousel-scroll-btn absolute -left-1 top-1/2 -translate-y-1/2 z-10">
          <ChevronLeft size={18} />
        </button>
      )}

      <div ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 carousel-scroll"
        style={{ scrollSnapType: 'x mandatory' }}>
        {groups.map(group => (
          <div key={group.asset_id || group.asset_name}
            className="flex-shrink-0"
            style={{ width: groups.length <= 3 ? `calc(${100 / Math.min(groups.length, 3)}% - ${((Math.min(groups.length, 3) - 1) * 16) / Math.min(groups.length, 3)}px)` : 340, scrollSnapAlign: 'start' }}>
            <AssetCarouselCard group={group} />
          </div>
        ))}
      </div>

      {/* Right scroll arrow */}
      {showArrows && canScrollRight && (
        <button onClick={() => scroll('right')}
          className="carousel-scroll-btn absolute -right-1 top-1/2 -translate-y-1/2 z-10">
          <ChevronRight size={18} />
        </button>
      )}
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

  const queryClient = useQueryClient();
  const { data: envData, isFetching: envFetching } = useQuery({
    queryKey: ['environmental'],
    queryFn: environmentalApi.getAssetData,
    refetchInterval: 300_000,
    staleTime: 240_000,
  });
  const envAssets = envData?.assets || {};

  const images = data?.recent_analyzed_images || [];
  const assetHealth = data?.asset_health || [];

  // Build carousel groups: include ALL assets from asset_health,
  // merge with images grouped by asset. Sort images high→low severity, limit 10.
  const carouselGroups = useMemo(() => {
    const imgGroups: Record<string, DashboardAnalyzedImage[]> = {};
    for (const img of images) {
      const key = img.asset_id || img.asset_name;
      if (!imgGroups[key]) imgGroups[key] = [];
      imgGroups[key].push(img);
    }

    const sevRank: Record<string, number> = { S3: 0, S2: 1, S1: 2, S0: 3 };

    // Build from assetHealth so ALL assets appear
    const groups = assetHealth.map(a => {
      const assetImages = (imgGroups[a.id] || [])
        .sort((x, y) =>
          (sevRank[x.max_severity || ''] ?? 4) - (sevRank[y.max_severity || ''] ?? 4) ||
          y.detection_count - x.detection_count
        )
        .slice(0, 10);
      return { asset_id: a.id, asset_name: a.name, images: assetImages };
    });

    // Also add any image groups for assets not in assetHealth
    const healthIds = new Set(assetHealth.map(a => a.id));
    for (const [key, imgs] of Object.entries(imgGroups)) {
      if (!healthIds.has(key)) {
        const sorted = [...imgs]
          .sort((x, y) =>
            (sevRank[x.max_severity || ''] ?? 4) - (sevRank[y.max_severity || ''] ?? 4) ||
            y.detection_count - x.detection_count
          )
          .slice(0, 10);
        groups.push({ asset_id: key, asset_name: sorted[0]?.asset_name || key, images: sorted });
      }
    }

    // Sort groups: most critical first
    return groups.sort((a, b) => {
      const wa = sevRank[a.images[0]?.max_severity || ''] ?? 4;
      const wb = sevRank[b.images[0]?.max_severity || ''] ?? 4;
      return wa - wb;
    });
  }, [images, assetHealth]);

  if (isLoading) return <DashboardSkeleton />;

  const sevBreakdown = data?.severity_breakdown || {};

  // Normalize old S0 → S1, old numeric 1→S1 etc, then merge counts
  const SEV_NORM: Record<string,string> = { S0:'S1', '1':'S1', '2':'S2', '3':'S3', '4':'S4', S1:'S1', S2:'S2', S3:'S3', S4:'S4' };
  const mergedSev: Record<string,number> = {};
  Object.entries(sevBreakdown).forEach(([k, v]) => {
    const nk = SEV_NORM[k] || k;
    mergedSev[nk] = (mergedSev[nk] || 0) + (v as number);
  });
  const sevDonut = Object.entries(mergedSev).map(([k, v]) => ({
    name: `${k} ${SEV[k]?.label || ''}`.trim(), value: v, color: SEV[k]?.color || '#64748B',
  })).sort((a, b) => b.value - a.value);

  const tooltipStyle = {
    contentStyle: { background: '#FFFFFF', border: '1px solid #C8E6D4', borderRadius: 10, fontSize: 12 },
    labelStyle: { color: TEAL, fontWeight: 700 },
    itemStyle: { color: TEAL },
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: TEAL }}>Dashboard</h1>
          <p className="text-sm sm:text-base text-slate-500 mt-1">Platform overview and recent activity</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="interactive-chip flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold px-2.5 sm:px-3 py-1.5 rounded-full"
            style={{ background: MINT, color: '#6B9A87', border: '1px solid #C8E6D4' }}>
            <Activity size={13} style={{ color: BRAND }} />
            <span>{data?.total_inspections ?? 0} inspections</span>
          </div>
          <div className="interactive-chip hidden sm:flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: MINT, color: '#6B9A87', border: '1px solid #C8E6D4' }}>
            <TrendingUp size={13} style={{ color: '#10B981' }} />
            <span>{data?.fleet_health_pct ?? 0}% asset health</span>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KPICard label="Active Assets" value={data?.active_assets ?? 0}
          sub={`${data?.total_assets ?? 0} total`} icon={<Building2 size={17} />} accentColor={BRAND} />
        <KPICard label="Total Detections" value={data?.total_detections ?? 0}
          sub={`across ${data?.total_inspections ?? 0} inspections`} icon={<AlertTriangle size={17} />} accentColor="#EF4444" />
        <KPICard label="Images Analyzed" value={data?.total_images ?? 0}
          sub={`${data?.pending_inspections ?? 0} pending`} icon={<ImageIcon size={17} />} accentColor={BLUE} />
      </div>

      {/* Two-column: Asset Health + Severity Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ border: '1px solid #C8E6D4' }}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #EDF6F0' }}>
            <div className="flex items-center gap-2">
              <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>Asset Health</h2>
              {Object.keys(envAssets).length > 0 && (
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
            <div className="flex items-center gap-2">
              {Object.keys(envAssets).length > 0 && (
                <button
                  onClick={(e) => { e.preventDefault(); queryClient.invalidateQueries({ queryKey: ['environmental'] }); }}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all hover:scale-105"
                  style={{ background: '#EDF6F0', color: '#6B9A87', border: '1px solid #C8E6D4' }}
                  title="Refresh live conditions">
                  <RefreshCw size={10} className={envFetching ? 'animate-spin' : ''} />
                  Live 5m
                </button>
              )}
              <Link href="/assets" className="interactive-link text-[11px] font-bold flex items-center gap-1"
                style={{ color: BRAND }}>
                View all <ArrowRight size={10} />
              </Link>
            </div>
          </div>
          {assetHealth.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 flex-1">
              <Building2 size={26} style={{ color: '#C8E6D4' }} />
              <p className="text-[13px]" style={{ color: '#6B9A87' }}>No assets yet</p>
              <Link href="/assets" className="text-[11px] font-bold" style={{ color: BRAND }}>Create one →</Link>
            </div>
          ) : (
            <div>
              {assetHealth.map(a => <AssetRow key={a.id} asset={a} env={envAssets[a.id]} />)}
            </div>
          )}
        </div>

        {sevDonut.length > 0 ? (
          <div className="interactive-card bg-white rounded-2xl p-4 shadow-sm flex flex-col" style={{ border: '1px solid #C8E6D4' }}>
            <h2 className="text-[12px] font-black uppercase tracking-wider mb-3" style={{ color: '#6B9A87' }}>Severity Mix</h2>
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={sevDonut} cx="50%" cy="50%" innerRadius={30} outerRadius={50}
                    dataKey="value" paddingAngle={3}>
                    {sevDonut.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <RechartTooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-1.5">
                {sevDonut.map((d, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[12px]" style={{ color: '#6B9A87' }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="text-[13px] font-black font-mono" style={{ color: TEAL }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="interactive-card bg-white rounded-2xl p-4 shadow-sm flex flex-col items-center justify-center" style={{ border: '1px solid #C8E6D4' }}>
            <Activity size={26} style={{ color: '#C8E6D4' }} />
            <p className="text-[12px] mt-2" style={{ color: '#6B9A87' }}>No severity data</p>
          </div>
        )}
      </div>

      {/* Asset image carousels - ALL assets */}
      {carouselGroups.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
              Most Affected Images
            </h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: '#EDF6F0', color: '#6B9A87' }}>
              {carouselGroups.length} asset{carouselGroups.length !== 1 ? 's' : ''} · up to 10 images each
            </span>
          </div>
          <CarouselRow groups={carouselGroups} />
        </div>
      ) : (
        <div className="interactive-card bg-white rounded-2xl shadow-sm p-8 flex flex-col items-center gap-3"
          style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: MINT }}>
            <ImageIcon size={22} style={{ color: '#6B9A87' }} />
          </div>
          <p className="text-[13px] font-semibold" style={{ color: '#6B9A87' }}>No analyzed images yet</p>
          <Link href="/upload" className="text-[11px] font-bold" style={{ color: BRAND }}>Upload your first inspection →</Link>
        </div>
      )}

      {/* Bottom spacer */}
      <div className="h-4" />
    </div>
  );
}

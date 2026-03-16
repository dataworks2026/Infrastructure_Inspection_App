'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, sensorsApi } from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Building2, AlertTriangle, ImageIcon, ArrowRight,
  Wind, Waves, Anchor, Shield, ChevronRight, ChevronLeft,
  Activity, Thermometer, RefreshCw, Map, FileText, Lock,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DashboardAnalyzedImage, DashboardAssetHealth } from '@/types';

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

function getSeverityColor(severity: string | null | undefined): string {
  const s = normSev(severity);
  return SEV[s || '']?.color || '#64748B';
}

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
      {/* Wider proportional stacked bar */}
      <div className="hidden lg:flex h-2 rounded-full overflow-hidden" style={{ width: 80, background: '#EDF6F0' }}>
        {total > 0 && items.map(k => {
          const pct = ((counts[k] || 0) / total) * 100;
          return pct > 0 ? (
            <div key={k} style={{ width: `${pct}%`, background: SEV[k].color, minWidth: 3 }} />
          ) : null;
        })}
      </div>
      {/* Chips */}
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

/* ── Asset health row (no sensors, severity on right) ── */
function AssetRow({ asset, sevCounts }: { asset: DashboardAssetHealth; sevCounts?: Record<string, number> }) {
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
      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate group-hover:text-[#0891B2] transition-colors" style={{ color: TEAL }}>
          {asset.name}
        </p>
        <span className="text-[11px]" style={{ color: '#6B9A87' }}>
          {INFRA_LABEL[asset.infrastructure_type] || asset.infrastructure_type}
        </span>
      </div>
      {/* Severity chips on right */}
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

/* ── Env metric pill (with green live dot) ── */
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

/* ── Image with SVG bounding-box overlay ── */
function BboxOverlayImage({ img }: { img: DashboardAnalyzedImage }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const dets = img.detections || [];

  return (
    <>
      <img
        src={img.url}
        alt={img.filename}
        className="w-full h-full object-cover"
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
        const labelH = Math.round(22 * scale);
        const labelPad = Math.round(6 * scale);
        const labels = visible.map((d: any) => {
          const { x1, y1, x2, y2 } = d.bbox;
          const sev = normSev(d.severity) || '';
          const mainLabel = sev ? `${sev} ${d.damage_type}` : d.damage_type;
          const mainFontSize = Math.round(13 * scale);
          const mainCharW = mainFontSize * 0.58;
          const labelW = mainLabel.length * mainCharW + labelPad * 2;
          let labelY = y1 >= labelH + 3 * scale ? y1 - labelH - 2 * scale : y2 + 2 * scale;
          const labelX = Math.max(0, Math.min(x1, dims.w - labelW - 2));
          return { d, mainLabel, mainFontSize, labelW, labelH, labelX, labelY };
        });
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
          <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 w-full h-full pointer-events-none">
            {labels.map((l, i) => {
              const { d, mainLabel, mainFontSize, labelW, labelH: lH, labelX, labelY } = l;
              const sevColor = getSeverityColor(d.severity);
              const { x1, y1, x2, y2 } = d.bbox;
              const bw = x2 - x1, bh = y2 - y1;
              const hi = d.confidence >= 0.5;
              const fillOp = hi ? 0.12 : 0.04;
              const strokeOp = hi ? 0.9 : 0.3;
              const cornerOp = hi ? 0.95 : 0.35;
              const labelBgOp = hi ? 0.85 : 0.45;

              return (
                <g key={i}>
                  <rect x={x1} y={y1} width={bw} height={bh}
                    fill={sevColor} fillOpacity={fillOp} rx={2 * scale} />
                  <rect x={x1} y={y1} width={bw} height={bh}
                    fill="none" stroke={sevColor} strokeWidth={strokeW}
                    strokeOpacity={strokeOp} rx={2 * scale} />
                  <line x1={x1} y1={y1 + bh * 0.12} x2={x1} y2={y1} stroke={sevColor} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <line x1={x1} y1={y1} x2={x1 + bw * 0.12} y2={y1} stroke={sevColor} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <line x1={x2} y1={y2 - bh * 0.12} x2={x2} y2={y2} stroke={sevColor} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <line x1={x2} y1={y2} x2={x2 - bw * 0.12} y2={y2} stroke={sevColor} strokeWidth={strokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                  <rect x={labelX + 1} y={labelY + 1} width={labelW} height={lH}
                    fill="rgba(0,0,0,0.25)" rx={4 * scale} />
                  <rect x={labelX} y={labelY} width={labelW} height={lH}
                    fill={sevColor} fillOpacity={labelBgOp} rx={4 * scale} />
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

/* ── Per-asset carousel card (clickable to inspections) ── */
function AssetCarouselCard({
  group,
}: {
  group: { asset_id: string; asset_name: string; images: DashboardAnalyzedImage[] };
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const imgs = group.images.slice(0, 10);
  const img = imgs[idx];

  const totalDetections = imgs.reduce((sum, i) => sum + i.detection_count, 0);
  const worstSev = imgs.find(i => i.max_severity)?.max_severity ?? null;
  const borderAccent = worstSev === 'S4' ? '#B71C1C' : worstSev === 'S3' ? '#EF4444' : worstSev === 'S2' ? '#F59E0B' : worstSev === 'S1' ? '#EAB308' : '#C8E6D4';

  const prev = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); };
  const next = (e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => Math.min(imgs.length - 1, i + 1)); };

  // Navigate to inspection detail page when image/card is clicked
  const goToInspection = () => {
    if (img?.inspection_id) router.push(`/inspections/${img.inspection_id}`);
    else router.push('/inspections');
  };

  if (!img) {
    return (
      <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col min-w-0"
        style={{ border: '1px solid #C8E6D4', minWidth: 280 }}>
        <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{ background: MINT, borderBottom: '1px solid #C8E6D4' }}>
          <p className="text-[12px] font-black truncate" style={{ color: TEAL }}>{group.asset_name}</p>
          <Link href="/inspections" className="flex items-center gap-0.5 text-[10px] font-bold ml-2 flex-shrink-0 hover:opacity-70"
            style={{ color: BRAND }}>
            View <ChevronRight size={11} />
          </Link>
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
    <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col min-w-0 cursor-pointer group/card"
      style={{ border: `1px solid ${borderAccent}`, minWidth: 280 }}
      onClick={goToInspection}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ background: MINT, borderBottom: '1px solid #C8E6D4' }}>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black truncate group-hover/card:text-[#0891B2] transition-colors" style={{ color: TEAL }}>{group.asset_name}</p>
          <p className="text-[10px] mt-0.5" style={{ color: '#6B9A87' }}>
            {imgs.length} image{imgs.length !== 1 ? 's' : ''}&nbsp;·&nbsp;
            <span style={{ color: totalDetections > 0 ? '#EF4444' : '#10B981', fontWeight: 700 }}>
              {totalDetections} detection{totalDetections !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        <span className="flex items-center gap-0.5 text-[10px] font-bold ml-2 flex-shrink-0 group-hover/card:opacity-70 transition-opacity"
          style={{ color: BRAND }}>
          Open <ChevronRight size={11} />
        </span>
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

        {/* Progress bar */}
        {imgs.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <div className="h-full transition-all duration-300 ease-out"
              style={{ width: `${((idx + 1) / imgs.length) * 100}%`, background: sev?.color || BRAND }} />
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
          {img.max_severity && (() => {
            const norm = normSev(img.max_severity);
            const s = norm ? SEV[norm] : null;
            if (!s || !norm) return null;
            return (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                {norm} {s.label}
              </span>
            );
          })()}
          {!img.max_severity && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
              <Shield size={8} /> Clean
            </span>
          )}
        </div>
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
      {showArrows && canScrollRight && (
        <button onClick={() => scroll('right')}
          className="carousel-scroll-btn absolute -right-1 top-1/2 -translate-y-1/2 z-10">
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════ */
export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.overview,
    refetchInterval: 120_000,
  });

  const queryClient = useQueryClient();
  const { data: envData, isFetching: envFetching } = useQuery({
    queryKey: ['sensors-live'],
    queryFn: sensorsApi.getLive,
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  // Pick first available sensor env (Gov Island)
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

  // Per-asset severity counts
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

  // Build carousel groups
  const carouselGroups = useMemo(() => {
    const imgGroups: Record<string, DashboardAnalyzedImage[]> = {};
    for (const img of images) {
      const key = img.asset_id || img.asset_name;
      if (!imgGroups[key]) imgGroups[key] = [];
      imgGroups[key].push(img);
    }
    const sevRank: Record<string, number> = { S4: 0, S3: 1, S2: 2, S1: 3 };
    const groups = assetHealth.map(a => {
      const assetImages = (imgGroups[a.id] || [])
        .sort((x, y) =>
          (sevRank[x.max_severity || ''] ?? 4) - (sevRank[y.max_severity || ''] ?? 4) ||
          y.detection_count - x.detection_count
        )
        .slice(0, 10);
      return { asset_id: a.id, asset_name: a.name, images: assetImages };
    });
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
    return groups.sort((a, b) => {
      const wa = sevRank[a.images[0]?.max_severity || ''] ?? 4;
      const wb = sevRank[b.images[0]?.max_severity || ''] ?? 4;
      return wa - wb;
    });
  }, [images, assetHealth]);

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

        {/* Reports — Soon */}
        <div className="interactive-card bg-white rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 opacity-60"
          style={{ border: '1px solid #E2EDE8' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#6B9A8712' }}>
            <FileText size={20} style={{ color: '#6B9A87' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-black leading-tight" style={{ color: TEAL }}>Reports</p>
            <p className="text-[11px] font-semibold" style={{ color: '#6B9A87' }}>Generate reports</p>
          </div>
          <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex-shrink-0 uppercase tracking-wider"
            style={{ background: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A' }}>
            <Lock size={8} className="inline mr-0.5 -mt-[1px]" />
            Soon
          </span>
        </div>
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

        {/* Sensors Card — single Gov Island location */}
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
      </div>

      {/* ── Most Affected Images ── */}
      {carouselGroups.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
              Most Affected Images
            </h2>
            <Link href="/inspections" className="interactive-link text-[11px] font-bold flex items-center gap-1"
              style={{ color: BRAND }}>
              All Inspections <ArrowRight size={10} />
            </Link>
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

      <div className="h-2" />
    </div>
  );
}

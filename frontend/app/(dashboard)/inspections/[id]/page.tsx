'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inspectionsApi, imagesApi, assetsApi, analysisApi } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, ImageIcon, Loader, CheckCircle, AlertCircle, Scan, Shield, X, ChevronLeft, ChevronRight, ZoomIn, Eye, AlertTriangle, BarChart3, Trash2, Pencil, Check } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

// ─── Severity ───────────────────────────────────────────────────────────────
const severityConfig: Record<string, { label: string; color: string; bg: string }> = {
  S0: { label: 'None',     color: 'text-emerald-700', bg: 'bg-emerald-50'  },
  S1: { label: 'Minor',    color: 'text-lime-700',    bg: 'bg-lime-50'     },
  S2: { label: 'Moderate', color: 'text-amber-700',   bg: 'bg-amber-50'    },
  S3: { label: 'Severe',   color: 'text-red-700',     bg: 'bg-red-50'      },
  S4: { label: 'Critical', color: 'text-purple-700',  bg: 'bg-purple-50'   },
};

function SeverityBadge({ severity, size = 'sm' }: { severity: string; size?: 'sm' | 'lg' }) {
  const config = severityConfig[severity] || severityConfig.S1;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${config.bg} ${config.color} ${
      size === 'lg' ? 'text-sm px-3 py-1' : 'text-xs'
    }`}>
      {severity} <span className="font-normal opacity-75">{config.label}</span>
    </span>
  );
}

// ─── Damage-type color palette ───────────────────────────────────────────────
const DAMAGE_PALETTE = [
  { key: ['biological', 'algae', 'growth'],       stroke: '#059669', light: '#D1FAE5', tw: { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-l-emerald-500', dot: 'bg-emerald-500' } },
  { key: ['marine'],                               stroke: '#0891B2', light: '#CFFAFE', tw: { bg: 'bg-cyan-50',    text: 'text-cyan-800',    border: 'border-l-cyan-500',    dot: 'bg-cyan-500'    } },
  { key: ['corrosion', 'rust', 'oxidat'],          stroke: '#EA580C', light: '#FFEDD5', tw: { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-l-orange-500', dot: 'bg-orange-500' } },
  { key: ['crack', 'fracture', 'split'],           stroke: '#DC2626', light: '#FEE2E2', tw: { bg: 'bg-red-50',    text: 'text-red-800',    border: 'border-l-red-500',    dot: 'bg-red-500'    } },
  { key: ['spall', 'delam', 'peel'],               stroke: '#7C3AED', light: '#EDE9FE', tw: { bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-l-violet-500', dot: 'bg-violet-500' } },
  { key: ['impact', 'dent', 'deform'],             stroke: '#2563EB', light: '#DBEAFE', tw: { bg: 'bg-blue-50',   text: 'text-blue-800',   border: 'border-l-blue-500',   dot: 'bg-blue-500'   } },
];
const DAMAGE_DEFAULT = { stroke: '#64748B', light: '#F1F5F9', tw: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-l-slate-400', dot: 'bg-slate-400' } };

function getDamageConfig(damageType: string) {
  const key = (damageType || '').toLowerCase();
  return DAMAGE_PALETTE.find(p => p.key.some(k => key.includes(k))) ?? DAMAGE_DEFAULT;
}

// ─── Custom SVG Annotated Overlay ────────────────────────────────────────────
function AnnotatedOverlay({ imageUrl, detections, onClick }: {
  imageUrl: string;
  detections: any[];
  onClick?: () => void;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  return (
    <div className="relative w-full cursor-pointer group" onClick={onClick}>
      <img
        src={imageUrl}
        alt="AI Analysis"
        className="w-full rounded-lg border border-slate-200 block"
        onLoad={(e) => {
          const img = e.currentTarget;
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {dims && detections.length > 0 && (
        <svg
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full rounded-lg pointer-events-none"
        >
          {detections.map((d, i) => {
            const cfg = getDamageConfig(d.damage_type);
            const { x1, y1, x2, y2 } = d.bbox;
            const bw = x2 - x1;
            const bh = y2 - y1;
            const scale = dims.w / 700;
            const fontSize = Math.round(13 * scale);
            const strokeW = Math.max(2, 2.5 * scale);
            const labelH = Math.round(22 * scale);
            const labelPad = Math.round(6 * scale);
            const shortLabel = `${d.damage_type} ${(d.confidence * 100).toFixed(0)}%`;
            const charW = fontSize * 0.58;
            const labelW = shortLabel.length * charW + labelPad * 2;
            const labelY = y1 >= labelH + 3 * scale ? y1 - labelH - 2 * scale : y2 + 2 * scale;
            const labelX = Math.max(0, Math.min(x1, dims.w - labelW - 2));

            return (
              <g key={i}>
                {/* Box fill tint */}
                <rect x={x1} y={y1} width={bw} height={bh}
                  fill={cfg.stroke} fillOpacity="0.07" rx={2 * scale} />
                {/* Box stroke */}
                <rect x={x1} y={y1} width={bw} height={bh}
                  fill="none" stroke={cfg.stroke} strokeWidth={strokeW}
                  strokeOpacity="0.95" rx={2 * scale} />
                {/* Corner accents — top-left */}
                <line x1={x1} y1={y1 + bh * 0.12} x2={x1} y2={y1} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity="1" strokeLinecap="round" />
                <line x1={x1} y1={y1} x2={x1 + bw * 0.12} y2={y1} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity="1" strokeLinecap="round" />
                {/* Corner accents — bottom-right */}
                <line x1={x2} y1={y2 - bh * 0.12} x2={x2} y2={y2} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity="1" strokeLinecap="round" />
                <line x1={x2} y1={y2} x2={x2 - bw * 0.12} y2={y2} stroke={cfg.stroke} strokeWidth={strokeW * 2} strokeOpacity="1" strokeLinecap="round" />
                {/* Label shadow */}
                <rect x={labelX + 1} y={labelY + 1} width={labelW} height={labelH}
                  fill="rgba(0,0,0,0.25)" rx={4 * scale} />
                {/* Label background */}
                <rect x={labelX} y={labelY} width={labelW} height={labelH}
                  fill={cfg.stroke} fillOpacity="0.95" rx={4 * scale} />
                {/* Label text */}
                <text
                  x={labelX + labelPad}
                  y={labelY + labelH * 0.72}
                  fontSize={fontSize}
                  fill="white"
                  fontFamily="system-ui,-apple-system,sans-serif"
                  fontWeight="700"
                  letterSpacing="0.2"
                >
                  {shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
function Lightbox({ images, initialIndex, onClose, analysisResults }: {
  images: any[];
  initialIndex: number;
  onClose: () => void;
  analysisResults: Record<string, any>;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [showAnnotated, setShowAnnotated] = useState(true);
  const img = images[index];
  const result = analysisResults[img?.id];
  const hasAnnotation = result && !result.error && result.detections?.length > 0;

  const goNext = useCallback(() => setIndex(i => (i + 1) % images.length), [images.length]);
  const goPrev = useCallback(() => setIndex(i => (i - 1 + images.length) % images.length), [images.length]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'a' || e.key === 'A') setShowAnnotated(s => !s);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  if (!img) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-6 py-4 bg-black/40" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-4">
          <span className="text-white/60 text-sm font-mono">{index + 1} / {images.length}</span>
          <span className="text-white text-sm font-medium truncate max-w-md">{img.filename}</span>
          {result && result.total_detections > 0 && (
            <span className="text-amber-400 text-xs font-medium bg-amber-400/10 px-2 py-1 rounded-md">
              {result.total_detections} detection{result.total_detections !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasAnnotation && (
            <button onClick={() => setShowAnnotated(s => !s)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                showAnnotated ? 'bg-sky-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}>
              <Eye size={14} /> {showAnnotated ? 'AI Analysis' : 'Original'}
              <span className="text-[10px] opacity-60 ml-1">[A]</span>
            </button>
          )}
          <button onClick={onClose} className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-all">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative px-16 py-4" onClick={e => e.stopPropagation()}>
        {images.length > 1 && (
          <>
            <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
              <ChevronLeft size={20} />
            </button>
            <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
              <ChevronRight size={20} />
            </button>
          </>
        )}
        {showAnnotated && hasAnnotation ? (
          <div className="max-h-full max-w-full">
            <AnnotatedOverlay imageUrl={img.url} detections={result.detections} />
          </div>
        ) : (
          <img src={img.url} alt={img.filename} className="max-h-full max-w-full object-contain rounded-lg" />
        )}
      </div>

      {result && result.total_detections > 0 && (
        <div className="bg-black/40 px-6 py-3 border-t border-white/10" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {result.detections?.map((d: any, i: number) => {
              const cfg = getDamageConfig(d.damage_type);
              return (
                <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2 flex-shrink-0"
                  style={{ background: cfg.stroke + '22', border: `1px solid ${cfg.stroke}55` }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cfg.stroke }} />
                  <span className="text-white text-xs font-semibold">{d.damage_type}</span>
                  <span className="text-white/50 text-xs">{(d.confidence * 100).toFixed(0)}%</span>
                  {d.severity && <SeverityBadge severity={d.severity} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function InspectionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inspectionId = params.id as string;
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, any>>({});
  const [loadingDetections, setLoadingDetections] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalToLoad, setTotalToLoad] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [editingDate, setEditingDate] = useState(false);
  const [editDate, setEditDate] = useState('');

  const deleteMutation = useMutation({
    mutationFn: () => inspectionsApi.delete(inspectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Inspection deleted');
      router.push('/inspections');
    },
    onError: () => toast.error('Failed to delete inspection'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<{ name: string; inspected_at: string }>) => inspectionsApi.update(inspectionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection', inspectionId] });
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('Inspection updated');
      setEditingName(false);
      setEditingDate(false);
    },
    onError: () => toast.error('Failed to update inspection'),
  });

  const { data: inspection, isLoading } = useQuery({
    queryKey: ['inspection', inspectionId],
    queryFn: () => inspectionsApi.get(inspectionId),
  });

  const { data: images = [], isSuccess: imagesLoaded } = useQuery({
    queryKey: ['images', inspectionId],
    queryFn: () => imagesApi.list(inspectionId),
  });

  const { data: asset } = useQuery({
    queryKey: ['asset', inspection?.asset_id],
    queryFn: () => assetsApi.get(inspection!.asset_id),
    enabled: !!inspection?.asset_id,
  });

  useEffect(() => {
    if (imagesLoaded && images.length > 0 && !selectedImage) {
      setSelectedImage(images[0].id);
    }
  }, [imagesLoaded, images, selectedImage]);

  // Incrementally fetch detections — update state per image so stats & thumbnails update live
  useEffect(() => {
    if (!imagesLoaded || images.length === 0) {
      setLoadingDetections(false);
      return;
    }

    const completedImages = images.filter((img: any) => img.analysis_status === 'completed');
    if (completedImages.length === 0) {
      setLoadingDetections(false);
      return;
    }

    let cancelled = false;
    setTotalToLoad(completedImages.length);
    setLoadedCount(0);

    async function fetchAllDetections() {
      for (const img of completedImages) {
        if (cancelled) break;
        try {
          const detections = await analysisApi.getDetections(img.id);
          if (!cancelled) {
            setAnalysisResults(prev => ({ ...prev, [img.id]: detections }));
            setLoadedCount(c => c + 1);
          }
        } catch {
          if (!cancelled) setLoadedCount(c => c + 1);
        }
      }
      if (!cancelled) setLoadingDetections(false);
    }

    fetchAllDetections();
    return () => { cancelled = true; };
  }, [imagesLoaded, images]);

  async function handleAnalyze(imageId: string) {
    setAnalyzing(imageId);
    try {
      const result = await analysisApi.analyze(imageId);
      setAnalysisResults(prev => ({ ...prev, [imageId]: result }));
      queryClient.invalidateQueries({ queryKey: ['images', inspectionId] });
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err: any) {
      setAnalysisResults(prev => ({ ...prev, [imageId]: { error: err.response?.data?.detail || 'Analysis failed' } }));
    }
    setAnalyzing(null);
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-mira-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!inspection) return <div className="text-red-500">Inspection not found.</div>;

  // Live-updating summary stats
  const completedCount = images.filter((img: any) => img.analysis_status === 'completed').length;
  const totalDetections = Object.values(analysisResults).reduce((sum: number, r: any) => sum + (r?.total_detections || 0), 0);
  const allSeverities = Object.values(analysisResults).flatMap((r: any) =>
    (r?.detections || []).map((d: any) => d.severity)
  ).filter(Boolean);
  const worstSeverity = allSeverities.sort().reverse()[0];
  const cleanCount = Object.values(analysisResults).filter((r: any) => r && !r.error && r.total_detections === 0).length;

  const currentImg = images.find((img: any) => img.id === selectedImage);
  const currentResult = currentImg ? analysisResults[currentImg.id] : null;
  const currentImgLoading = loadingDetections && currentImg?.analysis_status === 'completed' && !currentResult;

  const progressPct = totalToLoad > 0 ? Math.round((loadedCount / totalToLoad) * 100) : 0;

  return (
    <div>
      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          analysisResults={analysisResults}
        />
      )}

      <Link href="/inspections" className="inline-flex items-center gap-2 text-sm text-mira-muted hover:text-mira-blue mb-6 font-medium">
        <ArrowLeft size={16} /> Back to Inspections
      </Link>

      {/* Header */}
      <div className="bg-white border border-[#C8E6D4] rounded-xl p-6 shadow-sm mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') updateMutation.mutate({ name: editName });
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="text-xl font-bold rounded-lg px-3 py-1.5 outline-none flex-1"
                  style={{ color: '#082E29', border: '2px solid #0891B2', background: '#EDF6F0' }}
                  autoFocus
                />
                <button onClick={() => updateMutation.mutate({ name: editName })}
                  disabled={updateMutation.isPending}
                  className="p-2 rounded-lg transition-colors hover:bg-emerald-50"
                  style={{ color: '#10B981' }}>
                  <Check size={16} />
                </button>
                <button onClick={() => setEditingName(false)}
                  className="p-2 rounded-lg transition-colors hover:bg-red-50 text-red-400">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-xl font-bold text-slate-800">{inspection.name}</h1>
                <button onClick={() => { setEditName(inspection.name); setEditingName(true); }}
                  className="p-1.5 rounded-lg transition-colors hover:bg-[#EDF6F0] opacity-60 hover:opacity-100"
                  style={{ color: '#082E29' }} title="Edit name">
                  <Pencil size={13} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              {asset && <span className="text-xs px-2.5 py-1 rounded-md font-medium bg-sky-50 text-sky-700 border border-sky-100">{asset.name}</span>}
              <span className={`text-xs px-2.5 py-1 rounded-md font-medium ${
                inspection.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                inspection.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                'bg-slate-100 text-slate-500'
              }`}>{inspection.status}</span>
              {editingDate ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && editDate) updateMutation.mutate({ inspected_at: new Date(editDate).toISOString() });
                      if (e.key === 'Escape') setEditingDate(false);
                    }}
                    className="text-xs rounded-md px-2 py-1 outline-none"
                    style={{ border: '2px solid #0891B2', background: '#EDF6F0', color: '#082E29' }}
                    autoFocus
                  />
                  <button onClick={() => { if (editDate) updateMutation.mutate({ inspected_at: new Date(editDate).toISOString() }); }}
                    disabled={updateMutation.isPending || !editDate}
                    className="p-1 rounded-md transition-colors hover:bg-emerald-50"
                    style={{ color: '#10B981' }}>
                    <Check size={13} />
                  </button>
                  <button onClick={() => setEditingDate(false)}
                    className="p-1 rounded-md transition-colors hover:bg-red-50 text-red-400">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 group/date">
                  <span className="text-xs text-slate-400">
                    {new Date(inspection.inspected_at || inspection.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <button onClick={() => {
                    const d = new Date(inspection.inspected_at || inspection.created_at);
                    setEditDate(d.toISOString().split('T')[0]);
                    setEditingDate(true);
                  }}
                    className="p-1 rounded-md transition-colors hover:bg-[#EDF6F0] opacity-0 group-hover/date:opacity-100"
                    style={{ color: '#082E29' }} title="Edit date">
                    <Pencil size={11} />
                  </button>
                </span>
              )}
              {inspection.weather_conditions && <span className="text-xs text-slate-400">Weather: {inspection.weather_conditions}</span>}
              {inspection.inspector_name && <span className="text-xs text-slate-400">Inspector: {inspection.inspector_name}</span>}
            </div>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-lg transition-all ml-4 flex-shrink-0"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Inspection"
        message={`"${inspection.name}" and all its images and detections will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Inspection"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* ── Detection loading progress banner ── */}
      {loadingDetections && totalToLoad > 0 && (
        <div className="bg-white border border-[#C8E6D4] rounded-xl px-5 py-4 mb-5 shadow-sm">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="relative w-5 h-5 flex-shrink-0">
                <Loader size={18} className="animate-spin text-mira-blue" />
              </div>
              <span className="text-sm font-semibold text-slate-700">Loading AI detection results</span>
              <span className="text-xs text-slate-400 hidden sm:inline">— updating as each image loads</span>
            </div>
            <span className="text-xs font-mono font-semibold text-mira-blue">{loadedCount}/{totalToLoad}</span>
          </div>
          {/* Progress bar */}
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #0891B2 0%, #06B6D4 50%, #34D399 100%)',
              }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            {totalToLoad - loadedCount > 0
              ? `${totalToLoad - loadedCount} image${totalToLoad - loadedCount !== 1 ? 's' : ''} remaining — stats update in real time`
              : 'Finalising…'
            }
          </p>
        </div>
      )}

      {/* ── Summary stats — always visible once images loaded, live-update during load ── */}
      {completedCount > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center"><ImageIcon size={14} className="text-sky-600" /></div>
              <p className="text-xs font-semibold text-mira-muted uppercase tracking-wider">Analysed</p>
            </div>
            <p className="text-2xl font-bold text-slate-800 font-mono">{completedCount}<span className="text-sm text-mira-faint font-normal ml-0.5">/{images.length}</span></p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><AlertTriangle size={14} className="text-amber-600" /></div>
              <p className="text-xs font-semibold text-mira-muted uppercase tracking-wider">Detections</p>
            </div>
            {loadingDetections && loadedCount === 0 ? (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-16 h-6 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <p className="text-2xl font-bold text-slate-800 font-mono transition-all duration-300">{totalDetections}</p>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><CheckCircle size={14} className="text-emerald-600" /></div>
              <p className="text-xs font-semibold text-mira-muted uppercase tracking-wider">Clean Images</p>
            </div>
            {loadingDetections && loadedCount === 0 ? (
              <div className="w-10 h-6 bg-slate-100 rounded animate-pulse mt-1" />
            ) : (
              <p className="text-2xl font-bold text-slate-800 font-mono transition-all duration-300">{cleanCount}</p>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><BarChart3 size={14} className="text-red-600" /></div>
              <p className="text-xs font-semibold text-mira-muted uppercase tracking-wider">Worst Severity</p>
            </div>
            {loadingDetections && loadedCount === 0 ? (
              <div className="w-20 h-6 bg-slate-100 rounded animate-pulse mt-1" />
            ) : worstSeverity ? (
              <SeverityBadge severity={worstSeverity} size="lg" />
            ) : (
              <span className="text-sm text-emerald-600 font-medium flex items-center gap-1 mt-1"><Shield size={14} /> All Clear</span>
            )}
          </div>
        </div>
      )}

      {/* ── Images grid ── */}
      {images.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl shadow-card">
          <ImageIcon size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-base text-mira-muted font-medium">No images uploaded yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left: Thumbnail strip */}
          <div className="col-span-3">
            <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{images.length} Images</h3>
              </div>
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto p-2 space-y-1.5">
                {images.map((img: any) => {
                  const r = analysisResults[img.id];
                  const hasDetections = r && !r.error && r.total_detections > 0;
                  const isPendingLoad = loadingDetections && img.analysis_status === 'completed' && !r;
                  const isSelected = img.id === selectedImage;

                  return (
                    <button key={img.id} onClick={() => setSelectedImage(img.id)}
                      className={`w-full text-left rounded-lg p-2 transition-all group ${
                        isSelected ? 'bg-sky-50 ring-2 ring-sky-300' : 'hover:bg-slate-50'
                      }`}>
                      <div className="flex gap-2.5">
                        <div className="relative flex-shrink-0">
                          <img src={img.url} alt="" className="w-16 h-12 object-cover rounded-md border border-slate-200" />
                          {hasDetections && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center">
                              <span className="text-[8px] text-white font-bold">{r.total_detections}</span>
                            </div>
                          )}
                          {r && !r.error && r.total_detections === 0 && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                              <CheckCircle size={8} className="text-white" />
                            </div>
                          )}
                          {isPendingLoad && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-sky-400 border-2 border-white flex items-center justify-center">
                              <div className="w-2 h-2 border border-white border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <p className="text-[11px] font-medium text-slate-700 truncate leading-tight">
                            {img.filename.length > 20 ? img.filename.slice(0, 18) + '…' : img.filename}
                          </p>
                          <p className="text-[10px] text-mira-faint mt-0.5">
                            {isPendingLoad ? (
                              <span className="text-sky-500 flex items-center gap-1">
                                <span className="inline-block w-12 h-2 bg-sky-100 rounded animate-pulse" />
                              </span>
                            ) : img.analysis_status === 'completed' ? (
                              hasDetections
                                ? <span className="text-amber-600">{r.total_detections} issue{r.total_detections !== 1 ? 's' : ''}</span>
                                : <span className="text-emerald-600">Clean</span>
                            ) : (
                              <span className="text-slate-400">{img.analysis_status}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Detail view */}
          <div className="col-span-9">
            {currentImg ? (
              <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
                {/* Image header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <ImageIcon size={16} className="text-mira-muted" />
                    <span className="text-sm font-semibold text-slate-700 truncate">{currentImg.filename}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                      currentImg.analysis_status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                      currentImg.analysis_status === 'queued' ? 'bg-amber-50 text-amber-700' :
                      currentImg.analysis_status === 'processing' ? 'bg-sky-50 text-sky-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>{currentImg.analysis_status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentImg.analysis_status !== 'completed' && !analyzing && (
                      <button onClick={() => handleAnalyze(currentImg.id)}
                        className="flex items-center gap-1.5 text-xs text-white font-medium bg-mira-blue px-3 py-1.5 rounded-md hover:bg-sky-700 transition-all">
                        <Scan size={12} /> Run Analysis
                      </button>
                    )}
                    {analyzing === currentImg.id && (
                      <span className="flex items-center gap-1.5 text-xs text-mira-blue font-medium">
                        <Loader size={12} className="animate-spin" /> Analyzing…
                      </span>
                    )}
                    <button onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))}
                      className="flex items-center gap-1.5 text-xs text-slate-600 font-medium bg-slate-100 px-3 py-1.5 rounded-md hover:bg-slate-200 transition-all">
                      <ZoomIn size={12} /> Full Screen
                    </button>
                  </div>
                </div>

                {/* Image area */}
                <div className="p-5">
                  {currentImgLoading ? (
                    /* Skeleton while fetching detections for this image */
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Original</div>
                          <img src={currentImg.url} alt="Original"
                            className="w-full rounded-lg border border-slate-200"
                            onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">AI Analysis</div>
                          <div className="w-full rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-3 py-16">
                            <div className="w-8 h-8 border-2 border-mira-blue/30 border-t-mira-blue rounded-full animate-spin" />
                            <p className="text-xs text-slate-400 font-medium">Fetching detection data…</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : currentResult && !currentResult.error && currentResult.detections?.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Original</p>
                        <img src={currentImg.url} alt="Original"
                          className="w-full rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">AI Analysis</p>
                        <AnnotatedOverlay
                          imageUrl={currentImg.url}
                          detections={currentResult.detections}
                          onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))}
                        />
                      </div>
                    </div>
                  ) : (
                    <img src={currentImg.url} alt={currentImg.filename}
                      className="w-full max-h-[500px] object-contain rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                  )}
                </div>

                {/* Detection results panel */}
                {currentResult && !currentResult.error && (
                  <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/30">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Detection Results</h3>
                      <span className="text-xs text-mira-muted font-mono">
                        {currentResult.total_detections} finding{currentResult.total_detections !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {currentResult.total_detections > 0 ? (
                      <div className="space-y-2">
                        {currentResult.detections?.map((d: any, i: number) => {
                          const cfg = getDamageConfig(d.damage_type);
                          return (
                            <div key={i}
                              className={`flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-slate-100 border-l-4 ${cfg.tw.border}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.tw.dot}`} />
                                <span className={`text-sm font-semibold ${cfg.tw.text}`}>{d.damage_type}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-500"
                                      style={{ width: `${d.confidence * 100}%`, background: cfg.stroke }} />
                                  </div>
                                  <span className="text-xs text-mira-muted font-mono w-10 text-right">{(d.confidence * 100).toFixed(0)}%</span>
                                </div>
                                {d.severity && <SeverityBadge severity={d.severity} />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 bg-emerald-50 rounded-lg px-4 py-3 border border-emerald-100">
                        <CheckCircle size={18} className="text-emerald-600" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-800">No Damage Detected</p>
                          <p className="text-xs text-emerald-600">This image passed AI analysis with no issues found.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {currentResult?.error && (
                  <div className="border-t border-slate-100 px-5 py-4">
                    <div className="flex items-center gap-3 bg-red-50 rounded-lg px-4 py-3 border border-red-100">
                      <AlertCircle size={18} className="text-red-600" />
                      <div>
                        <p className="text-sm font-semibold text-red-800">Analysis Failed</p>
                        <p className="text-xs text-red-600">{currentResult.error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl shadow-card p-12 text-center">
                <ImageIcon size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-mira-muted">Select an image from the left panel to view details.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

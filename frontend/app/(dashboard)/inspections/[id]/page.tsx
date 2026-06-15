'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inspectionsApi, imagesApi, assetsApi, analysisApi, reviewApi } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, ImageIcon, Loader, CheckCircle, AlertCircle, Scan, Shield, X, ChevronLeft, ChevronRight, ZoomIn, Eye, AlertTriangle, BarChart3, Trash2, Pencil, Check, ArrowUpDown, ClipboardCheck, Download } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import ReviewOverlay, { type ReviewState } from '@/components/review/ReviewOverlay';
import BboxEditor from '@/components/review/BboxEditor';
import ReviewPanel, {
  initModifiedState,
  type AddedDraft,
  type LocalDetectionReview,
} from '@/components/review/ReviewPanel';
import ReviewToolbar, { type ReviewTool } from '@/components/review/ReviewToolbar';
import { industryCategoryOf, damageTypeNameOf } from '@/lib/annotationTaxonomy';
import { verifiedDetections } from '@/lib/reviewUtils';
import type { BoundingBox, CorrectedDetection, Detection, DetectionReviewItem, SubmitReviewRequest } from '@/types';

const roundBbox = (b: BoundingBox): BoundingBox => ({
  x1: Math.round(b.x1), y1: Math.round(b.y1), x2: Math.round(b.x2), y2: Math.round(b.y2),
});

// ─── Severity ───────────────────────────────────────────────────────────────
const severityConfig: Record<string, { label: string; color: string; bg: string; hex: string }> = {
  S1: { label: 'Minor',    color: 'text-emerald-700', bg: 'bg-emerald-50', hex: '#4CAF50'  },
  S2: { label: 'Moderate', color: 'text-amber-700',   bg: 'bg-amber-50',   hex: '#E6A817'  },
  S3: { label: 'Advanced', color: 'text-orange-700',  bg: 'bg-orange-50',  hex: '#FF7043'  },
  S4: { label: 'Severe',   color: 'text-red-700',     bg: 'bg-red-50',     hex: '#B71C1C'  },
};

/* Normalize legacy S0 → S1 */
const normSev = (s: string | null | undefined): string | null => {
  if (!s) return null;
  if (s === 'S0' || s === '0') return 'S1';
  const map: Record<string,string> = { '1':'S1','2':'S2','3':'S3','4':'S4' };
  return map[s] || s;
};

function SeverityBadge({ severity, size = 'sm' }: { severity: string; size?: 'sm' | 'lg' }) {
  const norm = normSev(severity) || severity;
  const config = severityConfig[norm] || severityConfig.S1;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${config.bg} ${config.color} ${
      size === 'lg' ? 'text-base px-3 py-1' : 'text-sm'
    }`}>
      {norm} <span className="font-normal opacity-75">{config.label}</span>
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

// ─── Lightbox ────────────────────────────────────────────────────────────────
function Lightbox({ images, initialIndex, onClose, analysisResults, showLabels = true }: {
  images: any[];
  initialIndex: number;
  onClose: () => void;
  analysisResults: Record<string, any>;
  showLabels?: boolean;
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
          <span className="text-white/60 text-base font-mono">{index + 1} / {images.length}</span>
          <span className="text-white text-base font-medium truncate max-w-md">{img.filename}</span>
          {result && result.total_detections > 0 && (
            <span className="text-amber-400 text-sm font-medium bg-amber-400/10 px-2 py-1 rounded-md">
              {result.total_detections} detection{result.total_detections !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasAnnotation && (
            <button onClick={() => setShowAnnotated(s => !s)}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md transition-all ${
                showAnnotated ? 'bg-sky-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}>
              <Eye size={16} /> {showAnnotated ? 'AI Analysis' : 'Original'}
              <span className="text-[11px] opacity-60 ml-1">[A]</span>
            </button>
          )}
          <button onClick={onClose} className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-all">
            <X size={22} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center relative px-16 py-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        {images.length > 1 && (
          <>
            <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
              <ChevronLeft size={22} />
            </button>
            <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
              <ChevronRight size={22} />
            </button>
          </>
        )}
        {showAnnotated && hasAnnotation ? (
          <div className="h-full w-full flex items-center justify-center overflow-hidden">
            <ReviewOverlay imageUrl={img.url} detections={result.detections} mode="view" fitScreen showLabels={showLabels} />
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
                  <span className="text-white text-sm font-semibold">{d.damage_type}</span>
                  <span className="text-white/50 text-sm">{(d.confidence * 100).toFixed(0)}%</span>
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [editingDate, setEditingDate] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [imageSort, setImageSort] = useState<'name' | 'detections' | 'severity'>('name');

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

  async function handleDownloadImages() {
    if (downloadingImages) return;
    setDownloadingImages(true);
    try {
      const res = await reviewApi.downloadAnnotatedImages(inspectionId);
      const match = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] || '');
      const filename = match?.[1] || `${inspection?.name || 'inspection'}_annotated_images.zip`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch {
      toast.error('Failed to download images');
    } finally {
      setDownloadingImages(false);
    }
  }

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

  // Fetch all detections for the inspection in a single batch query
  const { data: batchDetections, isLoading: loadingDetections } = useQuery({
    queryKey: ['all-detections', inspectionId],
    queryFn: () => analysisApi.getAllDetections(inspectionId),
    enabled: imagesLoaded && images.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (batchDetections) setAnalysisResults(batchDetections);
  }, [batchDetections]);

  // ── Final verified set (everything OUTSIDE review mode) ────────────────────
  // Rejected CV detections and stale CV originals replaced by a modification are
  // dropped; accepted, unreviewed and engineer-added survive. This is a no-op
  // pre-review (review_action is null everywhere). Review mode keeps the
  // unfiltered set so the engineer always sees everything.
  const viewResults = useMemo(() => {
    const out: Record<string, any> = {};
    for (const [imgId, r] of Object.entries(analysisResults)) {
      if (!r || r.error || !Array.isArray(r.detections)) { out[imgId] = r; continue; }
      const dets = verifiedDetections(r.detections);
      out[imgId] = dets.length === r.detections.length
        ? r
        : { ...r, detections: dets, total_detections: dets.length };
    }
    return out;
  }, [analysisResults]);
  const displayResults: Record<string, any> =
    inspection?.status === 'pending_review' ? analysisResults : viewResults;

  // ── Engineer Review Mode state ──────────────────────────────────────────────
  const [showStartReviewConfirm, setShowStartReviewConfirm] = useState(false);
  // Pending (not yet submitted) per-detection actions: imageId → detectionId → state
  const [reviewState, setReviewState] = useState<Record<string, Record<string, LocalDetectionReview>>>({});
  // Engineer-added draft detections: imageId → drafts
  const [addedDrafts, setAddedDrafts] = useState<Record<string, AddedDraft[]>>({});
  // Images whose review was submitted in this session (server also flags det.reviewed)
  const [submittedImages, setSubmittedImages] = useState<Set<string>>(new Set());
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null);
  // Active canvas tool — Select (V) / Box (B) / Oval (O), annotation-app style
  const [tool, setTool] = useState<ReviewTool>('select');
  // Bumped after each draw so the panel scrolls to LABELS and focuses Damage Type
  const [labelsFocusToken, setLabelsFocusToken] = useState(0);
  // Overlay text label chips visible (toggle: toolbar button or 'L')
  const [showLabels, setShowLabels] = useState(true);
  // Image asset types saved this session (PATCH succeeded): imageId → asset_type
  const [assetTypeOverrides, setAssetTypeOverrides] = useState<Record<string, string>>({});
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  // Reset per-image editing UI when switching images
  useEffect(() => {
    setSelectedDetectionId(null);
    setTool('select');
    setNaturalDims(null);
  }, [selectedImage]);

  // Industry category for taxonomy lists — from the asset, else any detection.
  const firstDetInfraType = Object.values(analysisResults)
    .flatMap((r: any) => r?.detections ?? [])
    .find((d: any) => d?.infrastructure_type)?.infrastructure_type;
  const category = industryCategoryOf(asset?.infrastructure_type ?? firstDetInfraType);

  const cvDetsOf = (imgId: string): Detection[] =>
    ((analysisResults[imgId]?.detections ?? []) as Detection[]).filter(d => d.source !== 'engineer_added');

  /** Image review submitted (this session or per server flags). */
  const isImageSubmitted = (imgId: string, extra?: Set<string>): boolean => {
    if (submittedImages.has(imgId) || extra?.has(imgId)) return true;
    const cv = cvDetsOf(imgId);
    return cv.length > 0 && cv.every(d => !!d.reviewed);
  };

  /** Counts toward review progress (zero-CV images don't block completion). */
  const isImageReviewed = (imgId: string, extra?: Set<string>): boolean =>
    isImageSubmitted(imgId, extra) || cvDetsOf(imgId).length === 0;

  const startReviewMutation = useMutation({
    mutationFn: () => reviewApi.startReview(inspectionId),
    onSuccess: () => {
      setShowStartReviewConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['inspection', inspectionId] });
      queryClient.invalidateQueries({ queryKey: ['all-detections', inspectionId] });
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('Review mode started — CV detections are now locked');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to start review'),
  });

  const submitReviewMutation = useMutation({
    mutationFn: ({ imageId, body }: { imageId: string; body: SubmitReviewRequest }) =>
      reviewApi.submitImageReview(imageId, body),
    onSuccess: (_data, { imageId }) => {
      const done = new Set(submittedImages);
      done.add(imageId);
      setSubmittedImages(done);
      setReviewState(prev => { const n = { ...prev }; delete n[imageId]; return n; });
      setAddedDrafts(prev => { const n = { ...prev }; delete n[imageId]; return n; });
      setSelectedDetectionId(null);
      setTool('select');
      queryClient.invalidateQueries({ queryKey: ['all-detections', inspectionId] });
      toast.success('Image review submitted');
      // Advance to the next image that still needs review
      const next = images.find((im: any) => !isImageReviewed(im.id, done));
      if (next) setSelectedImage(next.id);
    },
    onError: (err: any, { imageId }) => {
      if (err?.response?.status === 409) {
        toast.warning('This image was already reviewed — refreshing detections');
        setSubmittedImages(prev => new Set(prev).add(imageId));
        setReviewState(prev => { const n = { ...prev }; delete n[imageId]; return n; });
        queryClient.invalidateQueries({ queryKey: ['all-detections', inspectionId] });
      } else {
        toast.error(err?.response?.data?.detail || 'Failed to submit image review');
      }
    },
  });

  const completeReviewMutation = useMutation({
    mutationFn: () => reviewApi.completeReview(inspectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection', inspectionId] });
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('Review completed');
      router.push(`/inspections/${inspectionId}/review-summary`);
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        toast.warning('Some detections are still unreviewed — submit every image first');
        queryClient.invalidateQueries({ queryKey: ['all-detections', inspectionId] });
      } else {
        toast.error(err?.response?.data?.detail || 'Failed to complete review');
      }
    },
  });

  // Image asset type — mirrors the annotation app: fires on change, optimistic,
  // rolls back on error, toasts on success.
  const assetTypeMutation = useMutation({
    mutationFn: ({ imageId, assetType }: { imageId: string; assetType: string }) =>
      reviewApi.updateImageAssetType(imageId, assetType),
    onMutate: async ({ imageId, assetType }) => {
      const prev = assetTypeOverrides[imageId];
      setAssetTypeOverrides(p => ({ ...p, [imageId]: assetType }));
      return { imageId, prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images', inspectionId] });
      toast.success('Asset type updated');
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx) {
        setAssetTypeOverrides(p => {
          const n = { ...p };
          if (ctx.prev === undefined) delete n[ctx.imageId];
          else n[ctx.imageId] = ctx.prev;
          return n;
        });
      }
      toast.error(err?.response?.data?.detail || 'Failed to update asset type');
    },
  });

  // ── Review handlers ─────────────────────────────────────────────────────────
  function handleReviewAction(det: Detection, action: 'accepted' | 'rejected' | 'modified') {
    const imgId = selectedImage;
    if (!imgId) return;
    const cur = reviewState[imgId]?.[det.id];
    const togglingOff = cur?.action === action;

    setReviewState(prev => {
      const img = { ...(prev[imgId] ?? {}) };
      if (togglingOff) {
        img[det.id] = { ...cur, action: null };
      } else if (action === 'modified') {
        img[det.id] = initModifiedState(det, category, cur);
      } else {
        img[det.id] = { ...(cur ?? {}), action };
      }
      return { ...prev, [imgId]: img };
    });

    setTool('select');
    if (!togglingOff) {
      setSelectedDetectionId(det.id);
      // Modify jumps straight to the LABELS editor (same behavior as new drafts)
      if (action === 'modified') setLabelsFocusToken(t => t + 1);
    }
  }

  /** Accept All / Reject All — only fills in unactioned CV detections. */
  function handleBulkAction(action: 'accepted' | 'rejected') {
    const imgId = selectedImage;
    if (!imgId) return;
    setReviewState(prev => {
      const img = { ...(prev[imgId] ?? {}) };
      for (const d of cvDetsOf(imgId)) {
        if (!img[d.id]?.action) img[d.id] = { ...(img[d.id] ?? { action: null }), action };
      }
      return { ...prev, [imgId]: img };
    });
  }

  function handleUpdateReviewState(detId: string, patch: Partial<LocalDetectionReview>) {
    const imgId = selectedImage;
    if (!imgId) return;
    setReviewState(prev => {
      const existing: LocalDetectionReview = prev[imgId]?.[detId] ?? { action: null };
      return {
        ...prev,
        [imgId]: { ...(prev[imgId] ?? {}), [detId]: { ...existing, ...patch } },
      };
    });
  }

  function handleDrawComplete(b: BoundingBox) {
    const imgId = selectedImage;
    if (!imgId) return;
    const tempId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const draft: AddedDraft = {
      tempId,
      bbox: roundBbox(b),
      shapeType: tool === 'oval' ? 'ellipse' : 'rect',
      damageCode: '',
      severity: '',
      segments: [],
      defectId: '',
      notes: '',
    };
    setAddedDrafts(prev => ({ ...prev, [imgId]: [...(prev[imgId] ?? []), draft] }));
    // Annotation-app flow: tool snaps back to Select, the new draft is selected
    // (and therefore editable) and the panel jumps to LABELS.
    setTool('select');
    setSelectedDetectionId(tempId);
    setLabelsFocusToken(t => t + 1);
  }

  function handleUpdateDraft(tempId: string, patch: Partial<AddedDraft>) {
    const imgId = selectedImage;
    if (!imgId) return;
    setAddedDrafts(prev => ({
      ...prev,
      [imgId]: (prev[imgId] ?? []).map(d => (d.tempId === tempId ? { ...d, ...patch } : d)),
    }));
  }

  function handleRemoveDraft(tempId: string) {
    const imgId = selectedImage;
    if (!imgId) return;
    setAddedDrafts(prev => ({ ...prev, [imgId]: (prev[imgId] ?? []).filter(d => d.tempId !== tempId) }));
    if (selectedDetectionId === tempId) setSelectedDetectionId(null);
  }

  function handleEditorChange(b: BoundingBox) {
    const imgId = selectedImage;
    if (!imgId || !selectedDetectionId) return;
    const bb = roundBbox(b);
    const drafts = addedDrafts[imgId] ?? [];
    if (drafts.some(d => d.tempId === selectedDetectionId)) {
      handleUpdateDraft(selectedDetectionId, { bbox: bb });
    } else {
      handleUpdateReviewState(selectedDetectionId, { modifiedBbox: bb });
    }
  }

  function handleSubmitImageReview() {
    const imgId = selectedImage;
    if (!imgId) return;
    const cv = cvDetsOf(imgId);
    const states = reviewState[imgId] ?? {};
    const reviews: DetectionReviewItem[] = [];

    for (const d of cv) {
      const st = states[d.id];
      if (!st?.action) return; // guard — button is disabled in this case
      if (st.action === 'modified') {
        if (!st.damageCode || !st.severity || !(st.segments?.length)) return; // guard
        const corrected: CorrectedDetection = {
          damage_type: damageTypeNameOf(st.damageCode, category),
          damage_code: st.damageCode,
          severity: st.severity,
          bbox: st.modifiedBbox ?? d.bbox,
          confidence_score: 1.0,
          structural_segments: st.segments,
          shape_type: d.shape_type ?? 'rect',
        };
        const defectId = st.defectId?.trim();
        if (defectId) corrected.defect_id = defectId;
        reviews.push({
          cv_detection_id: d.id,
          action: 'modified',
          corrected_detection: corrected,
          notes: st.notes?.trim() || undefined,
        });
      } else {
        reviews.push({
          cv_detection_id: d.id,
          action: st.action,
          notes: st.notes?.trim() || undefined,
        });
      }
    }

    for (const draft of addedDrafts[imgId] ?? []) {
      if (!draft.damageCode || !draft.severity || draft.segments.length === 0) return; // guard
      const corrected: CorrectedDetection = {
        damage_type: damageTypeNameOf(draft.damageCode, category),
        damage_code: draft.damageCode,
        severity: draft.severity,
        bbox: draft.bbox,
        confidence_score: 1.0,
        structural_segments: draft.segments,
        shape_type: draft.shapeType,
      };
      const defectId = draft.defectId.trim();
      if (defectId) corrected.defect_id = defectId;
      reviews.push({
        cv_detection_id: null,
        action: 'added',
        corrected_detection: corrected,
        notes: draft.notes.trim() || undefined,
      });
    }

    submitReviewMutation.mutate({ imageId: imgId, body: { reviews } });
  }

  // ── Review-mode keyboard shortcuts (annotation-app style) ──────────────────
  // V = Select, B = Box, O = Oval, Esc = back to Select, Del/Backspace = remove
  // the selected engineer draft. Never fires while typing or in the lightbox.
  useEffect(() => {
    if (inspection?.status !== 'pending_review') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (lightboxIndex !== null) return;
      const imgId = selectedImage;
      if (!imgId || isImageSubmitted(imgId)) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setTool('select');
      else if (k === 'b') setTool('box');
      else if (k === 'o') setTool('oval');
      else if (e.key === 'Escape') setTool('select');
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only engineer DRAFTS are deletable — CV detections get Reject instead.
        if (selectedDetectionId && (addedDrafts[imgId] ?? []).some(d => d.tempId === selectedDetectionId)) {
          e.preventDefault();
          handleRemoveDraft(selectedDetectionId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection?.status, lightboxIndex, selectedImage, selectedDetectionId, addedDrafts, submittedImages, analysisResults]);

  // L = toggle overlay labels — works in view mode, review mode and the lightbox
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'l') setShowLabels(s => !s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleAnalyze(imageId: string) {
    setAnalyzing(imageId);
    try {
      const result = await analysisApi.analyze(imageId);
      setAnalysisResults(prev => ({ ...prev, [imageId]: result }));
      queryClient.invalidateQueries({ queryKey: ['images', inspectionId] });
      queryClient.invalidateQueries({ queryKey: ['all-detections', inspectionId] });
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

  // Live-updating summary stats — verified set outside review mode
  const completedCount = images.filter((img: any) => img.analysis_status === 'completed').length;
  const totalDetections = Object.values(displayResults).reduce((sum: number, r: any) => sum + (r?.total_detections || 0), 0);
  const allSeverities = Object.values(displayResults).flatMap((r: any) =>
    (r?.detections || []).map((d: any) => d.severity)
  ).filter(Boolean);
  const worstSeverity = allSeverities.sort().reverse()[0];
  const cleanCount = Object.values(displayResults).filter((r: any) => r && !r.error && r.total_detections === 0).length;

  // Sort images — computed inline (not useMemo) because this runs after early returns
  const sortedImages = (() => {
    const sevRank: Record<string, number> = { S4: 0, S3: 1, S2: 2, S1: 3 };
    const arr = images.slice();
    if (imageSort === 'name') {
      arr.sort((a: any, b: any) => (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true }));
    } else if (imageSort === 'detections') {
      arr.sort((a: any, b: any) => (displayResults[b.id]?.total_detections ?? -1) - (displayResults[a.id]?.total_detections ?? -1));
    } else if (imageSort === 'severity') {
      arr.sort((a: any, b: any) => {
        const ra = displayResults[a.id];
        const rb = displayResults[b.id];
        const worstA = (ra?.detections || []).reduce((w: number, d: any) => Math.min(w, sevRank[normSev(d.severity) || ''] ?? 99), 99);
        const worstB = (rb?.detections || []).reduce((w: number, d: any) => Math.min(w, sevRank[normSev(d.severity) || ''] ?? 99), 99);
        if (worstA !== worstB) return worstA - worstB;
        return (rb?.total_detections ?? -1) - (ra?.total_detections ?? -1);
      });
    }
    return arr;
  })();

  const currentImg = images.find((img: any) => img.id === selectedImage);
  // Verified set in view mode; unfiltered while reviewing (displayResults switches)
  const currentResult = currentImg ? displayResults[currentImg.id] : null;
  const currentImgLoading = loadingDetections && currentImg?.analysis_status === 'completed' && !currentResult;

  // ── Review-mode derived values ────────────────────────────────────────────
  const isReviewMode = inspection.status === 'pending_review';
  const reviewedImageCount = images.filter((im: any) => isImageReviewed(im.id)).length;
  const allImagesReviewed = !loadingDetections && images.length > 0 && reviewedImageCount === images.length;

  const currentCvDets: Detection[] = currentImg ? cvDetsOf(currentImg.id) : [];
  const currentStates: Record<string, LocalDetectionReview> = currentImg ? (reviewState[currentImg.id] ?? {}) : {};
  const currentDrafts: AddedDraft[] = currentImg ? (addedDrafts[currentImg.id] ?? []) : [];
  const currentSubmitted = currentImg ? isImageSubmitted(currentImg.id) : false;

  const actionedCount = currentCvDets.filter(d => currentStates[d.id]?.action).length;
  const unactionedCount = currentCvDets.length - actionedCount;

  // Effective asset type for the current image (session PATCH override wins)
  const currentAssetType: string = currentImg
    ? (assetTypeOverrides[currentImg.id] ?? currentImg.domain_metadata?.asset_type ?? '')
    : '';

  // ── Save gating (deliberately stricter than the annotation app) ────────────
  const invalidModified = currentCvDets.filter(d => {
    const st = currentStates[d.id];
    return st?.action === 'modified' &&
      (!st.damageCode || !st.severity || !(st.segments?.length) || !st.modifiedBbox);
  });
  const invalidDrafts = currentDrafts.filter(
    d => !d.damageCode || !d.severity || d.segments.length === 0,
  );
  // Labels exist (modified or added) → image asset type becomes mandatory
  const requiresAssetType =
    currentDrafts.length > 0 || currentCvDets.some(d => currentStates[d.id]?.action === 'modified');
  const assetTypeMissing = requiresAssetType && !currentAssetType;

  const missingHints: string[] = [];
  if (!currentSubmitted && (currentCvDets.length > 0 || currentDrafts.length > 0)) {
    if (unactionedCount > 0) {
      missingHints.push(`${unactionedCount} CV detection${unactionedCount !== 1 ? 's' : ''} need${unactionedCount === 1 ? 's' : ''} Accept / Reject / Modify`);
    }
    if (invalidModified.length > 0) {
      missingHints.push(`${invalidModified.length} modified detection${invalidModified.length !== 1 ? 's' : ''} missing damage type, severity or structural segment`);
    }
    if (invalidDrafts.length > 0) {
      missingHints.push(`${invalidDrafts.length} new annotation${invalidDrafts.length !== 1 ? 's' : ''} missing damage type, severity or structural segment`);
    }
    if (assetTypeMissing) {
      missingHints.push('Image asset type is required when annotations are modified or added');
    }
  }

  const canSubmitReview =
    !currentSubmitted &&
    (currentCvDets.length > 0 || currentDrafts.length > 0) &&
    missingHints.length === 0;

  // Current image has local (unsaved) review state
  const hasUnsavedChanges =
    !currentSubmitted && (currentDrafts.length > 0 || Object.values(currentStates).some(s => !!s.action));

  // ── Selection / editing resolution (selection drives the bbox editor) ──────
  const selectedDraft = currentDrafts.find(d => d.tempId === selectedDetectionId) ?? null;
  const selectedCvDet = selectedDraft ? null : currentCvDets.find(d => d.id === selectedDetectionId) ?? null;
  const drawing = !currentSubmitted && tool !== 'select';
  // Editable while selected: any engineer draft, or a CV detection in 'modified' state
  const editingDraft = !drawing && !currentSubmitted ? selectedDraft : null;
  const editingCvDet =
    !drawing && !currentSubmitted && selectedCvDet && currentStates[selectedCvDet.id]?.action === 'modified'
      ? selectedCvDet
      : null;
  const editingDetId = editingDraft?.tempId ?? editingCvDet?.id ?? null;

  // Overlay composition: server detections + draft (engineer) boxes not being edited
  const allServerDets: Detection[] = (currentResult?.detections ?? []) as Detection[];
  const draftOverlayDets: Detection[] = currentDrafts
    .filter(d => d.tempId !== editingDetId)
    .map(dr => ({
      id: dr.tempId,
      image_id: currentImg?.id ?? '',
      infrastructure_type: (allServerDets[0]?.infrastructure_type ?? 'coastal') as Detection['infrastructure_type'],
      damage_type: dr.damageCode ? damageTypeNameOf(dr.damageCode, category) : 'new damage',
      confidence: 1,
      bbox: dr.bbox,
      severity: dr.severity || undefined,
      created_at: '',
      source: 'engineer_added' as const,
      shape_type: dr.shapeType,
      domain_metadata: { code: dr.damageCode || undefined, segments: dr.segments },
    }));
  const overlayDetections = currentSubmitted ? allServerDets : [...allServerDets, ...draftOverlayDets];
  const overlayStates: Record<string, ReviewState> = {};
  for (const [id, st] of Object.entries(currentStates)) {
    // While a modified bbox is being edited, BboxEditor renders it — suppress the overlay copy
    overlayStates[id] = {
      action: st.action,
      modifiedBbox: editingDetId === id ? undefined : st.modifiedBbox,
      // Staged severity colors the modified box/label in the overlay
      modifiedSeverity: st.severity,
    };
  }

  // BboxEditor composition (rendered inside ReviewOverlay's svg)
  const editorBbox: BoundingBox | null = drawing
    ? null
    : editingDraft
      ? editingDraft.bbox
      : editingCvDet
        ? (currentStates[editingCvDet.id]?.modifiedBbox ?? editingCvDet.bbox)
        : null;
  const editorMode: 'draw' | 'edit' | 'idle' = drawing ? 'draw' : editingDetId && editorBbox ? 'edit' : 'idle';
  const editorShapeType: 'rect' | 'ellipse' = drawing
    ? (tool === 'oval' ? 'ellipse' : 'rect')
    : editingDraft
      ? editingDraft.shapeType
      : (editingCvDet?.shape_type ?? 'rect');
  // Editor handles/box follow the item's severity color (same palette as the
  // overlay) — slate for drafts without a severity, amber for a modified
  // detection whose staged severity is somehow unset.
  const editorColor = (() => {
    const hexOf = (s: string | null | undefined): string | null => {
      const n = normSev(s || null);
      return n && severityConfig[n] ? severityConfig[n].hex : null;
    };
    if (drawing) return '#64748b';
    if (editingDraft) return hexOf(editingDraft.severity) ?? '#64748b';
    if (editingCvDet) {
      const staged = currentStates[editingCvDet.id]?.severity;
      return hexOf(staged) ?? hexOf(editingCvDet.severity) ?? '#f59e0b';
    }
    return '#f59e0b';
  })();

  return (
    <div>
      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          analysisResults={displayResults}
          showLabels={showLabels}
        />
      )}

      <Link href="/inspections" className="inline-flex items-center gap-2 text-base text-mira-muted hover:text-mira-blue mb-6 font-medium">
        <ArrowLeft size={18} /> Back to Inspections
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
                  className="text-2xl font-bold rounded-lg px-3 py-1.5 outline-none flex-1"
                  style={{ color: '#082E29', border: '2px solid #0891B2', background: '#EDF6F0' }}
                  autoFocus
                />
                <button onClick={() => updateMutation.mutate({ name: editName })}
                  disabled={updateMutation.isPending}
                  className="p-2 rounded-lg transition-colors hover:bg-emerald-50"
                  style={{ color: '#10B981' }}>
                  <Check size={18} />
                </button>
                <button onClick={() => setEditingName(false)}
                  className="p-2 rounded-lg transition-colors hover:bg-red-50 text-red-400">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-2xl font-bold text-slate-800">{inspection.name}</h1>
                <button onClick={() => { setEditName(inspection.name); setEditingName(true); }}
                  className="p-1.5 rounded-lg transition-colors hover:bg-[#EDF6F0] opacity-60 hover:opacity-100"
                  style={{ color: '#082E29' }} title="Edit name">
                  <Pencil size={15} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              {asset && <span className="text-sm px-2.5 py-1 rounded-md font-medium bg-sky-50 text-sky-700 border border-sky-100">{asset.name}</span>}
              <span className={`text-sm px-2.5 py-1 rounded-md font-medium ${
                inspection.status === 'completed' || inspection.status === 'review_completed' ? 'bg-emerald-50 text-emerald-700' :
                inspection.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                inspection.status === 'pending_review' ? 'bg-amber-100 text-amber-800' :
                'bg-slate-100 text-slate-500'
              }`}>{inspection.status.replace(/_/g, ' ')}</span>
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
                    className="text-sm rounded-md px-2 py-1 outline-none"
                    style={{ border: '2px solid #0891B2', background: '#EDF6F0', color: '#082E29' }}
                    autoFocus
                  />
                  <button onClick={() => { if (editDate) updateMutation.mutate({ inspected_at: new Date(editDate).toISOString() }); }}
                    disabled={updateMutation.isPending || !editDate}
                    className="p-1 rounded-md transition-colors hover:bg-emerald-50"
                    style={{ color: '#10B981' }}>
                    <Check size={15} />
                  </button>
                  <button onClick={() => setEditingDate(false)}
                    className="p-1 rounded-md transition-colors hover:bg-red-50 text-red-400">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 group/date">
                  <span className="text-sm text-slate-400">
                    {new Date(inspection.inspected_at || inspection.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <button onClick={() => {
                    const d = new Date(inspection.inspected_at || inspection.created_at);
                    setEditDate(d.toISOString().split('T')[0]);
                    setEditingDate(true);
                  }}
                    className="p-1 rounded-md transition-colors hover:bg-[#EDF6F0] opacity-0 group-hover/date:opacity-100"
                    style={{ color: '#082E29' }} title="Edit date">
                    <Pencil size={13} />
                  </button>
                </span>
              )}
              {inspection.weather_conditions && <span className="text-sm text-slate-400">Weather: {inspection.weather_conditions}</span>}
              {inspection.inspector_name && <span className="text-sm text-slate-400">Inspector: {inspection.inspector_name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            {inspection.status === 'completed' && (
              <button
                onClick={() => setShowStartReviewConfirm(true)}
                className="flex items-center gap-1.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 px-3.5 py-2 rounded-lg transition-all shadow-sm"
              >
                <ClipboardCheck size={15} /> Start Review
              </button>
            )}
            {inspection.status === 'review_completed' && (
              <button
                onClick={handleDownloadImages}
                disabled={downloadingImages}
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-[#082E29] bg-slate-50 hover:bg-[#EDF6F0] border border-slate-200 hover:border-[#C8E6D4] px-3 py-2 rounded-lg transition-all disabled:opacity-60"
                title="Download annotated images"
              >
                {downloadingImages
                  ? <Loader size={15} className="animate-spin" />
                  : <Download size={15} />}
                Download Images
              </button>
            )}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-lg transition-all"
            >
              <Trash2 size={15} /> Delete
            </button>
          </div>
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

      <ConfirmDialog
        isOpen={showStartReviewConfirm}
        title="Start Engineer Review"
        message="All CV detections on this inspection will be locked, and the inspection will enter Review Mode. You will then accept, reject, modify, or add detections image by image."
        confirmLabel="Start Review"
        isLoading={startReviewMutation.isPending}
        onConfirm={() => startReviewMutation.mutate()}
        onCancel={() => setShowStartReviewConfirm(false)}
      />

      {/* ── Review Mode banner ── */}
      {isReviewMode && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-4 mb-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <ClipboardCheck size={20} className="text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-base font-bold text-amber-800">Review Mode Active</p>
                <p className="text-sm text-amber-700">Review each detection, then submit per image.</p>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-40 h-2 bg-amber-200/70 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${images.length ? (reviewedImageCount / images.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-amber-800 font-mono whitespace-nowrap">
                  {reviewedImageCount} / {images.length} images reviewed
                </span>
              </div>
              {allImagesReviewed && (
                <button
                  onClick={() => completeReviewMutation.mutate()}
                  disabled={completeReviewMutation.isPending}
                  className="flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg transition-all shadow-sm disabled:opacity-50"
                >
                  {completeReviewMutation.isPending
                    ? <Loader size={15} className="animate-spin" />
                    : <CheckCircle size={15} />}
                  Complete Review
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Review completed banner ── */}
      {inspection.status === 'review_completed' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 mb-6 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-emerald-600 flex-shrink-0" />
            <div>
              <p className="text-base font-bold text-emerald-800">Review completed</p>
              <p className="text-sm text-emerald-700">The verified detection set is final. Engineer-added detections are shown in green.</p>
            </div>
          </div>
          <Link
            href={`/inspections/${inspectionId}/review-summary`}
            className="text-sm font-bold text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-200 px-3.5 py-2 rounded-lg transition-all"
          >
            View Review Summary →
          </Link>
        </div>
      )}

      {/* ── Detection loading indicator ── */}
      {loadingDetections && (
        <div className="bg-white border border-[#C8E6D4] rounded-xl px-5 py-3 mb-5 shadow-sm flex items-center gap-2.5">
          <Loader size={18} className="animate-spin text-mira-blue" />
          <span className="text-base font-semibold text-slate-700">Loading detection results…</span>
        </div>
      )}

      {/* ── Summary stats — always visible once images loaded, live-update during load ── */}
      {completedCount > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center"><ImageIcon size={16} className="text-sky-600" /></div>
              <p className="text-sm font-semibold text-mira-muted uppercase tracking-wider">Analysed</p>
            </div>
            <p className="text-3xl font-bold text-slate-800 font-mono">{completedCount}<span className="text-base text-mira-faint font-normal ml-0.5">/{images.length}</span></p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><AlertTriangle size={16} className="text-amber-600" /></div>
              <p className="text-sm font-semibold text-mira-muted uppercase tracking-wider">Detections</p>
            </div>
            {loadingDetections ? (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-16 h-6 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <p className="text-3xl font-bold text-slate-800 font-mono transition-all duration-300">{totalDetections}</p>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><CheckCircle size={16} className="text-emerald-600" /></div>
              <p className="text-sm font-semibold text-mira-muted uppercase tracking-wider">Clean Images</p>
            </div>
            {loadingDetections ? (
              <div className="w-10 h-6 bg-slate-100 rounded animate-pulse mt-1" />
            ) : (
              <p className="text-3xl font-bold text-slate-800 font-mono transition-all duration-300">{cleanCount}</p>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><BarChart3 size={16} className="text-red-600" /></div>
              <p className="text-sm font-semibold text-mira-muted uppercase tracking-wider">Worst Severity</p>
            </div>
            {loadingDetections ? (
              <div className="w-20 h-6 bg-slate-100 rounded animate-pulse mt-1" />
            ) : worstSeverity ? (
              <SeverityBadge severity={worstSeverity} size="lg" />
            ) : (
              <span className="text-base text-emerald-600 font-medium flex items-center gap-1 mt-1"><Shield size={16} /> All Clear</span>
            )}
          </div>
        </div>
      )}

      {/* ── Images grid ── */}
      {images.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl shadow-card">
          <ImageIcon size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-lg text-mira-muted font-medium">No images uploaded yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left: Thumbnail strip */}
          <div className="col-span-3">
            <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">{images.length} Images</h3>
                <div className="relative">
                  <select
                    value={imageSort}
                    onChange={e => setImageSort(e.target.value as any)}
                    className="appearance-none text-[11px] font-semibold pl-6 pr-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors outline-none"
                  >
                    <option value="name">Name</option>
                    <option value="detections">Most Issues</option>
                    <option value="severity">Most Severe</option>
                  </select>
                  <ArrowUpDown size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto p-2 space-y-1.5">
                {sortedImages.map((img: any) => {
                  const r = displayResults[img.id];
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
                              <span className="text-[9px] text-white font-bold">{r.total_detections}</span>
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
                          {isReviewMode && !loadingDetections && isImageReviewed(img.id) && (
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center" title="Review submitted">
                              <Check size={9} className="text-white" strokeWidth={3.5} />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <p className="text-[12px] font-medium text-slate-700 truncate leading-tight">
                            {img.filename.length > 20 ? img.filename.slice(0, 18) + '…' : img.filename}
                          </p>
                          <p className="text-[11px] text-mira-faint mt-0.5">
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
            {currentImg && isReviewMode ? (
              /* ── Review Mode: interactive overlay + action panel ── */
              <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <ImageIcon size={18} className="text-mira-muted flex-shrink-0" />
                    <span className="text-base font-semibold text-slate-700 truncate">{currentImg.filename}</span>
                    {currentSubmitted ? (
                      <span className="flex items-center gap-1 text-sm px-2 py-0.5 rounded-md font-medium bg-emerald-50 text-emerald-700 flex-shrink-0">
                        <Check size={13} /> Reviewed
                      </span>
                    ) : (
                      <span className="text-sm px-2 py-0.5 rounded-md font-medium bg-amber-50 text-amber-700 flex-shrink-0">In review</span>
                    )}
                  </div>
                  <button onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))}
                    className="flex items-center gap-1.5 text-sm text-slate-600 font-medium bg-slate-100 px-3 py-1.5 rounded-md hover:bg-slate-200 transition-all flex-shrink-0">
                    <ZoomIn size={14} /> Full Screen
                  </button>
                </div>

                {/* Annotation-style toolbar (active review only) */}
                {!currentSubmitted && (
                  <ReviewToolbar
                    tool={tool}
                    onToolChange={setTool}
                    canDelete={!!selectedDraft}
                    onDelete={() => { if (selectedDraft) handleRemoveDraft(selectedDraft.tempId); }}
                    showLabels={showLabels}
                    onToggleLabels={() => setShowLabels(s => !s)}
                    reviewedImages={reviewedImageCount}
                    totalImages={images.length}
                    hasUnsaved={hasUnsavedChanges}
                    unactionedCount={unactionedCount}
                    onAcceptAll={() => handleBulkAction('accepted')}
                    onRejectAll={() => handleBulkAction('rejected')}
                    canSubmit={canSubmitReview}
                    submitting={submitReviewMutation.isPending}
                    missingHints={missingHints}
                    onSubmit={handleSubmitImageReview}
                  />
                )}

                <div className="flex items-stretch">
                  {/* Canvas */}
                  <div className="flex-1 min-w-0 p-5">
                    {currentImgLoading ? (
                      <div className="w-full rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-3 py-24">
                        <div className="w-8 h-8 border-2 border-mira-blue/30 border-t-mira-blue rounded-full animate-spin" />
                        <p className="text-sm text-slate-400 font-medium">Fetching detection data…</p>
                      </div>
                    ) : (
                      <ReviewOverlay
                        imageUrl={currentImg.url}
                        detections={overlayDetections}
                        mode={currentSubmitted ? 'view' : 'review'}
                        interactive={!currentSubmitted}
                        reviewStates={overlayStates}
                        selectedDetectionId={selectedDetectionId}
                        onSelectDetection={id => setSelectedDetectionId(id)}
                        onNaturalSize={(w, h) => setNaturalDims({ w, h })}
                        showLabels={showLabels}
                      >
                        {!currentSubmitted && naturalDims && (
                          <BboxEditor
                            bbox={editorBbox}
                            imageNaturalWidth={naturalDims.w}
                            imageNaturalHeight={naturalDims.h}
                            mode={editorMode}
                            shapeType={editorShapeType}
                            color={editorColor}
                            onChange={handleEditorChange}
                            onDrawComplete={handleDrawComplete}
                            onDrawCancel={() => { /* <5px or Escape mid-drag — stay in tool for retry */ }}
                          />
                        )}
                      </ReviewOverlay>
                    )}
                    {drawing && (
                      <p className="text-sm text-emerald-700 mt-2 font-medium">
                        Drag on the image to draw the new {tool === 'oval' ? 'oval' : 'box'}. Press Esc to cancel.
                      </p>
                    )}
                    {!drawing && editingDetId && editorMode === 'edit' && (
                      <p className="text-sm text-amber-700 mt-2 font-medium">Drag the shape to move it, or pull the handles to resize. Changes are saved with your review.</p>
                    )}
                  </div>

                  {/* Right: per-detection action panel */}
                  <div className="w-[360px] flex-shrink-0 border-l border-slate-100 bg-slate-50/40">
                    <ReviewPanel
                      detections={allServerDets}
                      drafts={currentDrafts}
                      states={currentStates}
                      imageSubmitted={currentSubmitted}
                      selectedDetectionId={selectedDetectionId}
                      category={category}
                      assetType={currentAssetType}
                      assetTypeSaving={assetTypeMutation.isPending}
                      assetTypeMissing={assetTypeMissing}
                      labelsFocusToken={labelsFocusToken}
                      missingHints={missingHints}
                      onAssetTypeChange={v => {
                        if (v && currentImg) assetTypeMutation.mutate({ imageId: currentImg.id, assetType: v });
                      }}
                      onSelectDetection={id => setSelectedDetectionId(id)}
                      onAction={handleReviewAction}
                      onUpdateState={handleUpdateReviewState}
                      onUpdateDraft={handleUpdateDraft}
                      onRemoveDraft={handleRemoveDraft}
                    />
                  </div>
                </div>
              </div>
            ) : currentImg ? (
              <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
                {/* Image header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <ImageIcon size={18} className="text-mira-muted" />
                    <span className="text-base font-semibold text-slate-700 truncate">{currentImg.filename}</span>
                    <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${
                      currentImg.analysis_status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                      currentImg.analysis_status === 'queued' ? 'bg-amber-50 text-amber-700' :
                      currentImg.analysis_status === 'processing' ? 'bg-sky-50 text-sky-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>{currentImg.analysis_status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {currentImg.analysis_status !== 'completed' && !analyzing && (
                      <button onClick={() => handleAnalyze(currentImg.id)}
                        className="flex items-center gap-1.5 text-sm text-white font-medium bg-mira-blue px-3 py-1.5 rounded-md hover:bg-sky-700 transition-all">
                        <Scan size={14} /> Run Analysis
                      </button>
                    )}
                    {analyzing === currentImg.id && (
                      <span className="flex items-center gap-1.5 text-sm text-mira-blue font-medium">
                        <Loader size={14} className="animate-spin" /> Analyzing…
                      </span>
                    )}
                    <button onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))}
                      className="flex items-center gap-1.5 text-sm text-slate-600 font-medium bg-slate-100 px-3 py-1.5 rounded-md hover:bg-slate-200 transition-all">
                      <ZoomIn size={14} /> Full Screen
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
                          <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Original</div>
                          <img src={currentImg.url} alt="Original"
                            className="w-full rounded-lg border border-slate-200"
                            onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">AI Analysis</div>
                          <div className="w-full rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-3 py-16">
                            <div className="w-8 h-8 border-2 border-mira-blue/30 border-t-mira-blue rounded-full animate-spin" />
                            <p className="text-sm text-slate-400 font-medium">Fetching detection data…</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : currentResult && !currentResult.error && currentResult.detections?.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Original</p>
                        <img src={currentImg.url} alt="Original"
                          className="w-full rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">AI Analysis</p>
                        <ReviewOverlay
                          imageUrl={currentImg.url}
                          detections={currentResult.detections}
                          mode="view"
                          showLabels={showLabels}
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
                      <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Detection Results</h3>
                      <span className="text-sm text-mira-muted font-mono">
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
                                <span className={`text-base font-semibold ${cfg.tw.text}`}>{d.damage_type}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-500"
                                      style={{ width: `${d.confidence * 100}%`, background: cfg.stroke }} />
                                  </div>
                                  <span className="text-sm text-mira-muted font-mono w-10 text-right">{(d.confidence * 100).toFixed(0)}%</span>
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
                          <p className="text-base font-semibold text-emerald-800">No Damage Detected</p>
                          <p className="text-sm text-emerald-600">This image passed AI analysis with no issues found.</p>
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
                        <p className="text-base font-semibold text-red-800">Analysis Failed</p>
                        <p className="text-sm text-red-600">{currentResult.error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl shadow-card p-12 text-center">
                <ImageIcon size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-base text-mira-muted">Select an image from the left panel to view details.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

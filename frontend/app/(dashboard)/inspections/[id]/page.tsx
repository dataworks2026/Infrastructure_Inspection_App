'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inspectionsApi, imagesApi, assetsApi, analysisApi } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ImageIcon, Loader, CheckCircle, AlertCircle, Scan, Shield, X, ChevronLeft, ChevronRight, ZoomIn, Eye, AlertTriangle, BarChart3, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

// Severity helpers
const severityConfig: Record<string, { label: string; color: string; bg: string; ring: string }> = {
  S0: { label: 'None',     color: 'text-emerald-700', bg: 'bg-emerald-50',  ring: 'ring-emerald-200' },
  S1: { label: 'Minor',    color: 'text-lime-700',    bg: 'bg-lime-50',     ring: 'ring-lime-200' },
  S2: { label: 'Moderate', color: 'text-amber-700',   bg: 'bg-amber-50',    ring: 'ring-amber-200' },
  S3: { label: 'Severe',   color: 'text-red-700',     bg: 'bg-red-50',      ring: 'ring-red-200' },
  S4: { label: 'Critical', color: 'text-purple-700',  bg: 'bg-purple-50',   ring: 'ring-purple-200' },
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

// Lightbox component for full-screen image viewing
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
  const annotatedUrl = result?.annotated_image_url;

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
      {/* Top bar */}
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
          {annotatedUrl && (
            <button onClick={() => setShowAnnotated(s => !s)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                showAnnotated ? 'bg-sky-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}>
              <Eye size={14} /> {showAnnotated ? 'Annotated' : 'Original'}
              <span className="text-[10px] opacity-60 ml-1">[A]</span>
            </button>
          )}
          <button onClick={onClose} className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-all">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div className="flex-1 flex items-center justify-center relative px-16 py-4" onClick={e => e.stopPropagation()}>
        {/* Nav arrows */}
        {images.length > 1 && (
          <>
            <button onClick={goPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
              <ChevronLeft size={20} />
            </button>
            <button onClick={goNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
              <ChevronRight size={20} />
            </button>
          </>
        )}

        {/* Image */}
        <img
          src={showAnnotated && annotatedUrl ? annotatedUrl : img.url}
          alt={img.filename}
          className="max-h-full max-w-full object-contain rounded-lg"
        />
      </div>

      {/* Bottom detection panel */}
      {result && result.total_detections > 0 && (
        <div className="bg-black/40 px-6 py-3 border-t border-white/10" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {result.detections?.map((d: any, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 flex-shrink-0">
                <span className="text-white text-xs font-semibold">{d.damage_type}</span>
                <span className="text-white/50 text-xs">{(d.confidence * 100).toFixed(0)}%</span>
                {d.severity && <SeverityBadge severity={d.severity} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InspectionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inspectionId = params.id as string;
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, any>>({});
  const [loadingDetections, setLoadingDetections] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  // Auto-select first image
  useEffect(() => {
    if (imagesLoaded && images.length > 0 && !selectedImage) {
      setSelectedImage(images[0].id);
    }
  }, [imagesLoaded, images, selectedImage]);

  // Auto-fetch detection results for all completed images
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

    async function fetchAllDetections() {
      const results: Record<string, any> = {};
      for (const img of completedImages) {
        if (cancelled) break;
        try {
          const detections = await analysisApi.getDetections(img.id);
          results[img.id] = detections;
        } catch {
          // Silently skip
        }
      }
      if (!cancelled) {
        setAnalysisResults(prev => ({ ...prev, ...results }));
        setLoadingDetections(false);
      }
    }

    fetchAllDetections();
    return () => { cancelled = true; };
  }, [imagesLoaded, images]);

  async function handleAnalyze(imageId: string) {
    setAnalyzing(imageId);
    try {
      const result = await analysisApi.analyze(imageId);
      setAnalysisResults(prev => ({ ...prev, [imageId]: result }));
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

  // Summary stats
  const completedCount = images.filter((img: any) => img.analysis_status === 'completed').length;
  const totalDetections = Object.values(analysisResults).reduce((sum: number, r: any) => sum + (r?.total_detections || 0), 0);
  const allSeverities = Object.values(analysisResults).flatMap((r: any) =>
    (r?.detections || []).map((d: any) => d.severity)
  ).filter(Boolean);
  const worstSeverity = allSeverities.sort().reverse()[0];
  const cleanCount = Object.values(analysisResults).filter((r: any) => r && !r.error && r.total_detections === 0).length;

  // Current selected image
  const currentImg = images.find((img: any) => img.id === selectedImage);
  const currentResult = currentImg ? analysisResults[currentImg.id] : null;

  return (
    <div>
      {/* Lightbox */}
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
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{inspection.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {asset && <span className="text-xs px-2.5 py-1 rounded-md font-medium bg-sky-100 text-sky-700">{asset.name}</span>}
              <span className={`text-xs px-2.5 py-1 rounded-md font-medium ${
                inspection.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                inspection.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                'bg-slate-100 text-slate-500'
              }`}>{inspection.status}</span>
              {inspection.weather_conditions && <span className="text-xs text-mira-faint">Weather: {inspection.weather_conditions}</span>}
              {inspection.inspector_name && <span className="text-xs text-mira-faint">Inspector: {inspection.inspector_name}</span>}
            </div>
          </div>
          {/* Delete button */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-lg transition-all"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Inspection"
        message={`"${inspection.name}" and all its images and detections will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Inspection"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Summary stats */}
      {!loadingDetections && completedCount > 0 && (
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
            <p className="text-2xl font-bold text-slate-800 font-mono">{totalDetections}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><CheckCircle size={14} className="text-emerald-600" /></div>
              <p className="text-xs font-semibold text-mira-muted uppercase tracking-wider">Clean Images</p>
            </div>
            <p className="text-2xl font-bold text-slate-800 font-mono">{cleanCount}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><BarChart3 size={14} className="text-red-600" /></div>
              <p className="text-xs font-semibold text-mira-muted uppercase tracking-wider">Worst Severity</p>
            </div>
            {worstSeverity ? <SeverityBadge severity={worstSeverity} size="lg" /> : (
              <span className="text-sm text-emerald-600 font-medium flex items-center gap-1 mt-1"><Shield size={14} /> All Clear</span>
            )}
          </div>
        </div>
      )}

      {loadingDetections && (
        <div className="flex items-center gap-3 text-sm text-mira-muted mb-6 bg-sky-50 border border-sky-100 rounded-xl px-4 py-3">
          <Loader size={16} className="animate-spin text-mira-blue" />
          Loading detection results...
        </div>
      )}

      {/* Main content: Thumbnail strip + Detail view */}
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
                {images.map((img: any, idx: number) => {
                  const r = analysisResults[img.id];
                  const hasDetections = r && !r.error && r.total_detections > 0;
                  const isSelected = img.id === selectedImage;

                  return (
                    <button key={img.id} onClick={() => setSelectedImage(img.id)}
                      className={`w-full text-left rounded-lg p-2 transition-all group ${
                        isSelected
                          ? 'bg-sky-50 ring-2 ring-sky-300'
                          : 'hover:bg-slate-50'
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
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <p className="text-[11px] font-medium text-slate-700 truncate leading-tight">
                            {img.filename.length > 20 ? img.filename.slice(0, 18) + '...' : img.filename}
                          </p>
                          <p className="text-[10px] text-mira-faint mt-0.5">
                            {img.analysis_status === 'completed' ? (
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
                        <Loader size={12} className="animate-spin" /> Analyzing...
                      </span>
                    )}
                    <button onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))}
                      className="flex items-center gap-1.5 text-xs text-slate-600 font-medium bg-slate-100 px-3 py-1.5 rounded-md hover:bg-slate-200 transition-all">
                      <ZoomIn size={12} /> Full Screen
                    </button>
                  </div>
                </div>

                {/* Image comparison area */}
                <div className="p-5">
                  {currentResult && !currentResult.error && currentResult.annotated_image_url ? (
                    // Side by side: Original + Annotated
                    <div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Original</p>
                          <img src={currentImg.url} alt="Original"
                            className="w-full rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">AI Annotated</p>
                          <img src={currentResult.annotated_image_url} alt="Annotated"
                            className="w-full rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Single image (no annotation yet)
                    <img src={currentImg.url} alt={currentImg.filename}
                      className="w-full max-h-[500px] object-contain rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setLightboxIndex(images.findIndex((i: any) => i.id === currentImg.id))} />
                  )}
                </div>

                {/* Detection results panel */}
                {currentResult && !currentResult.error && (
                  <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/30">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Detection Results
                      </h3>
                      <span className="text-xs text-mira-muted">
                        {currentResult.total_detections} finding{currentResult.total_detections !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {currentResult.total_detections > 0 ? (
                      <div className="space-y-2">
                        {currentResult.detections?.map((d: any, i: number) => (
                          <div key={i} className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${
                                d.severity === 'S0' ? 'bg-emerald-500' :
                                d.severity === 'S1' ? 'bg-lime-500' :
                                d.severity === 'S2' ? 'bg-amber-500' :
                                d.severity === 'S3' ? 'bg-red-500' :
                                'bg-purple-500'
                              }`} />
                              <span className="text-sm font-semibold text-slate-700">{d.damage_type}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {/* Confidence bar */}
                              <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-sky-500 rounded-full" style={{ width: `${d.confidence * 100}%` }} />
                                </div>
                                <span className="text-xs text-mira-muted font-mono w-10 text-right">{(d.confidence * 100).toFixed(0)}%</span>
                              </div>
                              {d.severity && <SeverityBadge severity={d.severity} />}
                            </div>
                          </div>
                        ))}
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

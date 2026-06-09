'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, GitCompareArrows, CalendarDays, AlertTriangle, CheckCircle,
  ChevronLeft, ChevronRight, Building2, TrendingDown, TrendingUp, Minus,
  ImageIcon, ScanSearch, X, Check,
} from 'lucide-react';
import { assetsApi, inspectionsApi, imagesApi } from '@/lib/api';
import type { Inspection, ImageRecord } from '@/types';

// ── Comparison Slider ──────────────────────────────────────────────────────
function ComparisonSlider({ beforeLabel, afterLabel, beforeContent, afterContent }: {
  beforeLabel: string;
  afterLabel: string;
  beforeContent: React.ReactNode;
  afterContent: React.ReactNode;
}) {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  }, []);

  const handleMouseDown = () => { isDragging.current = true; };
  const handleMouseUp   = () => { isDragging.current = false; };
  const handleMouseMove = (e: React.MouseEvent) => { if (isDragging.current) handleMove(e.clientX); };
  const handleTouchMove = (e: React.TouchEvent) => { handleMove(e.touches[0].clientX); };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full cursor-col-resize select-none overflow-hidden rounded-xl bg-slate-900"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    >
      {/* After (right side — full background) */}
      <div className="absolute inset-0">{afterContent}</div>

      {/* Before (left side — clipped) */}
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
        {beforeContent}
      </div>

      {/* Slider line + handle */}
      <div
        className="absolute top-0 bottom-0 z-10"
        style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
      >
        <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-xl flex items-center justify-center cursor-col-resize">
          <div className="flex items-center gap-0.5">
            <div className="w-0.5 h-4 bg-slate-400 rounded-full" />
            <div className="w-0.5 h-4 bg-slate-400 rounded-full" />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 z-10">
        <span className="bg-slate-900/80 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg">{beforeLabel}</span>
      </div>
      <div className="absolute top-4 right-4 z-10">
        <span className="bg-sky-600/90 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg">{afterLabel}</span>
      </div>
    </div>
  );
}

// ── Photo Card ──────────────────────────────────────────────────────────────
function PhotoCard({
  url, insp, onPickMatch, isPaired,
}: {
  url: string | null;
  insp: Inspection;
  onPickMatch?: () => void;
  isPaired?: boolean;
}) {
  const date = insp.inspected_at || insp.created_at;
  return (
    <div className="relative w-full h-full bg-slate-900">
      {url ? (
        <img src={url} alt={insp.name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full flex items-center justify-center opacity-30">
          <ImageIcon size={48} className="text-slate-400" />
        </div>
      )}

      {/* Pick match button — shown on the before (left) side only */}
      {onPickMatch && (
        <button
          onClick={onPickMatch}
          className="absolute top-14 left-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-colors"
          style={{
            background: isPaired ? 'rgba(16,185,129,0.85)' : 'rgba(99,102,241,0.85)',
            color: 'white',
            backdropFilter: 'blur(6px)',
            border: isPaired ? '1px solid rgba(52,211,153,0.5)' : '1px solid rgba(165,180,252,0.4)',
          }}
        >
          {isPaired ? <Check size={12} /> : <ScanSearch size={12} />}
          {isPaired ? 'Matched' : 'Pick match'}
        </button>
      )}

      {/* Info bar */}
      <div
        className="absolute bottom-0 left-0 right-0 px-4 py-3 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(15,23,42,0.92) 60%, transparent)' }}
      >
        <p className="text-white font-bold text-sm leading-tight truncate">{insp.name}</p>
        <p className="text-slate-300 text-xs mt-0.5">
          {new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

// ── Thumbnail Picker Overlay ────────────────────────────────────────────────
function ThumbnailPicker({
  images,
  currentIdx,
  onSelect,
  onClose,
  inspectionName,
}: {
  images: ImageRecord[];
  currentIdx: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
  inspectionName: string;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col"
      style={{ background: 'rgba(2,6,23,0.95)', backdropFilter: 'blur(8px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
        <div>
          <p className="text-white font-bold text-sm">Pick matching image</p>
          <p className="text-slate-400 text-xs mt-0.5">{inspectionName} · {images.length} images</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-4 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => { onSelect(i); onClose(); }}
              className="relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:opacity-90"
              style={{
                borderColor: i === currentIdx ? '#6366f1' : 'transparent',
                outline: i === currentIdx ? '2px solid rgba(99,102,241,0.4)' : 'none',
              }}
            >
              <img src={img.url} alt={img.filename} className="w-full h-full object-cover" draggable={false} />
              {i === currentIdx && (
                <div className="absolute inset-0 flex items-center justify-center bg-indigo-600/30">
                  <Check size={20} className="text-white drop-shadow" />
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}>
                <p className="text-white text-[9px] font-medium truncate">{i + 1}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="relative w-full h-full flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
      <div className="flex flex-col items-center gap-3 opacity-40">
        <div className="w-12 h-12 rounded-xl border-2 border-dashed border-slate-500 flex items-center justify-center">
          <CalendarDays size={20} className="text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium">{label}</p>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function ComparePage() {
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [beforeIdx, setBeforeIdx]             = useState<number>(0);
  const [afterIdx, setAfterIdx]               = useState<number>(1);
  const [pairIdx, setPairIdx]                 = useState<number>(0);
  // Maps afterImageIndex → beforeImageIndex (user-defined matches)
  const [pairMappings, setPairMappings]       = useState<Record<number, number>>({});
  const [showPicker, setShowPicker]           = useState(false);

  const { data: assets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(),
  });

  const { data: inspections = [] } = useQuery({
    queryKey: ['inspections', { asset_id: selectedAssetId }],
    queryFn: () => inspectionsApi.list({ asset_id: selectedAssetId }),
    enabled: !!selectedAssetId,
  });

  const sorted: Inspection[] = useMemo(() =>
    [...inspections].sort((a, b) =>
      new Date(a.inspected_at || a.created_at).getTime() -
      new Date(b.inspected_at || b.created_at).getTime()
    ), [inspections]);

  const before = sorted[beforeIdx] ?? null;
  const after  = sorted[afterIdx]  ?? null;

  const { data: beforeImages = [] } = useQuery({
    queryKey: ['images', before?.id],
    queryFn: () => imagesApi.list(before!.id),
    enabled: !!before?.id,
  });

  const { data: afterImages = [] } = useQuery({
    queryKey: ['images', after?.id],
    queryFn: () => imagesApi.list(after!.id),
    enabled: !!after?.id,
  });

  // Navigation is capped to the smaller set (after images = 6)
  const totalPairs   = Math.min(
    (beforeImages as ImageRecord[]).length,
    (afterImages  as ImageRecord[]).length,
  ) || 0;
  const safePairIdx  = Math.min(pairIdx, Math.max(0, totalPairs - 1));

  // After image: sequential
  const afterUrl = (afterImages as ImageRecord[])[safePairIdx]?.url ?? null;

  // Before image: use user-defined mapping if set, otherwise same index
  const mappedBeforeIdx = pairMappings[safePairIdx] ?? safePairIdx;
  const beforeUrl = (beforeImages as ImageRecord[])[mappedBeforeIdx]?.url ?? null;
  const isPaired  = pairMappings[safePairIdx] !== undefined;

  const diff = useMemo(() => {
    if (!before || !after) return null;
    const delta = after.image_count - before.image_count;
    return { delta, worsened: delta > 0, stable: delta === 0, improved: delta < 0 };
  }, [before, after]);

  function resetSelections(assetId: string) {
    setSelectedAssetId(assetId);
    setBeforeIdx(0);
    setAfterIdx(1);
    setPairIdx(0);
    setPairMappings({});
  }

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col -m-6">
      {/* Header */}
      <div className="px-6 py-4 bg-white/80 backdrop-blur-xl border-b border-slate-200 z-10 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/digital-twin"
              className="inline-flex items-center gap-2 text-sm text-mira-muted hover:text-mira-blue font-medium">
              <ArrowLeft size={15} /> Back
            </Link>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <GitCompareArrows size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-800">Temporal Comparison</h1>
                <p className="text-[10px] text-mira-muted">Track damage progression between inspections</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-slate-400" />
            <select
              value={selectedAssetId}
              onChange={e => resetSelections(e.target.value)}
              className="text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:border-violet-400 focus:outline-none"
            >
              <option value="">— Select Asset —</option>
              {(assets as any[]).map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Comparison viewer */}
        <div className="flex-1 p-4">
          <div className="w-full h-full bg-slate-900 rounded-2xl overflow-hidden shadow-xl border border-slate-700/50 relative">
            {!selectedAssetId ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <Building2 size={40} className="text-slate-600" />
                <p className="text-slate-400 font-medium">Select an asset to compare inspections</p>
              </div>
            ) : sorted.length < 2 ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <GitCompareArrows size={40} className="text-slate-600" />
                <p className="text-slate-400 font-medium">
                  {sorted.length === 0 ? 'No inspections for this asset' : 'Need at least 2 inspections to compare'}
                </p>
              </div>
            ) : (
              <>
                <ComparisonSlider
                  beforeLabel={before ? new Date(before.inspected_at || before.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                  afterLabel={after  ? new Date(after.inspected_at  || after.created_at ).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                  beforeContent={before
                    ? <PhotoCard
                        url={beforeUrl}
                        insp={before}
                        onPickMatch={() => setShowPicker(true)}
                        isPaired={isPaired}
                      />
                    : <EmptyCard label="Select before" />}
                  afterContent={after
                    ? <PhotoCard url={afterUrl} insp={after} />
                    : <EmptyCard label="Select after" />}
                />

                {/* Thumbnail picker overlay */}
                {showPicker && (
                  <ThumbnailPicker
                    images={beforeImages as ImageRecord[]}
                    currentIdx={mappedBeforeIdx}
                    onSelect={idx => setPairMappings(m => ({ ...m, [safePairIdx]: idx }))}
                    onClose={() => setShowPicker(false)}
                    inspectionName={before?.name ?? ''}
                  />
                )}

                {/* Image pair navigation */}
                {totalPairs > 0 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-slate-900/85 backdrop-blur-sm px-4 py-2 rounded-full border border-slate-700">
                    <button
                      onClick={() => setPairIdx(i => Math.max(0, i - 1))}
                      disabled={safePairIdx === 0}
                      className="text-white disabled:opacity-30 hover:text-sky-400 transition-colors"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-white text-xs font-bold tabular-nums">
                      Image {safePairIdx + 1} / {totalPairs}
                    </span>
                    <button
                      onClick={() => setPairIdx(i => Math.min(totalPairs - 1, i + 1))}
                      disabled={safePairIdx === totalPairs - 1}
                      className="text-white disabled:opacity-30 hover:text-sky-400 transition-colors"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-72 bg-white border-l border-slate-200 flex flex-col">
          {selectedAssetId && sorted.length >= 2 ? (
            <>
              {/* Inspection selectors */}
              <div className="px-4 py-3 border-b border-slate-100 space-y-3">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">Select Inspections</h3>
                <div>
                  <label className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider block mb-1">Before</label>
                  <select
                    value={beforeIdx}
                    onChange={e => { setBeforeIdx(Number(e.target.value)); setPairIdx(0); setPairMappings({}); }}
                    className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:border-indigo-400 focus:outline-none"
                  >
                    {sorted.map((insp, i) => (
                      <option key={insp.id} value={i} disabled={i === afterIdx}>
                        {new Date(insp.inspected_at || insp.created_at).toLocaleDateString()} — {insp.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-sky-600 uppercase tracking-wider block mb-1">After</label>
                  <select
                    value={afterIdx}
                    onChange={e => { setAfterIdx(Number(e.target.value)); setPairIdx(0); setPairMappings({}); }}
                    className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:border-sky-400 focus:outline-none"
                  >
                    {sorted.map((insp, i) => (
                      <option key={insp.id} value={i} disabled={i === beforeIdx}>
                        {new Date(insp.inspected_at || insp.created_at).toLocaleDateString()} — {insp.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pair progress */}
              {totalPairs > 0 && (
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-2">Matched Pairs</h3>
                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from({ length: totalPairs }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setPairIdx(i)}
                        className="w-7 h-7 rounded-lg text-[10px] font-bold transition-all"
                        style={{
                          background: i === safePairIdx
                            ? '#6366f1'
                            : pairMappings[i] !== undefined
                              ? '#10b981'
                              : '#f1f5f9',
                          color: i === safePairIdx || pairMappings[i] !== undefined ? 'white' : '#94a3b8',
                          border: i === safePairIdx ? '2px solid #818cf8' : '2px solid transparent',
                        }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">
                    {Object.keys(pairMappings).length}/{totalPairs} matched ·{' '}
                    <span className="text-indigo-500">Click left side "Pick match"</span>
                  </p>
                </div>
              )}

              {/* All inspections list */}
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-2">All Inspections ({sorted.length})</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {sorted.map((insp, i) => {
                  const isBefore = i === beforeIdx;
                  const isAfter  = i === afterIdx;
                  const date     = insp.inspected_at || insp.created_at;
                  return (
                    <div key={insp.id}
                      className={`p-3 rounded-xl border transition-all ${
                        isBefore ? 'border-indigo-200 bg-indigo-50' :
                        isAfter  ? 'border-sky-200 bg-sky-50' :
                        'border-slate-100 bg-white'
                      }`}>
                      <div className="flex items-start justify-between">
                        <p className="text-[12px] font-semibold text-slate-700 flex-1">{insp.name}</p>
                        <div className="flex gap-1 ml-1">
                          {isBefore && <span className="text-[8px] font-bold bg-indigo-500 text-white px-1.5 py-0.5 rounded">B</span>}
                          {isAfter  && <span className="text-[8px] font-bold bg-sky-500    text-white px-1.5 py-0.5 rounded">A</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <CalendarDays size={10} className="text-slate-400" />
                        <span className="text-[10px] text-slate-500">{new Date(date).toLocaleDateString()}</span>
                        <span className="text-[10px] text-slate-400">·</span>
                        <span className="text-[10px] text-slate-500">{insp.image_count} imgs</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Diff summary */}
              {diff && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Change Summary</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      {diff.worsened
                        ? <TrendingDown size={13} className="text-red-500" />
                        : diff.improved
                          ? <TrendingUp size={13} className="text-emerald-500" />
                          : <Minus size={13} className="text-slate-400" />}
                      <span className="text-slate-600">
                        {diff.worsened
                          ? `+${diff.delta} images added`
                          : diff.improved
                            ? `${diff.delta} fewer images`
                            : 'No change in image count'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      {diff.worsened
                        ? <AlertTriangle size={13} className="text-amber-500" />
                        : <CheckCircle   size={13} className="text-emerald-500" />}
                      <span className="text-slate-600">
                        {diff.worsened ? 'Potential progression' : diff.improved ? 'Improvement' : 'Stable'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <GitCompareArrows size={32} className="text-slate-300" />
              <p className="text-sm font-medium text-slate-400">
                {!selectedAssetId
                  ? 'Select an asset to see its inspection history'
                  : 'Need at least 2 inspections for comparison'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

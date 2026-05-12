'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitCompareArrows, CalendarDays, AlertTriangle, CheckCircle, ArrowRight, Building2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { assetsApi, inspectionsApi } from '@/lib/api';
import type { Inspection } from '@/types';

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
  const handleMouseUp = () => { isDragging.current = false; };
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

      {/* Slider line */}
      <div className="absolute top-0 bottom-0 z-10" style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
        onMouseDown={handleMouseDown} onTouchStart={handleMouseDown}>
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

function InspectionCard({ insp, tint }: { insp: Inspection; tint: string }) {
  const date = insp.inspected_at || insp.created_at;
  return (
    <div className="relative w-full h-full"
      style={{ background: `linear-gradient(135deg, ${tint}18 0%, #0f172a 100%)` }}>
      {/* Subtle center icon — decorative only */}
      <div className="absolute inset-0 flex items-center justify-center opacity-10">
        <CalendarDays size={96} style={{ color: tint }} />
      </div>
      {/* Info bar pinned to bottom */}
      <div className="absolute bottom-0 left-0 right-0 px-5 py-4"
        style={{ background: 'linear-gradient(to top, rgba(15,23,42,0.95) 70%, transparent)' }}>
        <p className="text-white font-bold text-base leading-tight truncate">{insp.name}</p>
        <p className="text-slate-300 text-sm mt-0.5">
          {new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-slate-400 text-xs">{insp.image_count} image{insp.image_count !== 1 ? 's' : ''}</span>
          <span className="text-slate-600 text-xs">·</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            insp.status === 'completed' ? 'bg-emerald-900/60 text-emerald-400' :
            insp.status === 'pending'   ? 'bg-amber-900/60 text-amber-400' :
            'bg-slate-700 text-slate-400'
          }`}>{insp.status}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ label }: { label: string; tint: string }) {
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

export default function ComparePage() {
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [beforeIdx, setBeforeIdx] = useState<number>(0);
  const [afterIdx, setAfterIdx] = useState<number>(1);

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

  const diff = useMemo(() => {
    if (!before || !after) return null;
    const delta = after.image_count - before.image_count;
    return { delta, worsened: delta > 0, stable: delta === 0, improved: delta < 0 };
  }, [before, after]);

  const selectedAsset = assets.find((a: any) => a.id === selectedAssetId);

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

          {/* Asset selector */}
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-slate-400" />
            <select
              value={selectedAssetId}
              onChange={e => { setSelectedAssetId(e.target.value); setBeforeIdx(0); setAfterIdx(1); }}
              className="text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:border-violet-400 focus:outline-none">
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
          <div className="w-full h-full bg-slate-900 rounded-2xl overflow-hidden shadow-xl border border-slate-700/50">
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
              <ComparisonSlider
                beforeLabel={before ? new Date(before.inspected_at || before.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                afterLabel={after ? new Date(after.inspected_at || after.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                beforeContent={before
                  ? <InspectionCard insp={before} tint="#6366f1" />
                  : <EmptyCard label="Select before" tint="#6366f1" />}
                afterContent={after
                  ? <InspectionCard insp={after} tint="#0ea5e9" />
                  : <EmptyCard label="Select after" tint="#0ea5e9" />}
              />
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
                  <select value={beforeIdx} onChange={e => setBeforeIdx(Number(e.target.value))}
                    className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:border-indigo-400 focus:outline-none">
                    {sorted.map((insp, i) => (
                      <option key={insp.id} value={i} disabled={i === afterIdx}>
                        {new Date(insp.inspected_at || insp.created_at).toLocaleDateString()} — {insp.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-sky-600 uppercase tracking-wider block mb-1">After</label>
                  <select value={afterIdx} onChange={e => setAfterIdx(Number(e.target.value))}
                    className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:border-sky-400 focus:outline-none">
                    {sorted.map((insp, i) => (
                      <option key={insp.id} value={i} disabled={i === beforeIdx}>
                        {new Date(insp.inspected_at || insp.created_at).toLocaleDateString()} — {insp.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* All inspections list */}
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-2">All Inspections ({sorted.length})</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {sorted.map((insp, i) => {
                  const isBefore = i === beforeIdx;
                  const isAfter = i === afterIdx;
                  const date = insp.inspected_at || insp.created_at;
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
                          {isAfter  && <span className="text-[8px] font-bold bg-sky-500 text-white px-1.5 py-0.5 rounded">A</span>}
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
                        : <CheckCircle size={13} className="text-emerald-500" />}
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

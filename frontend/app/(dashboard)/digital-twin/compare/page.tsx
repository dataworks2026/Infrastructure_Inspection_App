'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, GitCompareArrows, Upload, CalendarDays, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';

// Demo comparison data
const DEMO_COMPARISONS = [
  {
    id: '1',
    label: 'Blade 1 — Leading Edge',
    before: { date: 'Jan 2025', detections: 1, severity: 'S1' },
    after: { date: 'Jun 2025', detections: 3, severity: 'S3' },
    status: 'worsened',
  },
  {
    id: '2',
    label: 'Blade 2 — Root Section',
    before: { date: 'Jan 2025', detections: 2, severity: 'S2' },
    after: { date: 'Jun 2025', detections: 2, severity: 'S2' },
    status: 'stable',
  },
  {
    id: '3',
    label: 'Blade 3 — Tip Area',
    before: { date: 'Jan 2025', detections: 0, severity: 'S0' },
    after: { date: 'Jun 2025', detections: 1, severity: 'S2' },
    status: 'new',
  },
];

// Image comparison slider component
function ComparisonSlider({ beforeUrl, afterUrl, beforeLabel, afterLabel }: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
  afterLabel: string;
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
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) handleMove(e.clientX);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full cursor-col-resize select-none overflow-hidden rounded-xl"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    >
      {/* After image (full width background) */}
      <div className="absolute inset-0">
        <img src={afterUrl} alt="After" className="w-full h-full object-cover" />
      </div>

      {/* Before image (clipped) */}
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
        <img src={beforeUrl} alt="Before" className="w-full h-full object-cover" />
      </div>

      {/* Slider line */}
      <div className="absolute top-0 bottom-0 z-10" style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}>
        <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
        {/* Handle */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-xl flex items-center justify-center cursor-col-resize">
          <div className="flex items-center gap-0.5">
            <div className="w-0.5 h-4 bg-slate-400 rounded-full" />
            <div className="w-0.5 h-4 bg-slate-400 rounded-full" />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 z-10">
        <span className="bg-slate-900/80 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg">
          {beforeLabel}
        </span>
      </div>
      <div className="absolute top-4 right-4 z-10">
        <span className="bg-sky-600/90 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg">
          {afterLabel}
        </span>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [selectedComparison, setSelectedComparison] = useState('1');
  const [beforeImage, setBeforeImage] = useState<string | null>(null);
  const [afterImage, setAfterImage] = useState<string | null>(null);

  // Use demo placeholder images (gradient overlays representing drone imagery)
  const demoBeforeUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1e293b"/><stop offset="100%" style="stop-color:#334155"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#g1)"/>
    <text x="400" y="280" text-anchor="middle" fill="#64748b" font-size="18" font-family="sans-serif">January 2025 Inspection</text>
    <text x="400" y="310" text-anchor="middle" fill="#475569" font-size="14" font-family="sans-serif">Blade surface - minimal wear</text>
    <circle cx="350" cy="400" r="15" fill="none" stroke="#65a30d" stroke-width="2" stroke-dasharray="4"/><text x="350" y="405" text-anchor="middle" fill="#65a30d" font-size="10" font-family="sans-serif">S1</text>
  </svg>`);

  const demoAfterUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#0f172a"/><stop offset="100%" style="stop-color:#1e293b"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#g2)"/>
    <text x="400" y="280" text-anchor="middle" fill="#64748b" font-size="18" font-family="sans-serif">June 2025 Inspection</text>
    <text x="400" y="310" text-anchor="middle" fill="#475569" font-size="14" font-family="sans-serif">Blade surface - damage progression</text>
    <circle cx="350" cy="400" r="15" fill="none" stroke="#dc2626" stroke-width="2"/><text x="350" y="405" text-anchor="middle" fill="#dc2626" font-size="10" font-family="sans-serif">S3</text>
    <circle cx="450" cy="350" r="12" fill="none" stroke="#d97706" stroke-width="2"/><text x="450" y="355" text-anchor="middle" fill="#d97706" font-size="10" font-family="sans-serif">S2</text>
    <circle cx="300" cy="450" r="10" fill="none" stroke="#d97706" stroke-width="2"/><text x="300" y="455" text-anchor="middle" fill="#d97706" font-size="10" font-family="sans-serif">S2</text>
  </svg>`);

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col -m-6">
      {/* Header */}
      <div className="px-6 py-4 bg-white/80 backdrop-blur-xl border-b border-slate-200 z-10 flex-shrink-0">
        <div className="flex items-center justify-between">
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
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg cursor-pointer transition-all">
              <Upload size={13} /> Upload Before
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0];
                if (f) setBeforeImage(URL.createObjectURL(f));
              }} />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-white bg-gradient-to-r from-violet-500 to-purple-600 px-3.5 py-2 rounded-lg cursor-pointer shadow-md hover:shadow-lg transition-all">
              <Upload size={13} /> Upload After
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0];
                if (f) setAfterImage(URL.createObjectURL(f));
              }} />
            </label>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Comparison viewer */}
        <div className="flex-1 p-4">
          <div className="w-full h-full bg-slate-900 rounded-2xl overflow-hidden shadow-xl border border-slate-700/50">
            <ComparisonSlider
              beforeUrl={beforeImage || demoBeforeUrl}
              afterUrl={afterImage || demoAfterUrl}
              beforeLabel="Before — Jan 2025"
              afterLabel="After — Jun 2025"
            />
          </div>
        </div>

        {/* Right sidebar: comparison timeline */}
        <div className="w-72 bg-white border-l border-slate-200 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">Comparison Points</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {DEMO_COMPARISONS.map((comp) => {
              const isSelected = comp.id === selectedComparison;
              return (
                <button key={comp.id} onClick={() => setSelectedComparison(comp.id)}
                  className={`w-full text-left p-3 rounded-xl transition-all ${
                    isSelected ? 'bg-violet-50 ring-1 ring-violet-200' : 'hover:bg-slate-50'
                  }`}>
                  <p className="text-[12px] font-semibold text-slate-700">{comp.label}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <CalendarDays size={10} /> {comp.before.date}
                    </div>
                    <ArrowRight size={10} className="text-slate-300" />
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <CalendarDays size={10} /> {comp.after.date}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${
                      comp.status === 'worsened' ? 'bg-red-50 text-red-600' :
                      comp.status === 'new' ? 'bg-amber-50 text-amber-600' :
                      'bg-emerald-50 text-emerald-600'
                    }`}>
                      {comp.status === 'worsened' ? '↑ Worsened' :
                       comp.status === 'new' ? '⚡ New damage' :
                       '✓ Stable'}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {comp.before.detections} → {comp.after.detections} detections
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Summary */}
          <div className="border-t border-slate-100 p-4 bg-slate-50/50">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Change Summary</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <AlertTriangle size={13} className="text-red-500" />
                <span className="text-slate-600">1 area worsened</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <AlertTriangle size={13} className="text-amber-500" />
                <span className="text-slate-600">1 new damage found</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <CheckCircle size={13} className="text-emerald-500" />
                <span className="text-slate-600">1 area stable</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

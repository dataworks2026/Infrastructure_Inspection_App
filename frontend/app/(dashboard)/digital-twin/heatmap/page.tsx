'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Flame, Wind, Waves, Building2, TrainFront, Info } from 'lucide-react';

// Blade damage zones (zones along a turbine blade)
const BLADE_ZONES = [
  { id: 'root',     label: 'Root', start: 0,   end: 15 },
  { id: 'inner',    label: 'Inner', start: 15,  end: 35 },
  { id: 'mid',      label: 'Mid', start: 35,   end: 60 },
  { id: 'outer',    label: 'Outer', start: 60,  end: 80 },
  { id: 'tip',      label: 'Tip', start: 80,   end: 100 },
];

const BLADE_EDGES = ['leading', 'surface', 'trailing'] as const;

// Demo damage data per zone
interface ZoneData { count: number; maxSeverity: string; types: string[] }

const DEMO_DAMAGE_MAP: Record<string, ZoneData> = {
  // Blade 1
  'b1-root-leading':    { count: 0, maxSeverity: 'S0', types: [] },
  'b1-root-surface':    { count: 1, maxSeverity: 'S1', types: ['Minor scratch'] },
  'b1-root-trailing':   { count: 0, maxSeverity: 'S0', types: [] },
  'b1-inner-leading':   { count: 2, maxSeverity: 'S2', types: ['Leading edge erosion', 'Pitting'] },
  'b1-inner-surface':   { count: 0, maxSeverity: 'S0', types: [] },
  'b1-inner-trailing':  { count: 0, maxSeverity: 'S0', types: [] },
  'b1-mid-leading':     { count: 3, maxSeverity: 'S3', types: ['Deep erosion', 'Crack initiation', 'Delamination'] },
  'b1-mid-surface':     { count: 1, maxSeverity: 'S2', types: ['Surface crack'] },
  'b1-mid-trailing':    { count: 1, maxSeverity: 'S2', types: ['Trailing edge split'] },
  'b1-outer-leading':   { count: 2, maxSeverity: 'S3', types: ['Severe erosion', 'Material loss'] },
  'b1-outer-surface':   { count: 0, maxSeverity: 'S0', types: [] },
  'b1-outer-trailing':  { count: 0, maxSeverity: 'S0', types: [] },
  'b1-tip-leading':     { count: 1, maxSeverity: 'S4', types: ['Lightning strike damage'] },
  'b1-tip-surface':     { count: 1, maxSeverity: 'S3', types: ['Structural crack'] },
  'b1-tip-trailing':    { count: 0, maxSeverity: 'S0', types: [] },
  // Blade 2
  'b2-root-leading':    { count: 0, maxSeverity: 'S0', types: [] },
  'b2-root-surface':    { count: 0, maxSeverity: 'S0', types: [] },
  'b2-root-trailing':   { count: 0, maxSeverity: 'S0', types: [] },
  'b2-inner-leading':   { count: 1, maxSeverity: 'S1', types: ['Light erosion'] },
  'b2-inner-surface':   { count: 0, maxSeverity: 'S0', types: [] },
  'b2-inner-trailing':  { count: 0, maxSeverity: 'S0', types: [] },
  'b2-mid-leading':     { count: 1, maxSeverity: 'S2', types: ['Moderate erosion'] },
  'b2-mid-surface':     { count: 0, maxSeverity: 'S0', types: [] },
  'b2-mid-trailing':    { count: 0, maxSeverity: 'S0', types: [] },
  'b2-outer-leading':   { count: 0, maxSeverity: 'S0', types: [] },
  'b2-outer-surface':   { count: 1, maxSeverity: 'S1', types: ['Surface blemish'] },
  'b2-outer-trailing':  { count: 0, maxSeverity: 'S0', types: [] },
  'b2-tip-leading':     { count: 0, maxSeverity: 'S0', types: [] },
  'b2-tip-surface':     { count: 0, maxSeverity: 'S0', types: [] },
  'b2-tip-trailing':    { count: 0, maxSeverity: 'S0', types: [] },
  // Blade 3
  'b3-root-leading':    { count: 0, maxSeverity: 'S0', types: [] },
  'b3-root-surface':    { count: 0, maxSeverity: 'S0', types: [] },
  'b3-root-trailing':   { count: 0, maxSeverity: 'S0', types: [] },
  'b3-inner-leading':   { count: 0, maxSeverity: 'S0', types: [] },
  'b3-inner-surface':   { count: 0, maxSeverity: 'S0', types: [] },
  'b3-inner-trailing':  { count: 1, maxSeverity: 'S1', types: ['Minor crack'] },
  'b3-mid-leading':     { count: 1, maxSeverity: 'S2', types: ['Erosion patch'] },
  'b3-mid-surface':     { count: 0, maxSeverity: 'S0', types: [] },
  'b3-mid-trailing':    { count: 0, maxSeverity: 'S0', types: [] },
  'b3-outer-leading':   { count: 1, maxSeverity: 'S2', types: ['Leading edge erosion'] },
  'b3-outer-surface':   { count: 1, maxSeverity: 'S2', types: ['Coating damage'] },
  'b3-outer-trailing':  { count: 0, maxSeverity: 'S0', types: [] },
  'b3-tip-leading':     { count: 0, maxSeverity: 'S0', types: [] },
  'b3-tip-surface':     { count: 0, maxSeverity: 'S0', types: [] },
  'b3-tip-trailing':    { count: 0, maxSeverity: 'S0', types: [] },
};

const SEVERITY_COLORS: Record<string, string> = {
  S0: '#e2e8f0', S1: '#84cc16', S2: '#f59e0b', S3: '#ef4444', S4: '#a855f7',
};

const SEVERITY_LABELS: Record<string, string> = {
  S0: 'None', S1: 'Minor', S2: 'Moderate', S3: 'Severe', S4: 'Critical',
};

function getHeatColor(severity: string): string {
  return SEVERITY_COLORS[severity] || SEVERITY_COLORS.S0;
}

export default function HeatmapPage() {
  const [selectedBlade, setSelectedBlade] = useState(1);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const bladeKey = `b${selectedBlade}`;
  const hoveredData = hoveredZone ? DEMO_DAMAGE_MAP[hoveredZone] : null;
  const selectedData = selectedZone ? DEMO_DAMAGE_MAP[selectedZone] : null;

  // Stats for selected blade
  const bladeStats = useMemo(() => {
    let totalDamage = 0;
    let worstSev = 'S0';
    const sevOrder = ['S0', 'S1', 'S2', 'S3', 'S4'];
    Object.entries(DEMO_DAMAGE_MAP).forEach(([key, val]) => {
      if (key.startsWith(bladeKey)) {
        totalDamage += val.count;
        if (sevOrder.indexOf(val.maxSeverity) > sevOrder.indexOf(worstSev)) {
          worstSev = val.maxSeverity;
        }
      }
    });
    return { totalDamage, worstSev };
  }, [bladeKey]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/digital-twin"
            className="inline-flex items-center gap-2 text-sm text-mira-muted hover:text-mira-blue font-medium">
            <ArrowLeft size={15} /> Back
          </Link>
          <div className="w-px h-6 bg-slate-200" />
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Flame size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Damage Heatmap</h1>
              <p className="text-[10px] text-mira-muted">Blade damage density visualization</p>
            </div>
          </div>
        </div>

        {/* Blade selector */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {[1, 2, 3].map(b => (
            <button key={b} onClick={() => { setSelectedBlade(b); setSelectedZone(null); }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                selectedBlade === b
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              Blade {b}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Heatmap grid */}
        <div className="col-span-8">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-6">
            {/* Blade diagram header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-700">Blade {selectedBlade} — Damage Distribution</h2>
                <p className="text-[10px] text-mira-faint mt-0.5">
                  {bladeStats.totalDamage} total detections · Worst: {bladeStats.worstSev} ({SEVERITY_LABELS[bladeStats.worstSev]})
                </p>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-mira-faint">
                <Info size={10} /> Click a cell for details
              </div>
            </div>

            {/* SVG Blade heatmap */}
            <div className="relative">
              {/* Axis labels */}
              <div className="flex items-center mb-1 ml-20">
                {BLADE_ZONES.map(z => (
                  <div key={z.id} className="flex-1 text-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                    {z.label}
                  </div>
                ))}
              </div>
              <div className="flex items-center text-[8px] text-mira-faint mb-3 ml-20">
                {BLADE_ZONES.map(z => (
                  <div key={z.id} className="flex-1 text-center">
                    {z.start}–{z.end}%
                  </div>
                ))}
              </div>

              {/* Heatmap grid */}
              {BLADE_EDGES.map(edge => (
                <div key={edge} className="flex items-center mb-1.5">
                  <div className="w-20 text-right pr-3 text-[10px] font-semibold text-slate-500 capitalize">{edge}</div>
                  <div className="flex-1 flex gap-1.5">
                    {BLADE_ZONES.map(zone => {
                      const key = `${bladeKey}-${zone.id}-${edge}`;
                      const data = DEMO_DAMAGE_MAP[key] || { count: 0, maxSeverity: 'S0', types: [] };
                      const color = getHeatColor(data.maxSeverity);
                      const isHovered = hoveredZone === key;
                      const isSelected = selectedZone === key;

                      return (
                        <button
                          key={key}
                          className={`flex-1 h-16 rounded-lg transition-all relative group ${
                            isSelected ? 'ring-2 ring-slate-800 ring-offset-2' : ''
                          }`}
                          style={{
                            background: data.count > 0
                              ? `linear-gradient(135deg, ${color}40, ${color}90)`
                              : '#f8fafc',
                            border: `1px solid ${data.count > 0 ? color + '50' : '#e2e8f0'}`,
                            transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                          }}
                          onMouseEnter={() => setHoveredZone(key)}
                          onMouseLeave={() => setHoveredZone(null)}
                          onClick={() => setSelectedZone(isSelected ? null : key)}
                        >
                          {data.count > 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-lg font-bold" style={{ color: color }}>{data.count}</span>
                              <span className="text-[8px] font-bold" style={{ color: color }}>{data.maxSeverity}</span>
                            </div>
                          )}
                          {data.count === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-[10px] text-slate-300">—</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Blade shape outline SVG */}
              <div className="mt-4 ml-20">
                <svg viewBox="0 0 500 30" className="w-full h-8">
                  <defs>
                    <linearGradient id="bladeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <path d="M0,15 Q10,5 30,8 L470,4 Q500,3 500,15 Q500,27 470,26 L30,22 Q10,25 0,15Z"
                    fill="url(#bladeGrad)" stroke="#94a3b8" strokeWidth="0.5" />
                  <text x="250" y="18" textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="bold">
                    ← Root — Blade Span — Tip →
                  </text>
                </svg>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-6 pt-4 border-t border-slate-100">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Severity</span>
              {Object.entries(SEVERITY_COLORS).map(([sev, color]) => (
                <div key={sev} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: sev === 'S0' ? '#f1f5f9' : color }} />
                  <span className="text-[10px] text-slate-600 font-medium">{sev} {SEVERITY_LABELS[sev]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: Zone details */}
        <div className="col-span-4 space-y-4">
          {/* Zone detail card */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">Zone Detail</h3>
            {selectedData && selectedZone ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-4 h-4 rounded" style={{ background: getHeatColor(selectedData.maxSeverity) }} />
                  <span className="text-sm font-bold text-slate-800 capitalize">
                    {selectedZone.replace(`${bladeKey}-`, '').replace('-', ' · ')}
                  </span>
                </div>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-mira-muted">Detections</span>
                    <span className="font-bold text-slate-700">{selectedData.count}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-mira-muted">Max Severity</span>
                    <span className="font-bold" style={{ color: getHeatColor(selectedData.maxSeverity) }}>
                      {selectedData.maxSeverity} — {SEVERITY_LABELS[selectedData.maxSeverity]}
                    </span>
                  </div>
                </div>
                {selectedData.types.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Damage Types</p>
                    <div className="space-y-1.5">
                      {selectedData.types.map((t, i) => (
                        <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: getHeatColor(selectedData.maxSeverity) }} />
                          <span className="text-[11px] text-slate-700 font-medium">{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <Flame size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-xs text-mira-muted">Click a heatmap cell to see details</p>
              </div>
            )}
          </div>

          {/* Overall blade stats */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">Blade {selectedBlade} Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-mira-muted">Total Detections</span>
                <span className="text-lg font-bold text-slate-800">{bladeStats.totalDamage}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-mira-muted">Worst Severity</span>
                <span className="text-sm font-bold px-2 py-0.5 rounded-md" style={{
                  color: getHeatColor(bladeStats.worstSev),
                  background: getHeatColor(bladeStats.worstSev) + '20',
                }}>
                  {bladeStats.worstSev} {SEVERITY_LABELS[bladeStats.worstSev]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-mira-muted">Hotspot</span>
                <span className="text-xs font-semibold text-red-600">
                  {selectedBlade === 1 ? 'Mid-Outer Leading Edge' :
                   selectedBlade === 2 ? 'Mid Leading Edge' : 'Outer Leading Edge'}
                </span>
              </div>

              {/* Severity distribution bar */}
              <div className="mt-2 pt-2 border-t border-slate-100">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Distribution</p>
                <div className="flex gap-0.5 rounded-lg overflow-hidden h-3">
                  {Object.entries(SEVERITY_COLORS).map(([sev, color]) => {
                    const count = Object.entries(DEMO_DAMAGE_MAP)
                      .filter(([k, v]) => k.startsWith(bladeKey) && v.maxSeverity === sev && v.count > 0).length;
                    if (count === 0 && sev !== 'S0') return null;
                    return (
                      <div key={sev} className="h-full transition-all" style={{
                        background: sev === 'S0' ? '#f1f5f9' : color,
                        flex: Math.max(count, sev === 'S0' ? 3 : 0),
                      }} />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

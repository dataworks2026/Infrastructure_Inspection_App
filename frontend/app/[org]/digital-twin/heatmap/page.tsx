'use client';

import { useState, useMemo } from 'react';
import Link from '@/components/OrgLink';
import { ArrowLeft, Flame, Waves, Info } from 'lucide-react';

// Coastal structure zones (vertical sections of a seawall / revetment)
const STRUCTURE_ZONES = [
  { id: 'foundation', label: 'Foundation', start: 0,   end: 15 },
  { id: 'lower',      label: 'Lower',      start: 15,  end: 35 },
  { id: 'mid',        label: 'Mid-Wall',    start: 35,  end: 60 },
  { id: 'upper',      label: 'Upper',       start: 60,  end: 80 },
  { id: 'cap',        label: 'Cap / Crown', start: 80,  end: 100 },
];

const STRUCTURE_FACES = ['seaward', 'surface', 'landward'] as const;

const STRUCTURES = [
  { id: 1, label: 'Seawall A' },
  { id: 2, label: 'Timber Pier' },
  { id: 3, label: 'Revetment B' },
];

// Demo damage data per zone — coastal defect types
interface ZoneData { count: number; maxSeverity: string; types: string[] }

const DEMO_DAMAGE_MAP: Record<string, ZoneData> = {
  // Seawall A
  's1-foundation-seaward':  { count: 2, maxSeverity: 'S3', types: ['Toe undermining', 'Scour erosion'] },
  's1-foundation-surface':  { count: 1, maxSeverity: 'S2', types: ['Concrete spalling'] },
  's1-foundation-landward': { count: 0, maxSeverity: 'S0', types: [] },
  's1-lower-seaward':       { count: 3, maxSeverity: 'S3', types: ['Wave impact erosion', 'Rebar exposure', 'Biological growth'] },
  's1-lower-surface':       { count: 1, maxSeverity: 'S1', types: ['Hairline crack'] },
  's1-lower-landward':      { count: 0, maxSeverity: 'S0', types: [] },
  's1-mid-seaward':         { count: 2, maxSeverity: 'S2', types: ['Surface erosion', 'Joint separation'] },
  's1-mid-surface':         { count: 1, maxSeverity: 'S2', types: ['Lateral cracking'] },
  's1-mid-landward':        { count: 0, maxSeverity: 'S0', types: [] },
  's1-upper-seaward':       { count: 1, maxSeverity: 'S1', types: ['Minor pitting'] },
  's1-upper-surface':       { count: 0, maxSeverity: 'S0', types: [] },
  's1-upper-landward':      { count: 0, maxSeverity: 'S0', types: [] },
  's1-cap-seaward':         { count: 1, maxSeverity: 'S4', types: ['Cap displacement'] },
  's1-cap-surface':         { count: 1, maxSeverity: 'S3', types: ['Structural crack'] },
  's1-cap-landward':        { count: 0, maxSeverity: 'S0', types: [] },
  // Timber Pier
  's2-foundation-seaward':  { count: 1, maxSeverity: 'S2', types: ['Pile bearing loss'] },
  's2-foundation-surface':  { count: 0, maxSeverity: 'S0', types: [] },
  's2-foundation-landward': { count: 0, maxSeverity: 'S0', types: [] },
  's2-lower-seaward':       { count: 1, maxSeverity: 'S1', types: ['Minor marine borer damage'] },
  's2-lower-surface':       { count: 0, maxSeverity: 'S0', types: [] },
  's2-lower-landward':      { count: 0, maxSeverity: 'S0', types: [] },
  's2-mid-seaward':         { count: 1, maxSeverity: 'S2', types: ['Timber rot'] },
  's2-mid-surface':         { count: 0, maxSeverity: 'S0', types: [] },
  's2-mid-landward':        { count: 0, maxSeverity: 'S0', types: [] },
  's2-upper-seaward':       { count: 0, maxSeverity: 'S0', types: [] },
  's2-upper-surface':       { count: 1, maxSeverity: 'S1', types: ['Deck plank splitting'] },
  's2-upper-landward':      { count: 0, maxSeverity: 'S0', types: [] },
  's2-cap-seaward':         { count: 0, maxSeverity: 'S0', types: [] },
  's2-cap-surface':         { count: 0, maxSeverity: 'S0', types: [] },
  's2-cap-landward':        { count: 0, maxSeverity: 'S0', types: [] },
  // Revetment B
  's3-foundation-seaward':  { count: 0, maxSeverity: 'S0', types: [] },
  's3-foundation-surface':  { count: 0, maxSeverity: 'S0', types: [] },
  's3-foundation-landward': { count: 0, maxSeverity: 'S0', types: [] },
  's3-lower-seaward':       { count: 0, maxSeverity: 'S0', types: [] },
  's3-lower-surface':       { count: 0, maxSeverity: 'S0', types: [] },
  's3-lower-landward':      { count: 1, maxSeverity: 'S1', types: ['Filter fabric exposure'] },
  's3-mid-seaward':         { count: 1, maxSeverity: 'S2', types: ['Armor stone displacement'] },
  's3-mid-surface':         { count: 0, maxSeverity: 'S0', types: [] },
  's3-mid-landward':        { count: 0, maxSeverity: 'S0', types: [] },
  's3-upper-seaward':       { count: 1, maxSeverity: 'S2', types: ['Riprap settlement'] },
  's3-upper-surface':       { count: 1, maxSeverity: 'S2', types: ['Vegetation overgrowth'] },
  's3-upper-landward':      { count: 0, maxSeverity: 'S0', types: [] },
  's3-cap-seaward':         { count: 0, maxSeverity: 'S0', types: [] },
  's3-cap-surface':         { count: 0, maxSeverity: 'S0', types: [] },
  's3-cap-landward':        { count: 0, maxSeverity: 'S0', types: [] },
};

const SEVERITY_COLORS: Record<string, string> = {
  S0: '#e2e8f0', S1: '#4CAF50', S2: '#E6A817', S3: '#FF7043', S4: '#B71C1C',
};

const SEVERITY_LABELS: Record<string, string> = {
  S0: 'None', S1: 'Minor', S2: 'Moderate', S3: 'Advanced', S4: 'Severe',
};

function getHeatColor(severity: string): string {
  return SEVERITY_COLORS[severity] || SEVERITY_COLORS.S0;
}

export default function HeatmapPage() {
  const [selectedStructure, setSelectedStructure] = useState(1);
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const structureKey = `s${selectedStructure}`;
  const hoveredData = hoveredZone ? DEMO_DAMAGE_MAP[hoveredZone] : null;
  const selectedData = selectedZone ? DEMO_DAMAGE_MAP[selectedZone] : null;

  // Stats for selected structure
  const structureStats = useMemo(() => {
    let totalDamage = 0;
    let worstSev = 'S0';
    const sevOrder = ['S0', 'S1', 'S2', 'S3', 'S4'];
    Object.entries(DEMO_DAMAGE_MAP).forEach(([key, val]) => {
      if (key.startsWith(structureKey)) {
        totalDamage += val.count;
        if (sevOrder.indexOf(val.maxSeverity) > sevOrder.indexOf(worstSev)) {
          worstSev = val.maxSeverity;
        }
      }
    });
    return { totalDamage, worstSev };
  }, [structureKey]);

  const currentStructure = STRUCTURES.find(s => s.id === selectedStructure)!;

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
              <p className="text-[10px] text-mira-muted">Coastal structure damage density visualization</p>
            </div>
          </div>
        </div>

        {/* Structure selector */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {STRUCTURES.map(s => (
            <button key={s.id} onClick={() => { setSelectedStructure(s.id); setSelectedZone(null); }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                selectedStructure === s.id
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Heatmap grid */}
        <div className="col-span-8">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-6">
            {/* Structure diagram header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-700">{currentStructure.label} — Damage Distribution</h2>
                <p className="text-[10px] text-mira-faint mt-0.5">
                  {structureStats.totalDamage} total detections · Worst: {structureStats.worstSev} ({SEVERITY_LABELS[structureStats.worstSev]})
                </p>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-mira-faint">
                <Info size={10} /> Click a cell for details
              </div>
            </div>

            {/* Heatmap grid */}
            <div className="relative">
              {/* Axis labels */}
              <div className="flex items-center mb-1 ml-20">
                {STRUCTURE_ZONES.map(z => (
                  <div key={z.id} className="flex-1 text-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                    {z.label}
                  </div>
                ))}
              </div>
              <div className="flex items-center text-[8px] text-mira-faint mb-3 ml-20">
                {STRUCTURE_ZONES.map(z => (
                  <div key={z.id} className="flex-1 text-center">
                    {z.start}–{z.end}%
                  </div>
                ))}
              </div>

              {/* Heatmap cells */}
              {STRUCTURE_FACES.map(face => (
                <div key={face} className="flex items-center mb-1.5">
                  <div className="w-20 text-right pr-3 text-[10px] font-semibold text-slate-500 capitalize">{face}</div>
                  <div className="flex-1 flex gap-1.5">
                    {STRUCTURE_ZONES.map(zone => {
                      const key = `${structureKey}-${zone.id}-${face}`;
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

              {/* Structure cross-section diagram */}
              <div className="mt-4 ml-20">
                <svg viewBox="0 0 500 30" className="w-full h-8">
                  <defs>
                    <linearGradient id="wallGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <rect x="0" y="4" width="500" height="22" rx="4" fill="url(#wallGrad)" stroke="#94a3b8" strokeWidth="0.5" />
                  <text x="250" y="19" textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="bold">
                    Foundation -- Structure Elevation -- Cap
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
                    {selectedZone.replace(`${structureKey}-`, '').replace('-', ' · ')}
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
                <Waves size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-xs text-mira-muted">Click a heatmap cell to see details</p>
              </div>
            )}
          </div>

          {/* Overall structure stats */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">{currentStructure.label} Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-mira-muted">Total Detections</span>
                <span className="text-lg font-bold text-slate-800">{structureStats.totalDamage}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-mira-muted">Worst Severity</span>
                <span className="text-sm font-bold px-2 py-0.5 rounded-md" style={{
                  color: getHeatColor(structureStats.worstSev),
                  background: getHeatColor(structureStats.worstSev) + '20',
                }}>
                  {structureStats.worstSev} {SEVERITY_LABELS[structureStats.worstSev]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-mira-muted">Hotspot</span>
                <span className="text-xs font-semibold text-red-600">
                  {selectedStructure === 1 ? 'Lower Seaward Face' :
                   selectedStructure === 2 ? 'Mid Seaward Face' : 'Upper Seaward Face'}
                </span>
              </div>

              {/* Severity distribution bar */}
              <div className="mt-2 pt-2 border-t border-slate-100">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Distribution</p>
                <div className="flex gap-0.5 rounded-lg overflow-hidden h-3">
                  {Object.entries(SEVERITY_COLORS).map(([sev, color]) => {
                    const count = Object.entries(DEMO_DAMAGE_MAP)
                      .filter(([k, v]) => k.startsWith(structureKey) && v.maxSeverity === sev && v.count > 0).length;
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

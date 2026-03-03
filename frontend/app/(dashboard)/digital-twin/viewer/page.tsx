'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowLeft, Building2, AlertTriangle, RotateCw, MousePointer, Layers,
  Calendar, Activity, Thermometer, Wind, Droplets, Eye, EyeOff,
  ChevronDown, ChevronRight, MapPin, Clock, TrendingDown, TrendingUp,
  Shield, Gauge, FileText, Camera, Download, Share2, Maximize2,
} from 'lucide-react';

const TurbineScene = dynamic(() => import('./TurbineScene'), { ssr: false, loading: () => (
  <div className="w-full h-full bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">Loading 3D viewer...</span>
    </div>
  </div>
)});

/* ═══════════════════════════════════════════════
   DATA — Pins, inspections timeline, environmental
   ═══════════════════════════════════════════════ */
const DEMO_PINS = [
  // Sheet Pile Seawall (structure 0)
  { id: '1', label: 'Sheet Pile Section Loss', severity: 'S3', confidence: 0.93, structure: 0, zone: 'Seawall · Splash Zone · Panel 4', firstSeen: '2024-03-15', trend: 'worsening' as const },
  { id: '2', label: 'Through-Wall Corrosion', severity: 'S4', confidence: 0.96, structure: 0, zone: 'Seawall · Tidal Zone · Panel 8', firstSeen: '2023-05-22', trend: 'worsening' as const },
  { id: '3', label: 'Cap Beam Spalling', severity: 'S2', confidence: 0.87, structure: 0, zone: 'Seawall · Concrete Cap · Station 6', firstSeen: '2024-01-10', trend: 'stable' as const },
  { id: '4', label: 'Tie Rod Corrosion', severity: 'S3', confidence: 0.91, structure: 0, zone: 'Seawall · Cap · Tie Rod 3 Exposed', firstSeen: '2023-08-14', trend: 'worsening' as const },

  // Riprap Revetment (structure 1)
  { id: '5', label: 'Armor Stone Displacement', severity: 'S3', confidence: 0.89, structure: 1, zone: 'Revetment · Upper Slope · Section 3', firstSeen: '2023-11-02', trend: 'worsening' as const },
  { id: '6', label: 'Filter Layer Exposure', severity: 'S4', confidence: 0.94, structure: 1, zone: 'Revetment · Mid Slope · Section 5 · Geotextile Visible', firstSeen: '2023-08-14', trend: 'worsening' as const },
  { id: '7', label: 'Toe Scour', severity: 'S2', confidence: 0.82, structure: 1, zone: 'Revetment · Toe · Station 4', firstSeen: '2024-06-20', trend: 'new' as const },

  // Pier (structure 2)
  { id: '8', label: 'Timber Pile Decay', severity: 'S3', confidence: 0.92, structure: 2, zone: 'Pier · Pile B-3 · Splash Zone · Marine Borer', firstSeen: '2023-08-14', trend: 'worsening' as const },
  { id: '9', label: 'Deck Slab Delamination', severity: 'S2', confidence: 0.86, structure: 2, zone: 'Pier · Deck · Bay 4 · Soffit Spalling', firstSeen: '2024-03-15', trend: 'stable' as const },
  { id: '10', label: 'Pile Cap Cracking', severity: 'S2', confidence: 0.84, structure: 2, zone: 'Pier · Cap Beam · Bent 2', firstSeen: '2024-01-10', trend: 'stable' as const },
  { id: '11', label: 'Batter Pile Buckling', severity: 'S4', confidence: 0.95, structure: 2, zone: 'Pier · Batter Pile BP-1 · Below MHW', firstSeen: '2023-05-22', trend: 'worsening' as const },
  { id: '12', label: 'Fender Pile Splitting', severity: 'S2', confidence: 0.81, structure: 2, zone: 'Pier · Fender F-5 · Impact Zone', firstSeen: '2024-06-20', trend: 'new' as const },
];

// Inspection timeline (like RCOAST 4D / SkySpecs Horizon)
const INSPECTION_HISTORY = [
  { id: 'insp-1', date: '2024-06-20', type: 'Drone Survey', findings: 12, critical: 2, operator: 'DJI M3E', status: 'current' as const },
  { id: 'insp-2', date: '2024-03-15', type: 'Drone Survey', findings: 9, critical: 1, operator: 'DJI M3E', status: 'past' as const },
  { id: 'insp-3', date: '2024-01-10', type: 'Diver Inspection', findings: 6, critical: 1, operator: 'Manual', status: 'past' as const },
  { id: 'insp-4', date: '2023-11-02', type: 'Drone Survey', findings: 5, critical: 1, operator: 'Skydio X10', status: 'past' as const },
  { id: 'insp-5', date: '2023-08-14', type: 'Visual Walkdown', findings: 3, critical: 0, operator: 'Manual', status: 'past' as const },
  { id: 'insp-6', date: '2023-05-22', type: 'Baseline Survey', findings: 2, critical: 1, operator: 'DJI M3E', status: 'past' as const },
];

const SEVERITY_COLORS: Record<string, { color: string; label: string; bg: string }> = {
  S0: { color: '#059669', label: 'None', bg: 'bg-emerald-500' },
  S1: { color: '#65A30D', label: 'Minor', bg: 'bg-lime-500' },
  S2: { color: '#D97706', label: 'Moderate', bg: 'bg-amber-500' },
  S3: { color: '#DC2626', label: 'Severe', bg: 'bg-red-500' },
  S4: { color: '#7C3AED', label: 'Critical', bg: 'bg-purple-500' },
};

const STRUCTURE_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Castle Williams', color: '#c0622e' },
  1: { label: 'Fort Jay', color: '#6366f1' },
  2: { label: 'Seawall', color: '#06b6d4' },
  3: { label: 'Soissons Dock', color: '#f59e0b' },
};

/* ═══════════════════════════════════════════════
   HEALTH SCORE CALCULATION (like Forerunner risk scores)
   ═══════════════════════════════════════════════ */
function computeHealthScore(pins: typeof DEMO_PINS): number {
  if (pins.length === 0) return 100;
  const weights: Record<string, number> = { S0: 0, S1: 2, S2: 5, S3: 12, S4: 25 };
  const totalPenalty = pins.reduce((sum, p) => sum + (weights[p.severity] || 0), 0);
  const maxPenalty = pins.length * 25;
  return Math.max(0, Math.round(100 - (totalPenalty / maxPenalty) * 100));
}

function getHealthLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Good', color: '#059669' };
  if (score >= 60) return { label: 'Fair', color: '#D97706' };
  if (score >= 40) return { label: 'Poor', color: '#DC2626' };
  return { label: 'Critical', color: '#7C3AED' };
}

/* ═══════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════ */
export default function ViewerPage() {
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [filterStructure, setFilterStructure] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<'detections' | 'timeline' | 'environment'>('detections');
  const [showLayers, setShowLayers] = useState({ pins: true, structures: true, zones: true });
  const [expandedInspection, setExpandedInspection] = useState<string | null>(INSPECTION_HISTORY[0].id);

  const filteredPins = filterStructure !== null
    ? DEMO_PINS.filter(p => p.structure === filterStructure)
    : DEMO_PINS;

  const selectedDamage = DEMO_PINS.find(p => p.id === selectedPin);

  const severityDist = useMemo(() => DEMO_PINS.reduce((acc, p) => {
    acc[p.severity] = (acc[p.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), []);

  const structureDist = useMemo(() => DEMO_PINS.reduce((acc, p) => {
    acc[p.structure] = (acc[p.structure] || 0) + 1;
    return acc;
  }, {} as Record<number, number>), []);

  const healthScore = useMemo(() => computeHealthScore(DEMO_PINS), []);
  const healthInfo = getHealthLabel(healthScore);

  const criticalCount = DEMO_PINS.filter(p => p.severity === 'S4').length;
  const worseningCount = DEMO_PINS.filter(p => p.trend === 'worsening').length;

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col -m-6">
      {/* ═══ TOP TOOLBAR ═══ */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Back + Asset name */}
          <div className="pointer-events-auto flex items-center gap-3">
            <Link href="/digital-twin"
              className="inline-flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-xl text-white/80 px-3 py-2 rounded-lg shadow-lg border border-white/10 text-xs font-medium hover:bg-slate-900/90 transition-all">
              <ArrowLeft size={13} />
            </Link>
            <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg px-4 py-2 flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                <Building2 size={13} className="text-white" />
              </div>
              <div>
                <h3 className="text-[12px] font-bold text-white leading-none">Governors Island</h3>
                <p className="text-[9px] text-slate-400 mt-0.5">40.6892° N, 74.0167° W · New York Harbor</p>
              </div>
              <div className="w-px h-6 bg-white/10 mx-1" />
              {/* Health Score Gauge */}
              <div className="flex items-center gap-2">
                <div className="relative w-8 h-8">
                  <svg viewBox="0 0 36 36" className="w-8 h-8 -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="14" fill="none" stroke={healthInfo.color} strokeWidth="3"
                      strokeDasharray={`${healthScore * 0.88} 88`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-white">{healthScore}</span>
                </div>
                <div>
                  <span className="text-[9px] font-bold block" style={{ color: healthInfo.color }}>{healthInfo.label}</span>
                  <span className="text-[8px] text-slate-500">Health</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Action buttons + controls hint */}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Quick stats */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg px-3 py-2 flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1 text-red-400 font-bold">
                <AlertTriangle size={10} /> {criticalCount} Critical
              </span>
              <span className="w-px h-3 bg-white/10" />
              <span className="flex items-center gap-1 text-amber-400 font-bold">
                <TrendingDown size={10} /> {worseningCount} Worsening
              </span>
              <span className="w-px h-3 bg-white/10" />
              <span className="flex items-center gap-1 text-white/60">
                <Camera size={10} /> {INSPECTION_HISTORY.length} Surveys
              </span>
            </div>
            {/* Controls hint */}
            <div className="bg-slate-900/80 backdrop-blur-xl text-white/50 px-3 py-2 rounded-lg shadow-lg border border-white/10 text-[10px] flex items-center gap-2">
              <MousePointer size={9} /> Click
              <span className="w-px h-2.5 bg-white/10" />
              <RotateCw size={9} /> Orbit
            </div>
          </div>
        </div>
      </div>

      {/* ═══ MAIN 3D VIEWER ═══ */}
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <TurbineScene selectedPin={selectedPin} onSelectPin={setSelectedPin} />
        </div>

        {/* ═══ LEFT: LAYER CONTROLS + MINI MAP ═══ */}
        <div className="absolute top-16 left-4 z-10 pointer-events-auto flex flex-col gap-2" style={{ width: 200 }}>
          {/* Layer toggles */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Layers size={10} className="text-slate-400" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Layers</span>
            </div>
            {[
              { key: 'pins' as const, label: 'Damage Pins', count: DEMO_PINS.length },
              { key: 'structures' as const, label: 'Structures', count: 4 },
              { key: 'zones' as const, label: 'Inspection Zones', count: 8 },
            ].map(layer => (
              <button key={layer.key}
                onClick={() => setShowLayers(prev => ({ ...prev, [layer.key]: !prev[layer.key] }))}
                className="w-full flex items-center justify-between py-1.5 px-1 rounded hover:bg-white/5 transition-all">
                <div className="flex items-center gap-2">
                  {showLayers[layer.key] ? <Eye size={10} className="text-sky-400" /> : <EyeOff size={10} className="text-slate-600" />}
                  <span className={`text-[10px] font-medium ${showLayers[layer.key] ? 'text-white' : 'text-slate-600'}`}>{layer.label}</span>
                </div>
                <span className="text-[9px] text-slate-500">{layer.count}</span>
              </button>
            ))}
          </div>

          {/* Structure health breakdown */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Structures</span>
            {Object.entries(STRUCTURE_LABELS).map(([key, val]) => {
              const idx = Number(key);
              const count = structureDist[idx] || 0;
              const structPins = DEMO_PINS.filter(p => p.structure === idx);
              const structHealth = computeHealthScore(structPins);
              const sInfo = getHealthLabel(structHealth);
              return (
                <button key={key}
                  onClick={() => setFilterStructure(filterStructure === idx ? null : idx)}
                  className={`w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg transition-all mb-0.5 ${
                    filterStructure === idx ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5'
                  }`}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: val.color }} />
                  <span className="text-[10px] font-medium text-white flex-1 text-left">{val.label}</span>
                  <span className="text-[9px] font-bold" style={{ color: sInfo.color }}>{structHealth}</span>
                  <span className="text-[8px] text-slate-600">{count}d</span>
                </button>
              );
            })}
          </div>

          {/* Environmental conditions (like RCOAST) */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Conditions</span>
            <div className="space-y-1.5">
              {[
                { icon: Droplets, label: 'Tide', value: 'High +2.1ft', color: '#06b6d4' },
                { icon: Wind, label: 'Wind', value: 'SW 12 kts', color: '#94a3b8' },
                { icon: Thermometer, label: 'Water', value: '68°F', color: '#22c55e' },
                { icon: Activity, label: 'Wave', value: '1.2 ft', color: '#6366f1' },
              ].map(cond => (
                <div key={cond.label} className="flex items-center gap-2">
                  <cond.icon size={10} style={{ color: cond.color }} />
                  <span className="text-[9px] text-slate-500 w-10">{cond.label}</span>
                  <span className="text-[10px] font-medium text-white">{cond.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL — Tabbed: Detections / Timeline / Env ═══ */}
        <div className="absolute top-16 right-4 bottom-14 w-80 z-10 pointer-events-auto flex flex-col gap-0 overflow-hidden">
          {/* Tab bar */}
          <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-t-2xl flex border-b-0">
            {[
              { key: 'detections' as const, label: 'Detections', count: filteredPins.length },
              { key: 'timeline' as const, label: 'Timeline', count: INSPECTION_HISTORY.length },
            ].map(tab => (
              <button key={tab.key}
                onClick={() => setRightTab(tab.key)}
                className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                  rightTab === tab.key
                    ? 'text-white border-b-2 border-sky-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}>
                {tab.label} <span className="text-slate-600 ml-1">{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 border-t-0 rounded-b-2xl shadow-2xl flex-1 overflow-hidden flex flex-col min-h-0">
            {rightTab === 'detections' && (
              <>
                {/* Severity distribution bar */}
                <div className="px-3 py-2.5 border-b border-white/5 flex-shrink-0">
                  <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden">
                    {Object.entries(SEVERITY_COLORS).map(([sev, config]) => {
                      const count = severityDist[sev] || 0;
                      if (count === 0) return null;
                      return (
                        <div key={sev} className="h-full rounded-full" style={{
                          background: config.color,
                          width: `${(count / DEMO_PINS.length) * 100}%`,
                        }} title={`${sev}: ${count}`} />
                      );
                    })}
                  </div>
                  {/* Filter chips */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    <button onClick={() => setFilterStructure(null)}
                      className={`text-[8px] font-bold px-2 py-0.5 rounded-md transition-all ${
                        filterStructure === null ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-500 hover:bg-white/10'
                      }`}>
                      All {DEMO_PINS.length}
                    </button>
                    {Object.entries(STRUCTURE_LABELS).map(([key, val]) => {
                      const idx = Number(key);
                      return (
                        <button key={key}
                          onClick={() => setFilterStructure(filterStructure === idx ? null : idx)}
                          className={`text-[8px] font-bold px-2 py-0.5 rounded-md transition-all flex items-center gap-1 ${
                            filterStructure === idx ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-500 hover:bg-white/10'
                          }`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: val.color }} />
                          {val.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Detection list */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                  {filteredPins.map((pin) => {
                    const sev = SEVERITY_COLORS[pin.severity];
                    const isSelected = pin.id === selectedPin;
                    const struct = STRUCTURE_LABELS[pin.structure];
                    return (
                      <button key={pin.id} onClick={() => setSelectedPin(isSelected ? null : pin.id)}
                        className={`w-full text-left p-2.5 rounded-lg transition-all ${
                          isSelected ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5'
                        }`}>
                        <div className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: sev?.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[11px] font-semibold text-white truncate flex-1">{pin.label}</p>
                              {pin.trend === 'worsening' && <TrendingDown size={9} className="text-red-400 flex-shrink-0" />}
                              {pin.trend === 'new' && <span className="text-[7px] font-bold bg-sky-500/20 text-sky-400 px-1 py-0.5 rounded flex-shrink-0">NEW</span>}
                            </div>
                            <p className="text-[8px] text-slate-500 truncate mt-0.5">{pin.zone}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{
                                background: (sev?.color || '#888') + '20', color: sev?.color
                              }}>{pin.severity}</span>
                              <span className="text-[8px] text-slate-500">{(pin.confidence * 100).toFixed(0)}%</span>
                              <span className="w-1 h-1 rounded-full" style={{ background: struct?.color }} />
                              <span className="text-[8px] text-slate-600">{struct?.label}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {rightTab === 'timeline' && (
              <div className="flex-1 overflow-y-auto p-3">
                {/* Inspection timeline — like SkySpecs Horizon / RCOAST 4D */}
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[7px] top-4 bottom-4 w-px bg-white/10" />

                  {INSPECTION_HISTORY.map((insp, i) => {
                    const isExpanded = expandedInspection === insp.id;
                    const isCurrent = insp.status === 'current';
                    return (
                      <button key={insp.id}
                        onClick={() => setExpandedInspection(isExpanded ? null : insp.id)}
                        className="w-full text-left relative pl-6 mb-3">
                        {/* Timeline dot */}
                        <div className={`absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center ${
                          isCurrent
                            ? 'border-sky-400 bg-sky-400/20'
                            : 'border-slate-600 bg-slate-800'
                        }`}>
                          {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
                        </div>

                        <div className={`rounded-lg p-2.5 transition-all ${
                          isExpanded ? 'bg-white/8 ring-1 ring-white/10' : 'hover:bg-white/5'
                        }`}>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-white">{insp.date}</span>
                            {isCurrent && <span className="text-[7px] font-bold bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded">LATEST</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] text-slate-400">{insp.type}</span>
                            <span className="text-[9px] text-slate-600">via {insp.operator}</span>
                          </div>

                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-[8px] text-slate-500 block">Findings</span>
                                <span className="text-[13px] font-bold text-white">{insp.findings}</span>
                              </div>
                              <div>
                                <span className="text-[8px] text-slate-500 block">Critical</span>
                                <span className="text-[13px] font-bold" style={{
                                  color: insp.critical > 0 ? '#DC2626' : '#059669'
                                }}>{insp.critical}</span>
                              </div>
                              {i > 0 && (
                                <div className="col-span-2">
                                  <span className="text-[8px] text-slate-500 block mb-1">Change from previous</span>
                                  <div className="flex items-center gap-1">
                                    {insp.findings > INSPECTION_HISTORY[i - 1]?.findings ? (
                                      <><TrendingUp size={9} className="text-red-400" /><span className="text-[9px] text-red-400 font-bold">+{insp.findings - INSPECTION_HISTORY[i - 1].findings} findings</span></>
                                    ) : insp.findings < INSPECTION_HISTORY[i - 1]?.findings ? (
                                      <><TrendingDown size={9} className="text-emerald-400" /><span className="text-[9px] text-emerald-400 font-bold">{insp.findings - INSPECTION_HISTORY[i - 1].findings} findings</span></>
                                    ) : (
                                      <span className="text-[9px] text-slate-500">No change</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Findings trend chart (simple sparkline) */}
                <div className="mt-2 bg-white/5 rounded-lg p-3">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Findings Trend</span>
                  <div className="flex items-end gap-1 h-12">
                    {[...INSPECTION_HISTORY].reverse().map((insp, i) => {
                      const maxFindings = Math.max(...INSPECTION_HISTORY.map(h => h.findings));
                      const heightPct = (insp.findings / maxFindings) * 100;
                      return (
                        <div key={insp.id} className="flex-1 flex flex-col items-center gap-0.5">
                          <span className="text-[7px] text-slate-500">{insp.findings}</span>
                          <div className="w-full rounded-t-sm" style={{
                            height: `${heightPct}%`,
                            minHeight: 3,
                            background: insp.status === 'current' ? '#0ea5e9' : 'rgba(255,255,255,0.15)',
                          }} />
                          <span className="text-[6px] text-slate-600">{insp.date.slice(5, 7)}/{insp.date.slice(2, 4)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Selected damage detail overlay */}
          {selectedDamage && rightTab === 'detections' && (
            <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 mt-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={13} style={{ color: SEVERITY_COLORS[selectedDamage.severity]?.color }} />
                  <h4 className="text-[11px] font-bold text-white">{selectedDamage.label}</h4>
                </div>
                {selectedDamage.trend === 'worsening' && (
                  <span className="text-[8px] font-bold bg-red-500/15 text-red-400 px-2 py-0.5 rounded flex items-center gap-1">
                    <TrendingDown size={8} /> Worsening
                  </span>
                )}
                {selectedDamage.trend === 'new' && (
                  <span className="text-[8px] font-bold bg-sky-500/15 text-sky-400 px-2 py-0.5 rounded">New Finding</span>
                )}
                {selectedDamage.trend === 'stable' && (
                  <span className="text-[8px] font-bold bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded">Stable</span>
                )}
              </div>
              <p className="text-[9px] text-slate-400 mb-2">{selectedDamage.zone}</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/5 rounded-lg p-2 text-center">
                  <span className="text-[8px] text-slate-500 block">Severity</span>
                  <span className="text-[12px] font-black block" style={{ color: SEVERITY_COLORS[selectedDamage.severity]?.color }}>
                    {selectedDamage.severity}
                  </span>
                </div>
                <div className="bg-white/5 rounded-lg p-2 text-center">
                  <span className="text-[8px] text-slate-500 block">Confidence</span>
                  <span className="text-[12px] font-black text-white block">{(selectedDamage.confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="bg-white/5 rounded-lg p-2 text-center">
                  <span className="text-[8px] text-slate-500 block">First Seen</span>
                  <span className="text-[10px] font-bold text-white block">{selectedDamage.firstSeen.slice(5)}</span>
                </div>
              </div>
              {/* Confidence bar */}
              <div className="mt-2">
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${selectedDamage.confidence * 100}%`,
                    background: SEVERITY_COLORS[selectedDamage.severity]?.color,
                  }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ═══ BOTTOM TOOLBAR — Actions (like SkySpecs/Cyberhawk iHawk) ═══ */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
          <div className="bg-slate-900/85 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl px-2 py-1.5 flex items-center gap-1">
            {[
              { icon: Camera, label: 'Screenshot', action: () => {} },
              { icon: FileText, label: 'Report', action: () => {} },
              { icon: Download, label: 'Export', action: () => {} },
              { icon: Share2, label: 'Share', action: () => {} },
              { icon: Maximize2, label: 'Fullscreen', action: () => {} },
            ].map(btn => (
              <button key={btn.label}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all group"
                title={btn.label}>
                <btn.icon size={13} className="text-slate-400 group-hover:text-white transition-colors" />
                <span className="text-[7px] font-medium text-slate-500 group-hover:text-slate-300 transition-colors">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { missionsApi, assetsApi, type MissionDetection } from '@/lib/api';
import { resolveTwinForUser } from '@/lib/twinMap';
import {
  ArrowLeft, Building2, AlertTriangle, RotateCw, MousePointer, Layers,
  Calendar, Activity, Thermometer, Wind, Droplets, Eye, EyeOff,
  ChevronDown, ChevronRight, MapPin, Clock, TrendingDown, TrendingUp,
  Shield, Gauge, FileText, Camera, Download, Share2, Maximize2, Flame,
} from 'lucide-react';

/* Org-aware twin iframe for the full-screen 3D Viewer page. */
function ViewerTwinIframe() {
  const { data: assets } = useQuery({
    queryKey: ['assets-for-twin'],
    queryFn: () => assetsApi.list(),
  });
  const twin = resolveTwinForUser(assets ?? []);
  if (!twin) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
        No digital twin is available for this account yet.
      </div>
    );
  }
  return (
    <iframe
      src={`/twin/?mid=${twin.mid}&name=${encodeURIComponent(twin.name)}`}
      title={`${twin.name} digital twin`}
      className="w-full h-full block border-0"
      allow="fullscreen"
    />
  );
}

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
// ── Constants used by activePins for our JSON-driven detections ──────────────
const MID_CONST = '2abe1a45-0fc7-4e92-9d87-5c7cc7b0c1b8';

// Map structure strings from detections.json into the side-panel buckets.
// Each real Yankee Pier structure gets its OWN index so the filter chips +
// per-structure counts work correctly (previously they all collapsed to 2).
const STRUCT_NAME_TO_IDX: Record<string, number> = {
  'seawall': 0, 'sheet pile': 0,
  'timber pile': 1,
  'concrete cap': 2,
  'pile cap': 3,
};
function structToIdx(name?: string): number {
  if (!name) return 0;
  return STRUCT_NAME_TO_IDX[name.toLowerCase()] ?? 0;
}

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
  S1: { color: '#4CAF50', label: 'Minor', bg: 'bg-emerald-500' },
  S2: { color: '#E6A817', label: 'Moderate', bg: 'bg-amber-500' },
  S3: { color: '#FF7043', label: 'Advanced', bg: 'bg-orange-500' },
  S4: { color: '#B71C1C', label: 'Severe', bg: 'bg-red-500' },
};

const STRUCTURE_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Seawall',      color: '#0EA5E9' },
  1: { label: 'Timber Pile',  color: '#F59E0B' },
  2: { label: 'Concrete Cap', color: '#A78BFA' },
  3: { label: 'Pile Cap',     color: '#34D399' },
};

/* ═══════════════════════════════════════════════
   HEALTH SCORE CALCULATION (like Forerunner risk scores)
   ═══════════════════════════════════════════════ */
function computeHealthScore(pins: ReadonlyArray<{ severity: string }>): number {
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
// 3D positions for real detections — spread across structures
const STRUCTURE_POSITIONS: [number, number, number][] = [
  [-0.08, 0.5, -0.5],   // seawall
  [5.0, 0.0, 0.0],      // revetment
  [-4.0, 0.4, -2.5],    // pier
];

function detectionsToScenePins(detections: MissionDetection[]) {
  return detections.map((d, i) => ({
    id: d.id,
    position: STRUCTURE_POSITIONS[i % 3] as [number, number, number],
    label: d.label,
    severity: d.severity ?? 'S2',
    confidence: d.confidence,
    bladeId: i % 3,
    zone: `Mission detection · ${d.label}`,
  }));
}

export default function ViewerPage() {
  const searchParams = useSearchParams();
  const missionId = searchParams.get('missionId');

  // ── New state hooks MUST be declared before activePins useMemo references them.
  // Don't move below activePins or you'll trigger a TDZ at render time.
  const [pinModal, setPinModal] = useState<any>(null);
  const [iframeDetections, setIframeDetections] = useState<any[] | null>(null);
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e?.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'mira-twin-pin-click' && d.payload) setPinModal(d.payload);
      if (d.type === 'mira-twin-detections' && d.payload?.detections) {
        setIframeDetections(d.payload.detections);
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const MID = MID_CONST;

  const { data: detectionsData } = useQuery({
    queryKey: ['mission-detections', missionId],
    queryFn: () => missionsApi.getDetections(missionId!),
    enabled: !!missionId,
    staleTime: 60_000,
  });

  const { data: thermalData } = useQuery({
    queryKey: ['mission-thermal', missionId],
    queryFn: () => missionsApi.getThermalOverlay(missionId!),
    enabled: !!missionId,
    staleTime: 300_000,
  });

  const activePins = useMemo(() => {
    // Priority 1: detections broadcast from the iframed /twin/ viewer
    //             (these have the real photos + zones the user uploaded)
    if (iframeDetections && iframeDetections.length) {
      return iframeDetections.map((d: any) => ({
        id: d.id,
        label: d.label,
        severity: (d.severity ?? 'S2') as 'S1'|'S2'|'S3'|'S4',
        confidence: d.confidence ?? 0.8,
        structure: structToIdx(d.structure),
        zone: d.zone ?? d.structure ?? '',
        firstSeen: d.first_seen ?? new Date().toISOString().slice(0, 10),
        trend: (d.trend ?? 'stable') as 'worsening'|'stable'|'new',
        photo: d.photo,
      }));
    }
    // Priority 2: legacy backend detections (when missionId is in URL)
    if (missionId && detectionsData?.length) {
      return detectionsData.map((d, i) => ({
        id: d.id,
        label: d.label,
        severity: d.severity ?? 'S2',
        confidence: d.confidence,
        structure: i % 3,
        zone: `Mission · ${d.label}`,
        firstSeen: new Date().toISOString().slice(0, 10),
        trend: 'stable' as const,
      }));
    }
    // Fallback: demo
    return DEMO_PINS;
  }, [iframeDetections, missionId, detectionsData]);

  const scene3dPins = useMemo(() => {
    if (!missionId || !detectionsData?.length) return undefined;
    return detectionsToScenePins(detectionsData);
  }, [missionId, detectionsData]);

  const [selectedPin, setSelectedPin] = useState<string | null>(null);

  // pinModal / iframeDetections / MID / postMessage useEffect — declared at the
  // top of the component (above activePins) to avoid a TDZ. See top of function.

  const [filterStructure, setFilterStructure] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<'detections' | 'timeline' | 'environment'>('detections');
  const [showLayers, setShowLayers] = useState({ pins: true, structures: true, zones: true, thermal: false });
  const [expandedInspection, setExpandedInspection] = useState<string | null>(INSPECTION_HISTORY[0].id);

  const filteredPins = filterStructure !== null
    ? activePins.filter(p => p.structure === filterStructure)
    : activePins;

  const selectedDamage = activePins.find(p => p.id === selectedPin);

  const severityDist = useMemo(() => activePins.reduce((acc, p) => {
    acc[p.severity] = (acc[p.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [activePins]);

  const structureDist = useMemo(() => activePins.reduce((acc, p) => {
    acc[p.structure] = (acc[p.structure] || 0) + 1;
    return acc;
  }, {} as Record<number, number>), [activePins]);

  const healthScore = useMemo(() => computeHealthScore(activePins), [activePins]);
  const healthInfo = getHealthLabel(healthScore);

  const criticalCount = activePins.filter(p => p.severity === 'S4').length;
  const worseningCount = activePins.filter(p => p.trend === 'worsening').length;

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col -m-6">
      {/* ═══ TOP TOOLBAR ═══ */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Just the Back button now. The Governors Island / coords
              card moved to the right cluster so it doesn't overlap with the
              iframe's own title at top-left. */}
          <div className="pointer-events-auto flex items-center gap-3">
            <Link href="/digital-twin"
              className="inline-flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-xl text-white/80 px-3 py-2 rounded-lg shadow-lg border border-white/10 text-xs font-medium hover:bg-slate-900/90 transition-all">
              <ArrowLeft size={13} />
            </Link>
          </div>

          {/* Right: Quick stats + Health badge + controls hint
              (Quick stats moved to LEFT of Health badge per request — health is now
              the rightmost data card, just before the controls hint.) */}
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
            {/* Governors Island name + coords + Health Score Gauge — combined
                into ONE card on the right so they're paired and clear of any
                overlap with the iframe's own title at top-left. */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg px-3 py-2 flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                <Building2 size={13} className="text-white" />
              </div>
              <div>
                <h3 className="text-[12px] font-bold text-white leading-none">Governors Island</h3>
                <p className="text-[9px] text-slate-400 mt-0.5">40.6892° N, 74.0167° W · New York Harbor</p>
              </div>
              <div className="w-px h-6 bg-white/10 mx-1" />
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
            {/* Controls hint */}
            <div className="bg-slate-900/80 backdrop-blur-xl text-white/50 px-3 py-2 rounded-lg shadow-lg border border-white/10 text-[10px] flex items-center gap-2">
              <MousePointer size={9} /> Click
              <span className="w-px h-2.5 bg-white/10" />
              <RotateCw size={9} /> Orbit
            </div>
          </div>
        </div>
      </div>

      {/* ═══ MAIN 3D VIEWER ═══
          Org-aware iframe: the twin is resolved from the logged-in user's
          assets via lib/twinMap.ts so gov_island sees Yankee Pier and
          brooklynarmyterminal sees BAT Pier 4 v1. Overlays stay on top. */}
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <ViewerTwinIframe />
        </div>

        {/* ═══ LEFT COLUMN — LAYERS / STRUCTURES / CONDITIONS ═══
            The three cards fill the vertical space between the iframe's
            ASSET DIMENSIONS panel (top-left, ends ≈ y:280) and the bottom
            controls toolbar (starts ≈ y:820). Anchored to BOTH top and bottom
            so the cards space themselves evenly with `justify-between`. */}
        <div className="absolute z-10 pointer-events-auto flex flex-col justify-between"
             style={{ top: 290, bottom: 210, left: 10, width: 240 }}>
          {/* Layer toggles */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Layers size={10} className="text-slate-400" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Layers</span>
            </div>
            {[
              { key: 'pins' as const, label: 'Damage Pins', count: activePins.length },
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
            {/* Thermal layer toggle — only shown when missionId present */}
            {missionId && (
              <button
                onClick={() => setShowLayers(prev => ({ ...prev, thermal: !prev.thermal }))}
                className="w-full flex items-center justify-between py-1.5 px-1 rounded hover:bg-white/5 transition-all">
                <div className="flex items-center gap-2">
                  <Flame size={10} className={showLayers.thermal ? 'text-orange-400' : 'text-slate-600'} />
                  <span className={`text-[10px] font-medium ${showLayers.thermal ? 'text-orange-300' : 'text-slate-600'}`}>
                    Thermal
                  </span>
                  {thermalData?.has_thermal && (
                    <span className="text-[7px] font-bold bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded">
                      {thermalData.captures_count}
                    </span>
                  )}
                </div>
                {showLayers.thermal
                  ? <Eye size={10} className="text-orange-400" />
                  : <EyeOff size={10} className="text-slate-600" />}
              </button>
            )}
          </div>

          {/* Structure health breakdown */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Structures</span>
            {Object.entries(STRUCTURE_LABELS).map(([key, val]) => {
              const idx = Number(key);
              const count = structureDist[idx] || 0;
              const structPins = activePins.filter(p => p.structure === idx);
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

          {/* Thermal legend — shown when thermal layer is active */}
          {showLayers.thermal && (
            <div className="bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Flame size={10} className="text-orange-400" />
                <span className="text-[9px] font-bold text-orange-300 uppercase tracking-wider">Thermal</span>
              </div>
              <div className="h-2 rounded-full" style={{
                background: 'linear-gradient(to right, #3b82f6, #22d3ee, #86efac, #fbbf24, #ef4444)',
              }} />
              <div className="flex justify-between mt-1">
                <span className="text-[8px] text-blue-400 font-bold">Cool</span>
                <span className="text-[8px] text-red-400 font-bold">Hot</span>
              </div>
              {thermalData?.has_thermal ? (
                <div className="mt-2 space-y-0.5">
                  {thermalData.temp_min_c != null && <p className="text-[8px] text-slate-400">Min: {thermalData.temp_min_c.toFixed(1)}°C</p>}
                  {thermalData.temp_max_c != null && <p className="text-[8px] text-slate-400">Max: {thermalData.temp_max_c.toFixed(1)}°C</p>}
                  {thermalData.hotspot_count != null && thermalData.hotspot_count > 0 && (
                    <p className="text-[8px] text-orange-400 font-bold">{thermalData.hotspot_count} hotspot{thermalData.hotspot_count !== 1 ? 's' : ''} &gt;35°C</p>
                  )}
                </div>
              ) : (
                <p className="text-[8px] text-slate-500 mt-1">No thermal data for this mission</p>
              )}
            </div>
          )}

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
                          width: `${(count / activePins.length) * 100}%`,
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
                      All {activePins.length}
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
                      <button key={pin.id} onClick={() => {
                          setSelectedPin(isSelected ? null : pin.id);
                          // If this pin has a real photo attached (from detections.json),
                          // also open the photo modal so the user can see the damage image
                          // straight from the side panel (not just by clicking the 3D pin).
                          if ((pin as any).photo) {
                            setPinModal({
                              id: pin.id,
                              label: pin.label,
                              severity: pin.severity,
                              confidence: pin.confidence,
                              structure: STRUCTURE_LABELS[pin.structure]?.label,
                              zone: pin.zone,
                              first_seen: pin.firstSeen,
                              trend: pin.trend,
                              photo: (pin as any).photo,
                            });
                          }
                        }}
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

        {/* ═══ DAMAGE PIN MODAL — shown when user clicks a pin in the 3D twin ═══ */}
        {pinModal && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setPinModal(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-w-[920px] w-[92%] max-h-[88vh] flex flex-col"
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="text-[10px] font-black px-2.5 py-1 rounded uppercase tracking-wider"
                    style={{
                      background: (SEVERITY_COLORS[pinModal.severity]?.color || '#94A3B8') + '22',
                      color: SEVERITY_COLORS[pinModal.severity]?.color || '#94A3B8',
                      border: `1px solid ${SEVERITY_COLORS[pinModal.severity]?.color || '#94A3B8'}55`,
                    }}
                  >
                    {pinModal.severity} · {pinModal.id}
                  </span>
                  <h3 className="text-[15px] font-bold text-white">{pinModal.label}</h3>
                </div>
                <button
                  onClick={() => setPinModal(null)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  ✕
                </button>
              </div>

              {/* Body: photo + meta */}
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 bg-black flex items-center justify-center relative">
                  <DamagePhotoWithBoxes
                    src={`/twin-data/${MID}/damage_photos/${pinModal.photo}?v=${Date.now()}`}
                    label={pinModal.label}
                    bboxes={pinModal.bboxes ?? []}
                  />
                </div>
                <div className="w-[280px] border-l border-white/10 p-4 flex flex-col gap-3 overflow-y-auto">
                  <Row label="Structure" value={pinModal.structure} />
                  <Row label="Zone" value={pinModal.zone} />
                  <Row label="Confidence" value={`${Math.round((pinModal.confidence ?? 0) * 100)} %`} />
                  <Row label="First seen" value={pinModal.first_seen} />
                  <Row label="Trend" value={
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          pinModal.trend === 'worsening' ? '#ef444422'
                          : pinModal.trend === 'new'    ? '#0ea5e922'
                                                        : '#10b98122',
                        color:
                          pinModal.trend === 'worsening' ? '#ef4444'
                          : pinModal.trend === 'new'    ? '#0ea5e9'
                                                        : '#10b981',
                      }}
                    >
                      {pinModal.trend}
                    </span>
                  } />
                  <div className="mt-2 p-3 rounded-lg bg-white/5 text-[11px] text-slate-400 leading-relaxed">
                    Photo captured during the Yankee Pier H20T inspection. Position pinned in the 3D twin at the originating GPS coords.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className="text-[13px] font-medium text-white">{value}</div>
    </div>
  );
}

// Severity → color mapping used for bbox overlays. Matches the same scheme
// as the inspection page (green S0/S1, amber S2, orange S3, red S4).
const BBOX_SEVERITY: Record<string, string> = {
  S0: '#10B981', S1: '#10B981',
  S2: '#F59E0B',
  S3: '#FB923C',
  S4: '#EF4444',
};

type BBox = {
  type?: string;
  severity?: string;
  confidence?: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in original-image pixels
};

/** Renders the damage photo with severity-colored bbox overlays.
    The bbox coords are in the SOURCE image's native pixel space; we use an
    SVG with a viewBox matching those native dimensions, layered absolutely
    over the <img>, so the boxes scale automatically with the rendered image. */
function DamagePhotoWithBoxes({
  src, label, bboxes,
}: { src: string; label: string; bboxes: BBox[] }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="relative inline-block max-w-full max-h-[70vh]">
      <img
        src={src}
        alt={label}
        className="block max-w-full max-h-[70vh] object-contain"
        onLoad={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      {dims && bboxes && bboxes.length > 0 && (
        <svg
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {bboxes.map((b, i) => {
            const [x1, y1, x2, y2] = b.bbox;
            const col = BBOX_SEVERITY[b.severity ?? 'S1'] ?? '#94A3B8';
            // Stroke width + label text size are in image-pixel units (viewBox).
            // ~0.4% of width gives a nice 14-18px line on 4K images.
            const stroke = Math.max(6, Math.round(dims.w * 0.003));
            const fontSize = Math.max(28, Math.round(dims.w * 0.015));
            const padX = fontSize * 0.5;
            const padY = fontSize * 0.5;
            const tag = `${b.severity ?? ''} ${b.type ?? ''}`.trim();
            const tagW = tag.length * fontSize * 0.55 + padX * 2;
            const tagH = fontSize + padY;
            return (
              <g key={i}>
                <rect
                  x={x1} y={y1} width={x2 - x1} height={y2 - y1}
                  fill="none" stroke={col} strokeWidth={stroke}
                />
                {/* label background */}
                <rect
                  x={x1} y={Math.max(0, y1 - tagH)}
                  width={tagW} height={tagH}
                  fill={col} opacity={0.95}
                />
                <text
                  x={x1 + padX}
                  y={Math.max(0, y1 - tagH) + fontSize}
                  fill="white"
                  fontSize={fontSize}
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                  fontWeight={700}
                >
                  {tag}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

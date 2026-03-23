'use client';

import { useQuery } from '@tanstack/react-query';
import { assetsApi, imagesApi, dashboardApi } from '@/lib/api';
import { Asset, InfrastructureType, DashboardAssetHealth } from '@/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { MapPin, Building2, Waves, Anchor, Shield, Filter, ExternalLink, Eye, EyeOff, Globe, Camera, List, X, Search, AlertTriangle, Activity, Calendar, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => (
  <div className="w-full h-full bg-slate-900 rounded-xl flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-base text-slate-400 font-medium">Loading map...</span>
    </div>
  </div>
)});

const INFRA_CONFIG: Record<string, { label: string; icon: any; color: string; markerColor: string; desc: string }> = {
  pier: { label: 'Pier & Dock', icon: Anchor, color: 'bg-blue-500/15 text-blue-300', markerColor: '#3B82F6', desc: 'Piers, wharves & ferry landings' },
  coastal: { label: 'Coastal Structure', icon: Waves, color: 'bg-cyan-500/15 text-cyan-300', markerColor: '#06B6D4', desc: 'Seawalls, revetments & bulkheads' },
  seawall: { label: 'Seawall', icon: Shield, color: 'bg-teal-500/15 text-teal-300', markerColor: '#14B8A6', desc: 'Vertical seawall barriers' },
  breakwater: { label: 'Breakwater', icon: Building2, color: 'bg-indigo-500/15 text-indigo-300', markerColor: '#6366F1', desc: 'Offshore breakwater structures' },
};

const SEVERITY_OPTIONS = [
  { key: 'all', label: 'All', color: '#94A3B8' },
  { key: 'S4', label: 'S4', color: '#B71C1C' },
  { key: 'S3', label: 'S3', color: '#EF4444' },
  { key: 'S2', label: 'S2', color: '#F59E0B' },
  { key: 'S1', label: 'S1', color: '#EAB308' },
  { key: 'none', label: 'OK', color: '#38BDF8' },
];

const DATE_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '1y', label: '1y' },
];

function daysAgo(days: number): Date { const d = new Date(); d.setDate(d.getDate() - days); return d; }
function isStaleInspection(d: string | undefined): boolean { if (!d) return true; return new Date(d) < daysAgo(365); }
function healthColor(s: string | null): string {
  if (s === 'S4') return '#B71C1C'; if (s === 'S3') return '#EF4444'; if (s === 'S2') return '#F59E0B'; if (s === 'S1') return '#EAB308'; return '#34D399';
}
function healthLabel(s: string | null): string {
  if (s === 'S4') return 'Critical'; if (s === 'S3') return 'Poor'; if (s === 'S2') return 'Fair'; if (s === 'S1') return 'Good'; return 'Healthy';
}

// Glass button style helper
const glassBtn = (active: boolean) => active
  ? 'bg-black/40 backdrop-blur-2xl text-cyan-300 border-cyan-400/30 shadow-xl shadow-cyan-500/10'
  : 'bg-black/40 backdrop-blur-2xl text-white/80 border-white/[0.08] shadow-xl hover:text-white hover:border-white/15';

export default function MapPage() {
  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });
  const { data: gpsData } = useQuery({ queryKey: ['gps-points'], queryFn: () => imagesApi.gpsPoints() });
  const { data: dashboardData } = useQuery({ queryKey: ['dashboard-overview'], queryFn: () => dashboardApi.overview() });

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(Object.keys(INFRA_CONFIG)));
  const [showFilters, setShowFilters] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; lat: number; lon: number; type: 'asset' | 'place' }>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [flyToCoords, setFlyToCoords] = useState<[number, number] | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const [severityFilter, setSeverityFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [showAdvFilters, setShowAdvFilters] = useState(false);

  const healthMap = useMemo(() => {
    const map = new Map<string, DashboardAssetHealth>();
    dashboardData?.asset_health?.forEach((h: DashboardAssetHealth) => map.set(h.id, h));
    return map;
  }, [dashboardData]);

  const staleAssetIds = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a: Asset) => { if (isStaleInspection(a.last_inspection_at)) set.add(a.id); });
    return set;
  }, [assets]);

  const handleSelectAsset = useCallback((id: string) => {
    setSelectedAsset(id);
    setShowPanel(true);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!query.trim()) { setSearchResults([]); setShowSearchResults(false); return; }
    const q = query.toLowerCase();
    const assetMatches = assets
      .filter((a: Asset) => a.latitude != null && a.longitude != null)
      .filter((a: Asset) => a.name.toLowerCase().includes(q) || a.location_name?.toLowerCase().includes(q) || a.infrastructure_type.toLowerCase().includes(q))
      .slice(0, 5)
      .map((a: Asset) => ({ name: a.name, lat: a.latitude!, lon: a.longitude!, type: 'asset' as const }));
    setSearchResults(assetMatches);
    setShowSearchResults(true);
    if (query.length >= 3) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&viewbox=-74.05,40.70,-74.00,40.68&bounded=0`);
          const data = await res.json();
          const placeResults = data.map((p: any) => ({ name: p.display_name.split(',').slice(0, 2).join(','), lat: parseFloat(p.lat), lon: parseFloat(p.lon), type: 'place' as const }));
          setSearchResults(prev => [...prev.filter(r => r.type === 'asset'), ...placeResults]);
        } catch { /* ignore */ }
      }, 400);
    }
  }, [assets]);

  const handleSearchSelect = useCallback((result: { lat: number; lon: number }) => {
    setFlyToCoords([result.lat, result.lon]);
    setShowSearchResults(false);
    setSearchQuery('');
    setTimeout(() => setFlyToCoords(null), 2000);
  }, []);

  const filteredAssets = useMemo(() => {
    let result = assets.filter((a: Asset) => a.latitude != null && a.longitude != null && visibleTypes.has(a.infrastructure_type));
    if (severityFilter !== 'all') {
      result = result.filter((a: Asset) => {
        const h = healthMap.get(a.id);
        if (severityFilter === 'none') return !h?.worst_severity;
        return h?.worst_severity === severityFilter;
      });
    }
    if (dateFilter !== 'all') {
      const days = dateFilter === '7d' ? 7 : dateFilter === '30d' ? 30 : dateFilter === '90d' ? 90 : 365;
      const cutoff = daysAgo(days);
      result = result.filter((a: Asset) => a.last_inspection_at && new Date(a.last_inspection_at) >= cutoff);
    }
    return result;
  }, [assets, visibleTypes, severityFilter, dateFilter, healthMap]);

  const imagePoints = useMemo(() => (showImages ? (gpsData?.points ?? []) : []), [gpsData, showImages]);
  function toggleType(type: string) { setVisibleTypes(prev => { const n = new Set(prev); if (n.has(type)) n.delete(type); else n.add(type); return n; }); }

  const selected = assets.find((a: Asset) => a.id === selectedAsset);
  const selectedHealth = selected ? healthMap.get(selected.id) : null;
  const staleCount = staleAssetIds.size;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: '#082E29' }}>Map</h1>
        <p className="text-sm sm:text-base text-slate-500 mt-1">Asset locations and inspection imagery</p>
      </div>
      <div data-tour="map-view" className="h-[calc(100vh-160px)] lg:h-[calc(100vh-120px)] flex flex-col -mb-10 relative rounded-xl overflow-hidden">

      {/* ── Floating top bar ── */}
      <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ zIndex: 1000 }}>
        <div className="flex items-center justify-between px-3 sm:px-5 pt-3 sm:pt-4 pb-0 gap-2">

          {/* Title pill */}
          <div className="pointer-events-auto min-w-0 flex-shrink">
            <div className="flex items-center gap-2 sm:gap-2.5 bg-black/40 backdrop-blur-2xl rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-2xl border border-white/[0.08]">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#082E29,#0891B2)' }}>
                <Globe size={14} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-[12px] sm:text-[13px] font-bold text-white tracking-tight truncate">Governor&apos;s Island</h1>
                  <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded font-bold tracking-wider flex-shrink-0" style={{ background: 'rgba(8,145,178,0.25)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)' }}>LIVE</span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 leading-none truncate">
                  {filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}
                  {staleCount > 0 && <span className="text-amber-400 ml-1.5">· {staleCount} overdue</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 pointer-events-auto flex-shrink-0">
            <button onClick={() => setShowImages(v => !v)} title="Toggle photos"
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-xl border transition-all ${glassBtn(showImages)}`}>
              <Camera size={13} /><span className="hidden sm:inline">Photos</span>
            </button>
            <button onClick={() => setShowFilters(f => !f)} title="Layer types"
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-xl border transition-all ${glassBtn(showFilters)}`}>
              <Filter size={13} /><span className="hidden sm:inline">Layers</span>
            </button>
            <button onClick={() => setShowAdvFilters(f => !f)} title="Severity & date filters"
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-xl border transition-all ${glassBtn(showAdvFilters)}`}>
              <Activity size={13} /><span className="hidden sm:inline">Filters</span>
            </button>
            {/* Panel toggle */}
            <button onClick={() => setShowPanel(v => !v)} title="Asset panel"
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-xl border transition-all ${glassBtn(showPanel)}`}>
              <Search size={13} /><span className="hidden sm:inline">Assets</span>
            </button>
          </div>
        </div>

        {/* Layer chips */}
        {showFilters && (
          <div className="flex items-center gap-1.5 px-3 sm:px-5 pt-2 pb-1 pointer-events-auto flex-wrap">
            {Object.entries(INFRA_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              const active = visibleTypes.has(key);
              const count = assets.filter((a: Asset) => a.infrastructure_type === key && a.latitude != null).length;
              return (
                <button key={key} onClick={() => toggleType(key)}
                  className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${
                    active ? 'bg-black/40 backdrop-blur-2xl text-slate-200 border-white/10' : 'bg-black/20 text-slate-500 border-white/5 backdrop-blur-2xl'
                  }`} style={active ? { borderColor: config.markerColor + '40' } : {}}>
                  {active ? <Eye size={9} /> : <EyeOff size={9} />}
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: active ? config.markerColor : '#475569' }} />
                  <span className="hidden sm:inline">{config.label}</span>
                  <span className="sm:hidden">{config.label.split(' ')[0]}</span>
                  <span className="opacity-40">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Advanced filters */}
        {showAdvFilters && (
          <div className="flex items-center gap-2 px-3 sm:px-5 pt-2 pb-1 pointer-events-auto flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mr-0.5">Sev</span>
              {SEVERITY_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => setSeverityFilter(opt.key)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
                    severityFilter === opt.key ? 'bg-black/40 backdrop-blur-2xl text-white border-white/15' : 'bg-black/20 text-slate-500 border-white/5 backdrop-blur-2xl hover:text-slate-300'
                  }`} style={severityFilter === opt.key ? { borderColor: opt.color + '50', color: opt.color } : {}}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: opt.color }} />{opt.label}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-white/10 mx-0.5 hidden sm:block" />
            <div className="flex items-center gap-1">
              <Calendar size={10} className="text-slate-500" />
              {DATE_FILTER_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => setDateFilter(opt.key)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
                    dateFilter === opt.key ? 'bg-black/40 backdrop-blur-2xl text-cyan-400 border-cyan-400/25' : 'bg-black/20 text-slate-500 border-white/5 backdrop-blur-2xl hover:text-slate-300'
                  }`}>{opt.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Full-bleed map ── */}
      <div className="flex-1 relative">
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="w-full h-full bg-[#0a1420] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-9 h-9 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-base text-slate-400 font-medium">Loading assets...</span>
              </div>
            </div>
          ) : (
            <MapView
              assets={filteredAssets}
              selectedAssetId={selectedAsset}
              onSelectAsset={handleSelectAsset}
              infraConfig={INFRA_CONFIG}
              imagePoints={imagePoints}
              flyToCoords={flyToCoords}
            />
          )}
        </div>

        {/* ── Slide-in panel (hidden by default, toggled by Assets button) ── */}
        <div
          className={`absolute flex flex-col pointer-events-auto transition-all duration-300 ease-out
            bottom-0 left-0 right-0 lg:top-3 lg:bottom-3 lg:left-auto
            ${showPanel
              ? 'lg:right-3 translate-y-0 opacity-100'
              : 'lg:right-[-320px] translate-y-full lg:translate-y-0 opacity-0 lg:opacity-0 pointer-events-none'
            }
          `}
          style={{ maxHeight: '55vh', zIndex: 1000 }}
        >
          <style>{`
            @media (min-width: 1024px) {
              .map-side-panel { width: 280px; max-height: none !important; height: 100%; }
            }
          `}</style>

          <div className="map-side-panel w-full h-full">
          {selected ? (
            /* ── Asset detail card ── */
            <div className="bg-black/50 backdrop-blur-2xl border border-white/[0.08] rounded-t-2xl lg:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full">
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/[0.06]" style={{ background: 'rgba(8,46,41,0.3)' }}>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Asset Detail</h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedAsset(null)} className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold">← All</button>
                  <button onClick={() => setShowPanel(false)} className="text-slate-500 hover:text-white"><X size={14} /></button>
                </div>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${INFRA_CONFIG[selected.infrastructure_type]?.color || 'bg-slate-700 text-slate-300'}`}>
                    {INFRA_CONFIG[selected.infrastructure_type]?.label || selected.infrastructure_type}
                  </span>
                  {staleAssetIds.has(selected.id) && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 flex items-center gap-1">
                      <AlertTriangle size={9} /> Overdue
                    </span>
                  )}
                </div>
                <h2 className="text-[14px] font-bold text-white leading-tight">{selected.name}</h2>
                {selected.location_name && (
                  <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
                    <MapPin size={10} className="mt-0.5 flex-shrink-0" /> {selected.location_name}
                  </div>
                )}

                {/* Health bar */}
                <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Health</span>
                    <span className="text-[10px] font-bold" style={{ color: healthColor(selectedHealth?.worst_severity ?? null) }}>
                      {healthLabel(selectedHealth?.worst_severity ?? null)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{
                      width: selectedHealth?.worst_severity === 'S4' ? '15%' : selectedHealth?.worst_severity === 'S3' ? '35%' : selectedHealth?.worst_severity === 'S2' ? '60%' : selectedHealth?.worst_severity === 'S1' ? '80%' : '100%',
                      background: healthColor(selectedHealth?.worst_severity ?? null),
                    }} />
                  </div>
                  {selectedHealth && selectedHealth.total_detections > 0 && (
                    <p className="text-[9px] text-slate-500 mt-1">{selectedHealth.total_detections} detection{selectedHealth.total_detections !== 1 ? 's' : ''}</p>
                  )}
                </div>

                <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Status</span>
                    <span className={`font-semibold capitalize ${selected.status === 'active' ? 'text-emerald-400' : selected.status === 'maintenance' ? 'text-amber-400' : 'text-slate-400'}`}>{selected.status}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Inspections</span>
                    <span className="font-bold text-white">{selected.inspection_count}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Coords</span>
                    <span className="font-mono text-slate-400 text-[10px]">{selected.latitude?.toFixed(4)}, {selected.longitude?.toFixed(4)}</span>
                  </div>
                  {selected.last_inspection_at ? (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Last Insp.</span>
                      <span className={staleAssetIds.has(selected.id) ? 'text-amber-400 font-semibold' : 'text-slate-300'}>
                        {new Date(selected.last_inspection_at).toLocaleDateString()}{staleAssetIds.has(selected.id) && ' ⚠'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Last Insp.</span>
                      <span className="text-amber-400 font-semibold">Never</span>
                    </div>
                  )}
                </div>
                <Link href={`/assets/${selected.id}`}
                  className="flex items-center justify-center gap-2 text-[11px] font-bold text-white px-4 py-2 rounded-xl w-full transition-all hover:opacity-85 active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg,#082E29,#0891B2)' }}>
                  <ExternalLink size={12} /> View Asset
                </Link>
              </div>
            </div>
          ) : (
            /* ── Asset list panel with search ── */
            <div className="bg-black/50 backdrop-blur-2xl rounded-t-2xl lg:rounded-2xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0 h-full border border-white/[0.08]">
              {/* Header with close */}
              <div className="px-3 py-2.5 flex items-center justify-between border-b border-white/[0.06]" style={{ background: 'rgba(8,46,41,0.25)' }}>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                  Assets ({filteredAssets.length})
                </h3>
                <button onClick={() => setShowPanel(false)} className="text-slate-500 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>

              {/* Integrated search */}
              <div className="px-3 pt-2.5 pb-1.5">
                <div className="relative">
                  <div className="flex items-center gap-2 bg-white/[0.06] rounded-lg px-2.5 py-2 border border-white/[0.06]">
                    <Search size={12} className="text-slate-500 flex-shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => handleSearch(e.target.value)}
                      onFocus={() => searchQuery && setShowSearchResults(true)}
                      placeholder="Search assets or places..."
                      className="bg-transparent text-[11px] text-white placeholder-slate-600 outline-none flex-1"
                    />
                    {searchQuery && (
                      <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }} className="text-slate-500 hover:text-white"><X size={11} /></button>
                    )}
                  </div>
                  {showSearchResults && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-2xl rounded-lg border border-white/10 shadow-2xl overflow-hidden max-h-[180px] overflow-y-auto" style={{ zIndex: 10 }}>
                      {searchResults.map((r, i) => (
                        <button key={i} onClick={() => { handleSearchSelect(r); if (r.type === 'asset') { const m = assets.find((a: Asset) => a.name === r.name); if (m) handleSelectAsset(m.id); } }}
                          className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors flex items-center gap-2 border-b border-white/5 last:border-0">
                          {r.type === 'asset' ? <MapPin size={11} className="text-cyan-400 flex-shrink-0" /> : <Search size={11} className="text-slate-500 flex-shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-[11px] text-white truncate">{r.name}</p>
                            <p className="text-[9px] text-slate-500">{r.type === 'asset' ? 'Asset' : 'Place'}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Asset list */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                {filteredAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <MapPin size={16} className="text-cyan-400 mb-2" />
                    <p className="text-[11px] text-slate-300 font-semibold">No matching assets</p>
                    <p className="text-[10px] text-slate-500 mt-1 px-4">Adjust filters to see results.</p>
                  </div>
                ) : (
                  filteredAssets.map((asset: Asset) => {
                    const config = INFRA_CONFIG[asset.infrastructure_type];
                    const Icon = config?.icon || Anchor;
                    const isActive = asset.id === selectedAsset;
                    const health = healthMap.get(asset.id);
                    const isStale = staleAssetIds.has(asset.id);
                    const hColor = healthColor(health?.worst_severity ?? null);
                    return (
                      <button key={asset.id} onClick={() => setSelectedAsset(asset.id)}
                        className={`w-full text-left p-2 rounded-lg transition-all group flex items-center gap-2.5 ${
                          isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                        }`} style={isActive ? { border: '1px solid rgba(8,145,178,0.2)' } : { border: '1px solid transparent' }}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 relative"
                          style={{ backgroundColor: (config?.markerColor || '#64748B') + '18', color: config?.markerColor || '#64748B' }}>
                          <Icon size={14} />
                          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-black/50" style={{ background: hColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <p className="text-[12px] font-semibold text-slate-200 group-hover:text-white truncate">{asset.name}</p>
                            {isStale && <AlertTriangle size={10} className="text-amber-400 flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] text-slate-500">{config?.label || asset.infrastructure_type}</span>
                            <span className="text-[9px] text-slate-600">·</span>
                            <span className="text-[9px] text-slate-500">{asset.inspection_count} insp.</span>
                            <div className="flex-1 h-1 rounded-full bg-white/[0.06] max-w-[32px]">
                              <div className="h-full rounded-full" style={{
                                width: !health?.worst_severity ? '100%' : health.worst_severity === 'S1' ? '80%' : health.worst_severity === 'S2' ? '60%' : health.worst_severity === 'S3' ? '35%' : '15%',
                                background: hColor,
                              }} />
                            </div>
                          </div>
                        </div>
                        <ChevronRight size={12} className="text-slate-600 flex-shrink-0" />
                      </button>
                    );
                  })
                )}
              </div>

              {/* Stale warning */}
              {staleCount > 0 && (
                <div className="px-3 py-2" style={{ borderTop: '1px solid rgba(251,191,36,0.1)', background: 'rgba(251,191,36,0.03)' }}>
                  <p className="text-[9px] font-bold text-amber-400/70 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle size={9} /> {staleCount} overdue (&gt;1 yr)
                  </p>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

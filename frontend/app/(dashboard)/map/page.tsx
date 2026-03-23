'use client';

import { useQuery } from '@tanstack/react-query';
import { assetsApi, imagesApi, dashboardApi } from '@/lib/api';
import { Asset, InfrastructureType, DashboardAssetHealth } from '@/types';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { MapPin, Building2, Waves, Anchor, Shield, Filter, ExternalLink, Eye, EyeOff, Globe, Camera, List, X, Search, AlertTriangle, Activity, Calendar, ChevronDown } from 'lucide-react';
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
  pier: {
    label: 'Pier & Dock',
    icon: Anchor,
    color: 'bg-blue-500/15 text-blue-300',
    markerColor: '#3B82F6',
    desc: 'Piers, wharves & ferry landings',
  },
  coastal: {
    label: 'Coastal Structure',
    icon: Waves,
    color: 'bg-cyan-500/15 text-cyan-300',
    markerColor: '#06B6D4',
    desc: 'Seawalls, revetments & bulkheads',
  },
  seawall: {
    label: 'Seawall',
    icon: Shield,
    color: 'bg-teal-500/15 text-teal-300',
    markerColor: '#14B8A6',
    desc: 'Vertical seawall barriers',
  },
  breakwater: {
    label: 'Breakwater',
    icon: Building2,
    color: 'bg-indigo-500/15 text-indigo-300',
    markerColor: '#6366F1',
    desc: 'Offshore breakwater structures',
  },
  wind_turbine: {
    label: 'Wind Turbine',
    icon: Building2,
    color: 'bg-sky-500/15 text-sky-300',
    markerColor: '#0EA5E9',
    desc: 'Offshore wind turbines',
  },
};

const SEVERITY_OPTIONS = [
  { key: 'all', label: 'All', color: '#94A3B8' },
  { key: 'S4',  label: 'S4 Critical', color: '#B71C1C' },
  { key: 'S3',  label: 'S3 High',     color: '#EF4444' },
  { key: 'S2',  label: 'S2 Medium',   color: '#F59E0B' },
  { key: 'S1',  label: 'S1 Low',      color: '#EAB308' },
  { key: 'none', label: 'No Damage',  color: '#38BDF8' },
];

const DATE_FILTER_OPTIONS = [
  { key: 'all', label: 'All Dates' },
  { key: '7d',  label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '1y',  label: 'Last year' },
];

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function isStaleInspection(lastInspection: string | undefined): boolean {
  if (!lastInspection) return true;
  const oneYearAgo = daysAgo(365);
  return new Date(lastInspection) < oneYearAgo;
}

function healthColor(severity: string | null): string {
  if (severity === 'S4') return '#B71C1C';
  if (severity === 'S3') return '#EF4444';
  if (severity === 'S2') return '#F59E0B';
  if (severity === 'S1') return '#EAB308';
  return '#34D399';
}

function healthLabel(severity: string | null): string {
  if (severity === 'S4') return 'Critical';
  if (severity === 'S3') return 'Poor';
  if (severity === 'S2') return 'Fair';
  if (severity === 'S1') return 'Good';
  return 'Healthy';
}

export default function MapPage() {
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(),
  });

  const { data: gpsData } = useQuery({
    queryKey: ['gps-points'],
    queryFn: () => imagesApi.gpsPoints(),
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.overview(),
  });

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes]   = useState<Set<string>>(new Set(Object.keys(INFRA_CONFIG)));
  const [showFilters, setShowFilters]     = useState(false);
  const [showImages, setShowImages]       = useState(false);
  const [showPanel, setShowPanel]         = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; lat: number; lon: number; type: 'asset' | 'place' }>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [flyToCoords, setFlyToCoords] = useState<[number, number] | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const searchRef = useRef<HTMLDivElement>(null);

  // Advanced filters
  const [severityFilter, setSeverityFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [showAdvFilters, setShowAdvFilters] = useState(false);

  // Build health map from dashboard data
  const healthMap = useMemo(() => {
    const map = new Map<string, DashboardAssetHealth>();
    if (dashboardData?.asset_health) {
      dashboardData.asset_health.forEach((h: DashboardAssetHealth) => map.set(h.id, h));
    }
    return map;
  }, [dashboardData]);

  // Stale assets (no inspection in 1+ year)
  const staleAssetIds = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a: Asset) => { if (isStaleInspection(a.last_inspection_at)) set.add(a.id); });
    return set;
  }, [assets]);

  const handleSelectAsset = useCallback((id: string) => {
    setSelectedAsset(id);
    setShowPanel(true);
  }, []);

  // Search handler — match assets first, then geocode with Nominatim
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const q = query.toLowerCase();
    // Match assets
    const assetMatches = assets
      .filter((a: Asset) => a.latitude != null && a.longitude != null)
      .filter((a: Asset) => a.name.toLowerCase().includes(q) || a.location_name?.toLowerCase().includes(q) || a.infrastructure_type.toLowerCase().includes(q))
      .slice(0, 5)
      .map((a: Asset) => ({ name: a.name, lat: a.latitude!, lon: a.longitude!, type: 'asset' as const }));

    setSearchResults(assetMatches);
    setShowSearchResults(true);

    // Geocode via Nominatim (debounced)
    if (query.length >= 3) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&viewbox=-74.05,40.70,-74.00,40.68&bounded=0`);
          const data = await res.json();
          const placeResults = data.map((p: any) => ({
            name: p.display_name.split(',').slice(0, 2).join(','),
            lat: parseFloat(p.lat),
            lon: parseFloat(p.lon),
            type: 'place' as const,
          }));
          setSearchResults(prev => [...prev.filter(r => r.type === 'asset'), ...placeResults]);
        } catch { /* ignore geocode errors */ }
      }, 400);
    }
  }, [assets]);

  const handleSearchSelect = useCallback((result: { lat: number; lon: number }) => {
    setFlyToCoords([result.lat, result.lon]);
    setShowSearchResults(false);
    setSearchQuery('');
    // Reset flyTo after a tick so subsequent same-coords still trigger
    setTimeout(() => setFlyToCoords(null), 2000);
  }, []);

  // Close search results on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Filter assets
  const filteredAssets = useMemo(() => {
    let result = assets.filter((a: Asset) => a.latitude != null && a.longitude != null && visibleTypes.has(a.infrastructure_type));

    // Severity filter
    if (severityFilter !== 'all') {
      result = result.filter((a: Asset) => {
        const h = healthMap.get(a.id);
        if (severityFilter === 'none') return !h?.worst_severity;
        return h?.worst_severity === severityFilter;
      });
    }

    // Date filter
    if (dateFilter !== 'all') {
      const days = dateFilter === '7d' ? 7 : dateFilter === '30d' ? 30 : dateFilter === '90d' ? 90 : 365;
      const cutoff = daysAgo(days);
      result = result.filter((a: Asset) => a.last_inspection_at && new Date(a.last_inspection_at) >= cutoff);
    }

    return result;
  }, [assets, visibleTypes, severityFilter, dateFilter, healthMap]);

  const assetsWithoutLocation = useMemo(
    () => assets.filter((a: Asset) => a.latitude == null || a.longitude == null),
    [assets]
  );

  const imagePoints = useMemo(() => (showImages ? (gpsData?.points ?? []) : []), [gpsData, showImages]);

  function toggleType(type: string) {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

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

      {/* Floating top bar */}
      <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ zIndex: 1000 }}>
        <div className="flex items-center justify-between px-3 sm:px-5 pt-3 sm:pt-4 pb-0 gap-2">

          {/* Title pill */}
          <div className="pointer-events-auto min-w-0 flex-shrink">
            <div className="flex items-center gap-2 sm:gap-2.5 bg-[#0a1420]/90 backdrop-blur-xl rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-xl border border-white/8">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#082E29,#0891B2)' }}>
                <Globe size={14} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-[12px] sm:text-[13px] font-bold text-white tracking-tight truncate">Governor&apos;s Island</h1>
                  <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded font-bold tracking-wider flex-shrink-0" style={{ background: 'rgba(8,145,178,0.2)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)' }}>LIVE</span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 leading-none truncate">
                  {filteredAssets.length} asset{filteredAssets.length !== 1 ? 's' : ''}
                  {imagePoints.length > 0 && <span className="text-cyan-400 ml-1.5">· {imagePoints.length} photos</span>}
                  {staleCount > 0 && <span className="text-amber-400 ml-1.5">· {staleCount} overdue</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Search + Controls */}
          <div className="flex items-center gap-1 sm:gap-1.5 pointer-events-auto flex-shrink-0 lg:mr-[290px]">

            {/* Search bar */}
            <div ref={searchRef} className="relative hidden sm:block">
              <div className="flex items-center gap-1.5 bg-[#0a1420]/90 backdrop-blur-xl rounded-lg px-2.5 py-1.5 border border-white/8 shadow-lg">
                <Search size={13} className="text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  onFocus={() => searchQuery && setShowSearchResults(true)}
                  placeholder="Search assets or places..."
                  className="bg-transparent text-[12px] text-white placeholder-slate-500 outline-none w-[140px] lg:w-[180px]"
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }} className="text-slate-500 hover:text-white">
                    <X size={12} />
                  </button>
                )}
              </div>
              {showSearchResults && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a1420]/95 backdrop-blur-xl rounded-lg border border-white/10 shadow-2xl overflow-hidden max-h-[240px] overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        handleSearchSelect(r);
                        if (r.type === 'asset') {
                          const match = assets.find((a: Asset) => a.name === r.name);
                          if (match) handleSelectAsset(match.id);
                        }
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors flex items-center gap-2 border-b border-white/5 last:border-0"
                    >
                      {r.type === 'asset' ? <MapPin size={12} className="text-cyan-400 flex-shrink-0" /> : <Search size={12} className="text-slate-500 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-[11px] text-white truncate">{r.name}</p>
                        <p className="text-[9px] text-slate-500">{r.type === 'asset' ? 'Asset' : 'Place'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowPanel(v => !v)}
              title="Toggle asset list"
              className={`flex lg:hidden items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg shadow-lg border transition-all ${
                showPanel
                  ? 'bg-[#082E29]/90 text-cyan-400 border-cyan-400/25 backdrop-blur-xl'
                  : 'bg-[#0a1420]/85 text-slate-400 border-white/8 backdrop-blur-xl hover:text-slate-200'
              }`}>
              <List size={14} />
            </button>
            <button
              onClick={() => setShowImages(v => !v)}
              title="Toggle inspection photos"
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 sm:px-3.5 py-2 rounded-lg shadow-lg border transition-all ${
                showImages
                  ? 'bg-[#082E29]/90 text-cyan-400 border-cyan-400/25 backdrop-blur-xl'
                  : 'bg-[#0a1420]/85 text-slate-400 border-white/8 backdrop-blur-xl hover:text-slate-200'
              }`}>
              <Camera size={14} />
              <span className="hidden sm:inline">Photos</span>
            </button>
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 sm:px-3.5 py-2 rounded-lg shadow-lg border transition-all ${
                showFilters
                  ? 'bg-[#082E29]/90 text-cyan-400 border-cyan-400/25 backdrop-blur-xl'
                  : 'bg-[#0a1420]/85 text-slate-400 border-white/8 backdrop-blur-xl hover:text-slate-200'
              }`}>
              <Filter size={14} />
              <span className="hidden sm:inline">Layers</span>
            </button>
            <button
              onClick={() => setShowAdvFilters(f => !f)}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 sm:px-3.5 py-2 rounded-lg shadow-lg border transition-all ${
                showAdvFilters
                  ? 'bg-[#082E29]/90 text-cyan-400 border-cyan-400/25 backdrop-blur-xl'
                  : 'bg-[#0a1420]/85 text-slate-400 border-white/8 backdrop-blur-xl hover:text-slate-200'
              }`}>
              <Activity size={14} />
              <span className="hidden sm:inline">Filters</span>
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
                <button
                  key={key}
                  onClick={() => toggleType(key)}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg shadow-md border transition-all ${
                    active
                      ? 'bg-[#0a1420]/90 backdrop-blur-xl text-slate-200 border-white/10'
                      : 'bg-[#0a1420]/60 text-slate-500 border-white/5 backdrop-blur-xl'
                  }`}
                  style={active ? { borderColor: config.markerColor + '40' } : {}}>
                  {active ? <Eye size={10} /> : <EyeOff size={10} />}
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: active ? config.markerColor : '#475569' }} />
                  <span className="hidden sm:inline">{config.label}</span>
                  <span className="sm:hidden">{config.label.split(' ')[0]}</span>
                  <span className="opacity-40">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Advanced filters: severity + date */}
        {showAdvFilters && (
          <div className="flex items-center gap-2 px-3 sm:px-5 pt-2 pb-1 pointer-events-auto flex-wrap">
            {/* Severity */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mr-1">Severity</span>
              {SEVERITY_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSeverityFilter(opt.key)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                    severityFilter === opt.key
                      ? 'bg-[#0a1420]/90 backdrop-blur-xl text-white border-white/15'
                      : 'bg-[#0a1420]/60 text-slate-500 border-white/5 backdrop-blur-xl hover:text-slate-300'
                  }`}
                  style={severityFilter === opt.key ? { borderColor: opt.color + '50', color: opt.color } : {}}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: opt.color }} />
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-white/10 mx-1 hidden sm:block" />
            {/* Date */}
            <div className="flex items-center gap-1">
              <Calendar size={11} className="text-slate-400 mr-0.5" />
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mr-1">Inspected</span>
              {DATE_FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setDateFilter(opt.key)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                    dateFilter === opt.key
                      ? 'bg-[#0a1420]/90 backdrop-blur-xl text-cyan-400 border-cyan-400/25'
                      : 'bg-[#0a1420]/60 text-slate-500 border-white/5 backdrop-blur-xl hover:text-slate-300'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Full-bleed map */}
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

        {/* Floating right panel */}
        <div
          className={`absolute flex flex-col pointer-events-auto transition-all duration-300 ease-out
            bottom-0 left-0 right-0 lg:top-4 lg:right-4 lg:bottom-4 lg:left-auto
            ${showPanel
              ? 'translate-y-0 opacity-100'
              : 'translate-y-full lg:translate-y-0 lg:opacity-100 opacity-0 pointer-events-none lg:pointer-events-auto'
            }
          `}
          style={{ maxHeight: '50vh', zIndex: 1000 }}
        >
          <style>{`
            @media (min-width: 1024px) {
              .map-side-panel { width: 280px; max-height: none !important; height: 100%; }
            }
          `}</style>

          <div className="map-side-panel w-full h-full">
          {selected ? (
            /* Asset detail card */
            <div className="bg-[#0a1420]/95 backdrop-blur-xl border rounded-t-2xl lg:rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,46,41,0.4)' }}>
                <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em]">Asset Detail</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedAsset(null)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 transition-colors">
                    ← All
                  </button>
                  <button onClick={() => setShowPanel(false)} className="lg:hidden text-slate-400 hover:text-white transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2.5 py-1 rounded-md font-semibold ${
                    INFRA_CONFIG[selected.infrastructure_type]?.color || 'bg-slate-700 text-slate-300'
                  }`}>
                    {INFRA_CONFIG[selected.infrastructure_type]?.label || selected.infrastructure_type}
                  </span>
                  {staleAssetIds.has(selected.id) && (
                    <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 flex items-center gap-1">
                      <AlertTriangle size={10} /> Overdue
                    </span>
                  )}
                </div>
                <h2 className="text-[15px] font-bold text-white leading-tight">{selected.name}</h2>
                {selected.location_name && (
                  <div className="flex items-start gap-1.5 text-[12px] text-slate-400">
                    <MapPin size={10} className="mt-0.5 flex-shrink-0" /> {selected.location_name}
                  </div>
                )}

                {/* Health bar */}
                <div className="rounded-xl p-3" style={{ background: 'rgba(8,46,41,0.3)', border: '1px solid rgba(8,145,178,0.15)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Asset Health</span>
                    <span className="text-[11px] font-bold" style={{ color: healthColor(selectedHealth?.worst_severity ?? null) }}>
                      {healthLabel(selectedHealth?.worst_severity ?? null)}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: selectedHealth?.worst_severity === 'S4' ? '15%' :
                               selectedHealth?.worst_severity === 'S3' ? '35%' :
                               selectedHealth?.worst_severity === 'S2' ? '60%' :
                               selectedHealth?.worst_severity === 'S1' ? '80%' : '100%',
                        background: `linear-gradient(90deg, ${healthColor(selectedHealth?.worst_severity ?? null)}, ${healthColor(selectedHealth?.worst_severity ?? null)}88)`,
                      }}
                    />
                  </div>
                  {selectedHealth && selectedHealth.total_detections > 0 && (
                    <p className="text-[10px] text-slate-500 mt-1.5">{selectedHealth.total_detections} detection{selectedHealth.total_detections !== 1 ? 's' : ''} found</p>
                  )}
                </div>

                <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: 'rgba(8,46,41,0.3)', border: '1px solid rgba(8,145,178,0.15)' }}>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-slate-500">Status</span>
                    <span className={`font-semibold capitalize ${
                      selected.status === 'active' ? 'text-emerald-400' :
                      selected.status === 'maintenance' ? 'text-amber-400' : 'text-slate-400'
                    }`}>{selected.status}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-slate-500">Inspections</span>
                    <span className="font-bold text-white">{selected.inspection_count}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span className="text-slate-500">Coordinates</span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      {selected.latitude?.toFixed(4)}, {selected.longitude?.toFixed(4)}
                    </span>
                  </div>
                  {selected.last_inspection_at && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-slate-500">Last Inspection</span>
                      <span className={staleAssetIds.has(selected.id) ? 'text-amber-400 font-semibold' : 'text-slate-300'}>
                        {new Date(selected.last_inspection_at).toLocaleDateString()}
                        {staleAssetIds.has(selected.id) && ' ⚠'}
                      </span>
                    </div>
                  )}
                  {!selected.last_inspection_at && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-slate-500">Last Inspection</span>
                      <span className="text-amber-400 font-semibold">Never</span>
                    </div>
                  )}
                </div>
                <Link
                  href={`/assets/${selected.id}`}
                  className="flex items-center justify-center gap-2 text-[12px] font-bold text-white px-4 py-2.5 rounded-xl w-full transition-all hover:opacity-85 active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg,#082E29,#0891B2)' }}>
                  <ExternalLink size={14} /> View Asset
                </Link>
              </div>
            </div>
          ) : (
            /* Asset list panel */
            <div className="bg-[#0a1420]/95 backdrop-blur-xl rounded-t-2xl lg:rounded-2xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0 h-full" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,46,41,0.3)' }}>
                <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em]">
                  Infrastructure ({filteredAssets.length})
                </h3>
                <button onClick={() => setShowPanel(false)} className="lg:hidden text-slate-400 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Mobile search bar */}
              <div className="sm:hidden px-3 pt-2">
                <div className="flex items-center gap-1.5 bg-slate-800/60 rounded-lg px-2.5 py-1.5 border border-white/5">
                  <Search size={12} className="text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => handleSearch(e.target.value)}
                    placeholder="Search..."
                    className="bg-transparent text-[11px] text-white placeholder-slate-600 outline-none flex-1"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {filteredAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(8,46,41,0.4)', border: '1px solid rgba(8,145,178,0.2)' }}>
                      <MapPin size={18} className="text-cyan-400" />
                    </div>
                    <p className="text-[12px] text-slate-300 font-semibold">No matching assets</p>
                    <p className="text-[11px] text-slate-500 mt-1 px-4 leading-relaxed">
                      Adjust filters to see assets on the map.
                    </p>
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
                      <button
                        key={asset.id}
                        onClick={() => { setSelectedAsset(asset.id); }}
                        className={`w-full text-left p-2.5 rounded-xl transition-all group flex items-start gap-2.5 ${
                          isActive ? 'bg-[#082E29]/60' : 'hover:bg-white/4'
                        }`}
                        style={isActive ? { border: '1px solid rgba(8,145,178,0.25)' } : { border: '1px solid transparent' }}>
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 relative"
                          style={{ backgroundColor: (config?.markerColor || '#64748B') + '20', color: config?.markerColor || '#64748B', border: `1px solid ${(config?.markerColor || '#64748B')}30` }}>
                          <Icon size={16} />
                          {/* Health dot */}
                          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[#0a1420]" style={{ background: hColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-semibold text-slate-200 group-hover:text-white truncate transition-colors">
                              {asset.name}
                            </p>
                            {isStale && (
                              <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                            )}
                          </div>
                          {asset.location_name && (
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">{asset.location_name}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${config?.color || 'bg-slate-700 text-slate-400'}`}>
                              {config?.label || asset.infrastructure_type}
                            </span>
                            <span className="text-[10px] text-slate-500">{asset.inspection_count} insp.</span>
                            {/* Mini health bar */}
                            <div className="flex-1 h-1 rounded-full bg-slate-800 max-w-[40px]">
                              <div className="h-full rounded-full" style={{
                                width: !health?.worst_severity ? '100%' :
                                       health.worst_severity === 'S1' ? '80%' :
                                       health.worst_severity === 'S2' ? '60%' :
                                       health.worst_severity === 'S3' ? '35%' : '15%',
                                background: hColor,
                              }} />
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Stale inspections warning */}
              {staleCount > 0 && (
                <div className="px-3.5 py-2.5" style={{ borderTop: '1px solid rgba(251,191,36,0.15)', background: 'rgba(251,191,36,0.04)' }}>
                  <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-[0.12em] mb-1 flex items-center gap-1">
                    <AlertTriangle size={10} /> Overdue Inspection ({staleCount})
                  </p>
                  <p className="text-[10px] text-amber-400/60 leading-relaxed">
                    {staleCount} asset{staleCount !== 1 ? 's have' : ' has'} not been inspected in over 1 year.
                  </p>
                </div>
              )}

              {assetsWithoutLocation.length > 0 && (
                <div className="px-3.5 py-2.5" style={{ borderTop: '1px solid rgba(251,191,36,0.15)', background: 'rgba(251,191,36,0.04)' }}>
                  <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-[0.12em] mb-1.5">
                    Missing Location ({assetsWithoutLocation.length})
                  </p>
                  {assetsWithoutLocation.slice(0, 3).map((a: Asset) => (
                    <Link key={a.id} href={`/assets/${a.id}`}
                      className="block text-[11px] text-amber-400/70 hover:text-amber-300 truncate py-0.5 transition-colors">
                      {a.name} — <span className="underline">add coordinates</span>
                    </Link>
                  ))}
                  {assetsWithoutLocation.length > 3 && (
                    <span className="text-[11px] text-amber-500/40">+{assetsWithoutLocation.length - 3} more</span>
                  )}
                </div>
              )}

              {/* Legend */}
              <div className="px-4 py-3 hidden lg:block" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-2">Legend</p>
                <div className="space-y-1.5">
                  {Object.entries(INFRA_CONFIG)
                    .filter(([key]) => assets.some((a: Asset) => a.infrastructure_type === key))
                    .map(([key, config]) => (
                      <div key={key} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: config.markerColor }} />
                        <span className="text-[11px] text-slate-400">{config.label}</span>
                      </div>
                    ))}
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0 bg-cyan-400 opacity-80" />
                    <span className="text-[11px] text-slate-400">Inspection photo</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={12} className="text-amber-400" />
                    <span className="text-[11px] text-slate-400">Overdue (&gt;1 year)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

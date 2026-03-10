'use client';

import { useQuery } from '@tanstack/react-query';
import { assetsApi, imagesApi } from '@/lib/api';
import { Asset, InfrastructureType } from '@/types';
import { useState, useMemo, useCallback } from 'react';
import { MapPin, Building2, Waves, Anchor, Shield, Filter, ExternalLink, Eye, EyeOff, Globe, Camera } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => (
  <div className="w-full h-full bg-slate-900 rounded-xl flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400 font-medium">Loading map...</span>
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

export default function MapPage() {
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(),
  });

  const { data: gpsData } = useQuery({
    queryKey: ['gps-points'],
    queryFn: () => imagesApi.gpsPoints(),
  });

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes]   = useState<Set<string>>(new Set(Object.keys(INFRA_CONFIG)));
  const [showFilters, setShowFilters]     = useState(false);
  const [showImages, setShowImages]       = useState(false);

  const handleSelectAsset = useCallback((id: string) => setSelectedAsset(id), []);

  const mappableAssets = useMemo(
    () => assets.filter((a: Asset) => a.latitude != null && a.longitude != null && visibleTypes.has(a.infrastructure_type)),
    [assets, visibleTypes]
  );

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

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col -mx-6 -mb-6 relative">

      {/* Floating top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="flex items-center justify-between px-5 pt-4 pb-0">

          {/* Title pill */}
          <div className="pointer-events-auto">
            <div className="flex items-center gap-2.5 bg-[#0a1420]/90 backdrop-blur-xl rounded-xl px-4 py-2.5 shadow-xl border border-white/8">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#082E29,#0891B2)' }}>
                <Globe size={13} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[13px] font-bold text-white tracking-tight">Governor's Island</h1>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wider" style={{ background: 'rgba(8,145,178,0.2)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)' }}>LIVE</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-none">
                  {mappableAssets.length} asset{mappableAssets.length !== 1 ? 's' : ''}
                  {imagePoints.length > 0 && <span className="text-cyan-400 ml-1.5">· {imagePoints.length} photo{imagePoints.length !== 1 ? 's' : ''}</span>}
                  {assetsWithoutLocation.length > 0 && <span className="text-amber-400 ml-1.5">· {assetsWithoutLocation.length} unlocated</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              onClick={() => setShowImages(v => !v)}
              title="Toggle inspection photos"
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3.5 py-2 rounded-lg shadow-lg border transition-all ${
                showImages
                  ? 'bg-[#082E29]/90 text-cyan-400 border-cyan-400/25 backdrop-blur-xl'
                  : 'bg-[#0a1420]/85 text-slate-400 border-white/8 backdrop-blur-xl hover:text-slate-200'
              }`}>
              <Camera size={12} />
              <span>Photos</span>
            </button>
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3.5 py-2 rounded-lg shadow-lg border transition-all ${
                showFilters
                  ? 'bg-[#082E29]/90 text-cyan-400 border-cyan-400/25 backdrop-blur-xl'
                  : 'bg-[#0a1420]/85 text-slate-400 border-white/8 backdrop-blur-xl hover:text-slate-200'
              }`}>
              <Filter size={12} />
              <span>Layers</span>
            </button>
          </div>
        </div>

        {/* Filter chips */}
        {showFilters && (
          <div className="flex items-center gap-1.5 px-5 pt-2 pb-1 pointer-events-auto flex-wrap">
            {Object.entries(INFRA_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              const active = visibleTypes.has(key);
              const count = assets.filter((a: Asset) => a.infrastructure_type === key && a.latitude != null).length;
              return (
                <button
                  key={key}
                  onClick={() => toggleType(key)}
                  className={`flex items-center gap-1.5 text-[10px] font-semibold px-3 py-1.5 rounded-lg shadow-md border transition-all ${
                    active
                      ? 'bg-[#0a1420]/90 backdrop-blur-xl text-slate-200 border-white/10'
                      : 'bg-[#0a1420]/60 text-slate-500 border-white/5 backdrop-blur-xl'
                  }`}
                  style={active ? { borderColor: config.markerColor + '40' } : {}}>
                  {active ? <Eye size={10} /> : <EyeOff size={10} />}
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: active ? config.markerColor : '#475569' }} />
                  {config.label}
                  <span className="opacity-40">({count})</span>
                </button>
              );
            })}
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
                <span className="text-sm text-slate-400 font-medium">Loading assets...</span>
              </div>
            </div>
          ) : (
            <MapView
              assets={mappableAssets}
              selectedAssetId={selectedAsset}
              onSelectAsset={handleSelectAsset}
              infraConfig={INFRA_CONFIG}
              imagePoints={imagePoints}
            />
          )}
        </div>

        {/* Floating right panel */}
        <div className="absolute top-4 right-4 bottom-4 w-68 z-10 flex flex-col pointer-events-auto" style={{ width: '270px' }}>
          {selected ? (
            /* Asset detail card */
            <div className="bg-[#0a1420]/95 backdrop-blur-xl border rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,46,41,0.4)' }}>
                <h3 className="text-[9px] font-bold text-slate-300 uppercase tracking-[0.2em]">Asset Detail</h3>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 transition-colors">
                  ← All
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <span className={`text-[10px] px-2.5 py-1 rounded-md font-semibold ${
                    INFRA_CONFIG[selected.infrastructure_type]?.color || 'bg-slate-700 text-slate-300'
                  }`}>
                    {INFRA_CONFIG[selected.infrastructure_type]?.label || selected.infrastructure_type}
                  </span>
                </div>
                <h2 className="text-[15px] font-bold text-white leading-tight">{selected.name}</h2>
                {selected.location_name && (
                  <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
                    <MapPin size={10} className="mt-0.5 flex-shrink-0" /> {selected.location_name}
                  </div>
                )}
                <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: 'rgba(8,46,41,0.3)', border: '1px solid rgba(8,145,178,0.15)' }}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Status</span>
                    <span className={`font-semibold capitalize ${
                      selected.status === 'active' ? 'text-emerald-400' :
                      selected.status === 'maintenance' ? 'text-amber-400' : 'text-slate-400'
                    }`}>{selected.status}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Inspections</span>
                    <span className="font-bold text-white">{selected.inspection_count}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Coordinates</span>
                    <span className="font-mono text-slate-400 text-[10px]">
                      {selected.latitude?.toFixed(4)}, {selected.longitude?.toFixed(4)}
                    </span>
                  </div>
                  {selected.last_inspection_at && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Last Inspection</span>
                      <span className="text-slate-300">{new Date(selected.last_inspection_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                <Link
                  href={`/assets/${selected.id}`}
                  className="flex items-center justify-center gap-2 text-[11px] font-bold text-white px-4 py-2.5 rounded-xl w-full transition-all hover:opacity-85"
                  style={{ background: 'linear-gradient(135deg,#082E29,#0891B2)' }}>
                  <ExternalLink size={12} /> View Asset
                </Link>
              </div>
            </div>
          ) : (
            /* Asset list panel */
            <div className="bg-[#0a1420]/95 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,46,41,0.3)' }}>
                <h3 className="text-[9px] font-bold text-slate-300 uppercase tracking-[0.2em]">
                  Infrastructure ({mappableAssets.length})
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {mappableAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(8,46,41,0.4)', border: '1px solid rgba(8,145,178,0.2)' }}>
                      <MapPin size={18} className="text-cyan-400" />
                    </div>
                    <p className="text-[11px] text-slate-300 font-semibold">No assets on map</p>
                    <p className="text-[10px] text-slate-500 mt-1 px-4 leading-relaxed">
                      Add coordinates to assets to place them on the map.
                    </p>
                    <Link href="/assets" className="mt-3 text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded-lg transition-colors" style={{ background: 'rgba(8,46,41,0.4)' }}>
                      Go to Assets →
                    </Link>
                  </div>
                ) : (
                  mappableAssets.map((asset: Asset) => {
                    const config = INFRA_CONFIG[asset.infrastructure_type];
                    const Icon = config?.icon || Anchor;
                    const isActive = asset.id === selectedAsset;
                    return (
                      <button
                        key={asset.id}
                        onClick={() => setSelectedAsset(asset.id)}
                        className={`w-full text-left p-2.5 rounded-xl transition-all group flex items-start gap-2.5 ${
                          isActive ? 'bg-[#082E29]/60' : 'hover:bg-white/4'
                        }`}
                        style={isActive ? { border: '1px solid rgba(8,145,178,0.25)' } : { border: '1px solid transparent' }}>
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: (config?.markerColor || '#64748B') + '20', color: config?.markerColor || '#64748B', border: `1px solid ${(config?.markerColor || '#64748B')}30` }}>
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-slate-200 group-hover:text-white truncate transition-colors">
                            {asset.name}
                          </p>
                          {asset.location_name && (
                            <p className="text-[10px] text-slate-500 truncate mt-0.5">{asset.location_name}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${config?.color || 'bg-slate-700 text-slate-400'}`}>
                              {config?.label || asset.infrastructure_type}
                            </span>
                            <span className="text-[9px] text-slate-500">{asset.inspection_count} insp.</span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {assetsWithoutLocation.length > 0 && (
                <div className="px-3.5 py-2.5" style={{ borderTop: '1px solid rgba(251,191,36,0.15)', background: 'rgba(251,191,36,0.04)' }}>
                  <p className="text-[9px] font-bold text-amber-400/80 uppercase tracking-[0.12em] mb-1.5">
                    Missing Location ({assetsWithoutLocation.length})
                  </p>
                  {assetsWithoutLocation.slice(0, 3).map((a: Asset) => (
                    <Link key={a.id} href={`/assets/${a.id}`}
                      className="block text-[10px] text-amber-400/70 hover:text-amber-300 truncate py-0.5 transition-colors">
                      {a.name} — <span className="underline">add coordinates</span>
                    </Link>
                  ))}
                  {assetsWithoutLocation.length > 3 && (
                    <span className="text-[10px] text-amber-500/40">+{assetsWithoutLocation.length - 3} more</span>
                  )}
                </div>
              )}

              {/* Legend */}
              <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-2">Legend</p>
                <div className="space-y-1.5">
                  {Object.entries(INFRA_CONFIG)
                    .filter(([key]) => assets.some((a: Asset) => a.infrastructure_type === key))
                    .map(([key, config]) => (
                      <div key={key} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: config.markerColor }} />
                        <span className="text-[10px] text-slate-400">{config.label}</span>
                      </div>
                    ))}
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0 bg-cyan-400 opacity-80" />
                    <span className="text-[10px] text-slate-400">Inspection photo</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

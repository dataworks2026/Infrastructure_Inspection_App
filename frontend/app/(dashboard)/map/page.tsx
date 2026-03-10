'use client';

import { useQuery } from '@tanstack/react-query';
import { assetsApi, imagesApi } from '@/lib/api';
import { Asset, InfrastructureType } from '@/types';
import { useState, useMemo, useCallback } from 'react';
import { MapPin, Building2, Wind, Waves, TrainFront, Filter, ExternalLink, Eye, EyeOff, Globe, Camera } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => (
  <div className="w-full h-full bg-slate-900 rounded-xl flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">Loading map...</span>
    </div>
  </div>
)});

const INFRA_CONFIG: Record<string, { label: string; icon: any; color: string; markerColor: string }> = {
  wind_turbine: { label: 'Wind Turbine',  icon: Wind,       color: 'bg-sky-100 text-sky-700',       markerColor: '#0EA5E9' },
  coastal:      { label: 'Coastal',       icon: Waves,      color: 'bg-cyan-100 text-cyan-700',      markerColor: '#06B6D4' },
  pier:         { label: 'Pier & Dock',   icon: Building2,  color: 'bg-blue-100 text-blue-700',      markerColor: '#3B82F6' },
  railway:      { label: 'Railway',       icon: TrainFront, color: 'bg-indigo-100 text-indigo-700',  markerColor: '#6366F1' },
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

  const [selectedAsset, setSelectedAsset]   = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes]     = useState<Set<string>>(new Set(Object.keys(INFRA_CONFIG)));
  const [showFilters, setShowFilters]       = useState(false);
  const [showImages, setShowImages]         = useState(true);

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
      {/* Floating header overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="pointer-events-auto">
            <div className="bg-white/90 backdrop-blur-xl rounded-xl px-5 py-3 shadow-lg border border-white/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#082E29] flex items-center justify-center shadow-md">
                  <Globe size={16} className="text-[#93C5FD]" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-slate-800">Asset Map</h1>
                  <p className="text-[11px] text-slate-500">
                    {mappableAssets.length} asset{mappableAssets.length !== 1 ? 's' : ''}
                    {imagePoints.length > 0 && (
                      <span className="text-[#0891B2] ml-1">· {imagePoints.length} photos</span>
                    )}
                    {assetsWithoutLocation.length > 0 && (
                      <span className="text-amber-500 ml-1">· {assetsWithoutLocation.length} unlocated</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Toggle image GPS points */}
            <button onClick={() => setShowImages(v => !v)}
              className={`flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg border transition-all ${
                showImages
                  ? 'bg-[#082E29] text-[#93C5FD] border-[#082E29]'
                  : 'bg-white/90 backdrop-blur-xl text-slate-600 border-white/50 hover:bg-white'
              }`}>
              <Camera size={13} /> Photos
            </button>
            <button onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg border transition-all ${
                showFilters
                  ? 'bg-[#082E29] text-[#93C5FD] border-[#082E29]'
                  : 'bg-white/90 backdrop-blur-xl text-slate-700 border-white/50 hover:bg-white'
              }`}>
              <Filter size={13} /> Filters
            </button>
          </div>
        </div>

        {/* Filter chips */}
        {showFilters && (
          <div className="flex items-center gap-2 px-6 pb-3 pointer-events-auto flex-wrap">
            {Object.entries(INFRA_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              const active = visibleTypes.has(key);
              const count = assets.filter((a: Asset) => a.infrastructure_type === key && a.latitude != null).length;
              return (
                <button key={key} onClick={() => toggleType(key)}
                  className={`flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-lg shadow-md border transition-all ${
                    active
                      ? 'bg-white/90 backdrop-blur-xl text-slate-700 border-white/50'
                      : 'bg-slate-900/60 text-slate-400 border-slate-700/50 backdrop-blur-xl line-through'
                  }`}>
                  {active ? <Eye size={12} /> : <EyeOff size={12} />}
                  <Icon size={12} />
                  {config.label}
                  <span className="opacity-50">({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Full-bleed map + floating sidebar */}
      <div className="flex-1 relative">
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="w-full h-full bg-slate-900 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
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

        {/* Floating right sidebar */}
        <div className="absolute top-4 right-4 bottom-4 w-72 z-10 flex flex-col pointer-events-auto">
          {selected ? (
            <div className="bg-white/90 backdrop-blur-xl border border-white/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200/50 bg-[#EDF6F0]/80 flex items-center justify-between">
                <h3 className="text-[10px] font-bold text-[#082E29] uppercase tracking-[0.15em]">Asset Detail</h3>
                <button onClick={() => setSelectedAsset(null)}
                  className="text-[11px] text-[#0891B2] hover:text-[#082E29] font-semibold">
                  ← Back
                </button>
              </div>
              <div className="p-4 space-y-3 flex-1">
                <div>
                  <span className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold ${
                    INFRA_CONFIG[selected.infrastructure_type]?.color || 'bg-slate-100 text-slate-600'
                  }`}>
                    {INFRA_CONFIG[selected.infrastructure_type]?.label || selected.infrastructure_type}
                  </span>
                </div>
                <h2 className="text-[15px] font-bold text-slate-800 leading-tight">{selected.name}</h2>
                {selected.location_name && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <MapPin size={11} /> {selected.location_name}
                  </div>
                )}
                <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Status</span>
                    <span className={`font-semibold capitalize ${
                      selected.status === 'active' ? 'text-emerald-600' :
                      selected.status === 'maintenance' ? 'text-amber-600' : 'text-slate-500'
                    }`}>{selected.status}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Inspections</span>
                    <span className="font-bold text-slate-700">{selected.inspection_count}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Coordinates</span>
                    <span className="font-mono text-slate-500 text-[10px]">
                      {selected.latitude?.toFixed(4)}, {selected.longitude?.toFixed(4)}
                    </span>
                  </div>
                  {selected.last_inspection_at && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Last Inspection</span>
                      <span className="text-slate-600">{new Date(selected.last_inspection_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                <Link href={`/assets/${selected.id}`}
                  className="flex items-center justify-center gap-2 text-xs font-bold text-[#93C5FD] px-4 py-2.5 rounded-xl w-full shadow-sm transition-all hover:opacity-90"
                  style={{ background: '#082E29' }}>
                  <ExternalLink size={13} /> View Asset
                </Link>
              </div>
            </div>
          ) : (
            <div className="bg-white/90 backdrop-blur-xl border border-white/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="px-4 py-3 border-b border-[#C8E6D4]/50 bg-[#EDF6F0]/80">
                <h3 className="text-[10px] font-bold text-[#082E29] uppercase tracking-[0.15em]">
                  Assets ({mappableAssets.length})
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {mappableAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-12 h-12 rounded-full bg-[#EDF6F0] flex items-center justify-center mb-3" style={{ border: '1px solid #C8E6D4' }}>
                      <MapPin size={20} style={{ color: '#082E29' }} />
                    </div>
                    <p className="text-xs text-slate-600 font-semibold">No assets on map</p>
                    <p className="text-[10px] text-slate-400 mt-1 px-4 leading-relaxed">
                      Create assets with coordinates to add locations.
                    </p>
                    <Link href="/assets"
                      className="mt-3 text-[10px] font-semibold text-[#0891B2] hover:text-[#082E29] bg-[#EDF6F0] px-3 py-1.5 rounded-lg">
                      Go to Assets →
                    </Link>
                  </div>
                ) : (
                  mappableAssets.map((asset: Asset) => {
                    const config = INFRA_CONFIG[asset.infrastructure_type];
                    const Icon = config?.icon || Building2;
                    return (
                      <button key={asset.id} onClick={() => setSelectedAsset(asset.id)}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-[#EDF6F0] transition-all group flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: config?.markerColor + '15', color: config?.markerColor, border: `1px solid ${config?.markerColor}30` }}>
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-slate-700 group-hover:text-[#082E29] truncate transition-colors">
                            {asset.name}
                          </p>
                          {asset.location_name && (
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">{asset.location_name}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold ${config?.color || 'bg-slate-100 text-slate-600'}`}>
                              {config?.label || asset.infrastructure_type}
                            </span>
                            <span className="text-[9px] text-slate-400">{asset.inspection_count} insp.</span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {assetsWithoutLocation.length > 0 && (
                <div className="border-t border-amber-200/50 px-3.5 py-2.5 bg-amber-50/80">
                  <p className="text-[9px] font-bold text-amber-600 uppercase tracking-[0.1em] mb-1.5">
                    Missing Location ({assetsWithoutLocation.length})
                  </p>
                  {assetsWithoutLocation.slice(0, 3).map((a: Asset) => (
                    <Link key={a.id} href={`/assets/${a.id}`}
                      className="block text-[10px] text-amber-600 hover:text-amber-800 truncate py-0.5">
                      {a.name} — <span className="underline font-medium">Edit to add</span>
                    </Link>
                  ))}
                  {assetsWithoutLocation.length > 3 && (
                    <span className="text-[10px] text-amber-400">+{assetsWithoutLocation.length - 3} more</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

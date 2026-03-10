'use client';

import { useQuery } from '@tanstack/react-query';
import { assetsApi, imagesApi } from '@/lib/api';
import { Asset } from '@/types';
import { useState, useMemo, useCallback } from 'react';
import { MapPin, Building2, Wind, Waves, TrainFront, Filter, ExternalLink, Eye, EyeOff, ImageIcon, Camera } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { ImageGpsPoint } from './MapView';

const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

// Dynamically import map component (Leaflet needs window)
const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => (
  <div className="w-full h-full flex items-center justify-center" style={{ background: MINT }}>
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${TEAL} transparent transparent transparent` }} />
      <span className="text-sm" style={{ color: '#6B9A87' }}>Loading map…</span>
    </div>
  </div>
)});

const INFRA_CONFIG: Record<string, { label: string; icon: any; markerColor: string }> = {
  wind_turbine: { label: 'Wind Turbine', icon: Wind,       markerColor: '#0EA5E9' },
  coastal:      { label: 'Coastal',      icon: Waves,      markerColor: '#06B6D4' },
  pier:         { label: 'Pier & Dock',  icon: Building2,  markerColor: '#3B82F6' },
  railway:      { label: 'Railway',      icon: TrainFront, markerColor: '#6366F1' },
};

const SEV_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  S3: { color: '#EF4444', bg: '#FEF2F2', label: 'Critical' },
  S2: { color: '#F59E0B', bg: '#FFFBEB', label: 'Major' },
  S1: { color: '#EAB308', bg: '#FEFCE8', label: 'Minor' },
  S0: { color: '#10B981', bg: '#F0FDF4', label: 'None' },
};

export default function MapPage() {
  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });
  const { data: gpsData, isLoading: gpsLoading } = useQuery({
    queryKey: ['image-gps-points'],
    queryFn: () => imagesApi.gpsPoints(),
  });

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes]   = useState<Set<string>>(new Set(Object.keys(INFRA_CONFIG)));
  const [showFilters, setShowFilters]     = useState(false);
  const [showImages, setShowImages]       = useState(true);

  const handleSelectAsset = useCallback((id: string) => setSelectedAsset(id), []);

  const mappableAssets = useMemo(
    () => (assets as Asset[]).filter(a => a.latitude != null && a.longitude != null && visibleTypes.has(a.infrastructure_type)),
    [assets, visibleTypes]
  );

  const assetsWithoutLocation = useMemo(
    () => (assets as Asset[]).filter(a => a.latitude == null || a.longitude == null),
    [assets]
  );

  const imagePoints: ImageGpsPoint[] = useMemo(
    () => showImages ? (gpsData?.points || []) : [],
    [gpsData, showImages]
  );

  const criticalCount = useMemo(
    () => (gpsData?.points || []).filter((p: ImageGpsPoint) => p.max_severity === 'S3').length,
    [gpsData]
  );

  function toggleType(type: string) {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  const selected = (assets as Asset[]).find(a => a.id === selectedAsset);

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col -mx-6 -mb-6 relative">

      {/* ── Floating header ── */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="flex items-center justify-between px-6 py-4">

          {/* Title card */}
          <div className="pointer-events-auto">
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg"
              style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', border: '1px solid rgba(200,230,212,0.6)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" style={{ background: TEAL }}>
                <MapPin size={16} color={BLUE} />
              </div>
              <div>
                <h1 className="text-[14px] font-bold" style={{ color: TEAL }}>Fleet Map</h1>
                <p className="text-[11px]" style={{ color: '#6B9A87' }}>
                  {mappableAssets.length} asset{mappableAssets.length !== 1 ? 's' : ''}
                  {gpsData?.points?.length > 0 && (
                    <span>
                      {' · '}{gpsData.points.length} image{gpsData.points.length !== 1 ? 's' : ''}
                      {criticalCount > 0 && (
                        <span style={{ color: '#EF4444' }}> · {criticalCount} critical</span>
                      )}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Toggle image GPS points */}
            <button onClick={() => setShowImages(s => !s)}
              className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-lg transition-all"
              style={showImages
                ? { background: TEAL, color: BLUE, border: 'none' }
                : { background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', color: '#2E6B5B', border: '1px solid rgba(200,230,212,0.6)' }}>
              {showImages ? <Camera size={13} /> : <Camera size={13} />}
              {showImages ? 'Hide Images' : 'Show Images'}
            </button>

            {/* Filter */}
            <button onClick={() => setShowFilters(f => !f)}
              className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2.5 rounded-xl shadow-lg transition-all"
              style={showFilters
                ? { background: TEAL, color: BLUE, border: 'none' }
                : { background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', color: '#2E6B5B', border: '1px solid rgba(200,230,212,0.6)' }}>
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
              const count = (assets as Asset[]).filter(a => a.infrastructure_type === key && a.latitude != null).length;
              return (
                <button key={key} onClick={() => toggleType(key)}
                  className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-lg shadow-md transition-all"
                  style={active
                    ? { background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', color: '#2E6B5B', border: '1px solid rgba(200,230,212,0.6)' }
                    : { background: 'rgba(8,46,41,0.7)', backdropFilter: 'blur(12px)', color: '#6B9A87', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {active ? <Eye size={12} /> : <EyeOff size={12} />}
                  <Icon size={12} />
                  {config.label}
                  <span style={{ opacity: 0.5 }}>({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Map + Sidebar ── */}
      <div className="flex-1 relative">
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center" style={{ background: MINT }}>
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${TEAL} transparent transparent transparent` }} />
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

        {/* ── Floating sidebar ── */}
        <div className="absolute top-4 right-4 bottom-4 w-72 z-10 flex flex-col pointer-events-auto">
          {selected ? (
            // Selected asset detail
            <div className="rounded-2xl shadow-2xl overflow-hidden flex flex-col"
              style={{ background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)', border: '1px solid rgba(200,230,212,0.6)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #EDF6F0', background: MINT }}>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#6B9A87' }}>Asset Detail</span>
                <button onClick={() => setSelectedAsset(null)}
                  className="text-[11px] font-semibold hover:underline" style={{ color: BRAND, background: 'none', border: 'none', cursor: 'pointer' }}>
                  ← Back
                </button>
              </div>
              <div className="p-4 space-y-3 flex-1">
                <div>
                  <span className="text-[10px] px-2.5 py-1 rounded-lg font-semibold"
                    style={{ background: (INFRA_CONFIG[selected.infrastructure_type]?.markerColor || BRAND) + '18', color: INFRA_CONFIG[selected.infrastructure_type]?.markerColor || BRAND }}>
                    {INFRA_CONFIG[selected.infrastructure_type]?.label || selected.infrastructure_type}
                  </span>
                </div>
                <h2 className="text-[15px] font-bold leading-tight" style={{ color: TEAL }}>{selected.name}</h2>
                {selected.location_name && (
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#6B9A87' }}>
                    <MapPin size={11} /> {selected.location_name}
                  </div>
                )}
                <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: MINT, border: '1px solid #C8E6D4' }}>
                  {[
                    { label: 'Status', value: <span style={{ color: selected.status === 'active' ? '#15803D' : '#92400E', fontWeight: 600 }}>{selected.status}</span> },
                    { label: 'Inspections', value: <span style={{ color: TEAL, fontWeight: 700 }}>{selected.inspection_count}</span> },
                    { label: 'Coordinates', value: <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B9A87' }}>{selected.latitude?.toFixed(4)}, {selected.longitude?.toFixed(4)}</span> },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-[11px]">
                      <span style={{ color: '#6B9A87' }}>{label}</span>
                      {value}
                    </div>
                  ))}
                  {selected.last_inspection_at && (
                    <div className="flex justify-between text-[11px]">
                      <span style={{ color: '#6B9A87' }}>Last Inspection</span>
                      <span style={{ color: '#2E6B5B' }}>{new Date(selected.last_inspection_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                    </div>
                  )}
                </div>
                <Link href={`/assets/${selected.id}`}
                  className="flex items-center justify-center gap-2 text-xs font-bold w-full py-2.5 rounded-xl shadow-sm"
                  style={{ background: TEAL, color: BLUE }}>
                  <ExternalLink size={13} /> View Asset
                </Link>
              </div>
            </div>
          ) : (
            // Asset list + legend
            <div className="rounded-2xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0"
              style={{ background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)', border: '1px solid rgba(200,230,212,0.6)' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid #EDF6F0', background: MINT }}>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#6B9A87' }}>
                  Assets ({mappableAssets.length})
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {mappableAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <MapPin size={24} className="mb-3" style={{ color: '#C8E6D4' }} />
                    <p className="text-xs font-semibold" style={{ color: TEAL }}>No assets on map</p>
                    <p className="text-[10px] mt-1 px-4 leading-relaxed" style={{ color: '#6B9A87' }}>
                      Add coordinates to your assets to see them here.
                    </p>
                    <Link href="/assets" className="mt-3 text-[10px] font-semibold px-3 py-1.5 rounded-lg" style={{ color: BRAND, background: MINT }}>
                      Go to Assets →
                    </Link>
                  </div>
                ) : (
                  mappableAssets.map((asset: Asset) => {
                    const config = INFRA_CONFIG[asset.infrastructure_type];
                    const Icon = config?.icon || Building2;
                    return (
                      <button key={asset.id} onClick={() => setSelectedAsset(asset.id)}
                        className="w-full text-left p-2.5 rounded-xl transition-all group flex items-start gap-2.5"
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = MINT)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: (config?.markerColor || BRAND) + '18', color: config?.markerColor || BRAND, border: `1px solid ${(config?.markerColor || BRAND)}30` }}>
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold truncate transition-colors" style={{ color: TEAL }}>{asset.name}</p>
                          {asset.location_name && (
                            <p className="text-[10px] truncate mt-0.5" style={{ color: '#6B9A87' }}>{asset.location_name}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold"
                              style={{ background: (config?.markerColor || BRAND) + '15', color: config?.markerColor || BRAND }}>
                              {config?.label || asset.infrastructure_type}
                            </span>
                            <span className="text-[9px]" style={{ color: '#6B9A87' }}>{asset.inspection_count} insp.</span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Severity legend */}
              {showImages && (gpsData?.points?.length || 0) > 0 && (
                <div style={{ borderTop: '1px solid #EDF6F0', padding: '10px 14px', background: MINT }}>
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-2" style={{ color: '#6B9A87' }}>
                    <Camera size={10} style={{ display: 'inline', marginRight: 4 }} />
                    Image Severity
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(SEV_COLORS).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: v.color }} />
                        <span style={{ color: '#2E6B5B' }}>{k} – {v.label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: '#6B9A87' }} />
                      <span style={{ color: '#2E6B5B' }}>No data</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Assets without location */}
              {assetsWithoutLocation.length > 0 && (
                <div style={{ borderTop: '1px solid #FDE68A', padding: '10px 14px', background: '#FFFBEB' }}>
                  <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#92400E' }}>
                    Missing Location ({assetsWithoutLocation.length})
                  </p>
                  {assetsWithoutLocation.slice(0, 3).map((a: Asset) => (
                    <Link key={a.id} href={`/assets/${a.id}`}
                      className="block text-[10px] py-0.5 hover:underline" style={{ color: '#92400E' }}>
                      {a.name} — <span className="font-medium">Edit to add</span>
                    </Link>
                  ))}
                  {assetsWithoutLocation.length > 3 && (
                    <span className="text-[10px]" style={{ color: '#B45309' }}>+{assetsWithoutLocation.length - 3} more</span>
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

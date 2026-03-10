'use client';

import { useEffect, useRef, useMemo, memo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
// leaflet.css loaded via CDN <link> in app/layout.tsx — Turbopack can't parse its legacy IE filter syntax
import { Asset } from '@/types';

// Fix Leaflet default icons issue with Next.js bundler
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ── Icon cache — generate each SVG icon only once per (color, selected) pair ──
const iconCache = new Map<string, L.DivIcon>();

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function getIcon(color: string, isSelected: boolean): L.DivIcon {
  const key = `${color}-${isSelected ? 1 : 0}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const size = isSelected ? 40 : 30;
  const glowId = `glow-${color.replace('#', '')}-${isSelected ? 's' : 'n'}`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56" width="${size}" height="${size * 1.4}">
      <defs>
        <filter id="${glowId}" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="${isSelected ? 4 : 2}" result="blur"/>
          <feFlood flood-color="${color}" flood-opacity="${isSelected ? 0.6 : 0.3}" result="color"/>
          <feComposite in="color" in2="blur" operator="in" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="grad-${glowId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${adjustColor(color, -30)};stop-opacity:1" />
        </linearGradient>
      </defs>
      ${isSelected ? `<circle cx="20" cy="20" r="18" fill="${color}" opacity="0.15"><animate attributeName="r" values="16;22;16" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;0.05;0.2" dur="2s" repeatCount="indefinite"/></circle>` : ''}
      <path d="M20 2C11.163 2 4 9.163 4 18c0 12.5 16 34 16 34s16-21.5 16-34c0-8.837-7.163-16-16-16z"
            fill="url(#grad-${glowId})" filter="url(#${glowId})"
            stroke="white" stroke-width="${isSelected ? 2.5 : 1.5}" stroke-opacity="${isSelected ? 1 : 0.8}"/>
      <circle cx="20" cy="17" r="7" fill="white" opacity="0.95"/>
      <circle cx="20" cy="17" r="4" fill="${color}"/>
    </svg>`;

  const icon = L.divIcon({
    html: svg,
    className: 'custom-marker-icon',
    iconSize: [size, size * 1.4],
    iconAnchor: [size / 2, size * 1.4],
    popupAnchor: [0, -size * 1.1],
  });
  iconCache.set(key, icon);
  return icon;
}

// Component to fly to selected asset
function FlyToAsset({ asset }: { asset?: Asset }) {
  const map = useMap();
  useEffect(() => {
    if (asset?.latitude && asset?.longitude) {
      map.flyTo([asset.latitude, asset.longitude], 12, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [asset, map]);
  return null;
}

// Component to fit bounds on all markers
function FitBounds({ assets }: { assets: Asset[] }) {
  const map = useMap();
  const hasFitted = useRef(false);
  useEffect(() => {
    if (assets.length > 0 && !hasFitted.current) {
      const bounds = L.latLngBounds(assets.map(a => [a.latitude!, a.longitude!] as [number, number]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
      hasFitted.current = true;
    }
  }, [assets, map]);
  return null;
}

// ── Single marker — memoized so it only re-renders when its own props change ──
const AssetMarker = memo(function AssetMarker({ asset, isSelected, onSelect, markerColor, configLabel }:
  { asset: Asset; isSelected: boolean; onSelect: () => void; markerColor: string; configLabel: string }
) {
  const icon = getIcon(markerColor, isSelected);
  return (
    <Marker
      position={[asset.latitude!, asset.longitude!]}
      icon={icon}
      eventHandlers={{ click: onSelect }}
    >
      <Popup>
        <div className="asset-popup">
          <div className="asset-popup-header">{asset.name}</div>
          {asset.location_name && (
            <div className="asset-popup-location">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {asset.location_name}
            </div>
          )}
          <div className="asset-popup-meta">
            <span className="asset-popup-badge" style={{
              backgroundColor: markerColor + '25',
              color: markerColor,
              border: `1px solid ${markerColor}40`,
            }}>
              {configLabel || asset.infrastructure_type}
            </span>
            <span className="asset-popup-badge" style={{
              backgroundColor: asset.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
              color: asset.status === 'active' ? '#4ade80' : '#fbbf24',
              border: `1px solid ${asset.status === 'active' ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'}`,
            }}>
              {asset.status}
            </span>
          </div>
          <div className="asset-popup-coords">
            {asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}
            {' · '}
            {asset.latitude?.toFixed(4)}°, {asset.longitude?.toFixed(4)}°
          </div>
          <div className="asset-popup-divider" />
          <a href={`/assets/${asset.id}`} className="asset-popup-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View Asset Details
          </a>
        </div>
      </Popup>
    </Marker>
  );
});

interface MapViewProps {
  assets: Asset[];
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
  infraConfig: Record<string, { label: string; markerColor: string }>;
}

const MAP_STYLES = `
  .custom-marker-icon { background: none !important; border: none !important; }
  .custom-marker-icon svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)); transition: transform 0.2s ease; }
  .custom-marker-icon:hover svg { transform: scale(1.15) translateY(-2px); }
  .leaflet-container { font-family: 'Inter', system-ui, sans-serif !important; background: #0a0f1a; }
  .leaflet-popup-content-wrapper { border-radius: 14px !important; box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08) !important; padding: 0 !important; overflow: hidden; background: rgba(15, 23, 42, 0.95) !important; backdrop-filter: blur(20px); }
  .leaflet-popup-content { margin: 0 !important; width: auto !important; min-width: 220px; }
  .leaflet-popup-tip-container { display: none; }
  .leaflet-control-zoom { border: none !important; box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important; border-radius: 12px !important; overflow: hidden; }
  .leaflet-control-zoom a { background: rgba(15, 23, 42, 0.9) !important; color: white !important; border: none !important; backdrop-filter: blur(10px); width: 36px !important; height: 36px !important; line-height: 36px !important; font-size: 16px !important; }
  .leaflet-control-zoom a:hover { background: rgba(30, 41, 59, 0.95) !important; }
  .leaflet-control-layers { border: none !important; border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important; background: rgba(15, 23, 42, 0.9) !important; backdrop-filter: blur(10px); color: white !important; }
  .leaflet-control-layers-expanded { padding: 8px 14px !important; }
  .leaflet-control-layers label { color: #cbd5e1 !important; font-size: 12px !important; }
  .leaflet-control-layers-toggle { width: 36px !important; height: 36px !important; }
  .leaflet-control-attribution { background: rgba(15, 23, 42, 0.7) !important; color: #64748b !important; font-size: 9px !important; border-radius: 6px 0 0 0 !important; backdrop-filter: blur(10px); }
  .leaflet-control-attribution a { color: #94a3b8 !important; }
  .asset-popup { padding: 16px 18px; color: white; }
  .asset-popup-header { font-size: 14px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px; letter-spacing: -0.01em; }
  .asset-popup-location { font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 5px; }
  .asset-popup-meta { display: flex; gap: 6px; margin-top: 10px; }
  .asset-popup-badge { font-size: 10px; padding: 3px 10px; border-radius: 8px; font-weight: 600; }
  .asset-popup-coords { font-size: 10px; color: #64748b; margin-top: 8px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.02em; }
  .asset-popup-divider { height: 1px; background: linear-gradient(90deg, transparent, #334155, transparent); margin: 12px -18px; }
  .asset-popup-link { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 600; color: #38bdf8; padding: 8px; margin: 0 -18px -16px -18px; background: rgba(56, 189, 248, 0.08); transition: all 0.15s ease; text-decoration: none; }
  .asset-popup-link:hover { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; }
`;

function MapView({ assets, selectedAssetId, onSelectAsset, infraConfig }: MapViewProps) {
  const selectedAsset = useMemo(
    () => assets.find(a => a.id === selectedAssetId),
    [assets, selectedAssetId]
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_STYLES }} />
      <MapContainer
        center={[53.5, 0.5]}
        zoom={5}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="Dark">
            <TileLayer
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OSM</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Ocean">
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Light">
            <TileLayer
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OSM</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <FitBounds assets={assets} />
        <FlyToAsset asset={selectedAsset} />

        {assets.map((asset) => {
          const config = infraConfig[asset.infrastructure_type];
          return (
            <AssetMarker
              key={asset.id}
              asset={asset}
              isSelected={asset.id === selectedAssetId}
              onSelect={() => onSelectAsset(asset.id)}
              markerColor={config?.markerColor || '#64748B'}
              configLabel={config?.label || asset.infrastructure_type}
            />
          );
        })}
      </MapContainer>
    </>
  );
}

export default memo(MapView);

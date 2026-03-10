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

// ── Image GPS point type ──
export interface ImageGpsPoint {
  id: string;
  lat: number;
  lon: number;
  gps_accuracy_m?: number;
  inspection_id: string;
  inspection_name: string;
  filename: string;
  detection_count: number;
  max_severity?: string;
  thumbnail_url?: string;
}

// ── Icon cache ──
const iconCache = new Map<string, L.DivIcon>();

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// ── Asset pin icon (teardrop) ──
function getAssetIcon(color: string, isSelected: boolean): L.DivIcon {
  const key = `asset-${color}-${isSelected ? 1 : 0}`;
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

// ── Camera icon for image GPS markers ──
function getImageIcon(severity?: string): L.DivIcon {
  const colorMap: Record<string, string> = {
    S3: '#EF4444', S2: '#F59E0B', S1: '#EAB308', S0: '#10B981',
  };
  const c = severity ? (colorMap[severity] || '#082E29') : '#6B9A87';
  const key = `img-${c}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28" width="28" height="24">
      <defs>
        <filter id="sh-${c.replace('#','')}">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="${c}" flood-opacity="0.4"/>
        </filter>
      </defs>
      <rect x="2" y="7" width="28" height="19" rx="4" fill="${c}" filter="url(#sh-${c.replace('#','')})"/>
      <rect x="11" y="3" width="10" height="6" rx="2" fill="${c}"/>
      <circle cx="16" cy="16.5" r="6" fill="white" opacity="0.9"/>
      <circle cx="16" cy="16.5" r="4" fill="${c}"/>
      <circle cx="16" cy="16.5" r="2" fill="white" opacity="0.6"/>
    </svg>`;

  const icon = L.divIcon({
    html: svg,
    className: 'custom-marker-icon',
    iconSize: [28, 24],
    iconAnchor: [14, 24],
    popupAnchor: [0, -26],
  });
  iconCache.set(key, icon);
  return icon;
}

function FlyToAsset({ asset }: { asset?: Asset }) {
  const map = useMap();
  useEffect(() => {
    if (asset?.latitude && asset?.longitude) {
      map.flyTo([asset.latitude, asset.longitude], 12, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [asset, map]);
  return null;
}

function FitBounds({ assets, imagePoints }: { assets: Asset[]; imagePoints: ImageGpsPoint[] }) {
  const map = useMap();
  const hasFitted = useRef(false);
  useEffect(() => {
    const coords: [number, number][] = [
      ...assets.filter(a => a.latitude && a.longitude).map(a => [a.latitude!, a.longitude!] as [number, number]),
      ...imagePoints.map(p => [p.lat, p.lon] as [number, number]),
    ];
    if (coords.length > 0 && !hasFitted.current) {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
      hasFitted.current = true;
    }
  }, [assets, imagePoints, map]);
  return null;
}

const AssetMarker = memo(function AssetMarker({ asset, isSelected, onSelect, markerColor, configLabel }:
  { asset: Asset; isSelected: boolean; onSelect: () => void; markerColor: string; configLabel: string }
) {
  const icon = getAssetIcon(markerColor, isSelected);
  return (
    <Marker position={[asset.latitude!, asset.longitude!]} icon={icon} eventHandlers={{ click: onSelect }}>
      <Popup>
        <div className="img-popup">
          <div className="img-popup-name">{asset.name}</div>
          {asset.location_name && (
            <div className="img-popup-meta" style={{ color: '#6B9A87', marginBottom: 8 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {asset.location_name}
            </div>
          )}
          <div className="img-popup-meta">
            <span className="img-popup-badge" style={{ background: markerColor + '20', color: markerColor, border: `1px solid ${markerColor}40` }}>{configLabel}</span>
            <span className="img-popup-badge" style={{ background: asset.status === 'active' ? '#F0FDF4' : '#FFFBEB', color: asset.status === 'active' ? '#15803D' : '#92400E', border: `1px solid ${asset.status === 'active' ? '#BBF7D0' : '#FDE68A'}` }}>{asset.status}</span>
          </div>
          <div className="img-popup-coords">{asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}</div>
          <div className="img-popup-divider" />
          <a href={`/assets/${asset.id}`} className="img-popup-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View Asset
          </a>
        </div>
      </Popup>
    </Marker>
  );
});

const ImageMarker = memo(function ImageMarker({ point }: { point: ImageGpsPoint }) {
  const icon = getImageIcon(point.max_severity);
  const sevColors: Record<string, string> = { S3: '#EF4444', S2: '#F59E0B', S1: '#EAB308', S0: '#10B981' };
  const sevBg: Record<string, string>     = { S3: '#FEF2F2', S2: '#FFFBEB', S1: '#FEFCE8', S0: '#F0FDF4' };
  const sevBorder: Record<string, string> = { S3: '#FECACA', S2: '#FDE68A', S1: '#FEF08A', S0: '#BBF7D0' };
  return (
    <Marker position={[point.lat, point.lon]} icon={icon}>
      <Popup>
        <div className="img-popup">
          {point.thumbnail_url && (
            <div style={{ margin: '-16px -18px 10px -18px', height: 90, overflow: 'hidden', borderRadius: '14px 14px 0 0' }}>
              <img src={point.thumbnail_url} alt={point.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div className="img-popup-name">{point.filename}</div>
          <div className="img-popup-meta" style={{ color: '#6B9A87', fontSize: 10 }}>{point.inspection_name}</div>
          <div className="img-popup-meta" style={{ marginTop: 8 }}>
            <span className="img-popup-badge" style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
              {point.detection_count} detection{point.detection_count !== 1 ? 's' : ''}
            </span>
            {point.max_severity && (
              <span className="img-popup-badge" style={{ background: sevBg[point.max_severity] || '#F9FAFB', color: sevColors[point.max_severity] || '#6B7280', border: `1px solid ${sevBorder[point.max_severity] || '#E5E7EB'}` }}>
                {point.max_severity}
              </span>
            )}
          </div>
          {point.gps_accuracy_m && (
            <div className="img-popup-coords">GPS ±{point.gps_accuracy_m.toFixed(1)} m</div>
          )}
          <div className="img-popup-divider" />
          <a href={`/inspections/${point.inspection_id}`} className="img-popup-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View Inspection
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
  imagePoints?: ImageGpsPoint[];
}

const MAP_STYLES = `
  .custom-marker-icon { background: none !important; border: none !important; }
  .custom-marker-icon svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)); transition: transform 0.2s ease; }
  .custom-marker-icon:hover svg { transform: scale(1.15) translateY(-2px); }
  .leaflet-container { font-family: 'Inter', system-ui, sans-serif !important; }
  .leaflet-popup-content-wrapper {
    border-radius: 14px !important;
    box-shadow: 0 8px 32px rgba(8,46,41,0.15), 0 0 0 1px rgba(200,230,212,0.4) !important;
    padding: 0 !important; overflow: hidden; background: #fff !important;
  }
  .leaflet-popup-content { margin: 0 !important; width: auto !important; min-width: 220px; }
  .leaflet-popup-tip-container { display: none; }
  .leaflet-control-zoom { border: none !important; box-shadow: 0 4px 16px rgba(8,46,41,0.15) !important; border-radius: 12px !important; overflow: hidden; }
  .leaflet-control-zoom a { background: rgba(255,255,255,0.95) !important; color: #082E29 !important; border: none !important; border-bottom: 1px solid #EDF6F0 !important; width: 36px !important; height: 36px !important; line-height: 36px !important; font-size: 16px !important; }
  .leaflet-control-zoom a:hover { background: #EDF6F0 !important; }
  .leaflet-control-layers { border: none !important; border-radius: 12px !important; box-shadow: 0 4px 16px rgba(8,46,41,0.15) !important; background: rgba(255,255,255,0.95) !important; color: #082E29 !important; }
  .leaflet-control-layers-expanded { padding: 8px 14px !important; }
  .leaflet-control-layers label { color: #2E6B5B !important; font-size: 12px !important; }
  .leaflet-control-layers-toggle { width: 36px !important; height: 36px !important; }
  .leaflet-control-attribution { background: rgba(255,255,255,0.85) !important; color: #6B9A87 !important; font-size: 9px !important; border-radius: 6px 0 0 0 !important; }
  .leaflet-control-attribution a { color: #0891B2 !important; }
  .img-popup { padding: 16px 18px; color: #082E29; }
  .img-popup-name { font-size: 13px; font-weight: 700; color: #082E29; margin-bottom: 3px; letter-spacing: -0.01em; }
  .img-popup-meta { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; font-size: 10px; color: #6B9A87; }
  .img-popup-badge { font-size: 10px; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
  .img-popup-coords { font-size: 10px; color: #6B9A87; margin-top: 6px; font-family: monospace; }
  .img-popup-divider { height: 1px; background: #EDF6F0; margin: 10px -18px; }
  .img-popup-link { display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 12px; font-weight: 600; color: #0891B2; padding: 7px; margin: 0 -18px -16px -18px; background: #EDF6F0; transition: all 0.15s ease; text-decoration: none; }
  .img-popup-link:hover { background: #C8E6D4; color: #082E29; }
`;

function MapView({ assets, selectedAssetId, onSelectAsset, infraConfig, imagePoints = [] }: MapViewProps) {
  const selectedAsset = useMemo(() => assets.find(a => a.id === selectedAssetId), [assets, selectedAssetId]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_STYLES }} />
      <MapContainer center={[53.5, 0.5]} zoom={5} style={{ width: '100%', height: '100%' }} zoomControl={true} scrollWheelZoom={true}>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Light">
            <TileLayer
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OSM</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Dark">
            <TileLayer
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OSM</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Ocean">
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <FitBounds assets={assets} imagePoints={imagePoints} />
        <FlyToAsset asset={selectedAsset} />

        {assets.map((asset) => {
          const config = infraConfig[asset.infrastructure_type];
          return (
            <AssetMarker
              key={asset.id}
              asset={asset}
              isSelected={asset.id === selectedAssetId}
              onSelect={() => onSelectAsset(asset.id)}
              markerColor={config?.markerColor || '#6B9A87'}
              configLabel={config?.label || asset.infrastructure_type}
            />
          );
        })}

        {imagePoints.map((point) => (
          <ImageMarker key={point.id} point={point} />
        ))}
      </MapContainer>
    </>
  );
}

export default memo(MapView);

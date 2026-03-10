'use client';

import { useEffect, useRef, useMemo, memo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { Asset } from '@/types';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

export interface ImageGpsPoint {
  id: string;
  lat: number;
  lon: number;
  gps_accuracy_m?: number | null;
  inspection_id: string;
  inspection_name: string;
  filename: string;
  detection_count: number;
  max_severity: string | null;
  thumbnail_url: string;
}

// ── Icon caches ──────────────────────────────────────────────────────────────
const assetIconCache = new Map<string, L.DivIcon>();
const imageIconCache = new Map<string, L.DivIcon>();

// ── Maritime icon paths (24×24 viewBox, uses CSS currentColor) ───────────────
const ICON_PATHS: Record<string, string> = {
  pier: `
    <line x1="3" y1="7" x2="21" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <rect x="2" y="9.5" width="20" height="3" rx="1.2" fill="currentColor"/>
    <rect x="4"   y="12.5" width="2.8" height="7.5" rx="1.4" fill="currentColor" opacity="0.85"/>
    <rect x="10.5" y="12.5" width="2.8" height="7.5" rx="1.4" fill="currentColor" opacity="0.85"/>
    <rect x="17"  y="12.5" width="2.8" height="7.5" rx="1.4" fill="currentColor" opacity="0.85"/>
    <line x1="4.5" y1="7" x2="4.5" y2="9.5" stroke="currentColor" stroke-width="1.5"/>
    <line x1="12"  y1="7" x2="12"  y2="9.5" stroke="currentColor" stroke-width="1.5"/>
    <line x1="19.5" y1="7" x2="19.5" y2="9.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M2 22 Q6 20.5 10 22 Q14 23.5 18 22 Q20.5 21.2 22 22"
          stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.5"/>`,

  anchor: `
    <circle cx="12" cy="5.5" r="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <line x1="7.5" y1="5.5" x2="16.5" y2="5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="12" y1="8"  x2="12" y2="20"  stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="5"  y1="12" x2="19" y2="12"  stroke="currentColor" stroke-width="2"   stroke-linecap="round"/>
    <path d="M5  12 C3.5 16.5 5.5 20.5 9  20.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M19 12 C20.5 16.5 18.5 20.5 15 20.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M9 20.5 Q12 22 15 20.5" stroke="currentColor" stroke-width="2" fill="none"/>`,

  coastal: `
    <path d="M2 9  Q5 6  8 9  Q11 12 14 9  Q17 6  20 9  Q21.5 10.5 22.5 10"
          stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M2 15 Q5 12 8 15 Q11 18 14 15 Q17 12 20 15 Q21.5 16.5 22.5 16"
          stroke="currentColor" stroke-width="2"   fill="none" stroke-linecap="round" opacity="0.75"/>
    <rect x="2" y="20" width="20" height="3" rx="1.2" fill="currentColor" opacity="0.8"/>`,

  breakwater: `
    <rect x="9.5" y="4"  width="5" height="12" rx="1" fill="currentColor"/>
    <rect x="7.5" y="2.5" width="9" height="3.5" rx="1" fill="currentColor"/>
    <circle cx="12" cy="4.5" r="1.8" fill="white" opacity="0.9"/>
    <line x1="7.5" y1="4" x2="3.5" y2="1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="16.5" y1="4" x2="20.5" y2="1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="7.5" y1="6.5" x2="4" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
    <line x1="16.5" y1="6.5" x2="20" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
    <path d="M5 16 Q12 13.5 19 16" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M3 21 Q7.5 19 12 21 Q16.5 19 21 21" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.5"/>`,

  seawall: `
    <rect x="2"    y="5"  width="10" height="6" rx="1.2" fill="currentColor" opacity="0.9"/>
    <rect x="13.5" y="5"  width="8.5" height="6" rx="1.2" fill="currentColor" opacity="0.9"/>
    <rect x="2"    y="12.5" width="6.5" height="6" rx="1.2" fill="currentColor" opacity="0.75"/>
    <rect x="9.5"  y="12.5" width="6.5" height="6" rx="1.2" fill="currentColor" opacity="0.75"/>
    <rect x="17"   y="12.5" width="5"   height="6" rx="1.2" fill="currentColor" opacity="0.75"/>
    <rect x="2"    y="20"   width="20"  height="3" rx="1.2" fill="currentColor" opacity="0.5"/>`,
};

function getIconPath(infraType: string): string {
  if (infraType === 'pier')       return ICON_PATHS.pier;
  if (infraType === 'coastal')    return ICON_PATHS.coastal;
  if (infraType === 'seawall')    return ICON_PATHS.seawall;
  if (infraType === 'breakwater') return ICON_PATHS.breakwater;
  return ICON_PATHS.anchor; // fallback
}

// ── Build the large teardrop pin SVG ─────────────────────────────────────────
// Pin is 48×66 (viewBox), scaled to `size` px wide.
function buildPinSvg(
  color: string,
  darkColor: string,
  infraType: string,
  size: number,
  selected: boolean,
): string {
  const uid  = `${infraType}-${color.replace('#', '')}-${selected ? 's' : 'n'}`;
  const h    = Math.round(size * 1.375);           // ~66/48 aspect
  const cx   = 24;                                  // fixed viewBox coords
  const cy   = 24;
  const r    = 22;                                  // pin circle radius in vb
  const iconPath = getIconPath(infraType);

  const pulse = selected ? `
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="${color}" opacity="0">
      <animate attributeName="r"       values="${r+4};${r+16};${r+4}" dur="2.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.22;0;0.22"            dur="2.2s" repeatCount="indefinite"/>
    </circle>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 66" width="${size}" height="${h}">
  <defs>
    <linearGradient id="pg-${uid}" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%"   stop-color="${color}"     stop-opacity="1"/>
      <stop offset="100%" stop-color="${darkColor}"  stop-opacity="1"/>
    </linearGradient>
    <filter id="ps-${uid}" x="-50%" y="-30%" width="200%" height="180%">
      <feDropShadow dx="0" dy="${selected ? 5 : 3}" stdDeviation="${selected ? 6 : 4}"
                    flood-color="${darkColor}" flood-opacity="${selected ? 0.55 : 0.35}"/>
    </filter>
  </defs>

  ${pulse}

  <!-- Teardrop pin body -->
  <path d="M24 2
           C12.4 2 3 11.4 3 23
           C3 34 24 64 24 64
           C24 64 45 34 45 23
           C45 11.4 35.6 2 24 2 Z"
        fill="url(#pg-${uid})"
        filter="url(#ps-${uid})"
        stroke="white"
        stroke-width="${selected ? 2.2 : 1.6}"
        stroke-opacity="0.9"/>

  <!-- White disc background -->
  <circle cx="${cx}" cy="${cy}" r="15" fill="white" opacity="0.97"/>

  <!-- Maritime icon (24×24 centered at 24,24 → translate 12,12) -->
  <g transform="translate(12,12)" color="${color}">
    ${iconPath}
  </g>
</svg>`;
}

// ── Darker shade helper ───────────────────────────────────────────────────────
function darken(hex: string, pct = 0.28): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = 1 - pct;
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8)  & 255) * f);
  const b = Math.round((n         & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function getAssetIcon(color: string, isSelected: boolean, infraType: string): L.DivIcon {
  const key = `${infraType}-${color}-${isSelected ? 's' : 'n'}`;
  const cached = assetIconCache.get(key);
  if (cached) return cached;

  const size = isSelected ? 58 : 46;
  const h    = Math.round(size * 1.375);
  const svg  = buildPinSvg(color, darken(color), infraType, size, isSelected);

  const icon = L.divIcon({
    html: svg,
    className: 'pin-marker',
    iconSize:   [size, h],
    iconAnchor: [size / 2, h],
    popupAnchor: [0, -h + 8],
  });
  assetIconCache.set(key, icon);
  return icon;
}

// ── Severity dot for inspection photo markers ─────────────────────────────────
function severityColor(sev: string | null): string {
  if (sev === 'S3') return '#EF4444';
  if (sev === 'S2') return '#F59E0B';
  if (sev === 'S1') return '#EAB308';
  if (sev === 'S0') return '#10B981';
  return '#38BDF8';
}

function getImageIcon(sev: string | null): L.DivIcon {
  const key = `img-${sev ?? 'none'}`;
  const cached = imageIconCache.get(key);
  if (cached) return cached;

  const c   = severityColor(sev);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="18" height="18">
    <circle cx="10" cy="10" r="8"  fill="${c}" opacity="0.18" stroke="${c}" stroke-width="1.5"/>
    <circle cx="10" cy="10" r="4.5" fill="${c}" stroke="white" stroke-width="1.8"/>
    <circle cx="10" cy="10" r="1.8" fill="white"/>
  </svg>`;

  const icon = L.divIcon({
    html: svg,
    className: 'img-dot-marker',
    iconSize:   [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
  imageIconCache.set(key, icon);
  return icon;
}

// ── Map behaviour helpers ─────────────────────────────────────────────────────
function FlyToAsset({ asset }: { asset?: Asset }) {
  const map = useMap();
  useEffect(() => {
    if (asset?.latitude && asset?.longitude) {
      map.flyTo([asset.latitude, asset.longitude], 17, { duration: 1.4, easeLinearity: 0.2 });
    }
  }, [asset, map]);
  return null;
}

function FitBounds({ assets, imagePoints }: { assets: Asset[]; imagePoints: ImageGpsPoint[] }) {
  const map     = useMap();
  const fitted  = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const coords: [number, number][] = [
      ...assets.filter(a => a.latitude != null && a.longitude != null).map(a => [a.latitude!, a.longitude!] as [number, number]),
      ...imagePoints.map(p => [p.lat, p.lon] as [number, number]),
    ];
    if (coords.length) {
      map.fitBounds(L.latLngBounds(coords), { padding: [90, 90], maxZoom: 16 });
      fitted.current = true;
    }
  }, [assets, imagePoints, map]);
  return null;
}

// ── Markers ───────────────────────────────────────────────────────────────────
const AssetMarker = memo(function AssetMarker({
  asset, isSelected, onSelect, markerColor, configLabel, infraType,
}: {
  asset: Asset; isSelected: boolean; onSelect: () => void;
  markerColor: string; configLabel: string; infraType: string;
}) {
  const icon = getAssetIcon(markerColor, isSelected, infraType);
  return (
    <Marker position={[asset.latitude!, asset.longitude!]} icon={icon} eventHandlers={{ click: onSelect }}>
      <Popup>
        <div className="asset-popup">
          <div className="ap-name">{asset.name}</div>
          {asset.location_name && (
            <div className="ap-loc">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              {asset.location_name}
            </div>
          )}
          <div className="ap-badges">
            <span className="ap-badge" style={{ background: markerColor + '22', color: markerColor, border: `1px solid ${markerColor}45` }}>
              {configLabel}
            </span>
            <span className="ap-badge" style={{
              background: asset.status === 'active' ? 'rgba(34,197,94,.15)'  : 'rgba(234,179,8,.15)',
              color:      asset.status === 'active' ? '#4ade80'              : '#fbbf24',
              border:     `1px solid ${asset.status === 'active' ? 'rgba(34,197,94,.3)' : 'rgba(234,179,8,.3)'}`,
            }}>
              {asset.status}
            </span>
          </div>
          <div className="ap-coords">
            {asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}
            {' · '}{asset.latitude?.toFixed(5)}°, {asset.longitude?.toFixed(5)}°
          </div>
          <div className="ap-divider"/>
          <a href={`/assets/${asset.id}`} className="ap-link">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View Asset Details
          </a>
        </div>
      </Popup>
    </Marker>
  );
});

const ImageMarker = memo(function ImageMarker({ point }: { point: ImageGpsPoint }) {
  const icon  = getImageIcon(point.max_severity);
  const color = severityColor(point.max_severity);
  return (
    <Marker position={[point.lat, point.lon]} icon={icon}>
      <Popup>
        <div className="asset-popup">
          <div className="ap-name">{point.filename}</div>
          <div className="ap-loc">{point.inspection_name}</div>
          <div className="ap-badges">
            {point.max_severity && (
              <span className="ap-badge" style={{ background: color + '22', color, border: `1px solid ${color}45` }}>
                {point.max_severity}
              </span>
            )}
            <span className="ap-badge" style={{ background: 'rgba(56,189,248,.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,.25)' }}>
              {point.detection_count} detection{point.detection_count !== 1 ? 's' : ''}
            </span>
          </div>
          {point.gps_accuracy_m != null && <div className="ap-coords">GPS ±{point.gps_accuracy_m.toFixed(1)} m</div>}
          <div className="ap-divider"/>
          <a href={`/inspections/${point.inspection_id}`} className="ap-link">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View Inspection
          </a>
        </div>
      </Popup>
    </Marker>
  );
});

// ── CSS ───────────────────────────────────────────────────────────────────────
const MAP_STYLES = `
  .pin-marker,
  .img-dot-marker        { background: none !important; border: none !important; }
  .pin-marker svg        { transition: transform .2s ease; filter: drop-shadow(0 4px 8px rgba(0,0,0,.35)); overflow: visible; }
  .pin-marker:hover svg  { transform: scale(1.12) translateY(-3px); }
  .img-dot-marker svg    { transition: transform .15s ease; }
  .img-dot-marker:hover svg { transform: scale(1.4); }

  .leaflet-container     { font-family: 'Inter', system-ui, sans-serif !important; background: #06101c; }

  /* Popups */
  .leaflet-popup-content-wrapper {
    border-radius: 16px !important;
    padding: 0 !important;
    overflow: hidden;
    background: rgba(8, 16, 30, 0.97) !important;
    backdrop-filter: blur(28px) saturate(1.4);
    box-shadow: 0 24px 64px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.07) !important;
  }
  .leaflet-popup-content { margin: 0 !important; width: auto !important; min-width: 240px; }
  .leaflet-popup-tip-container { display: none; }

  /* Zoom control */
  .leaflet-control-zoom {
    border: none !important;
    border-radius: 12px !important;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,.4) !important;
  }
  .leaflet-control-zoom a {
    background: rgba(8,16,30,.94) !important;
    color: #cbd5e1 !important;
    border: none !important;
    border-bottom: 1px solid rgba(255,255,255,.06) !important;
    backdrop-filter: blur(12px);
    width: 36px !important; height: 36px !important;
    line-height: 36px !important; font-size: 18px !important; font-weight: 300 !important;
  }
  .leaflet-control-zoom a:hover { background: rgba(8,46,41,.95) !important; color: #38bdf8 !important; }

  /* Layers control */
  .leaflet-control-layers {
    border: none !important; border-radius: 12px !important;
    background: rgba(8,16,30,.94) !important;
    backdrop-filter: blur(12px);
    box-shadow: 0 4px 20px rgba(0,0,0,.4) !important;
    color: white !important;
  }
  .leaflet-control-layers-expanded { padding: 10px 16px !important; min-width: 140px; }
  .leaflet-control-layers label    { color: #94a3b8 !important; font-size: 12px !important; line-height: 2 !important; }
  .leaflet-control-layers-toggle   { width: 36px !important; height: 36px !important; }
  .leaflet-control-attribution      {
    background: rgba(8,16,30,.7) !important; color: #475569 !important;
    font-size: 9px !important; border-radius: 8px 0 0 0 !important;
  }
  .leaflet-control-attribution a { color: #64748b !important; }

  /* Popup content */
  .asset-popup { padding: 16px 18px; color: white; }
  .ap-name     { font-size: 13px; font-weight: 700; color: #f1f5f9; letter-spacing: -.01em; }
  .ap-loc      { font-size: 10px; color: #64748b; display: flex; align-items: center; gap: 4px; margin-top: 3px; }
  .ap-badges   { display: flex; gap: 5px; margin-top: 10px; flex-wrap: wrap; }
  .ap-badge    { font-size: 10px; padding: 3px 9px; border-radius: 6px; font-weight: 600; }
  .ap-coords   { font-size: 10px; color: #475569; margin-top: 8px; font-family: ui-monospace, monospace; }
  .ap-divider  { height: 1px; background: linear-gradient(90deg, transparent, rgba(148,163,184,.12), transparent); margin: 12px -18px; }
  .ap-link     {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    font-size: 11px; font-weight: 600; color: #38bdf8;
    padding: 9px; margin: 0 -18px -16px -18px;
    background: rgba(56,189,248,.07);
    transition: all .15s; text-decoration: none;
  }
  .ap-link:hover { background: rgba(56,189,248,.14); color: #7dd3fc; }
`;

// ── Main component ────────────────────────────────────────────────────────────
interface MapViewProps {
  assets: Asset[];
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
  infraConfig: Record<string, { label: string; markerColor: string }>;
  imagePoints: ImageGpsPoint[];
}

const DEFAULT_CENTER: [number, number] = [40.6900, -74.0155];
const DEFAULT_ZOOM   = 15;

function MapView({ assets, selectedAssetId, onSelectAsset, infraConfig, imagePoints }: MapViewProps) {
  const selectedAsset = useMemo(
    () => assets.find(a => a.id === selectedAssetId),
    [assets, selectedAssetId],
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_STYLES }} />
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: '100%', height: '100%' }}
        zoomControl
        scrollWheelZoom
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              attribution='&copy; <a href="https://www.esri.com">Esri</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Dark">
            <TileLayer
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
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
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <FitBounds assets={assets} imagePoints={imagePoints} />
        <FlyToAsset asset={selectedAsset} />

        {assets.map(asset => {
          const cfg = infraConfig[asset.infrastructure_type];
          return (
            <AssetMarker
              key={asset.id}
              asset={asset}
              isSelected={asset.id === selectedAssetId}
              onSelect={() => onSelectAsset(asset.id)}
              markerColor={cfg?.markerColor ?? '#64748B'}
              configLabel={cfg?.label ?? asset.infrastructure_type}
              infraType={asset.infrastructure_type}
            />
          );
        })}

        {imagePoints.map(pt => <ImageMarker key={pt.id} point={pt} />)}
      </MapContainer>
    </>
  );
}

export default memo(MapView);

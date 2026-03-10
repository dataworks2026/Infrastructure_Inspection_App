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

// ── Icon caches ────────────────────────────────────────────────────────────────
const assetIconCache  = new Map<string, L.DivIcon>();
const imageIconCache  = new Map<string, L.DivIcon>();

// Pier SVG: dock posts with deck planks
function pierSvg(color: string, size: number, selected: boolean): string {
  const s = selected ? `<circle cx="22" cy="22" r="20" fill="${color}" opacity="0.12"><animate attributeName="r" values="17;23;17" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.18;0.04;0.18" dur="2s" repeatCount="indefinite"/></circle>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${size}" height="${size}">
    <defs>
      <filter id="pier-shadow-${selected?'s':'n'}" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="${selected?3:2}" flood-color="${color}" flood-opacity="${selected?0.5:0.3}"/>
      </filter>
    </defs>
    ${s}
    <circle cx="22" cy="22" r="18" fill="${color}" filter="url(#pier-shadow-${selected?'s':'n'})" stroke="white" stroke-width="${selected?2.5:1.8}" opacity="0.95"/>
    <!-- Pier deck (horizontal planks) -->
    <rect x="10" y="19" width="24" height="3" rx="1" fill="white" opacity="0.95"/>
    <rect x="10" y="23" width="24" height="2" rx="0.5" fill="white" opacity="0.55"/>
    <!-- Pier posts (pilings) -->
    <rect x="12" y="24" width="2.5" height="7" rx="1.2" fill="white" opacity="0.85"/>
    <rect x="19.5" y="24" width="2.5" height="7" rx="1.2" fill="white" opacity="0.85"/>
    <rect x="27" y="24" width="2.5" height="7" rx="1.2" fill="white" opacity="0.85"/>
    <!-- Anchor symbol above -->
    <circle cx="22" cy="14" r="2.5" fill="none" stroke="white" stroke-width="1.5" opacity="0.9"/>
    <line x1="22" y1="16.5" x2="22" y2="20" stroke="white" stroke-width="1.5" opacity="0.9" stroke-linecap="round"/>
    <line x1="17.5" y1="18" x2="26.5" y2="18" stroke="white" stroke-width="1.5" opacity="0.9" stroke-linecap="round"/>
  </svg>`;
}

// Coastal SVG: waves + seawall
function coastalSvg(color: string, size: number, selected: boolean): string {
  const s = selected ? `<circle cx="22" cy="22" r="20" fill="${color}" opacity="0.12"><animate attributeName="r" values="17;23;17" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.18;0.04;0.18" dur="2s" repeatCount="indefinite"/></circle>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${size}" height="${size}">
    <defs>
      <filter id="coastal-shadow-${selected?'s':'n'}" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="${selected?3:2}" flood-color="${color}" flood-opacity="${selected?0.5:0.3}"/>
      </filter>
    </defs>
    ${s}
    <circle cx="22" cy="22" r="18" fill="${color}" filter="url(#coastal-shadow-${selected?'s':'n'})" stroke="white" stroke-width="${selected?2.5:1.8}" opacity="0.95"/>
    <!-- Seawall base -->
    <rect x="10" y="26" width="24" height="4" rx="1" fill="white" opacity="0.9"/>
    <rect x="10" y="29" width="24" height="2" rx="0.5" fill="white" opacity="0.45"/>
    <!-- Wave 1 -->
    <path d="M10 23 Q13.5 19 17 23 Q20.5 27 24 23 Q27.5 19 31 23" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.95"/>
    <!-- Wave 2 -->
    <path d="M12 18 Q15 15 18 18 Q21 21 24 18 Q27 15 30 18" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.6"/>
  </svg>`;
}

// Seawall SVG: layered stone wall
function seawallSvg(color: string, size: number, selected: boolean): string {
  const s = selected ? `<circle cx="22" cy="22" r="20" fill="${color}" opacity="0.12"><animate attributeName="r" values="17;23;17" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.18;0.04;0.18" dur="2s" repeatCount="indefinite"/></circle>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${size}" height="${size}">
    <defs>
      <filter id="seawall-shadow-${selected?'s':'n'}" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="${selected?3:2}" flood-color="${color}" flood-opacity="${selected?0.5:0.3}"/>
      </filter>
    </defs>
    ${s}
    <circle cx="22" cy="22" r="18" fill="${color}" filter="url(#seawall-shadow-${selected?'s':'n'})" stroke="white" stroke-width="${selected?2.5:1.8}" opacity="0.95"/>
    <!-- Stone wall rows -->
    <rect x="10" y="14" width="11" height="5" rx="1" fill="white" opacity="0.9"/>
    <rect x="22.5" y="14" width="11" height="5" rx="1" fill="white" opacity="0.9"/>
    <rect x="10" y="20.5" width="7.5" height="5" rx="1" fill="white" opacity="0.75"/>
    <rect x="18.5" y="20.5" width="7.5" height="5" rx="1" fill="white" opacity="0.75"/>
    <rect x="27" y="20.5" width="6" height="5" rx="1" fill="white" opacity="0.75"/>
    <rect x="10" y="27" width="24" height="4" rx="1" fill="white" opacity="0.55"/>
  </svg>`;
}

// Breakwater SVG: rocky breakwater icon
function breakwaterSvg(color: string, size: number, selected: boolean): string {
  const s = selected ? `<circle cx="22" cy="22" r="20" fill="${color}" opacity="0.12"><animate attributeName="r" values="17;23;17" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.18;0.04;0.18" dur="2s" repeatCount="indefinite"/></circle>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="${size}" height="${size}">
    <defs>
      <filter id="bw-shadow-${selected?'s':'n'}" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="${selected?3:2}" flood-color="${color}" flood-opacity="${selected?0.5:0.3}"/>
      </filter>
    </defs>
    ${s}
    <circle cx="22" cy="22" r="18" fill="${color}" filter="url(#bw-shadow-${selected?'s':'n'})" stroke="white" stroke-width="${selected?2.5:1.8}" opacity="0.95"/>
    <!-- Lighthouse tower -->
    <rect x="19.5" y="11" width="5" height="13" rx="1" fill="white" opacity="0.9"/>
    <rect x="18" y="10" width="8" height="3" rx="1" fill="white" opacity="0.9"/>
    <!-- Light beams -->
    <line x1="22" y1="11.5" x2="15" y2="6" stroke="white" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>
    <line x1="22" y1="11.5" x2="29" y2="6" stroke="white" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>
    <!-- Base rocks -->
    <ellipse cx="15" cy="28" rx="5" ry="3.5" fill="white" opacity="0.75"/>
    <ellipse cx="22" cy="29" rx="4.5" ry="3" fill="white" opacity="0.9"/>
    <ellipse cx="29" cy="28" rx="5" ry="3.5" fill="white" opacity="0.75"/>
    <!-- Water line -->
    <path d="M10 32 Q14 30 18 32 Q22 34 26 32 Q30 30 34 32" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.5"/>
  </svg>`;
}

function getSvgForType(type: string, color: string, size: number, selected: boolean): string {
  if (type === 'pier') return pierSvg(color, size, selected);
  if (type === 'coastal') return coastalSvg(color, size, selected);
  if (type === 'seawall') return seawallSvg(color, size, selected);
  if (type === 'breakwater') return breakwaterSvg(color, size, selected);
  // fallback — pier style
  return pierSvg(color, size, selected);
}

function getAssetIcon(color: string, isSelected: boolean, infraType: string): L.DivIcon {
  const key = `${infraType}-${color}-${isSelected ? 1 : 0}`;
  const cached = assetIconCache.get(key);
  if (cached) return cached;

  const size = isSelected ? 44 : 34;
  const svg = getSvgForType(infraType, color, size, isSelected);

  const icon = L.divIcon({
    html: svg,
    className: 'custom-marker-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size * 0.6],
  });
  assetIconCache.set(key, icon);
  return icon;
}

function severityColor(sev: string | null): string {
  if (sev === 'S3') return '#EF4444';
  if (sev === 'S2') return '#F59E0B';
  if (sev === 'S1') return '#EAB308';
  if (sev === 'S0') return '#10B981';
  return '#0891B2';
}

// Image GPS point icon: clean dot with severity ring
function getImageIcon(sev: string | null): L.DivIcon {
  const key = `img-${sev ?? 'none'}`;
  const cached = imageIconCache.get(key);
  if (cached) return cached;

  const color = severityColor(sev);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="9" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="${color}" opacity="0.9" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="2" fill="white" opacity="0.9"/>
    </svg>`;

  const icon = L.divIcon({
    html: svg,
    className: 'custom-image-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
  imageIconCache.set(key, icon);
  return icon;
}

// ── Map helpers ────────────────────────────────────────────────────────────────
function FlyToAsset({ asset }: { asset?: Asset }) {
  const map = useMap();
  useEffect(() => {
    if (asset?.latitude && asset?.longitude) {
      map.flyTo([asset.latitude, asset.longitude], 16, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [asset, map]);
  return null;
}

function FitBounds({ assets, imagePoints }: { assets: Asset[]; imagePoints: ImageGpsPoint[] }) {
  const map = useMap();
  const hasFitted = useRef(false);
  useEffect(() => {
    if (hasFitted.current) return;
    const assetCoords: [number, number][] = assets
      .filter(a => a.latitude != null && a.longitude != null)
      .map(a => [a.latitude!, a.longitude!]);
    const imgCoords: [number, number][] = imagePoints.map(p => [p.lat, p.lon]);
    const all = [...assetCoords, ...imgCoords];
    if (all.length > 0) {
      map.fitBounds(L.latLngBounds(all), { padding: [80, 80], maxZoom: 16 });
      hasFitted.current = true;
    }
  }, [assets, imagePoints, map]);
  return null;
}

// ── Markers ────────────────────────────────────────────────────────────────────
const AssetMarker = memo(function AssetMarker({ asset, isSelected, onSelect, markerColor, configLabel, infraType }:
  { asset: Asset; isSelected: boolean; onSelect: () => void; markerColor: string; configLabel: string; infraType: string }
) {
  const icon = getAssetIcon(markerColor, isSelected, infraType);
  return (
    <Marker position={[asset.latitude!, asset.longitude!]} icon={icon} eventHandlers={{ click: onSelect }}>
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
            <span className="asset-popup-badge" style={{ backgroundColor: markerColor + '25', color: markerColor, border: `1px solid ${markerColor}40` }}>
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
            {asset.latitude?.toFixed(5)}°, {asset.longitude?.toFixed(5)}°
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

const ImageMarker = memo(function ImageMarker({ point }: { point: ImageGpsPoint }) {
  const icon = getImageIcon(point.max_severity);
  const color = severityColor(point.max_severity);
  return (
    <Marker position={[point.lat, point.lon]} icon={icon}>
      <Popup>
        <div className="asset-popup">
          <div className="asset-popup-header">{point.filename}</div>
          <div className="asset-popup-location">{point.inspection_name}</div>
          <div className="asset-popup-meta">
            {point.max_severity && (
              <span className="asset-popup-badge" style={{ backgroundColor: color + '25', color, border: `1px solid ${color}40` }}>
                {point.max_severity}
              </span>
            )}
            <span className="asset-popup-badge" style={{ backgroundColor: 'rgba(147,197,253,0.15)', color: '#93C5FD', border: '1px solid rgba(147,197,253,0.3)' }}>
              {point.detection_count} detection{point.detection_count !== 1 ? 's' : ''}
            </span>
          </div>
          {point.gps_accuracy_m != null && (
            <div className="asset-popup-coords">GPS ±{point.gps_accuracy_m.toFixed(1)}m</div>
          )}
          <div className="asset-popup-divider" />
          <a href={`/inspections/${point.inspection_id}`} className="asset-popup-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View Inspection
          </a>
        </div>
      </Popup>
    </Marker>
  );
});

// ── Styles ─────────────────────────────────────────────────────────────────────
const MAP_STYLES = `
  .custom-marker-icon { background: none !important; border: none !important; }
  .custom-marker-icon svg { filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3)); transition: transform 0.2s ease; }
  .custom-marker-icon:hover svg { transform: scale(1.2); }
  .custom-image-icon { background: none !important; border: none !important; }
  .custom-image-icon svg { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4)); transition: transform 0.15s ease; }
  .custom-image-icon:hover svg { transform: scale(1.3); }
  .leaflet-container { font-family: 'Inter', system-ui, sans-serif !important; background: #0a0f1a; }
  .leaflet-popup-content-wrapper { border-radius: 14px !important; box-shadow: 0 20px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08) !important; padding: 0 !important; overflow: hidden; background: rgba(10, 20, 35, 0.96) !important; backdrop-filter: blur(24px); }
  .leaflet-popup-content { margin: 0 !important; width: auto !important; min-width: 230px; }
  .leaflet-popup-tip-container { display: none; }
  .leaflet-control-zoom { border: none !important; box-shadow: 0 4px 20px rgba(0,0,0,0.35) !important; border-radius: 10px !important; overflow: hidden; }
  .leaflet-control-zoom a { background: rgba(10, 20, 35, 0.92) !important; color: #e2e8f0 !important; border: none !important; border-bottom: 1px solid rgba(255,255,255,0.06) !important; backdrop-filter: blur(10px); width: 34px !important; height: 34px !important; line-height: 34px !important; font-size: 16px !important; font-weight: 300 !important; }
  .leaflet-control-zoom a:hover { background: rgba(8,46,41,0.95) !important; color: #93C5FD !important; }
  .leaflet-control-layers { border: none !important; border-radius: 10px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.35) !important; background: rgba(10, 20, 35, 0.92) !important; backdrop-filter: blur(10px); color: white !important; }
  .leaflet-control-layers-expanded { padding: 10px 14px !important; min-width: 130px; }
  .leaflet-control-layers label { color: #94a3b8 !important; font-size: 12px !important; line-height: 1.8 !important; }
  .leaflet-control-layers input[type=radio]:checked + span { color: #93C5FD !important; font-weight: 600; }
  .leaflet-control-layers-toggle { width: 34px !important; height: 34px !important; }
  .leaflet-control-attribution { background: rgba(10,20,35,0.7) !important; color: #475569 !important; font-size: 9px !important; border-radius: 6px 0 0 0 !important; backdrop-filter: blur(10px); }
  .leaflet-control-attribution a { color: #64748b !important; }
  .asset-popup { padding: 16px 18px; color: white; }
  .asset-popup-header { font-size: 13px; font-weight: 700; color: #f1f5f9; margin-bottom: 3px; letter-spacing: -0.01em; }
  .asset-popup-location { font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px; margin-top: 2px; }
  .asset-popup-meta { display: flex; gap: 5px; margin-top: 10px; flex-wrap: wrap; }
  .asset-popup-badge { font-size: 10px; padding: 3px 9px; border-radius: 6px; font-weight: 600; letter-spacing: 0.01em; }
  .asset-popup-coords { font-size: 10px; color: #475569; margin-top: 8px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.02em; }
  .asset-popup-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(148,163,184,0.15), transparent); margin: 12px -18px; }
  .asset-popup-link { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; font-weight: 600; color: #38bdf8; padding: 9px; margin: 0 -18px -16px -18px; background: rgba(56,189,248,0.07); transition: all 0.15s ease; text-decoration: none; letter-spacing: 0.01em; }
  .asset-popup-link:hover { background: rgba(56,189,248,0.14); color: #7dd3fc; }
`;

// ── Main component ─────────────────────────────────────────────────────────────
interface MapViewProps {
  assets: Asset[];
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
  infraConfig: Record<string, { label: string; markerColor: string }>;
  imagePoints: ImageGpsPoint[];
}

// Governor's Island, NY Harbor — default center
const DEFAULT_CENTER: [number, number] = [40.6900, -74.0168];
const DEFAULT_ZOOM = 15;

function MapView({ assets, selectedAssetId, onSelectAsset, infraConfig, imagePoints }: MapViewProps) {
  const selectedAsset = useMemo(
    () => assets.find(a => a.id === selectedAssetId),
    [assets, selectedAssetId]
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_STYLES }} />
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: '100%', height: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
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
          <LayersControl.BaseLayer name="Light">
            <TileLayer
              attribution='&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://openstreetmap.org">OSM</a>'
              url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
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
              markerColor={config?.markerColor || '#64748B'}
              configLabel={config?.label || asset.infrastructure_type}
              infraType={asset.infrastructure_type}
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

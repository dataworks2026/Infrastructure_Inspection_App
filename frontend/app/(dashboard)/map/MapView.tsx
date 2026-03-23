'use client';

import { useEffect, useRef, useMemo, memo, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Asset } from '@/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export interface ImageGpsPoint {
  id: string; lat: number; lon: number; gps_accuracy_m?: number | null;
  inspection_id: string; inspection_name: string; filename: string;
  detection_count: number; max_severity: string | null; thumbnail_url: string;
}

// ── Severity colors ──────────────────────────────────────────────────────────
function severityColor(sev: string | null): string {
  const s = (sev === 'S0' || sev === '0') ? 'S1' : sev;
  if (s === 'S4') return '#B71C1C'; if (s === 'S3') return '#EF4444';
  if (s === 'S2') return '#F59E0B'; if (s === 'S1') return '#EAB308';
  return '#38BDF8';
}

// ── Infrastructure marker colors ─────────────────────────────────────────────
const MARKER_COLORS: Record<string, string> = {
  pier: '#3B82F6', coastal: '#06B6D4', seawall: '#14B8A6',
  breakwater: '#6366F1',
};

// ── SVG icon paths for marker pins ───────────────────────────────────────────
const ICON_SVG: Record<string, string> = {
  pier: '<path d="M6 4h12M7 6h10v2H7zM8 8v6M12 8v6M16 8v6" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  coastal: '<path d="M4 10q3-3 6 0t6 0M4 14q3-3 6 0t6 0" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  seawall: '<rect x="4" y="6" width="16" height="5" rx="1" fill="white" opacity="0.9"/><rect x="4" y="13" width="7" height="5" rx="1" fill="white" opacity="0.7"/><rect x="13" y="13" width="7" height="5" rx="1" fill="white" opacity="0.7"/>',
  breakwater: '<rect x="9" y="4" width="6" height="10" rx="1" fill="white" opacity="0.9"/><circle cx="12" cy="6" r="2" fill="white" opacity="0.5"/><path d="M5 16q7-3 14 0" stroke="white" stroke-width="1.2" fill="none"/>',
};

function createMarkerElement(infraType: string, color: string, isSelected: boolean, name?: string): HTMLElement {
  const size = isSelected ? 48 : 38;
  const el = document.createElement('div');
  el.className = 'mira-marker' + (isSelected ? ' mira-marker-selected' : '');
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.alignItems = 'center';
  const iconSvg = ICON_SVG[infraType] || ICON_SVG.pier;
  const pinHtml = `<svg viewBox="0 0 48 60" width="${size}" height="${Math.round(size*1.25)}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="ms-${infraType}" x="-40%" y="-20%" width="180%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="${color}" flood-opacity="0.4"/>
      </filter>
    </defs>
    ${isSelected ? `<circle cx="24" cy="24" r="22" fill="${color}" opacity="0.15"><animate attributeName="r" values="20;30;20" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;0;0.2" dur="2s" repeatCount="indefinite"/></circle>` : ''}
    <path d="M24 2C13 2 4 11 4 22c0 12 20 36 20 36s20-24 20-36C44 11 35 2 24 2z"
      fill="${color}" filter="url(#ms-${infraType})" stroke="white" stroke-width="${isSelected ? 2 : 1.5}" stroke-opacity="0.9"/>
    <circle cx="24" cy="22" r="12" fill="white" opacity="0.95"/>
    <g transform="translate(12,12)">${iconSvg}</g>
  </svg>`;
  const labelHtml = name ? `<div class="mira-label">${name}</div>` : '';
  el.innerHTML = pinHtml + labelHtml;
  return el;
}

function createImageMarkerElement(sev: string | null): HTMLElement {
  const c = severityColor(sev);
  const el = document.createElement('div');
  el.className = 'mira-img-dot';
  el.innerHTML = `<svg viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="10" r="7" fill="${c}" opacity="0.2" stroke="${c}" stroke-width="1.5"/><circle cx="10" cy="10" r="4" fill="${c}" stroke="white" stroke-width="1.5"/></svg>`;
  return el;
}

// ── Popup HTML builders ──────────────────────────────────────────────────────
function assetPopupHTML(asset: Asset, color: string, label: string, imageCount: number): string {
  const statusColor = asset.status === 'active' ? '#4ade80' : '#fbbf24';
  const statusBg = asset.status === 'active' ? 'rgba(34,197,94,.15)' : 'rgba(234,179,8,.15)';
  return `<div class="mp-card">
    <div class="mp-name">${asset.name}</div>
    ${asset.location_name ? `<div class="mp-loc"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${asset.location_name}</div>` : ''}
    <div class="mp-badges">
      <span class="mp-badge" style="background:${color}22;color:${color};border:1px solid ${color}45">${label}</span>
      <span class="mp-badge" style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor}30">${asset.status}</span>
    </div>
    <div class="mp-stats">${asset.inspection_count} inspections · ${imageCount} images</div>
    <div class="mp-coords">${asset.latitude?.toFixed(5)}, ${asset.longitude?.toFixed(5)}</div>
    <a href="/assets/${asset.id}" class="mp-link">View Asset Details →</a>
  </div>`;
}

function imagePopupHTML(pt: ImageGpsPoint): string {
  const c = severityColor(pt.max_severity);
  return `<div class="mp-card">
    <div class="mp-name">${pt.filename}</div>
    <div class="mp-loc">${pt.inspection_name}</div>
    <div class="mp-badges">
      ${pt.max_severity ? `<span class="mp-badge" style="background:${c}22;color:${c};border:1px solid ${c}45">${pt.max_severity}</span>` : ''}
      <span class="mp-badge" style="background:rgba(56,189,248,.12);color:#38bdf8;border:1px solid rgba(56,189,248,.25)">${pt.detection_count} detections</span>
    </div>
    ${pt.gps_accuracy_m != null ? `<div class="mp-stats">GPS ±${pt.gps_accuracy_m.toFixed(1)} m</div>` : ''}
    <a href="/inspections/${pt.inspection_id}" class="mp-link">View Inspection →</a>
  </div>`;
}

// ── Styles ───────────────────────────────────────────────────────────────────
const MAP_STYLES = `
  .mapboxgl-map { font-family: 'Inter', system-ui, sans-serif; }

  /* Markers */
  .mira-marker { cursor: pointer; }
  .mira-marker:hover { transform: scale(1.08) translateY(-2px); transition: transform .15s ease; }
  .mira-marker-selected { z-index: 10 !important; }
  .mira-label {
    margin-top: 2px; padding: 3px 8px; border-radius: 6px;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
    font-size: 11px; font-weight: 700; color: #f1f5f9; white-space: nowrap;
    font-family: 'Inter', system-ui, sans-serif; letter-spacing: -0.01em;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .mira-img-dot { cursor: pointer; }
  .mira-img-dot:hover { transform: scale(1.5); transition: transform .15s ease; }

  /* Popup */
  .mapboxgl-popup-content {
    background: rgba(8,16,30,0.97) !important; border-radius: 16px !important;
    padding: 0 !important; box-shadow: 0 24px 64px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.07) !important;
    backdrop-filter: blur(28px) saturate(1.4); color: white;
  }
  .mapboxgl-popup-tip { border-top-color: rgba(8,16,30,0.97) !important; }
  .mapboxgl-popup-close-button { color: #64748b; font-size: 18px; padding: 4px 10px; }
  .mapboxgl-popup-close-button:hover { color: white; background: transparent; }

  .mp-card { padding: 16px 18px; min-width: 220px; }
  .mp-name { font-size: 13px; font-weight: 700; color: #f1f5f9; }
  .mp-loc { font-size: 10px; color: #64748b; display: flex; align-items: center; gap: 4px; margin-top: 3px; }
  .mp-badges { display: flex; gap: 5px; margin-top: 10px; flex-wrap: wrap; }
  .mp-badge { font-size: 10px; padding: 3px 9px; border-radius: 6px; font-weight: 600; }
  .mp-stats { font-size: 10px; color: #94a3b8; margin-top: 8px; }
  .mp-coords { font-size: 9px; color: #475569; margin-top: 4px; font-family: ui-monospace, monospace; }
  .mp-link {
    display: block; text-align: center; font-size: 11px; font-weight: 600; color: #38bdf8;
    padding: 10px; margin: 12px -18px -16px -18px; background: rgba(56,189,248,.07);
    text-decoration: none; transition: background .15s;
  }
  .mp-link:hover { background: rgba(56,189,248,.14); color: #7dd3fc; }

  /* Controls override — match Governor's Island pill (black/40) */
  .mapboxgl-ctrl-top-left { margin-top: 70px !important; margin-left: 4px !important; }
  .mapboxgl-ctrl-group {
    background: rgba(0,0,0,0.40) !important;
    backdrop-filter: blur(40px) saturate(1.5) !important;
    border: 1px solid rgba(255,255,255,0.08) !important;
    border-radius: 12px !important;
    box-shadow: 0 8px 32px rgba(0,0,0,.4) !important;
    overflow: hidden;
  }
  .mapboxgl-ctrl-group button {
    background: transparent !important; color: #e2e8f0 !important;
    width: 36px !important; height: 36px !important;
    border: none !important; border-bottom: 1px solid rgba(255,255,255,.06) !important;
  }
  .mapboxgl-ctrl-group button:hover { background: rgba(255,255,255,.08) !important; color: #38bdf8 !important; }
  .mapboxgl-ctrl-group button:last-child { border-bottom: none !important; }
  .mapboxgl-ctrl-group button .mapboxgl-ctrl-icon { filter: invert(1) brightness(0.85); }

  /* Compass — same size as +/- buttons */
  .mapboxgl-ctrl-compass { width: 36px !important; height: 36px !important; }
  .mapboxgl-ctrl-compass .mapboxgl-ctrl-icon {
    filter: none !important;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='10' fill='none' stroke='rgba(255,255,255,0.15)' stroke-width='1'/%3E%3Cpolygon points='12,3 13.8,10 12,9 10.2,10' fill='%23EF4444' opacity='0.95'/%3E%3Cpolygon points='12,21 13.8,14 12,15 10.2,14' fill='%23475569' opacity='0.7'/%3E%3Ccircle cx='12' cy='12' r='1.5' fill='white'/%3E%3C/svg%3E") !important;
    background-size: 24px !important;
    background-position: center !important;
  }

  .mapboxgl-ctrl-scale {
    background: rgba(0,0,0,0.40) !important; backdrop-filter: blur(40px) !important;
    color: #94a3b8 !important; border-color: rgba(148,163,184,.3) !important;
    font-size: 10px !important; font-weight: 600 !important; border-radius: 6px !important;
    padding: 1px 6px !important; border: 1px solid rgba(255,255,255,0.08) !important;
  }
  .mapboxgl-ctrl-attrib { background: rgba(0,0,0,.3) !important; border-radius: 8px 0 0 0 !important; backdrop-filter: blur(8px); }
  .mapboxgl-ctrl-attrib a { color: #64748b !important; }

  /* 3D buildings */
  .mapboxgl-canvas { outline: none; }
`;

// ── Map styles (layers) ──────────────────────────────────────────────────────
const MAP_LAYER_STYLES = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
  streets: 'mapbox://styles/mapbox/streets-v12',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
};

// ── Main Component ───────────────────────────────────────────────────────────
interface MapViewProps {
  assets: Asset[]; selectedAssetId: string | null; onSelectAsset: (id: string) => void;
  infraConfig: Record<string, { label: string; markerColor: string }>; imagePoints: ImageGpsPoint[];
  flyToCoords?: [number, number] | null;
}

const DEFAULT_CENTER: [number, number] = [-74.0155, 40.6900]; // [lng, lat] for Mapbox
const DEFAULT_ZOOM = 15;

function MapView({ assets, selectedAssetId, onSelectAsset, infraConfig, imagePoints, flyToCoords }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const imageMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [currentStyle, setCurrentStyle] = useState<keyof typeof MAP_LAYER_STYLES>('satellite');
  const initRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || initRef.current) return;
    initRef.current = true;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_LAYER_STYLES.satellite,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 45,
      bearing: 0,
      antialias: true,
      attributionControl: true,
    });

    // Controls
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'top-left');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    // On style load: hide POI labels, add 3D buildings
    map.on('style.load', () => {
      const layers = map.getStyle()?.layers;
      if (!layers) return;

      // Hide POI / place labels so they don't clash with our markers
      layers.forEach(layer => {
        if (layer.type === 'symbol' && (
          layer.id.includes('poi') || layer.id.includes('place') ||
          layer.id.includes('transit') || layer.id.includes('airport')
        )) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      });

      // Add 3D building layer if available
      const labelLayerId = layers.find(l => l.type === 'symbol' && (l.layout as any)?.['text-field'])?.id;
      if (map.getSource('composite') && !map.getLayer('3d-buildings')) {
        try {
          map.addLayer({
            id: '3d-buildings', source: 'composite', 'source-layer': 'building',
            filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
            paint: {
              'fill-extrusion-color': '#082E29',
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.5,
            },
          }, labelLayerId);
        } catch { /* style may not support buildings */ }
      }
    });

    mapRef.current = map;

    return () => { map.remove(); initRef.current = false; };
  }, []);

  // Fit bounds to assets on first load
  const fittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fittedRef.current) return;
    const coords = [
      ...assets.filter(a => a.latitude != null && a.longitude != null).map(a => [a.longitude!, a.latitude!] as [number, number]),
      ...imagePoints.map(p => [p.lon, p.lat] as [number, number]),
    ];
    if (coords.length > 0) {
      const bounds = coords.reduce((b, c) => b.extend(c as [number, number]), new mapboxgl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: 80, maxZoom: 16, pitch: 45 });
      fittedRef.current = true;
    }
  }, [assets, imagePoints]);

  // Update asset markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(assets.map(a => a.id));
    // Remove old markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    });

    // Add/update markers
    assets.forEach(asset => {
      if (asset.latitude == null || asset.longitude == null) return;
      const color = infraConfig[asset.infrastructure_type]?.markerColor ?? '#64748B';
      const label = infraConfig[asset.infrastructure_type]?.label ?? asset.infrastructure_type;
      const isSelected = asset.id === selectedAssetId;
      const existing = markersRef.current.get(asset.id);

      if (existing) {
        // Update position and element
        existing.setLngLat([asset.longitude, asset.latitude]);
        const el = createMarkerElement(asset.infrastructure_type, color, isSelected, asset.name);
        el.addEventListener('click', (e) => { e.stopPropagation(); onSelectAsset(asset.id); });
        existing.getElement().replaceWith(el);
        // Mapbox doesn't support replaceWith on marker element easily, remove and re-add
        existing.remove();
        markersRef.current.delete(asset.id);
      }

      const el = createMarkerElement(asset.infrastructure_type, color, isSelected, asset.name);
      el.addEventListener('click', (e) => { e.stopPropagation(); onSelectAsset(asset.id); });

      const popup = new mapboxgl.Popup({ offset: 25, closeButton: true, maxWidth: '300px' })
        .setHTML(assetPopupHTML(asset, color, label, asset.image_count ?? 0));

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([asset.longitude, asset.latitude])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.set(asset.id, marker);
    });
  }, [assets, selectedAssetId, onSelectAsset, infraConfig]);

  // Update image markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old
    imageMarkersRef.current.forEach(m => m.remove());
    imageMarkersRef.current.clear();

    // Add new
    imagePoints.forEach(pt => {
      const el = createImageMarkerElement(pt.max_severity);
      const popup = new mapboxgl.Popup({ offset: 12, closeButton: true, maxWidth: '280px' })
        .setHTML(imagePopupHTML(pt));
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pt.lon, pt.lat])
        .setPopup(popup)
        .addTo(map);
      imageMarkersRef.current.set(pt.id, marker);
    });
  }, [imagePoints]);

  // Fly to selected asset
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedAssetId) return;
    const asset = assets.find(a => a.id === selectedAssetId);
    if (asset?.latitude && asset?.longitude) {
      map.flyTo({ center: [asset.longitude, asset.latitude], zoom: 17, pitch: 55, duration: 1400 });
    }
  }, [selectedAssetId, assets]);

  // Fly to search coords
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToCoords) return;
    map.flyTo({ center: [flyToCoords[1], flyToCoords[0]], zoom: 17, pitch: 45, duration: 1400 });
  }, [flyToCoords]);

  // Style switcher
  const switchStyle = useCallback((style: keyof typeof MAP_LAYER_STYLES) => {
    const map = mapRef.current;
    if (!map) return;
    setCurrentStyle(style);
    map.setStyle(MAP_LAYER_STYLES[style]);
    // Re-add markers after style change
    map.once('style.load', () => {
      markersRef.current.forEach(m => m.addTo(map));
      imageMarkersRef.current.forEach(m => m.addTo(map));
    });
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_STYLES }} />
      <div ref={mapContainer} style={{ width: '100%', height: '100%', borderRadius: '12px', overflow: 'hidden' }} />

      {/* Style switcher - bottom right */}
      <div style={{ position: 'absolute', bottom: 32, right: 12, zIndex: 5, display: 'flex', gap: 4 }}>
        {(Object.keys(MAP_LAYER_STYLES) as Array<keyof typeof MAP_LAYER_STYLES>).map(key => (
          <button
            key={key}
            onClick={() => switchStyle(key)}
            style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: 'none', transition: 'all .15s',
              background: currentStyle === key ? 'rgba(8,145,178,0.4)' : 'rgba(8,16,30,0.75)',
              color: currentStyle === key ? '#38bdf8' : '#94a3b8',
              backdropFilter: 'blur(16px)',
              boxShadow: currentStyle === key ? '0 0 12px rgba(8,145,178,0.3)' : '0 4px 12px rgba(0,0,0,.3)',
              borderWidth: 1, borderStyle: 'solid',
              borderColor: currentStyle === key ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.06)',
            }}
          >
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>
    </>
  );
}

export default memo(MapView);

'use client';
import { useState } from 'react';
import type { Detection, BoundingBox, Severity } from '@/types';
import { buildAnnotationLabel } from '@/lib/annotationTaxonomy';

// ─── Severity (view mode keeps legacy hex palette — pixel-identical) ─────────
const SEVERITY_HEX: Record<string, string> = {
  S1: '#4CAF50',
  S2: '#E6A817',
  S3: '#FF7043',
  S4: '#B71C1C',
};

/* Normalize legacy S0 → S1 */
const normSev = (s: string | null | undefined): string | null => {
  if (!s) return null;
  if (s === 'S0' || s === '0') return 'S1';
  const map: Record<string, string> = { '1': 'S1', '2': 'S2', '3': 'S3', '4': 'S4' };
  return map[s] || s;
};

// ─── Review-mode accents ──────────────────────────────────────────────────────
// Boxes/ellipses are colored by SEVERITY (same palette as view mode); status is
// conveyed by markers only (label prefix, opacity, strikethrough, dashes).
const REJECT_STRIKE = '#ef4444'; // red strikethrough — reads as rejection
const NEUTRAL_HEX = '#64748b';   // slate — drafts before a severity is picked

const damageCode = (damageType: string): string =>
  (damageType || '??').slice(0, 2).toUpperCase();

type ShapeType = 'rect' | 'ellipse';

/** Common SVG presentation props shared by <rect> and <ellipse>. */
type ShapeProps = {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  strokeDasharray?: string;
};

/** Renders a bbox as <rect> or, when shapeType === 'ellipse', as an inscribed <ellipse>. */
function bboxShape(
  bbox: BoundingBox,
  shapeType: ShapeType | undefined,
  props: ShapeProps,
  rectRx?: number,
) {
  const { x1, y1, x2, y2 } = bbox;
  if (shapeType === 'ellipse') {
    return (
      <ellipse
        cx={(x1 + x2) / 2}
        cy={(y1 + y2) / 2}
        rx={(x2 - x1) / 2}
        ry={(y2 - y1) / 2}
        {...props}
      />
    );
  }
  return <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={rectRx} {...props} />;
}

export interface ReviewState {
  action: 'accepted' | 'rejected' | 'modified' | 'added' | null;
  modifiedBbox?: BoundingBox;
  modifiedShapeType?: 'rect' | 'ellipse';
  /** Staged severity for a 'modified' detection — colors the new box/label. */
  modifiedSeverity?: Severity;
}

export interface ReviewOverlayProps {
  imageUrl: string;
  detections: Detection[];
  mode?: 'view' | 'review';
  reviewStates?: Record<string, ReviewState>;
  selectedDetectionId?: string | null;
  onSelectDetection?: (id: string) => void;
  onClick?: () => void;
  fitScreen?: boolean;
  /** Rendered inside the <svg>, after detection layers (e.g. BboxEditor). */
  children?: React.ReactNode;
  /** Enables pointer events on the svg (review interactions / editor). */
  interactive?: boolean;
  /** Reports the image's natural dimensions once loaded (for BboxEditor composition). */
  onNaturalSize?: (w: number, h: number) => void;
  /** When false, hides all text label chips (boxes/ellipses/strikethroughs stay). */
  showLabels?: boolean;
}

export default function ReviewOverlay({
  imageUrl,
  detections,
  mode = 'view',
  reviewStates,
  selectedDetectionId,
  onSelectDetection,
  onClick,
  fitScreen,
  children,
  interactive,
  onNaturalSize,
  showLabels = true,
}: ReviewOverlayProps) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const isReview = mode === 'review';
  const pointerEnabled = interactive ?? false;

  return (
    <div
      className={`relative cursor-pointer group ${fitScreen ? 'inline-block max-h-full max-w-full' : 'w-full'}`}
      onClick={onClick}
    >
      <img
        src={imageUrl}
        alt="AI Analysis"
        className={fitScreen
          ? 'block max-h-[calc(100vh-160px)] max-w-full object-contain rounded-lg'
          : 'w-full rounded-lg border border-slate-200 block'}
        onLoad={(e) => {
          const img = e.currentTarget;
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
          onNaturalSize?.(img.naturalWidth, img.naturalHeight);
        }}
      />
      {dims && (detections.length > 0 || children) && (
        <svg
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          preserveAspectRatio="none"
          className={`absolute inset-0 w-full h-full rounded-lg ${pointerEnabled ? '' : 'pointer-events-none'}`}
        >
          {(() => {
            const visible = detections.filter((d) => d.confidence >= 0.20);
            const scale = dims.w / 700;
            const strokeW = Math.max(2, 2.5 * scale);
            const labelH = Math.round(22 * scale);
            const labelPad = Math.round(6 * scale);

            const labels = visible.map((d) => {
              const { x1, y1, x2, y2 } = d.bbox;
              const sev = normSev(d.severity) || '';
              let mainLabel: string;
              if (isReview) {
                const state = reviewStates?.[d.id];
                const action = state?.action ?? (d.source === 'engineer_added' ? 'added' : null);
                // Modified detections show (and are colored by) the staged severity
                const labelSev = action === 'modified' && state?.modifiedSeverity
                  ? (normSev(state.modifiedSeverity) || sev)
                  : sev;
                const annLabel = buildAnnotationLabel({
                  damageCode: d.domain_metadata?.code ?? damageCode(d.damage_type),
                  severity: (['S1', 'S2', 'S3', 'S4'].includes(labelSev) ? labelSev : null) as
                    | 'S1' | 'S2' | 'S3' | 'S4' | null,
                  segments: d.domain_metadata?.segments,
                });
                if (action === 'added') {
                  mainLabel = `NEW: ${annLabel}`;
                } else if (action === null) {
                  mainLabel = `CV: ${annLabel}`;
                } else if (action === 'accepted') {
                  mainLabel = `✓ ${annLabel}`;
                } else {
                  mainLabel = annLabel;
                }
              } else if (d.source === 'engineer_added') {
                mainLabel = `✓ ${sev ? `${sev} ${d.damage_type}` : d.damage_type}`;
              } else {
                mainLabel = sev ? `${sev} ${d.damage_type}` : d.damage_type;
              }
              const mainFontSize = Math.round(13 * scale);
              const mainCharW = mainFontSize * 0.58;
              const labelW = mainLabel.length * mainCharW + labelPad * 2;
              let labelY = y1 >= labelH + 3 * scale ? y1 - labelH - 2 * scale : y2 + 2 * scale;
              const labelX = Math.max(0, Math.min(x1, dims.w - labelW - 2));
              return { d, mainLabel, mainFontSize, labelW, labelH, labelX, labelY };
            });
            // Nudge overlapping labels
            for (let i = 0; i < labels.length; i++) {
              for (let j = i + 1; j < labels.length; j++) {
                const a = labels[i], b = labels[j];
                if (Math.abs(a.labelY - b.labelY) < labelH * 0.85 &&
                    a.labelX < b.labelX + b.labelW && b.labelX < a.labelX + a.labelW) {
                  b.labelY = a.labelY + labelH + 2 * scale;
                  if (b.labelY > dims.h - labelH) b.labelY = a.labelY - labelH - 2 * scale;
                }
              }
            }

            return labels.map((l, i) => {
              const { d, mainLabel, mainFontSize, labelW, labelH: lH, labelX, labelY } = l;
              const { x1, y1, x2, y2 } = d.bbox;
              const bw = x2 - x1;
              const bh = y2 - y1;
              const conf = d.confidence;
              const isSelected = isReview && selectedDetectionId === d.id;

              // ── Determine colors ────────────────────────────────────────
              const state = reviewStates?.[d.id];
              const action = isReview
                ? (state?.action ?? (d.source === 'engineer_added' ? 'added' : null))
                : null;

              let stroke: string;
              let fill: string;
              let fillOp: number;
              let strokeOp: number;
              let cornerOp: number;
              let labelBgOp: number;
              let dashed = false;

              // Original severity color — slate while a draft has no severity yet
              const origHex = SEVERITY_HEX[normSev(d.severity) || ''] || NEUTRAL_HEX;

              if (isReview) {
                if (action === 'modified') {
                  // New box/label take the staged severity's color
                  const newSev = normSev(state?.modifiedSeverity) || normSev(d.severity) || '';
                  stroke = SEVERITY_HEX[newSev] || origHex;
                } else if (action === 'added') {
                  stroke = origHex; // severity color once chosen, slate until then
                  dashed = true;
                } else {
                  // unactioned CV / accepted / rejected — own severity color
                  stroke = origHex;
                }
                fill = stroke;
                fillOp = action === 'rejected' ? 0.04 : 0.08;
                strokeOp = action === 'rejected' ? 0.4 : 0.9;
                cornerOp = strokeOp;
                labelBgOp = action === 'rejected' ? 0.45 : 0.85;
              } else {
                // Severity drives the color for every detection, engineer-added
                // included — provenance is conveyed by the ✓ label prefix only
                const sevHex = SEVERITY_HEX[normSev(d.severity) || ''] || '#64748B';
                stroke = sevHex;
                fill = sevHex;
                const hi = conf >= 0.5;
                fillOp = hi ? 0.12 : 0.04;
                strokeOp = hi ? 0.9 : 0.3;
                cornerOp = hi ? 0.95 : 0.35;
                labelBgOp = hi ? 0.85 : 0.45;
              }

              const effStrokeW = isSelected ? strokeW * 1.8 : strokeW;
              const handleSelect = isReview && onSelectDetection
                ? (e: React.MouseEvent) => { e.stopPropagation(); onSelectDetection(d.id); }
                : undefined;

              const modBbox = action === 'modified' ? state?.modifiedBbox : undefined;
              const shapeType: ShapeType | undefined = d.shape_type;
              const modShapeType: ShapeType | undefined =
                state?.modifiedShapeType ?? shapeType;

              return (
                <g key={d.id || i}
                  onClick={handleSelect}
                  style={handleSelect ? { cursor: 'pointer' } : undefined}
                >
                  {/* Selection glow */}
                  {isSelected && bboxShape(d.bbox, shapeType, {
                    fill: 'none', stroke, strokeWidth: effStrokeW * 2.2,
                    strokeOpacity: 0.25,
                  }, 2 * scale)}
                  {/* Original bbox — faint dash in the ORIGINAL severity's color when modified */}
                  {modBbox ? (
                    bboxShape(d.bbox, shapeType, {
                      fill: 'none', stroke: origHex, strokeWidth: strokeW,
                      strokeOpacity: 0.35, strokeDasharray: `${6 * scale} ${4 * scale}`,
                    }, 2 * scale)
                  ) : (
                    <>
                      {bboxShape(d.bbox, shapeType, {
                        fill, fillOpacity: fillOp,
                      }, 2 * scale)}
                      {bboxShape(d.bbox, shapeType, {
                        fill: 'none', stroke, strokeWidth: effStrokeW,
                        strokeOpacity: strokeOp,
                        strokeDasharray: dashed ? `${8 * scale} ${5 * scale}` : undefined,
                      }, 2 * scale)}
                      {!dashed && shapeType !== 'ellipse' && (
                        <>
                          <line x1={x1} y1={y1 + bh * 0.12} x2={x1} y2={y1} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                          <line x1={x1} y1={y1} x2={x1 + bw * 0.12} y2={y1} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                          <line x1={x2} y1={y2 - bh * 0.12} x2={x2} y2={y2} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                          <line x1={x2} y1={y2} x2={x2 - bw * 0.12} y2={y2} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                        </>
                      )}
                    </>
                  )}
                  {/* Rejected — red diagonal strikethrough (rejection marker) */}
                  {action === 'rejected' && (
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={REJECT_STRIKE} strokeWidth={strokeW}
                      strokeOpacity={0.6} strokeLinecap="round" />
                  )}
                  {/* Modified — solid shape at new position in the NEW severity's color */}
                  {modBbox && (
                    <>
                      {bboxShape(modBbox, modShapeType, {
                        fill: stroke, fillOpacity: 0.08,
                      }, 2 * scale)}
                      {bboxShape(modBbox, modShapeType, {
                        fill: 'none', stroke,
                        strokeWidth: effStrokeW, strokeOpacity: 0.95,
                      }, 2 * scale)}
                    </>
                  )}
                  {/* Label chip (hidden when labels are toggled off) */}
                  {showLabels && (
                    <>
                      <rect x={labelX + 1} y={labelY + 1} width={labelW} height={lH}
                        fill="rgba(0,0,0,0.25)" rx={4 * scale} />
                      <rect x={labelX} y={labelY} width={labelW} height={lH}
                        fill={stroke} fillOpacity={labelBgOp} rx={4 * scale} />
                      <text x={labelX + labelPad} y={labelY + lH * 0.72}
                        fontSize={mainFontSize} fill="white"
                        fontFamily="system-ui,-apple-system,sans-serif"
                        fontWeight="700" letterSpacing="0.2">
                        {mainLabel}
                      </text>
                    </>
                  )}
                </g>
              );
            });
          })()}
          {children}
        </svg>
      )}
    </div>
  );
}

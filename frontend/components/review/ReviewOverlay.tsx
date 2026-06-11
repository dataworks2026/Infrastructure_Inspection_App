'use client';
import { useState } from 'react';
import type { Detection, BoundingBox } from '@/types';

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

// ─── Review-mode palette (Engineer Review Flow spec) ─────────────────────────
const REVIEW_COLORS = {
  cv: '#3b82f6',        // blue-500 — unreviewed CV detection
  cvFill: 'rgba(59, 130, 246, 0.08)',
  accepted: '#10b981',  // green
  rejected: '#ef4444',  // red
  modified: '#f59e0b',  // amber
  added: '#10b981',     // green
} as const;

const damageCode = (damageType: string): string =>
  (damageType || '??').slice(0, 2).toUpperCase();

export interface ReviewState {
  action: 'accepted' | 'rejected' | 'modified' | 'added' | null;
  modifiedBbox?: BoundingBox;
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
                const sevNum = sev.replace('S', '');
                if (action === 'added') {
                  mainLabel = `NEW: ${damageCode(d.damage_type)}${sevNum ? ` | Sev ${sevNum}` : ''}`;
                } else {
                  mainLabel = `CV: ${damageCode(d.damage_type)}${sevNum ? ` | Sev ${sevNum}` : ''} | ${Math.round(d.confidence * 100)}%`;
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

              if (isReview) {
                if (action === 'accepted') stroke = REVIEW_COLORS.accepted;
                else if (action === 'rejected') stroke = REVIEW_COLORS.rejected;
                else if (action === 'modified') stroke = REVIEW_COLORS.modified;
                else if (action === 'added') { stroke = REVIEW_COLORS.added; dashed = true; }
                else stroke = REVIEW_COLORS.cv;
                fill = stroke;
                fillOp = action === 'rejected' ? 0.04 : 0.08;
                strokeOp = action === 'rejected' ? 0.4 : 0.9;
                cornerOp = strokeOp;
                labelBgOp = action === 'rejected' ? 0.45 : 0.85;
              } else {
                const sevHex = d.source === 'engineer_added'
                  ? '#10b981'
                  : (SEVERITY_HEX[normSev(d.severity) || ''] || '#64748B');
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

              return (
                <g key={d.id || i}
                  onClick={handleSelect}
                  style={handleSelect ? { cursor: 'pointer' } : undefined}
                >
                  {/* Selection glow */}
                  {isSelected && (
                    <rect x={x1} y={y1} width={bw} height={bh}
                      fill="none" stroke={stroke} strokeWidth={effStrokeW * 2.2}
                      strokeOpacity={0.25} rx={2 * scale} />
                  )}
                  {/* Original bbox — faint dashed blue when modified */}
                  {modBbox ? (
                    <rect x={x1} y={y1} width={bw} height={bh}
                      fill="none" stroke={REVIEW_COLORS.cv} strokeWidth={strokeW}
                      strokeOpacity={0.35} strokeDasharray={`${6 * scale} ${4 * scale}`}
                      rx={2 * scale} />
                  ) : (
                    <>
                      <rect x={x1} y={y1} width={bw} height={bh}
                        fill={fill} fillOpacity={fillOp} rx={2 * scale} />
                      <rect x={x1} y={y1} width={bw} height={bh}
                        fill="none" stroke={stroke} strokeWidth={effStrokeW}
                        strokeOpacity={strokeOp}
                        strokeDasharray={dashed ? `${8 * scale} ${5 * scale}` : undefined}
                        rx={2 * scale} />
                      {!dashed && (
                        <>
                          <line x1={x1} y1={y1 + bh * 0.12} x2={x1} y2={y1} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                          <line x1={x1} y1={y1} x2={x1 + bw * 0.12} y2={y1} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                          <line x1={x2} y1={y2 - bh * 0.12} x2={x2} y2={y2} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                          <line x1={x2} y1={y2} x2={x2 - bw * 0.12} y2={y2} stroke={stroke} strokeWidth={effStrokeW * 2} strokeOpacity={cornerOp} strokeLinecap="round" />
                        </>
                      )}
                    </>
                  )}
                  {/* Rejected — diagonal strikethrough */}
                  {action === 'rejected' && (
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={REVIEW_COLORS.rejected} strokeWidth={strokeW}
                      strokeOpacity={0.6} strokeLinecap="round" />
                  )}
                  {/* Modified — solid amber rect at new position */}
                  {modBbox && (
                    <>
                      <rect x={modBbox.x1} y={modBbox.y1}
                        width={modBbox.x2 - modBbox.x1} height={modBbox.y2 - modBbox.y1}
                        fill={REVIEW_COLORS.modified} fillOpacity={0.08} rx={2 * scale} />
                      <rect x={modBbox.x1} y={modBbox.y1}
                        width={modBbox.x2 - modBbox.x1} height={modBbox.y2 - modBbox.y1}
                        fill="none" stroke={REVIEW_COLORS.modified}
                        strokeWidth={effStrokeW} strokeOpacity={0.95} rx={2 * scale} />
                    </>
                  )}
                  {/* Label chip */}
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

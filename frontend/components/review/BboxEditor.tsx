'use client';

/**
 * BboxEditor — interactive SVG bounding-box editor for the Engineer Review Flow.
 *
 * IMPORTANT: this component renders SVG elements (a single <g>), NOT a full <svg>.
 * It must be composed INSIDE an existing parent <svg> whose viewBox equals the
 * image's natural dimensions, e.g.:
 *
 *   <svg viewBox={`0 0 ${naturalW} ${naturalH}`} preserveAspectRatio="none"
 *        className="absolute inset-0 w-full h-full">
 *     <BboxEditor
 *       bbox={editingBbox}
 *       imageNaturalWidth={naturalW}
 *       imageNaturalHeight={naturalH}
 *       mode="edit"
 *       onChange={setEditingBbox}
 *     />
 *   </svg>
 *
 * All coordinates (props in, callbacks out) are absolute pixels in the image's
 * natural coordinate space (x1, y1, x2, y2), matching the DB convention.
 * The parent svg must NOT have `pointer-events-none` while editing/drawing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundingBox } from '@/types';

export type BboxEditorMode = 'edit' | 'draw' | 'idle';

export interface BboxEditorProps {
  /** Box being edited (natural-image pixel coords); null in draw mode before drawing. */
  bbox: BoundingBox | null;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  mode: BboxEditorMode;
  /** Stroke/fill color. Default amber (modified). */
  color?: string;
  /** Fired with the updated bbox while dragging and on drag end. */
  onChange: (bbox: BoundingBox) => void;
  /** Fired on mouseup after drawing a new box in 'draw' mode. */
  onDrawComplete?: (bbox: BoundingBox) => void;
}

/** Ensure x1<x2 and y1<y2. */
export function normalizeBbox(b: BoundingBox): BoundingBox {
  return {
    x1: Math.min(b.x1, b.x2),
    y1: Math.min(b.y1, b.y2),
    x2: Math.max(b.x1, b.x2),
    y2: Math.max(b.y1, b.y2),
  };
}

const MIN_SIZE = 4; // px in natural-image space

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface HandleDef {
  id: HandleId;
  cursor: string;
  // which edges this handle moves
  moveX1: boolean;
  moveY1: boolean;
  moveX2: boolean;
  moveY2: boolean;
  // position factors within the bbox (0 = x1/y1, 0.5 = mid, 1 = x2/y2)
  fx: number;
  fy: number;
}

const HANDLES: HandleDef[] = [
  { id: 'nw', cursor: 'nwse-resize', moveX1: true,  moveY1: true,  moveX2: false, moveY2: false, fx: 0,   fy: 0   },
  { id: 'n',  cursor: 'ns-resize',   moveX1: false, moveY1: true,  moveX2: false, moveY2: false, fx: 0.5, fy: 0   },
  { id: 'ne', cursor: 'nesw-resize', moveX1: false, moveY1: true,  moveX2: true,  moveY2: false, fx: 1,   fy: 0   },
  { id: 'e',  cursor: 'ew-resize',   moveX1: false, moveY1: false, moveX2: true,  moveY2: false, fx: 1,   fy: 0.5 },
  { id: 'se', cursor: 'nwse-resize', moveX1: false, moveY1: false, moveX2: true,  moveY2: true,  fx: 1,   fy: 1   },
  { id: 's',  cursor: 'ns-resize',   moveX1: false, moveY1: false, moveX2: false, moveY2: true,  fx: 0.5, fy: 1   },
  { id: 'sw', cursor: 'nesw-resize', moveX1: true,  moveY1: false, moveX2: false, moveY2: true,  fx: 0,   fy: 1   },
  { id: 'w',  cursor: 'ew-resize',   moveX1: true,  moveY1: false, moveX2: false, moveY2: false, fx: 0,   fy: 0.5 },
];

type DragState =
  | { kind: 'move'; start: { x: number; y: number }; orig: BoundingBox }
  | { kind: 'resize'; handle: HandleDef; start: { x: number; y: number }; orig: BoundingBox }
  | { kind: 'draw'; start: { x: number; y: number } };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function BboxEditor({
  bbox,
  imageNaturalWidth,
  imageNaturalHeight,
  mode,
  color = '#f59e0b',
  onChange,
  onDrawComplete,
}: BboxEditorProps) {
  const gRef = useRef<SVGGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Live preview box while drawing (not yet committed via onDrawComplete).
  const [drawPreview, setDrawPreview] = useState<BoundingBox | null>(null);

  // Keep latest callbacks in refs so document-level listeners stay fresh.
  const onChangeRef = useRef(onChange);
  const onDrawCompleteRef = useRef(onDrawComplete);
  onChangeRef.current = onChange;
  onDrawCompleteRef.current = onDrawComplete;

  /** Convert a pointer event's client coords into the parent svg's viewBox coords. */
  const toSvgPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const g = gRef.current;
    const svg = g?.ownerSVGElement ?? null;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return {
      x: clamp(pt.x, 0, imageNaturalWidth),
      y: clamp(pt.y, 0, imageNaturalHeight),
    };
  }, [imageNaturalWidth, imageNaturalHeight]);

  const applyDrag = useCallback((e: PointerEvent | React.PointerEvent): BoundingBox | null => {
    const drag = dragRef.current;
    if (!drag) return null;
    const p = toSvgPoint(e);

    if (drag.kind === 'move') {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const w = drag.orig.x2 - drag.orig.x1;
      const h = drag.orig.y2 - drag.orig.y1;
      const x1 = clamp(drag.orig.x1 + dx, 0, imageNaturalWidth - w);
      const y1 = clamp(drag.orig.y1 + dy, 0, imageNaturalHeight - h);
      return { x1, y1, x2: x1 + w, y2: y1 + h };
    }

    if (drag.kind === 'resize') {
      const { handle, orig } = drag;
      let { x1, y1, x2, y2 } = orig;
      if (handle.moveX1) x1 = clamp(Math.min(p.x, orig.x2 - MIN_SIZE), 0, imageNaturalWidth);
      if (handle.moveY1) y1 = clamp(Math.min(p.y, orig.y2 - MIN_SIZE), 0, imageNaturalHeight);
      if (handle.moveX2) x2 = clamp(Math.max(p.x, orig.x1 + MIN_SIZE), 0, imageNaturalWidth);
      if (handle.moveY2) y2 = clamp(Math.max(p.y, orig.y1 + MIN_SIZE), 0, imageNaturalHeight);
      return normalizeBbox({ x1, y1, x2, y2 });
    }

    // draw
    return normalizeBbox({ x1: drag.start.x, y1: drag.start.y, x2: p.x, y2: p.y });
  }, [toSvgPoint, imageNaturalWidth, imageNaturalHeight]);

  // Document-level move/up listeners while a drag is in progress, so dragging
  // keeps working even if pointer capture is lost (e.g. element re-render).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = applyDrag(e);
      if (!next) return;
      if (drag.kind === 'draw') setDrawPreview(next);
      else onChangeRef.current(next);
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = applyDrag(e);
      dragRef.current = null;
      if (!next) return;
      if (drag.kind === 'draw') {
        setDrawPreview(null);
        if (next.x2 - next.x1 >= MIN_SIZE && next.y2 - next.y1 >= MIN_SIZE) {
          onDrawCompleteRef.current?.(next);
        }
      } else {
        onChangeRef.current(next);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [applyDrag]);

  const startDrag = (e: React.PointerEvent<SVGElement>, state: DragState) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = state;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  if (mode === 'idle') return null;

  // Sizes scaled so they look constant regardless of image resolution
  // (parent svg viewBox = natural dims, rendered at arbitrary CSS size).
  const scale = Math.max(imageNaturalWidth, imageNaturalHeight) / 900;
  const handleSize = 8 * scale;
  const strokeW = Math.max(1.5, 2.5 * scale);

  // ── Draw mode ──────────────────────────────────────────────────────────────
  if (mode === 'draw') {
    return (
      <g ref={gRef}>
        {/* Full-bleed capture surface */}
        <rect
          x={0}
          y={0}
          width={imageNaturalWidth}
          height={imageNaturalHeight}
          fill="transparent"
          style={{ cursor: 'crosshair', pointerEvents: 'all', touchAction: 'none' }}
          onPointerDown={(e) => {
            const p = toSvgPoint(e);
            startDrag(e, { kind: 'draw', start: p });
            setDrawPreview({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
          }}
        />
        {drawPreview && (
          <rect
            x={drawPreview.x1}
            y={drawPreview.y1}
            width={drawPreview.x2 - drawPreview.x1}
            height={drawPreview.y2 - drawPreview.y1}
            fill={color}
            fillOpacity={0.12}
            stroke={color}
            strokeWidth={strokeW}
            strokeDasharray={`${6 * scale} ${4 * scale}`}
            pointerEvents="none"
          />
        )}
      </g>
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (!bbox) return null;
  const b = normalizeBbox(bbox);
  const w = b.x2 - b.x1;
  const h = b.y2 - b.y1;

  return (
    <g ref={gRef}>
      {/* Body: drag to reposition */}
      <rect
        x={b.x1}
        y={b.y1}
        width={w}
        height={h}
        fill={color}
        fillOpacity={0.12}
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={`${6 * scale} ${4 * scale}`}
        style={{ cursor: 'move', pointerEvents: 'all', touchAction: 'none' }}
        onPointerDown={(e) => startDrag(e, { kind: 'move', start: toSvgPoint(e), orig: b })}
      />
      {/* 8 resize handles: 4 corners + 4 edge midpoints */}
      {HANDLES.map((hd) => {
        const cx = b.x1 + w * hd.fx;
        const cy = b.y1 + h * hd.fy;
        return (
          <rect
            key={hd.id}
            x={cx - handleSize / 2}
            y={cy - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="white"
            stroke={color}
            strokeWidth={Math.max(1, 1.5 * scale)}
            style={{ cursor: hd.cursor, pointerEvents: 'all', touchAction: 'none' }}
            onPointerDown={(e) => startDrag(e, { kind: 'resize', handle: hd, start: toSvgPoint(e), orig: b })}
          />
        );
      })}
    </g>
  );
}

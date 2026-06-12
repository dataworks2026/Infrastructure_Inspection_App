'use client';

/**
 * ReviewPanel — right-hand sidebar for Engineer Review Mode on the inspection
 * detail page, mirroring the Mira Asset Annotation App layout:
 *   1. IMAGE ASSET TYPE (required when labels exist; saves instantly via PATCH)
 *   2. ANNOTATIONS list (CV detections + engineer drafts)
 *   3. CV detection cards (Accept / Reject / Modify)
 *   4. LABELS editor (classification + structural segments) for the selected
 *      draft or modified CV detection
 * Pure presentation + callbacks; all review state lives in the page.
 */

import { useEffect, useRef } from 'react';
import { Check, X, Pencil, CheckCircle, AlertTriangle, Loader } from 'lucide-react';
import type { Detection, BoundingBox, Severity } from '@/types';
import {
  ASSET_TYPES_BY_CATEGORY,
  DAMAGE_TYPES_BY_CATEGORY,
  SEVERITY_LEVELS,
  STRUCTURAL_SEGMENTS,
  buildAnnotationLabel,
  type IndustryCategory,
} from '@/lib/annotationTaxonomy';

// ─── Shared review-mode types (page-level state shapes) ──────────────────────
export interface LocalDetectionReview {
  action: 'accepted' | 'rejected' | 'modified' | null;
  modifiedBbox?: BoundingBox;
  damageCode?: string;
  severity?: Severity;
  segments?: string[];
  defectId?: string;
  notes?: string;
}

export interface AddedDraft {
  tempId: string;
  bbox: BoundingBox;
  shapeType: 'rect' | 'ellipse';
  damageCode: string;
  severity: Severity | '';
  segments: string[];
  defectId: string;
  notes: string;
}

// Severity colors — Engineer Review Flow spec (must match exactly)
export const REVIEW_SEVERITY_HEX: Record<Severity, string> = {
  S1: '#10b981',
  S2: '#f59e0b',
  S3: '#f97316',
  S4: '#ef4444',
};
const SEVERITY_LABELS: Record<Severity, string> = {
  S1: 'Minor', S2: 'Moderate', S3: 'Advanced', S4: 'Severe',
};

/** Normalize legacy severity values ('S0', '2', …) to S1–S4. */
export const normSeverity = (s: string | null | undefined): Severity => {
  if (!s) return 'S1';
  const map: Record<string, Severity> = {
    S0: 'S1', '0': 'S1', '1': 'S1', '2': 'S2', '3': 'S3', '4': 'S4',
    S1: 'S1', S2: 'S2', S3: 'S3', S4: 'S4',
  };
  return map[s] ?? 'S1';
};

/**
 * Best-effort damage code for a CV detection: explicit domain_metadata.code,
 * else match its damage_type name against the category taxonomy.
 */
export function deriveDamageCode(det: Detection, category: IndustryCategory): string {
  if (det.domain_metadata?.code) return det.domain_metadata.code;
  const name = (det.damage_type || '').toLowerCase().replace(/_/g, ' ').trim();
  if (!name) return '';
  const list = DAMAGE_TYPES_BY_CATEGORY[category];
  const exact = list.find(d => d.label.toLowerCase() === name);
  if (exact) return exact.code;
  const partial = list.find(d =>
    name.includes(d.label.toLowerCase()) || d.label.toLowerCase().includes(name));
  return partial?.code ?? '';
}

/** Segments of a CV detection from domain metadata (plural or legacy singular). */
export function segmentsOf(det: Detection): string[] {
  if (det.domain_metadata?.segments?.length) return det.domain_metadata.segments;
  if (det.domain_metadata?.segment) return [det.domain_metadata.segment];
  return [];
}

function SevBadge({ severity }: { severity: string | null | undefined }) {
  const s = normSeverity(severity);
  const hex = REVIEW_SEVERITY_HEX[s];
  return (
    <span
      className="text-[11px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
      style={{ background: `${hex}1a`, color: hex }}
    >
      {s} {SEVERITY_LABELS[s]}
    </span>
  );
}

// ─── Action buttons (toggleable Accept / Reject / Modify) ────────────────────
const ACTION_STYLES = {
  accepted: {
    on: 'bg-emerald-600 text-white border-emerald-600',
    off: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  },
  rejected: {
    on: 'bg-red-600 text-white border-red-600',
    off: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  },
  modified: {
    on: 'bg-amber-500 text-white border-amber-500',
    off: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  },
} as const;

// ─── LABELS editor (shared by drafts and modified CV detections) ─────────────
interface LabelValues {
  damageCode: string;
  severity: Severity | '';
  segments: string[];
  defectId: string;
  notes: string;
}

function LabelsEditor({ category, value, onPatch, damageSelectRef }: {
  category: IndustryCategory;
  value: LabelValues;
  onPatch: (patch: Partial<LabelValues>) => void;
  damageSelectRef: React.MutableRefObject<HTMLSelectElement | null>;
}) {
  const toggleSegment = (code: string) => {
    onPatch({
      segments: value.segments.includes(code)
        ? value.segments.filter(s => s !== code)
        : [...value.segments, code],
    });
  };

  const inputCls = 'w-full text-xs font-medium border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300';

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Classification</p>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Damage Type</label>
        <select
          ref={damageSelectRef}
          value={value.damageCode}
          onChange={e => onPatch({ damageCode: e.target.value })}
          className={inputCls}
        >
          <option value="">-- Select --</option>
          {DAMAGE_TYPES_BY_CATEGORY[category].map(d => (
            <option key={d.code} value={d.code}>{d.code} - {d.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Severity</label>
        <select
          value={value.severity}
          onChange={e => onPatch({ severity: e.target.value as Severity | '' })}
          className={inputCls}
        >
          <option value="">-- Select --</option>
          {SEVERITY_LEVELS.map(s => (
            <option key={s.sev} value={s.sev}>{s.level} - {s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Structural Segments *</label>
        <p className="text-[11px] text-slate-400 mb-1.5">Select all structural components affected by this damage</p>
        <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md bg-white divide-y divide-slate-50">
          {STRUCTURAL_SEGMENTS.map(seg => (
            <label
              key={seg.code}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={value.segments.includes(seg.code)}
                onChange={() => toggleSegment(seg.code)}
                className="accent-sky-600 flex-shrink-0"
              />
              <span className="flex-1 min-w-0 truncate font-medium">{seg.code} - {seg.name}</span>
              <span className="text-[10px] text-slate-400 flex-shrink-0">{seg.category}</span>
            </label>
          ))}
        </div>
        {value.segments.length === 0 && (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 mt-1.5">
            <AlertTriangle size={12} /> At least one structural segment is required
          </p>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Defect ID (optional)</label>
        <input
          value={value.defectId}
          onChange={e => onPatch({ defectId: e.target.value.toUpperCase() })}
          placeholder="E.G., PIER-CR-001"
          pattern="[A-Z0-9-]*"
          className={`${inputCls} uppercase`}
        />
        <p className="text-[11px] text-slate-400 mt-1">Track this defect across inspections</p>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Notes</label>
        <textarea
          value={value.notes}
          onChange={e => onPatch({ notes: e.target.value })}
          placeholder="Optional notes..."
          rows={2}
          className={`${inputCls} resize-none font-normal`}
        />
      </div>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────
export interface ReviewPanelProps {
  /** All server detections for the current image (CV + engineer_added). */
  detections: Detection[];
  drafts: AddedDraft[];
  states: Record<string, LocalDetectionReview>;
  imageSubmitted: boolean;
  selectedDetectionId: string | null;
  category: IndustryCategory;
  /** Effective asset type for the current image ('' when unset). */
  assetType: string;
  assetTypeSaving: boolean;
  /** Labels exist but no asset type — highlight the select as required. */
  assetTypeMissing: boolean;
  /** Incremented by the page after a draw — scrolls to LABELS and focuses Damage Type. */
  labelsFocusToken: number;
  /** What is still blocking Save (shown inline at the bottom). */
  missingHints: string[];
  onAssetTypeChange: (assetType: string) => void;
  onSelectDetection: (id: string) => void;
  onAction: (det: Detection, action: 'accepted' | 'rejected' | 'modified') => void;
  onUpdateState: (detId: string, patch: Partial<LocalDetectionReview>) => void;
  onUpdateDraft: (tempId: string, patch: Partial<AddedDraft>) => void;
  onRemoveDraft: (tempId: string) => void;
}

export default function ReviewPanel({
  detections,
  drafts,
  states,
  imageSubmitted,
  selectedDetectionId,
  category,
  assetType,
  assetTypeSaving,
  assetTypeMissing,
  labelsFocusToken,
  missingHints,
  onAssetTypeChange,
  onSelectDetection,
  onAction,
  onUpdateState,
  onUpdateDraft,
  onRemoveDraft,
}: ReviewPanelProps) {
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const damageSelectRef = useRef<HTMLSelectElement>(null) as React.MutableRefObject<HTMLSelectElement | null>;

  const cvDetections = detections.filter(d => d.source !== 'engineer_added');
  const actionedCount = cvDetections.filter(d => states[d.id]?.action).length;

  // After a draw, scroll to the LABELS section and focus the Damage Type select.
  useEffect(() => {
    if (labelsFocusToken <= 0) return;
    const t = setTimeout(() => {
      labelsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      damageSelectRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [labelsFocusToken]);

  // ── Read-only view for already-submitted images ────────────────────────────
  if (imageSubmitted) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">Review</h3>
        <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5 mb-3">
          <CheckCircle size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-semibold text-emerald-800">Reviewed — this image&apos;s review has been submitted.</p>
        </div>
        <div className="space-y-2">
          {detections.map(d => (
            <div key={d.id} className="bg-white rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-700 truncate">{d.damage_type}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {d.source === 'engineer_added' ? (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">NEW</span>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">CV</span>
                  )}
                  <SevBadge severity={d.severity} />
                </div>
              </div>
            </div>
          ))}
          {detections.length === 0 && (
            <p className="text-sm text-slate-400">No detections on this image.</p>
          )}
        </div>
      </div>
    );
  }

  // ── Selected item resolution ────────────────────────────────────────────────
  const selectedDraft = drafts.find(d => d.tempId === selectedDetectionId) ?? null;
  const selectedCvDet = selectedDraft
    ? null
    : cvDetections.find(d => d.id === selectedDetectionId) ?? null;
  const selectedModified =
    selectedCvDet && states[selectedCvDet.id]?.action === 'modified' ? selectedCvDet : null;
  const labelsTarget = selectedDraft ?? selectedModified;

  // Annotation list labels
  const cvListLabel = (d: Detection, idx: number): string => {
    const st = states[d.id];
    const code = st?.action === 'modified'
      ? (st.damageCode || deriveDamageCode(d, category))
      : deriveDamageCode(d, category);
    const segs = st?.action === 'modified' ? (st.segments ?? []) : segmentsOf(d);
    const sev = st?.action === 'modified' ? (st.severity ?? normSeverity(d.severity)) : normSeverity(d.severity);
    const label = buildAnnotationLabel({ damageCode: code || null, severity: sev, segments: segs });
    return label || `CV Detection ${idx + 1}`;
  };

  let boxN = 0;
  let ovalN = 0;
  const draftNames = drafts.map(d => (d.shapeType === 'ellipse' ? `Oval ${++ovalN}` : `Box ${++boxN}`));

  // LABELS editor values + patch routing
  const labelValues: LabelValues | null = selectedDraft
    ? {
        damageCode: selectedDraft.damageCode,
        severity: selectedDraft.severity,
        segments: selectedDraft.segments,
        defectId: selectedDraft.defectId,
        notes: selectedDraft.notes,
      }
    : selectedModified
      ? {
          damageCode: states[selectedModified.id]?.damageCode ?? '',
          severity: states[selectedModified.id]?.severity ?? normSeverity(selectedModified.severity),
          segments: states[selectedModified.id]?.segments ?? [],
          defectId: states[selectedModified.id]?.defectId ?? '',
          notes: states[selectedModified.id]?.notes ?? '',
        }
      : null;

  const patchLabels = (patch: Partial<LabelValues>) => {
    if (selectedDraft) {
      onUpdateDraft(selectedDraft.tempId, patch);
    } else if (selectedModified) {
      // LocalDetectionReview stores severity as Severity | undefined ('' → unset)
      const { severity, ...rest } = patch;
      onUpdateState(selectedModified.id, {
        ...rest,
        ...(severity !== undefined ? { severity: severity === '' ? undefined : severity } : {}),
      });
    }
  };

  // ── Active review view ──────────────────────────────────────────────────────
  return (
    <div className="p-4 flex flex-col max-h-[calc(100vh-260px)]">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
        {/* 1 ── IMAGE ASSET TYPE ─────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Image Asset Type *</h3>
            {assetTypeSaving && <Loader size={12} className="animate-spin text-sky-500" />}
          </div>
          <select
            value={assetType}
            onChange={e => onAssetTypeChange(e.target.value)}
            className={`w-full text-xs font-medium rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none border ${
              assetTypeMissing ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-sky-300'
            }`}
          >
            <option value="">-- Select Asset Type --</option>
            {ASSET_TYPES_BY_CATEGORY[category].map(a => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          {assetTypeMissing && (
            <p className="flex items-center gap-1 text-[11px] font-semibold text-red-600 mt-1">
              <AlertTriangle size={12} /> Required: Select asset type before saving annotations
            </p>
          )}
        </div>

        {/* 2 ── ANNOTATIONS list ─────────────────────────────────────────────── */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            Annotations ({cvDetections.length + drafts.length})
          </h3>
          <div className="border border-slate-200 rounded-md bg-white divide-y divide-slate-50">
            {cvDetections.length === 0 && drafts.length === 0 && (
              <p className="text-xs text-slate-400 px-2 py-2">
                No annotations — use the Box or Oval tool to add detections the model missed.
              </p>
            )}
            {cvDetections.map((d, i) => (
              <button
                key={d.id}
                onClick={() => onSelectDetection(d.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                  selectedDetectionId === d.id ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1 py-0.5 rounded flex-shrink-0">CV</span>
                <span className="flex-1 min-w-0 truncate font-medium">{cvListLabel(d, i)}</span>
                {states[d.id]?.action && (
                  <span className={`text-[10px] font-bold flex-shrink-0 ${
                    states[d.id].action === 'accepted' ? 'text-emerald-600' :
                    states[d.id].action === 'rejected' ? 'text-red-500' : 'text-amber-600'
                  }`}>
                    {states[d.id].action === 'accepted' ? '✓' : states[d.id].action === 'rejected' ? '✗' : '✎'}
                  </span>
                )}
              </button>
            ))}
            {drafts.map((d, i) => (
              <div
                key={d.tempId}
                onClick={() => onSelectDetection(d.tempId)}
                className={`flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                  selectedDetectionId === d.tempId ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded flex-shrink-0">NEW</span>
                <span className="flex-1 min-w-0 truncate font-medium">
                  {draftNames[i]}{d.damageCode ? ` — ${d.damageCode}` : ''}
                </span>
                <button
                  title="Remove draft"
                  onClick={e => { e.stopPropagation(); onRemoveDraft(d.tempId); }}
                  className="p-0.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 3 ── CV detection cards ───────────────────────────────────────────── */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            CV Detections
            <span className="ml-2 font-mono text-slate-400 normal-case">{actionedCount}/{cvDetections.length}</span>
          </h3>
          <div className="space-y-2">
            {cvDetections.length === 0 && (
              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                No CV detections on this image.
              </p>
            )}
            {cvDetections.map(det => {
              const st = states[det.id];
              const action = st?.action ?? null;
              const selected = selectedDetectionId === det.id;
              return (
                <div
                  key={det.id}
                  onClick={() => onSelectDetection(det.id)}
                  className={`bg-white rounded-lg border p-3 cursor-pointer transition-all ${
                    selected ? 'border-sky-300 ring-2 ring-sky-200' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-bold text-slate-700 truncate">{det.damage_type}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SevBadge severity={det.severity} />
                      <span className="text-xs font-mono text-slate-400">{Math.round(det.confidence * 100)}%</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      onClick={e => { e.stopPropagation(); onAction(det, 'accepted'); }}
                      className={`flex items-center justify-center gap-1 text-xs font-semibold border rounded-md py-1.5 transition-all ${
                        action === 'accepted' ? ACTION_STYLES.accepted.on : ACTION_STYLES.accepted.off
                      }`}
                    >
                      <Check size={13} /> Accept
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onAction(det, 'rejected'); }}
                      className={`flex items-center justify-center gap-1 text-xs font-semibold border rounded-md py-1.5 transition-all ${
                        action === 'rejected' ? ACTION_STYLES.rejected.on : ACTION_STYLES.rejected.off
                      }`}
                    >
                      <X size={13} /> Reject
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onAction(det, 'modified'); }}
                      className={`flex items-center justify-center gap-1 text-xs font-semibold border rounded-md py-1.5 transition-all ${
                        action === 'modified' ? ACTION_STYLES.modified.on : ACTION_STYLES.modified.off
                      }`}
                    >
                      <Pencil size={13} /> Modify
                    </button>
                  </div>

                  {action === 'modified' && (
                    <p className="text-[11px] text-amber-700 font-medium mt-2">
                      Edit the box on the image and fill in the LABELS section below.
                    </p>
                  )}

                  {/* Per-detection notes for accepted / rejected */}
                  {(action === 'accepted' || action === 'rejected') && (
                    <input
                      value={st?.notes ?? ''}
                      onChange={e => onUpdateState(det.id, { notes: e.target.value })}
                      onClick={e => e.stopPropagation()}
                      placeholder="Notes (optional)"
                      className="mt-2 w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 4 ── LABELS ───────────────────────────────────────────────────────── */}
        {labelsTarget && labelValues && (
          <div
            ref={labelsRef}
            className={`rounded-lg border p-3 ${
              selectedDraft ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'
            }`}
          >
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Labels — {selectedDraft
                ? draftNames[drafts.findIndex(d => d.tempId === selectedDraft.tempId)]
                : `Modified: ${selectedModified?.damage_type}`}
            </h3>
            <LabelsEditor
              category={category}
              value={labelValues}
              onPatch={patchLabels}
              damageSelectRef={damageSelectRef}
            />
          </div>
        )}
      </div>

      {/* ── Save gating hints ── */}
      {missingHints.length > 0 && (
        <div className="pt-3 mt-3 border-t border-slate-200 flex-shrink-0">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-[11px] font-bold text-amber-800 mb-1">Before saving this image:</p>
            <ul className="space-y-0.5">
              {missingHints.map((h, i) => (
                <li key={i} className="text-[11px] text-amber-700 flex items-start gap-1">
                  <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> {h}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * ReviewPanel — right-hand sidebar for Engineer Review Mode on the inspection
 * detail page. Pure presentation + callbacks; all review state lives in the page.
 */

import { useState } from 'react';
import { Check, X, Pencil, Plus, Trash2, Loader, CheckCircle, Move } from 'lucide-react';
import type { Detection, BoundingBox, Severity } from '@/types';

// ─── Shared review-mode types (page-level state shapes) ──────────────────────
export interface LocalDetectionReview {
  action: 'accepted' | 'rejected' | 'modified' | null;
  modifiedBbox?: BoundingBox;
  damageType?: string;
  severity?: Severity;
  notes?: string;
}

export interface AddedDraft {
  tempId: string;
  bbox: BoundingBox;
  damageType: string;
  severity: Severity;
  notes: string;
}

export const FIXED_DAMAGE_TYPES = [
  'corrosion', 'crack', 'spalling', 'rust', 'erosion', 'vegetation', 'structural_damage',
];

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
const SEVERITIES: Severity[] = ['S1', 'S2', 'S3', 'S4'];

/** Normalize legacy severity values ('S0', '2', …) to S1–S4. */
export const normSeverity = (s: string | null | undefined): Severity => {
  if (!s) return 'S1';
  const map: Record<string, Severity> = {
    S0: 'S1', '0': 'S1', '1': 'S1', '2': 'S2', '3': 'S3', '4': 'S4',
    S1: 'S1', S2: 'S2', S3: 'S3', S4: 'S4',
  };
  return map[s] ?? 'S1';
};

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

// ─── Damage type select with free-text option ────────────────────────────────
function DamageTypeSelect({ value, options, onChange }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const inList = options.includes(value);
  const [custom, setCustom] = useState(!inList && value !== '');
  const showCustom = custom || (!inList && value !== '');
  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={showCustom ? '__custom__' : value}
        onChange={e => {
          if (e.target.value === '__custom__') { setCustom(true); onChange(''); }
          else { setCustom(false); onChange(e.target.value); }
        }}
        className="w-full text-xs font-medium border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300"
      >
        {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        <option value="__custom__">Other (type below)…</option>
      </select>
      {showCustom && (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Custom damage type"
          className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300"
        />
      )}
    </div>
  );
}

function SeveritySelect({ value, onChange }: { value: Severity; onChange: (s: Severity) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as Severity)}
      className="w-full text-xs font-medium border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300"
    >
      {SEVERITIES.map(s => (
        <option key={s} value={s}>{s} — {SEVERITY_LABELS[s]}</option>
      ))}
    </select>
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

// ─── Props ───────────────────────────────────────────────────────────────────
export interface ReviewPanelProps {
  /** All server detections for the current image (CV + engineer_added). */
  detections: Detection[];
  drafts: AddedDraft[];
  states: Record<string, LocalDetectionReview>;
  imageSubmitted: boolean;
  selectedDetectionId: string | null;
  editingDetId: string | null;
  drawingNew: boolean;
  damageTypeOptions: string[];
  submitting: boolean;
  canSubmit: boolean;
  onSelectDetection: (id: string) => void;
  onAction: (det: Detection, action: 'accepted' | 'rejected' | 'modified') => void;
  onUpdateState: (detId: string, patch: Partial<LocalDetectionReview>) => void;
  onToggleEditBbox: (detId: string) => void;
  onStartDraw: () => void;
  onCancelDraw: () => void;
  onUpdateDraft: (tempId: string, patch: Partial<AddedDraft>) => void;
  onRemoveDraft: (tempId: string) => void;
  onSubmit: () => void;
}

export default function ReviewPanel({
  detections,
  drafts,
  states,
  imageSubmitted,
  selectedDetectionId,
  editingDetId,
  drawingNew,
  damageTypeOptions,
  submitting,
  canSubmit,
  onSelectDetection,
  onAction,
  onUpdateState,
  onToggleEditBbox,
  onStartDraw,
  onCancelDraw,
  onUpdateDraft,
  onRemoveDraft,
  onSubmit,
}: ReviewPanelProps) {
  const cvDetections = detections.filter(d => d.source !== 'engineer_added');
  const actionedCount = cvDetections.filter(d => states[d.id]?.action).length;

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

  // ── Active review view ──────────────────────────────────────────────────────
  return (
    <div className="p-4 flex flex-col max-h-[calc(100vh-260px)]">
      <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3 flex-shrink-0">
        Review Detections
        <span className="ml-2 text-xs font-mono text-slate-400 normal-case">{actionedCount}/{cvDetections.length}</span>
      </h3>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {cvDetections.length === 0 && (
          <p className="text-sm text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
            No CV detections on this image. You can still add detections the model missed.
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

              {/* Action buttons */}
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

              {/* Inline modify form */}
              {action === 'modified' && st && (
                <div className="mt-2 space-y-2 bg-amber-50/60 border border-amber-100 rounded-lg p-2.5" onClick={e => e.stopPropagation()}>
                  <DamageTypeSelect
                    value={st.damageType ?? ''}
                    options={damageTypeOptions}
                    onChange={v => onUpdateState(det.id, { damageType: v })}
                  />
                  <SeveritySelect
                    value={st.severity ?? normSeverity(det.severity)}
                    onChange={s => onUpdateState(det.id, { severity: s })}
                  />
                  <button
                    onClick={() => onToggleEditBbox(det.id)}
                    className={`w-full flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-md py-1.5 transition-all ${
                      editingDetId === det.id
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    <Move size={13} /> {editingDetId === det.id ? 'Done editing box' : 'Edit box on image'}
                  </button>
                </div>
              )}

              {/* Notes */}
              <input
                value={st?.notes ?? ''}
                onChange={e => onUpdateState(det.id, { notes: e.target.value })}
                onClick={e => e.stopPropagation()}
                placeholder="Notes (optional)"
                className="mt-2 w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300"
              />
            </div>
          );
        })}

        {/* ── Engineer-added drafts ── */}
        <div className="pt-3 border-t border-slate-200">
          {drawingNew ? (
            <button
              onClick={onCancelDraw}
              className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg py-2 hover:bg-slate-200 transition-all"
            >
              <X size={15} /> Cancel drawing
            </button>
          ) : (
            <button
              onClick={onStartDraw}
              className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-dashed border-emerald-300 rounded-lg py-2 hover:bg-emerald-100 transition-all"
            >
              <Plus size={15} /> Add Detection
            </button>
          )}

          <div className="space-y-2 mt-2">
            {drafts.map(d => {
              const selected = selectedDetectionId === d.tempId;
              return (
                <div
                  key={d.tempId}
                  onClick={() => onSelectDetection(d.tempId)}
                  className={`bg-white rounded-lg border p-3 cursor-pointer transition-all ${
                    selected ? 'border-emerald-300 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">NEW</span>
                    <div className="flex items-center gap-1">
                      <button
                        title="Edit box on image"
                        onClick={e => { e.stopPropagation(); onToggleEditBbox(d.tempId); }}
                        className={`p-1 rounded transition-all ${
                          editingDetId === d.tempId ? 'bg-emerald-600 text-white' : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        <Move size={13} />
                      </button>
                      <button
                        title="Remove"
                        onClick={e => { e.stopPropagation(); onRemoveDraft(d.tempId); }}
                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2" onClick={e => e.stopPropagation()}>
                    <DamageTypeSelect
                      value={d.damageType}
                      options={damageTypeOptions}
                      onChange={v => onUpdateDraft(d.tempId, { damageType: v })}
                    />
                    <SeveritySelect value={d.severity} onChange={s => onUpdateDraft(d.tempId, { severity: s })} />
                    <input
                      value={d.notes}
                      onChange={e => onUpdateDraft(d.tempId, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-sky-300"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Submit ── */}
      <div className="pt-3 mt-3 border-t border-slate-200 flex-shrink-0">
        <p className="text-xs text-slate-500 mb-2 font-medium">
          {actionedCount} / {cvDetections.length} detections actioned
          {drafts.length > 0 && ` · ${drafts.length} added`}
        </p>
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm py-2.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? <Loader size={15} className="animate-spin" /> : <Check size={15} />}
          Submit Review for This Image
        </button>
      </div>
    </div>
  );
}

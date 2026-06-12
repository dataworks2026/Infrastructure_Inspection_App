'use client';

/**
 * ReviewToolbar — annotation-app style toolbar rendered above the review canvas.
 * Tools: Select (V) / Box (B) / Oval (O) / Delete (Del), bulk Accept/Reject,
 * progress, unsaved indicator and the per-image Save (submit) button.
 * Pure presentation; all state lives in the inspection detail page.
 */

import {
  MousePointer2, Square, Circle, Trash2, Check, X, Loader, Save,
} from 'lucide-react';

export type ReviewTool = 'select' | 'box' | 'oval';

export interface ReviewToolbarProps {
  tool: ReviewTool;
  onToolChange: (tool: ReviewTool) => void;
  /** Selected item is an engineer draft (deletable). CV detections are never deletable. */
  canDelete: boolean;
  onDelete: () => void;
  reviewedImages: number;
  totalImages: number;
  /** Current image has local (not yet submitted) review state. */
  hasUnsaved: boolean;
  /** CV detections on the current image without an Accept/Reject/Modify choice. */
  unactionedCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  canSubmit: boolean;
  submitting: boolean;
  /** Human-readable list of what is still blocking Save. */
  missingHints: string[];
  onSubmit: () => void;
}

const TOOLS: { id: ReviewTool; label: string; shortcut: string; Icon: typeof Square }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 },
  { id: 'box', label: 'Box', shortcut: 'B', Icon: Square },
  { id: 'oval', label: 'Oval', shortcut: 'O', Icon: Circle },
];

export default function ReviewToolbar({
  tool,
  onToolChange,
  canDelete,
  onDelete,
  reviewedImages,
  totalImages,
  hasUnsaved,
  unactionedCount,
  onAcceptAll,
  onRejectAll,
  canSubmit,
  submitting,
  missingHints,
  onSubmit,
}: ReviewToolbarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2 border-b border-slate-100 bg-white">
      {/* Tool group */}
      <div className="flex items-center gap-1">
        {TOOLS.map(({ id, label, shortcut, Icon }) => (
          <button
            key={id}
            title={`${label} (${shortcut})`}
            onClick={() => onToolChange(id)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-all ${
              tool === id
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Icon size={14} /> {label}
            <span className={`text-[10px] font-mono ${tool === id ? 'text-sky-100' : 'text-slate-400'}`}>{shortcut}</span>
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-slate-200" />

      <button
        title={canDelete ? 'Delete selected draft (Del)' : 'Delete is only available for unsaved engineer drafts — reject CV detections instead'}
        onClick={onDelete}
        disabled={!canDelete}
        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border bg-white text-red-600 border-red-200 hover:bg-red-50 transition-all disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white"
      >
        <Trash2 size={14} /> Delete
      </button>

      <div className="w-px h-6 bg-slate-200" />

      {/* Progress + unsaved */}
      <span className="text-xs font-mono font-semibold text-slate-500 whitespace-nowrap">
        {reviewedImages} / {totalImages} images reviewed
      </span>
      {hasUnsaved && (
        <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">Unsaved changes</span>
      )}

      <div className="flex-1" />

      {/* Bulk actions */}
      <button
        title="Accept all unactioned CV detections on this image (does not override choices you already made)"
        onClick={onAcceptAll}
        disabled={unactionedCount === 0}
        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <Check size={14} /> Accept All
      </button>
      <button
        title="Reject all unactioned CV detections on this image (does not override choices you already made)"
        onClick={onRejectAll}
        disabled={unactionedCount === 0}
        className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition-all disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <X size={14} /> Reject All
      </button>

      <div className="w-px h-6 bg-slate-200" />

      <button
        title={canSubmit ? 'Submit review for this image' : missingHints.join('\n') || 'Nothing to submit'}
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
        Save
      </button>
    </div>
  );
}

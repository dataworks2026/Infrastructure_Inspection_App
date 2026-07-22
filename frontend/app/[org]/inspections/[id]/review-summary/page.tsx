'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from '@/components/OrgLink';
import {
  ArrowLeft, CheckCircle, Pencil,
  FileDown, FileJson, ClipboardList, AlertCircle, Check, X, Plus, Loader2,
} from 'lucide-react';
import { reviewApi, inspectionsApi } from '@/lib/api';
import type {
  ReviewAction,
  ModificationDelta,
  ModificationEntry,
  PerImageDiff,
  DamageTypeAccuracy,
} from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Gauge / accuracy color by range: <50 red, <75 amber, <90 green, ≥90 emerald */
function accuracyColor(pct: number): { hex: string; text: string; bg: string } {
  if (pct < 50) return { hex: '#ef4444', text: 'text-red-500',     bg: 'bg-red-500'     };
  if (pct < 75) return { hex: '#f59e0b', text: 'text-amber-500',   bg: 'bg-amber-500'   };
  if (pct < 90) return { hex: '#22c55e', text: 'text-green-500',   bg: 'bg-green-500'   };
  return              { hex: '#10b981', text: 'text-emerald-500', bg: 'bg-emerald-500' };
}

const actionBadgeStyles: Record<ReviewAction, string> = {
  accepted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  modified: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  added:    'bg-sky-500/15 text-sky-400 border-sky-500/30',
};

const actionLabels: Record<ReviewAction, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  modified: 'Modified',
  added:    'Engineer Added',
};

function ActionBadge({ action }: { action: ReviewAction }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${actionBadgeStyles[action]}`}>
      {actionLabels[action]}
    </span>
  );
}

const severityLabel = (s: string): string => {
  const map: Record<string, string> = { S1: 'Minor', S2: 'Moderate', S3: 'Advanced', S4: 'Severe' };
  return map[s] ? `${s} (${map[s]})` : s;
};

/** Human-readable change descriptions from a ModificationDelta */
function describeDelta(delta: ModificationDelta): string[] {
  const parts: string[] = [];
  if (delta.bbox_changed) {
    if (delta.bbox_before && delta.bbox_after) {
      const dx = Math.round(
        Math.max(
          Math.abs(delta.bbox_after.x1 - delta.bbox_before.x1),
          Math.abs(delta.bbox_after.y1 - delta.bbox_before.y1),
          Math.abs(delta.bbox_after.x2 - delta.bbox_before.x2),
          Math.abs(delta.bbox_after.y2 - delta.bbox_before.y2),
        )
      );
      parts.push(dx > 0 ? `Bbox repositioned (moved up to ${dx}px)` : 'Bbox repositioned');
    } else {
      parts.push('Bbox repositioned');
    }
  }
  if (delta.severity_changed) {
    parts.push(
      delta.severity_before && delta.severity_after
        ? `Severity ${severityLabel(delta.severity_before)} → ${severityLabel(delta.severity_after)}`
        : 'Severity changed'
    );
  }
  if (delta.damage_type_changed) {
    parts.push(
      delta.damage_type_before && delta.damage_type_after
        ? `Damage type ${delta.damage_type_before} → ${delta.damage_type_after}`
        : 'Damage type changed'
    );
  }
  return parts.length > 0 ? parts : ['Detection updated'];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}


// ─── Per-image action chips ──────────────────────────────────────────────────

function ActionChips({ image }: { image: PerImageDiff }) {
  const counts: Record<ReviewAction, number> = { accepted: 0, rejected: 0, modified: 0, added: 0 };
  image.actions.forEach(a => { counts[a.action] += 1; });

  const chips: { key: ReviewAction; icon: React.ReactNode; cls: string }[] = [
    { key: 'accepted', icon: <Check className="w-3 h-3" />,  cls: 'bg-emerald-500/15 text-emerald-400' },
    { key: 'rejected', icon: <X className="w-3 h-3" />,      cls: 'bg-red-500/15 text-red-400' },
    { key: 'modified', icon: <Pencil className="w-3 h-3" />, cls: 'bg-amber-500/15 text-amber-400' },
    { key: 'added',    icon: <Plus className="w-3 h-3" />,   cls: 'bg-sky-500/15 text-sky-400' },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {chips.map(c => counts[c.key] > 0 && (
        <span key={c.key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${c.cls}`} title={actionLabels[c.key]}>
          {c.icon}{counts[c.key]}
        </span>
      ))}
      {image.actions.length === 0 && <span className="text-xs text-card-faint">—</span>}
    </div>
  );
}

// ─── Accuracy badge with mini bar ────────────────────────────────────────────

function AccuracyBadge({ pct }: { pct: number }) {
  const { text, bg } = accuracyColor(pct);
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 rounded-full bg-card-border overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className={`text-sm font-mono font-semibold ${text}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReviewSummaryPage() {
  const params = useParams();
  const inspectionId = params.id as string;
  const [exporting, setExporting] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: inspection } = useQuery({
    queryKey: ['inspection', inspectionId],
    queryFn: () => inspectionsApi.get(inspectionId),
  });

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await reviewApi.downloadReviewReport(inspectionId);
      const dispo = res.headers['content-disposition'] as string | undefined;
      const filename =
        dispo?.match(/filename="?([^";]+)"?/)?.[1] ||
        `${inspection?.name || inspectionId}_review_report.pdf`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Failed to generate the review report PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportJson = async () => {
    if (exportingJson) return;
    setExportingJson(true);
    setExportError(null);
    try {
      const res = await reviewApi.downloadReviewExport(inspectionId);
      const dispo = res.headers['content-disposition'] as string | undefined;
      const filename =
        dispo?.match(/filename="?([^";]+)"?/)?.[1] ||
        `${inspection?.name || inspectionId}_review_export.json`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Failed to generate the review export JSON. Please try again.');
    } finally {
      setExportingJson(false);
    }
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['review-diff', inspectionId],
    queryFn: () => reviewApi.getReviewDiff(inspectionId),
  });

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-card-border/60" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-card-dark border border-card-border" />
          ))}
        </div>
        <div className="h-48 rounded-xl bg-card-dark border border-card-border" />
        <div className="h-64 rounded-xl bg-card-dark border border-card-border" />
      </div>
    );
  }

  // ── Error ──
  if (isError) {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Failed to load review summary</h2>
        <p className="text-sm text-slate-500 mb-4">{detail || 'An unexpected error occurred while fetching the review diff.'}</p>
        <Link href={`/inspections/${inspectionId}`} className="inline-flex items-center gap-2 text-sm text-mira-blue hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Inspection
        </Link>
      </div>
    );
  }

  // ── Empty (no reviews yet) ──
  const hasReviews = data && (data.totals.cv_detections > 0 || data.totals.engineer_added > 0 || data.per_image.some(i => i.actions.length > 0));
  if (!data || !hasReviews) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ClipboardList className="w-10 h-10 text-slate-400 mb-3" />
        <h2 className="text-lg font-semibold text-slate-800 mb-1">No review data yet</h2>
        <p className="text-sm text-slate-500 mb-4 max-w-md">
          This inspection has not been reviewed by an engineer yet. Start a review from the inspection detail page to capture CV corrections.
        </p>
        <Link href={`/inspections/${inspectionId}`} className="inline-flex items-center gap-2 text-sm text-mira-blue hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Inspection
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* ── 1. Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/inspections/${inspectionId}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-2 print:hidden"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Inspection
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-800">
              Review Summary{inspection ? ` — ${inspection.name}` : ''}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle className="w-3.5 h-3.5" /> Review Completed
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Reviewed by <span className="font-medium text-slate-700">{data.reviewed_by || 'Unknown'}</span>
            {' '}on <span className="font-medium text-slate-700">{formatDate(data.reviewed_at)}</span>
          </p>
        </div>

        {/* ── 6. Export — downloads the dedicated Engineer Review Report PDF */}
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJson}
              disabled={exportingJson}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-card-border bg-card-dark text-card-text text-sm font-semibold hover:bg-card-border/40 transition-colors print:hidden disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exportingJson
                ? (<><Loader2 className="w-4 h-4 animate-spin" /> Generating JSON…</>)
                : (<><FileJson className="w-4 h-4" /> Export JSON</>)}
            </button>
            <button
              onClick={handleExportPdf}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-mira-blue text-white text-sm font-semibold hover:opacity-90 transition-opacity print:hidden disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exporting
                ? (<><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF…</>)
                : (<><FileDown className="w-4 h-4" /> Export PDF</>)}
            </button>
          </div>
          {exportError && (
            <span className="text-xs text-red-400">{exportError}</span>
          )}
        </div>
      </div>

      {/* ── 4. Per-image breakdown ──────────────────────────────────────── */}
      <div className="bg-card-dark border border-card-border rounded-xl shadow-card-dark overflow-hidden">
        <div className="px-6 py-4 border-b border-card-border">
          <h2 className="text-sm font-semibold text-card-muted uppercase tracking-wider">Per-Image Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-card-faint uppercase tracking-wider border-b border-card-border">
                <th className="px-6 py-3 font-semibold">Image</th>
                <th className="px-4 py-3 font-semibold text-right">Detections</th>
                <th className="px-4 py-3 font-semibold text-right">Final Verified</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
                <th className="px-6 py-3 font-semibold">Verified</th>
              </tr>
            </thead>
            <tbody>
              {data.per_image.map(img => (
                <tr key={img.image_id} className="border-b border-card-border/50 last:border-0 hover:bg-card-border/20 transition-colors">
                  <td className="px-6 py-3 font-medium text-card-text font-mono text-xs">{img.filename}</td>
                  <td className="px-4 py-3 text-right font-mono text-card-muted">{img.cv_count}</td>
                  <td className="px-4 py-3 text-right font-mono text-card-text">{img.final_count}</td>
                  <td className="px-4 py-3"><ActionChips image={img} /></td>
                  <td className="px-6 py-3"><AccuracyBadge pct={img.accuracy_pct} /></td>
                </tr>
              ))}
              {data.per_image.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-card-faint">No image-level data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 6. Modification log ─────────────────────────────────────────── */}
      <div className="bg-card-dark border border-card-border rounded-xl shadow-card-dark overflow-hidden">
        <div className="px-6 py-4 border-b border-card-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-card-muted uppercase tracking-wider">Modification Log</h2>
          <span className="text-xs text-card-faint font-mono">{data.modifications.length} change{data.modifications.length === 1 ? '' : 's'}</span>
        </div>
        {data.modifications.length === 0 ? (
          <div className="px-6 py-8 text-center text-card-faint text-sm">
            No modifications — all CV detections were accepted or rejected without changes.
          </div>
        ) : (
          <ul className="divide-y divide-card-border/50">
            {data.modifications.map((mod: ModificationEntry, i: number) => (
              <li key={`${mod.cv_detection_id}-${i}`} className="px-6 py-4 hover:bg-card-border/20 transition-colors">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span className="font-mono text-xs text-card-text">{mod.image_filename}</span>
                  <ActionBadge action="modified" />
                </div>
                <ul className="flex flex-wrap gap-2 mb-1">
                  {describeDelta(mod.delta).map((desc, j) => (
                    <li key={j} className="inline-flex items-center px-2 py-0.5 rounded bg-card-border/40 text-xs text-card-muted font-mono">
                      {desc}
                    </li>
                  ))}
                </ul>
                {mod.notes && (
                  <p className="text-sm text-card-faint italic mt-1.5">&ldquo;{mod.notes}&rdquo;</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

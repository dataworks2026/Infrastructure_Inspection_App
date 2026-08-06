'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Download, AlertTriangle, Loader2,
  CheckCircle2, ChevronRight, ImageIcon,
} from 'lucide-react';

import { inspectionsApi, reportsApi } from '@/lib/api';
import type { ReportPreview, ReportNarrative } from '@/lib/api';
import type { Inspection } from '@/types';

const TEAL    = '#082E29';
const MINT    = '#6B9A87';
const BORDER  = '#E2EDE8';
const SURFACE = '#F8FAFB';
const BRAND   = '#0891B2';

const SEV_COLOR: Record<string, string> = {
  '1 - Minor':    '#16a34a',
  '2 - Moderate': '#d97706',
  '3 - Advanced': '#ea580c',
  '4 - Severe':   '#dc2626',
};

const RISK_COLOR: Record<string, string> = {
  critical: '#dc2626',
  high:     '#ea580c',
  medium:   '#d97706',
  low:      '#16a34a',
};

const STATUS_LABELS: Record<string, string> = {
  pending:          'Pending',
  processing:       'Processing',
  completed:        'Completed',
  pending_review:   'Review In Progress',
  review_completed: 'Review Completed',
  failed:           'Failed',
};

function humanizeStatus(s: string): string {
  if (!s) return '—';
  return (
    STATUS_LABELS[s] ||
    s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );
}

export default function ReportsPage() {
  const [selectedId, setSelectedId] = useState<string>('');

  const inspectionsQ = useQuery({
    queryKey: ['inspections', 'for-reports'],
    queryFn:  () => inspectionsApi.list(),
  });

  const previewQ = useQuery<ReportPreview>({
    queryKey: ['report-preview', selectedId],
    queryFn:  () => reportsApi.preview(selectedId),
    enabled:  Boolean(selectedId),
    retry:    false,
  });

  const inspections = inspectionsQ.data ?? [];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-[24px] font-black mb-1" style={{ color: TEAL }}>
          Reports
        </h1>
        <p className="text-[13px]" style={{ color: MINT }}>
          Generate PDF inspection reports from completed inspections.
        </p>
      </div>

      <InspectionPicker
        inspections={inspections}
        loading={inspectionsQ.isLoading}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {!selectedId && !inspectionsQ.isLoading && inspections.length === 0 && (
        <EmptyHint />
      )}

      {selectedId && (
        <PreviewArea
          inspectionId={selectedId}
          preview={previewQ.data}
          loading={previewQ.isLoading}
          error={previewQ.error as any}
        />
      )}
    </div>
  );
}


function InspectionPicker({
  inspections, loading, selectedId, onSelect,
}: {
  inspections: Inspection[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="bg-white rounded-xl border p-5 mb-6 shadow-card-dark"
      style={{ borderColor: BORDER }}
    >
      <label className="block text-[12px] font-bold mb-2" style={{ color: TEAL }}>
        SELECT INSPECTION
      </label>
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        disabled={loading || inspections.length === 0}
        className="w-full px-3 py-2.5 rounded-lg border text-[14px] bg-white disabled:bg-slate-50 disabled:text-slate-400"
        style={{ borderColor: BORDER, color: TEAL }}
      >
        <option value="">
          {loading
            ? 'Loading inspections…'
            : inspections.length === 0
              ? 'No inspections yet'
              : 'Choose an inspection…'}
        </option>
        {inspections.map((i) => {
          const date = new Date(i.inspected_at || i.created_at)
            .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
          const imagePart = i.image_count
            ? ` · ${i.image_count} image${i.image_count === 1 ? '' : 's'}`
            : '';
          return (
            <option key={i.id} value={i.id}>
              {i.name || i.id.slice(0, 8)}{imagePart} · {date} · {humanizeStatus(i.status)}
            </option>
          );
        })}
      </select>
    </div>
  );
}


function EmptyHint() {
  return (
    <div
      className="text-center py-16 bg-white rounded-xl border"
      style={{ borderColor: BORDER }}
    >
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-3"
        style={{ background: SURFACE }}
      >
        <FileText size={26} style={{ color: MINT }} />
      </div>
      <p className="text-[15px] font-semibold" style={{ color: TEAL }}>
        No inspections to report on yet
      </p>
      <p className="text-[13px] mt-1" style={{ color: MINT }}>
        Upload images and run analysis to generate inspection records.
      </p>
    </div>
  );
}


function PreviewArea({
  inspectionId, preview, loading, error,
}: {
  inspectionId: string;
  preview: ReportPreview | undefined;
  loading: boolean;
  error: any;
}) {
  if (loading) {
    return (
      <div
        className="bg-white rounded-xl border p-12 text-center"
        style={{ borderColor: BORDER }}
      >
        <Loader2
          size={28}
          className="animate-spin mx-auto mb-3"
          style={{ color: BRAND }}
        />
        <p className="text-[13px]" style={{ color: MINT }}>
          Building report preview…
        </p>
      </div>
    );
  }

  if (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail;
    return (
      <div
        className="bg-white rounded-xl border p-8 flex items-start gap-3"
        style={{ borderColor: '#FECACA' }}
      >
        <AlertTriangle size={22} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[14px] font-semibold text-red-700">
            {status === 422 ? 'No detections yet' : 'Could not load report'}
          </p>
          <p className="text-[13px] text-red-600 mt-0.5">
            {typeof detail === 'string'
              ? detail
              : 'This inspection has no detections to report on yet. Run analysis on its images first.'}
          </p>
        </div>
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="space-y-6">
      <CoverCard preview={preview} inspectionId={inspectionId} />
      <KpiRow preview={preview} />
      <SeverityMatrix preview={preview} />
      <NarrativeCard narrative={preview.narrative} />
      <ImageFindings preview={preview} />
    </div>
  );
}


function CoverCard({
  preview, inspectionId,
}: { preview: ReportPreview; inspectionId: string }) {
  const { metadata, summary } = preview;
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const slug = (metadata.asset_name || 'inspection')
        .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      await reportsApi.downloadPdf(inspectionId, `${slug}-inspection-report.pdf`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="bg-white rounded-xl border overflow-hidden shadow-card-dark"
      style={{ borderColor: BORDER }}
    >
      <div className="p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-[11px] font-bold tracking-wider mb-1"
            style={{ color: MINT }}
          >
            {(metadata.organization_name || '').toUpperCase()}
          </p>
          <h2
            className="text-[22px] font-black leading-tight"
            style={{ color: TEAL }}
          >
            {metadata.asset_name || 'Inspection Report'}
          </h2>
          <p className="text-[13px] mt-0.5" style={{ color: MINT }}>
            Visual Damage Assessment Report
            {metadata.location_name ? ` · ${metadata.location_name}` : ''}
          </p>
        </div>
        <button
          onClick={download}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-bold transition-colors disabled:cursor-not-allowed flex-shrink-0"
          style={{
            background: downloading ? '#94A3B8' : BRAND,
            color: 'white',
            opacity: downloading ? 0.85 : 1,
          }}
        >
          {downloading ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Generating PDF…
            </>
          ) : (
            <>
              <Download size={15} />
              Download PDF
            </>
          )}
        </button>
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-px"
        style={{ background: BORDER }}
      >
        <MetaCell label="Inspection Date" value={metadata.inspection_date} />
        {/* Method intentionally hidden — field is set inconsistently upstream
            (default 'manual'; mission flow writes off-vocabulary 'automated').
            Reinstate together with the PDF cover row once the data is fixed. */}
        <MetaCell label="Inspector" value={metadata.inspector_name || '—'} />
        <MetaCell
          label="Status"
          value={metadata.status ? humanizeStatus(metadata.status) : '—'}
        />
        <MetaCell
          label="Total Images"
          value={String(summary.total_images || metadata.total_images || 0)}
        />
        <MetaCell
          label="Total Detections"
          value={String(summary.total_detections)}
        />
        <MetaCell
          label="Type"
          value={metadata.inspection_type?.replace(/-/g, ' ') || '—'}
        />
        <MetaCell
          label="Infrastructure"
          value={metadata.infrastructure_type || '—'}
        />
      </div>
    </div>
  );
}


function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p
        className="text-[10px] font-bold tracking-wider mb-1"
        style={{ color: MINT }}
      >
        {label.toUpperCase()}
      </p>
      <p className="text-[13px] font-semibold capitalize" style={{ color: TEAL }}>
        {value}
      </p>
    </div>
  );
}


function KpiRow({ preview }: { preview: ReportPreview }) {
  const { metrics, narrative } = preview;
  const riskColor = RISK_COLOR[narrative.risk_assessment] || MINT;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        label="Overall Risk"
        value={`${narrative.risk_score}/100`}
        sub={narrative.risk_assessment.toUpperCase()}
        accent={riskColor}
      />
      <KpiCard
        label="High Severity (S3 + S4)"
        value={String(metrics.high_severity_count)}
        sub={`Advanced + Severe · ${(metrics.high_severity_pct * 100).toFixed(0)}% of detections`}
        accent="#dc2626"
      />
      <KpiCard
        label="Avg Confidence"
        value={metrics.avg_confidence.toFixed(2)}
        sub={metrics.avg_confidence >= 0.7 ? 'Above threshold' : 'Below 0.70'}
        accent={metrics.avg_confidence >= 0.7 ? '#16a34a' : '#d97706'}
      />
      <KpiCard
        label="Top Defect"
        value={metrics.top_3_defects[0]?.[0]?.replace(/_/g, ' ') || '—'}
        sub={`${metrics.top_3_defects[0]?.[1] ?? 0} detections`}
        accent={BRAND}
      />
    </div>
  );
}


function KpiCard({
  label, value, sub, accent,
}: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div
      className="bg-white rounded-xl border p-4 shadow-card-dark"
      style={{ borderColor: BORDER }}
    >
      <p className="text-[10px] font-bold tracking-wider mb-2" style={{ color: MINT }}>
        {label.toUpperCase()}
      </p>
      <p
        className="text-[22px] font-black leading-tight capitalize"
        style={{ color: accent }}
      >
        {value}
      </p>
      <p className="text-[11px] mt-1" style={{ color: MINT }}>
        {sub}
      </p>
    </div>
  );
}


function SeverityMatrix({ preview }: { preview: ReportPreview }) {
  const { matrix, column_totals } = preview.summary;
  const rowsWithData = matrix.filter((r) => r.total > 0);
  const visible = rowsWithData.length > 0 ? rowsWithData : matrix;

  return (
    <div
      className="bg-white rounded-xl border overflow-hidden shadow-card-dark"
      style={{ borderColor: BORDER }}
    >
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-[15px] font-black" style={{ color: TEAL }}>
          Defect Summary
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: MINT }}>
          Detections grouped by damage type and severity.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ background: SURFACE, borderTop: `1px solid ${BORDER}` }}>
              <th className="px-4 py-2.5 text-left text-[11px] font-bold tracking-wider"
                  style={{ color: TEAL }}>
                Damage Type
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold tracking-wider"
                  style={{ color: SEV_COLOR['1 - Minor'] }}>
                1 — Minor
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold tracking-wider"
                  style={{ color: SEV_COLOR['2 - Moderate'] }}>
                2 — Moderate
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold tracking-wider"
                  style={{ color: SEV_COLOR['3 - Advanced'] }}>
                3 — Advanced
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold tracking-wider"
                  style={{ color: SEV_COLOR['4 - Severe'] }}>
                4 — Severe
              </th>
              <th className="px-3 py-2.5 text-right text-[11px] font-bold tracking-wider"
                  style={{ color: TEAL }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.code} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td className="px-4 py-2.5">
                  <span className="text-[13px] font-semibold" style={{ color: TEAL }}>
                    {r.label}
                  </span>
                  <span className="text-[11px] ml-1.5" style={{ color: MINT }}>
                    ({r.code})
                  </span>
                </td>
                <SevCell n={r.minor}    color={SEV_COLOR['1 - Minor']} />
                <SevCell n={r.moderate} color={SEV_COLOR['2 - Moderate']} />
                <SevCell n={r.advanced} color={SEV_COLOR['3 - Advanced']} />
                <SevCell n={r.severe}   color={SEV_COLOR['4 - Severe']} />
                <td className="px-3 py-2.5 text-right text-[13px] font-bold"
                    style={{ color: TEAL }}>
                  {r.total}
                </td>
              </tr>
            ))}
            <tr style={{ background: SURFACE, borderTop: `1px solid ${BORDER}` }}>
              <td className="px-4 py-3 text-[12px] font-black tracking-wider"
                  style={{ color: TEAL }}>
                TOTAL
              </td>
              <td className="px-3 py-3 text-center text-[13px] font-black" style={{ color: TEAL }}>
                {column_totals.minor}
              </td>
              <td className="px-3 py-3 text-center text-[13px] font-black" style={{ color: TEAL }}>
                {column_totals.moderate}
              </td>
              <td className="px-3 py-3 text-center text-[13px] font-black" style={{ color: TEAL }}>
                {column_totals.advanced}
              </td>
              <td className="px-3 py-3 text-center text-[13px] font-black" style={{ color: TEAL }}>
                {column_totals.severe}
              </td>
              <td className="px-3 py-3 text-right text-[13px] font-black" style={{ color: TEAL }}>
                {column_totals.total}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


function SevCell({ n, color }: { n: number; color: string }) {
  return (
    <td className="px-3 py-2.5 text-center text-[13px]"
        style={{ color: n ? color : '#cbd5e1', fontWeight: n ? 700 : 400 }}>
      {n || '—'}
    </td>
  );
}


function NarrativeCard({ narrative }: { narrative: ReportNarrative }) {
  return (
    <div
      className="bg-white rounded-xl border p-5 shadow-card-dark"
      style={{ borderColor: BORDER }}
    >
      <h3 className="text-[15px] font-black mb-3" style={{ color: TEAL }}>
        Assessment Narrative
      </h3>

      <div className="mb-4">
        <p className="text-[11px] font-bold tracking-wider mb-1.5" style={{ color: MINT }}>
          EXECUTIVE SUMMARY
        </p>
        <p className="text-[13px] leading-relaxed" style={{ color: TEAL }}>
          {narrative.executive_summary}
        </p>
      </div>

      <div className="mb-4">
        <p className="text-[11px] font-bold tracking-wider mb-1.5" style={{ color: MINT }}>
          TECHNICAL FINDINGS
        </p>
        <p className="text-[13px] leading-relaxed" style={{ color: TEAL }}>
          {narrative.technical_findings}
        </p>
      </div>

      {narrative.recommendations.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] font-bold tracking-wider mb-2" style={{ color: MINT }}>
            RECOMMENDATIONS
          </p>
          <ul className="space-y-2.5">
            {narrative.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2">
                <ChevronRight
                  size={14}
                  className="flex-shrink-0 mt-1"
                  style={{ color: BRAND }}
                />
                <div>
                  <p className="text-[13px] font-bold" style={{ color: TEAL }}>
                    {r.action}
                  </p>
                  <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: MINT }}>
                    {r.rationale}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {narrative.confidence_note && (
        <div
          className="mt-3 px-3 py-2 rounded-lg flex items-start gap-2"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}
        >
          <AlertTriangle size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800">
            {narrative.confidence_note}
          </p>
        </div>
      )}
    </div>
  );
}


function ImageFindings({ preview }: { preview: ReportPreview }) {
  const findings = preview.image_findings;
  if (findings.length === 0) return null;

  return (
    <div
      className="bg-white rounded-xl border shadow-card-dark"
      style={{ borderColor: BORDER }}
    >
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-[15px] font-black" style={{ color: TEAL }}>
          Per-Image Findings
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: MINT }}>
          {findings.length} image{findings.length === 1 ? '' : 's'} with detections.
        </p>
      </div>

      <div className="divide-y" style={{ borderColor: BORDER }}>
        {findings.map((f) => (
          <div key={f.image_id} className="px-5 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon size={14} style={{ color: MINT }} />
              <p className="text-[13px] font-bold truncate" style={{ color: TEAL }}>
                {f.image_filename}
              </p>
              <span className="text-[11px] ml-auto" style={{ color: MINT }}>
                {f.detections.length} detection{f.detections.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {f.detections.map((d, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold"
                  style={{
                    background: '#F8FAFB',
                    border: `1px solid ${BORDER}`,
                    color: TEAL,
                  }}
                >
                  <span style={{ color: SEV_COLOR[d.severity_label] || MINT }}>
                    ●
                  </span>
                  {d.damage_code}
                  {d.segment && d.segment !== 'UNK' ? ` · ${d.segment}` : ''}
                  {' · '}{d.severity_label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

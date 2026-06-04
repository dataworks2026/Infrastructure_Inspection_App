'use client';

// Predictive Analytics dashboard.
// Renders the priority-ranked result of the most recent completed
// analytics run for the caller's organization. Fetches from the
// backend via GET /api/v1/predictive/latest (predictiveApi.getLatest).
//
// Subtask 6.1 — core page + data table. Subsequent commits wire the
// Run Analysis mutation button (6.2) and loading / empty states (6.3).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  TrendingDown, Flag,
  Play, Loader2, AlertTriangle,
} from 'lucide-react';

import { predictiveApi } from '@/lib/api';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { PRIORITY, TREND, TTI_COLOR } from '@/lib/predictive-theme';
import type { PredictiveAssetResult } from '@/types';

const TEAL = '#082E29';

// S1..S4 badge palette — matches dashboard/page.tsx (pre-existing
// duplication noted as a follow-up; not in scope for this PR).
const SEV: Record<string, { color: string; bg: string; border: string }> = {
  S4: { color: '#B71C1C', bg: '#FEF2F2', border: '#FECACA' },
  S3: { color: '#FF7043', bg: '#FFF3E0', border: '#FFCCBC' },
  S2: { color: '#E6A817', bg: '#FFFBEB', border: '#FDE68A' },
  S1: { color: '#4CAF50', bg: '#F0FDF4', border: '#BBF7D0' },
};

// ── Small formatting helpers ────────────────────────────────────
function sevLabel(n: number): string {
  const clamped = Math.max(1, Math.min(4, Math.round(n)));
  return `S${clamped}`;
}

function formatRate(rate: number): string {
  const sign = rate > 0 ? '+' : '';
  return `${sign}${rate.toFixed(2)}/yr`;
}

function formatTti(days: number | undefined | null): string {
  if (days == null) return 'N/A';
  if (days <= 0)    return '0d';
  return `${Math.round(days)}d`;
}


// Render a user-friendly timestamp for the last completed run.
// Returns an empty string when the input is missing or invalid so
// the caller can decide whether to render at all.
function formatRunTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}


export default function AnalyticsPage() {
  const router      = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey : ['predictive-latest'],
    queryFn  : () => predictiveApi.getLatest(),
    // A 404 from /latest means "no runs yet" — a legitimate state
    // rather than a failure, so skip React Query's default retry.
    retry    : false,
  });

  // POST /api/v1/predictive/run — runs the pipeline server-side.
  // On success we invalidate the ['predictive-latest'] key so the
  // page pulls fresh results automatically; no manual refetch call
  // needed.
  const runMutation = useMutation({
    mutationFn: () => predictiveApi.runAnalysis(),
    onSuccess : () => {
      queryClient.invalidateQueries({ queryKey: ['predictive-latest'] });
    },
  });

  const runError = runMutation.error as any;

  if (isLoading) {
    return (
      <div className="p-8">
        <DashboardSkeleton />
      </div>
    );
  }

  const is404 = (error as any)?.response?.status === 404;
  if (is404 || !data) {
    return (
      <EmptyState
        onRun   = {() => runMutation.mutate()}
        isPending = {runMutation.isPending}
        runError= {runError}
      />
    );
  }

  const results         = data.results ?? [];
  const lastRunFormatted = formatRunTimestamp(data.completed_at ?? data.created_at);

  return (
    <div className="p-8">
      {/* Header row: title on the left, Run Analysis on the right */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-black mb-1" style={{ color: TEAL }}>
            Analytics
          </h1>
          <p className="text-[13px] text-[#6B9A87]">
            Assets ranked by deterioration rate, anomaly flags, and
            time-to-intervention. Click any row to drill into an asset.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <RunButton
            onClick  = {() => runMutation.mutate()}
            isPending= {runMutation.isPending}
          />
          {lastRunFormatted && (
            <p className="text-[11px] text-[#6B9A87]">
              Last run: {lastRunFormatted} · {data.total_items_analyzed} asset
              {data.total_items_analyzed === 1 ? '' : 's'} analysed
            </p>
          )}
        </div>
      </div>

      {runError && <RunErrorBanner error={runError} />}

      <div
        className="bg-white rounded-xl border border-[#E2EDE8] overflow-hidden shadow-card-dark"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#F8FAFB', borderBottom: '1px solid #E2EDE8' }}>
                <ColHeader align="left">  Rank     </ColHeader>
                <ColHeader align="left">  Asset    </ColHeader>
                <ColHeader align="left">  Severity </ColHeader>
                <ColHeader align="left">  Trend    </ColHeader>
                <ColHeader align="right"> Rate     </ColHeader>
                <ColHeader align="center">Flag     </ColHeader>
                <ColHeader align="right"> Priority </ColHeader>
                <ColHeader align="right"> TTI      </ColHeader>
              </tr>
            </thead>
            <tbody>
              {results.map((asset) => (
                <AssetRow
                  key={asset.asset_id}
                  asset={asset}
                  onClick={() => router.push(`/assets/${asset.asset_id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ── Controls ────────────────────────────────────────────────────

function RunButton({
  onClick, isPending,
}: { onClick: () => void; isPending: boolean }) {
  return (
    <button
      onClick    = {onClick}
      disabled   = {isPending}
      data-tour  = "analytics-run"
      className  = "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold transition-colors disabled:cursor-not-allowed"
      style={{
        background: isPending ? '#94A3B8' : '#0891B2',
        color     : 'white',
        opacity   : isPending ? 0.85 : 1,
      }}
    >
      {isPending ? (
        <>
          <Loader2 size={15} className="animate-spin" />
          Running analysis…
        </>
      ) : (
        <>
          <Play size={14} style={{ fill: 'currentColor' }} />
          Run Analysis
        </>
      )}
    </button>
  );
}

function EmptyState({
  onRun, isPending, runError,
}: { onRun: () => void; isPending: boolean; runError: any }) {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-[24px] font-black mb-1" style={{ color: TEAL }}>
          Analytics
        </h1>
        <p className="text-[13px] text-[#6B9A87]">
          Assets ranked by deterioration rate, anomaly flags, and
          time-to-intervention.
        </p>
      </div>

      {runError && <RunErrorBanner error={runError} />}

      <div
        className="flex flex-col items-center justify-center text-center rounded-xl"
        style={{
          background: '#F8FAFB',
          border    : '1px dashed #CBD5D0',
          padding   : '56px 32px',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: '#EDF6F0', border: '1px solid #CBE3D5' }}
        >
          <TrendingDown size={24} style={{ color: '#0891B2' }} />
        </div>
        <h2 className="text-[16px] font-black mb-1.5" style={{ color: TEAL }}>
          No analytics runs yet
        </h2>
        <p className="text-[13px] text-[#6B9A87] mb-5 max-w-sm">
          Click Run Analysis to generate your first predictive report.
          The engine will score every completed inspection in your
          organization.
        </p>
        <RunButton onClick={onRun} isPending={isPending} />
      </div>
    </div>
  );
}

function RunErrorBanner({ error }: { error: any }) {
  const status  = error?.response?.status;
  const detail  = error?.response?.data?.detail;
  const message =
    detail ||
    error?.message ||
    'Unable to trigger an analytics run. Please try again.';

  return (
    <div
      className="flex items-start gap-2.5 px-4 py-3 mb-4 rounded-lg"
      style={{
        background: '#FEF2F2',
        border    : '1px solid #FECACA',
        color     : '#B71C1C',
      }}
    >
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-[13px] font-bold">Analysis failed</p>
        <p className="text-[12px] mt-0.5">
          {status ? `(${status}) ` : ''}{message}
        </p>
      </div>
    </div>
  );
}


// ── Table cell helpers ──────────────────────────────────────────

function ColHeader({
  align, children,
}: { align: 'left' | 'right' | 'center'; children: React.ReactNode }) {
  return (
    <th
      className="px-4 py-3 text-[11px] font-black uppercase tracking-wide text-[#6B9A87]"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

function AssetRow({
  asset, onClick,
}: { asset: PredictiveAssetResult; onClick: () => void }) {
  const sevKey = sevLabel(asset.latest_severity);
  const sev    = SEV[sevKey] ?? SEV.S1;
  const pri    = PRIORITY[asset.priority_label] ?? PRIORITY.Low;
  const trend  = TREND[asset.trend_direction] ?? TREND.stable;
  const TrendIcon = trend.icon;
  const ttiColor  = TTI_COLOR[asset.tti_label] ?? '#6B7280';

  return (
    <tr
      onClick={onClick}
      className="interactive-row cursor-pointer hover:bg-[#F8FAFB]"
      style={{ borderBottom: '1px solid #EDF6F0' }}
    >
      {/* Rank */}
      <td className="px-4 py-4 text-[14px] font-black tabular-nums" style={{ color: TEAL }}>
        #{asset.priority_rank}
      </td>

      {/* Asset name + type */}
      <td className="px-4 py-4">
        <p className="text-[13px] font-bold" style={{ color: TEAL }}>{asset.asset_name}</p>
        {asset.asset_type && (
          <p className="text-[11px] text-[#6B9A87] capitalize mt-0.5">
            {asset.asset_type.replace(/_/g, ' ')}
          </p>
        )}
      </td>

      {/* Severity badge */}
      <td className="px-4 py-4">
        <span
          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
          style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}
        >
          <span className="w-[6px] h-[6px] rounded-full" style={{ background: sev.color }} />
          {sevKey}
        </span>
      </td>

      {/* Trend direction */}
      <td className="px-4 py-4">
        <span
          className="inline-flex items-center gap-1.5 text-[12px] font-bold"
          style={{ color: trend.color }}
        >
          <TrendIcon size={14} />
          {trend.label}
        </span>
      </td>

      {/* Severity change rate per year */}
      <td
        className="px-4 py-4 text-right text-[12px] font-mono tabular-nums"
        style={{ color: trend.color }}
      >
        {formatRate(asset.severity_change_rate)}
      </td>

      {/* Anomaly flag */}
      <td className="px-4 py-4 text-center">
        {asset.has_anomaly && (
          <Flag
            size={14}
            className="inline"
            style={{ color: '#B71C1C', fill: '#B71C1C' }}
          />
        )}
      </td>

      {/* Priority score + label */}
      <td className="px-4 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="text-[13px] font-bold tabular-nums" style={{ color: TEAL }}>
            {asset.priority_score.toFixed(1)}
          </span>
          <span
            className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: pri.bg, color: pri.color, border: `1px solid ${pri.border}` }}
          >
            {asset.priority_label}
          </span>
        </div>
      </td>

      {/* TTI days + label */}
      <td className="px-4 py-4 text-right">
        <p className="text-[12px] font-bold tabular-nums" style={{ color: ttiColor }}>
          {formatTti(asset.tti_days)}
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: ttiColor, opacity: 0.75 }}>
          {asset.tti_label}
        </p>
      </td>
    </tr>
  );
}

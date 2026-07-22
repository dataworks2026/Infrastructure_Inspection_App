'use client';

// Predictive analytics panel for the asset detail page.
//
// Pulls the latest run's result for a single asset via
// GET /api/v1/predictive/assets/{asset_id} (predictiveApi.getAssetAnalytics)
// and renders four sections per the Area 7 spec:
//
//   1. Priority score + label badge + rank line
//   2. Trend direction + rate + acceleration warning (if any)
//   3. TTI countdown OR a "not applicable" explanation
//   4. Anomaly alert banner (only when has_anomaly is true)
//
// The Recharts sparkline (severity history line) lands in a follow-up
// commit alongside the backend severity_history payload.

import Link from '@/components/OrgLink';
import { useQuery } from '@tanstack/react-query';
import { Flag, AlertTriangle, Loader2, TrendingUp, TrendingDown, Minus, Siren } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts';

import { predictiveApi } from '@/lib/api';
import { PRIORITY, TREND, TTI_COLOR } from '@/lib/predictive-theme';
import type {
  PredictiveAnalyticsReason,
  PredictiveAssetResult,
  SeverityHistoryPoint,
} from '@/types';


const TEAL  = '#082E29';
const BRAND = '#0891B2';


// ── helpers ─────────────────────────────────────────────────────

function formatRate(rate: number): string {
  const sign = rate > 0 ? '+' : '';
  return `${sign}${rate.toFixed(2)}/yr`;
}


// ── public component ────────────────────────────────────────────

export default function AnalyticsPanel({ assetId }: { assetId: string }) {
  const { data, isLoading, error } = useQuery<PredictiveAssetResult>({
    queryKey : ['predictive-asset', assetId],
    queryFn  : () => predictiveApi.getAssetAnalytics(assetId),
    retry    : false,   // 404 = "no analytics yet" is a legit state, do not retry
  });

  if (isLoading) {
    return (
      <Card>
        <PanelHeader />
        <div className="flex items-center gap-2 text-[13px] text-[#6B9A87] py-4">
          <Loader2 size={14} className="animate-spin" />
          Loading analytics…
        </div>
      </Card>
    );
  }

  const is404 = (error as any)?.response?.status === 404;
  if (is404 || !data) {
    return (
      <Card>
        <PanelHeader />
        <p className="text-[13px] text-[#6B9A87]">
          Analytics not available for this asset yet.{' '}
          <Link href="/analytics" className="text-sky-600 hover:underline font-medium">
            Run an analysis →
          </Link>
        </p>
      </Card>
    );
  }

  const trend       = TREND[data.trend_direction] ?? TREND.stable;
  const TrendIcon   = trend.icon;
  const pri         = PRIORITY[data.priority_label] ?? PRIORITY.Low;
  const ttiColor    = TTI_COLOR[data.tti_label] ?? '#6B7280';

  return (
    <Card>
      <PanelHeader />

      {/* Anomaly alert — only renders when something tripped the engine */}
      {data.has_anomaly && (
        <div
          className="flex items-start gap-2.5 px-4 py-3 mb-5 rounded-lg"
          style={{
            background: '#FFF3E0',
            border    : '1px solid #FFCCBC',
            color     : '#C2410C',
          }}
        >
          <Flag size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-bold">Anomaly detected</p>
            <p className="text-[12px] mt-0.5">
              {data.anomaly_reason ?? 'An unusual severity jump was flagged.'}
            </p>
          </div>
        </div>
      )}

      {/* Priority + Trend + TTI + (optional) sparkline */}
      <div className={
        data.severity_history.length >= 2
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
          : "grid grid-cols-1 sm:grid-cols-3 gap-5"
      }>
        {/* 1. Priority */}
        <Section label="Priority Score">
          <div className="flex items-baseline gap-2">
            <span className="text-[40px] font-black leading-none tabular-nums" style={{ color: TEAL }}>
              {data.priority_score.toFixed(1)}
            </span>
            <span
              className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: pri.bg, color: pri.color, border: `1px solid ${pri.border}` }}
            >
              {data.priority_label}
            </span>
          </div>
          <p className="text-[11px] text-[#6B9A87] mt-1.5">
            Ranked #{data.priority_rank} in this run
          </p>
        </Section>

        {/* 2. Trend */}
        <Section label="Trend">
          <div className="flex items-center gap-2">
            <TrendIcon size={20} style={{ color: trend.color }} />
            <span className="text-[16px] font-bold" style={{ color: trend.color }}>
              {trend.label}
            </span>
          </div>
          <p className="text-[12px] text-[#6B9A87] mt-1.5">
            Changing at {formatRate(data.severity_change_rate)}
          </p>
          {data.acceleration && (
            <p className="text-[11px] mt-1 font-semibold flex items-center gap-1"
              style={{ color: '#C2410C' }}>
              <AlertTriangle size={12} /> Rate of worsening is increasing
            </p>
          )}
        </Section>

        {/* 3. TTI */}
        <Section label="Time to Intervention">
          {data.tti_days != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[28px] font-black leading-none tabular-nums"
                  style={{ color: ttiColor }}
                >
                  {data.tti_days <= 0 ? '0' : Math.round(data.tti_days)}
                </span>
                <span className="text-[13px] font-bold" style={{ color: ttiColor }}>
                  days
                </span>
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: ttiColor }}>
                {data.tti_label}
              </p>
            </>
          ) : (
            <>
              <p className="text-[14px] font-bold" style={{ color: ttiColor }}>
                {data.tti_label}
              </p>
              <p className="text-[11px] text-[#6B9A87] mt-1.5">
                {data.tti_note}
              </p>
            </>
          )}
        </Section>

        {/* 4. Severity history sparkline — only if we have at least
             two points to draw a line through. */}
        {data.severity_history.length >= 2 && (
          <Section label="History">
            <SeveritySparkline points={data.severity_history} />
            <p className="text-[10px] text-[#6B9A87] mt-1.5">
              {data.severity_history.length} inspections,
              {' '}{data.severity_history[0].date} – {data.severity_history[data.severity_history.length - 1].date}
            </p>
          </Section>
        )}
      </div>

      {/* "Why this score?" — explains the priority + TTI verdict so a
           user does not have to mentally reconcile e.g. a "stable"
           trend with an "Immediate" TTI. */}
      {data.reasons.length > 0 && <ReasonList reasons={data.reasons} />}

      {/* V3 — M2 LightGBM forecast section */}
      {data.forecast_severity_next != null && (
        <ForecastSection data={data} />
      )}
    </Card>
  );
}


// ── forecast section ─────────────────────────────────────────────

const SEV_STYLE: Record<number, { bg: string; color: string; label: string }> = {
  1: { bg: '#DCFCE7', color: '#15803D', label: 'S1 — Minor' },
  2: { bg: '#FEF9C3', color: '#A16207', label: 'S2 — Moderate' },
  3: { bg: '#FFEDD5', color: '#C2410C', label: 'S3 — Significant' },
  4: { bg: '#FEE2E2', color: '#B91C1C', label: 'S4 — Critical' },
};

const CONF_STYLE: Record<string, { bg: string; color: string }> = {
  High   : { bg: '#DCFCE7', color: '#15803D' },
  Medium : { bg: '#FEF9C3', color: '#A16207' },
  Low    : { bg: '#FEE2E2', color: '#B91C1C' },
};

function ForecastSection({ data }: { data: PredictiveAssetResult }) {
  const sev  = SEV_STYLE[data.forecast_severity_next!] ?? SEV_STYLE[4];
  const conf = CONF_STYLE[data.forecast_confidence ?? ''] ?? CONF_STYLE.Medium;

  // Asset locked at S4 AND historically accelerating — worst possible state
  const lockedAtCritical =
    data.forecast_severity_next === 4 &&
    data.latest_severity        === 4;

  const worsening = data.forecast_severity_next! > data.latest_severity;
  const improving = data.forecast_severity_next! < data.latest_severity;

  const ForecastIcon = worsening ? TrendingUp : improving ? TrendingDown : Minus;
  const iconColor    = worsening ? '#B91C1C'  : improving ? '#15803D'    : '#6B7280';

  return (
    <div
      className="mt-6 pt-5 border-t"
      style={{ borderColor: '#E2EDE8' }}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6B9A87] mb-4">
        Forecast
      </p>

      {/* Locked-at-critical banner — shown when asset is at S4 and staying there */}
      {lockedAtCritical && (
        <div
          className="flex items-start gap-3 px-4 py-3 mb-5 rounded-lg"
          style={{
            background : '#FEF2F2',
            border     : '1px solid #FECACA',
            color      : '#7F1D1D',
          }}
        >
          <Siren size={16} className="flex-shrink-0 mt-0.5 text-red-700" />
          <div>
            <p className="text-[13px] font-black">
              Locked at Critical — Immediate intervention required
            </p>
            <p className="text-[12px] mt-0.5 leading-snug font-medium">
              This asset has reached maximum severity (S4) and is forecast to remain there.
              {data.trend_direction === 'accelerating' && (
                <span className="block mt-1 text-red-700 font-bold">
                  ⚠ The rate of deterioration is still accelerating — conditions are actively getting worse.
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">

        {/* Predicted severity */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6B9A87] mb-2">
            Predicted Severity
          </p>
          <div className="flex items-center gap-2">
            {lockedAtCritical ? (
              <span
                className="text-[13px] font-black px-3 py-1 rounded-full flex items-center gap-1.5"
                style={{ background: '#FEE2E2', color: '#B91C1C', border: '1.5px solid #FECACA' }}
              >
                <Siren size={13} />
                S4 — Critical (No change possible)
              </span>
            ) : (
              <>
                <ForecastIcon size={18} style={{ color: iconColor }} />
                <span
                  className="text-[13px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: sev.bg, color: sev.color }}
                >
                  {sev.label}
                </span>
              </>
            )}
          </div>
          <p className="text-[11px] text-[#6B9A87] mt-1.5">
            within {data.forecast_horizon_days ?? 180} days
          </p>
        </div>

        {/* Confidence */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6B9A87] mb-2">
            Confidence
          </p>
          <span
            className="text-[13px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: conf.bg, color: conf.color }}
          >
            {data.forecast_confidence}
          </span>
          <p className="text-[11px] text-[#6B9A87] mt-1.5">
            model confidence level
          </p>
        </div>

        {/* Forecast note */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6B9A87] mb-2">
            Interpretation
          </p>
          <p
            className="text-[12px] leading-snug"
            style={{ color: lockedAtCritical ? '#B91C1C' : '#334155', fontWeight: lockedAtCritical ? 600 : 400 }}
          >
            {data.forecast_note}
          </p>
        </div>

      </div>
    </div>
  );
}


// ── reason list ──────────────────────────────────────────────────

function ReasonList({ reasons }: { reasons: PredictiveAnalyticsReason[] }) {
  return (
    <div
      className="mt-6 pt-5 border-t"
      style={{ borderColor: '#E2EDE8' }}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6B9A87] mb-3">
        Why this score?
      </p>
      <ul className="space-y-2">
        {reasons.map((r, idx) => (
          <li
            key={idx}
            className="flex items-start gap-3 text-[12px]"
          >
            <CategoryDot category={r.reason_category} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className="text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: TEAL }}
                >
                  {prettyCode(r.reason_code)}
                </span>
                {r.weight != null && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: '#EDF6F0', color: '#3D6B5E' }}
                  >
                    weight {Math.round(r.weight * 100)}%
                  </span>
                )}
              </div>
              <p className="text-[12px] text-slate-700 mt-0.5 leading-snug">
                {r.reason_text}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Display name for each reason_code.
function prettyCode(code: string): string {
  switch (code) {
    case 'deterioration':    return 'Deterioration';
    case 'anomaly':          return 'Anomaly';
    case 'tti':              return 'Time to Intervention';
    case 'current_severity': return 'Current Severity';
    default:                 return code;
  }
}

// Tiny colour-coded dot that matches the section it explains.
function CategoryDot({ category }: { category?: string }) {
  const color =
    category === 'trend'      ? '#B91C1C' :
    category === 'anomaly'    ? '#C2410C' :
    category === 'projection' ? '#A16207' :
    category === 'severity'   ? '#15803D' :
                                '#6B7280';
  return (
    <span
      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
      style={{ background: color }}
    />
  );
}


// ── sparkline ────────────────────────────────────────────────────

function SeveritySparkline({ points }: { points: SeverityHistoryPoint[] }) {
  // Recharts wants its dataKey on each item. Our shape already has
  // {date, severity} so we can pass it through directly.
  return (
    <div style={{ width: '100%', height: 70 }}>
      <ResponsiveContainer>
        <LineChart
          data={points}
          margin={{ top: 5, right: 4, left: 4, bottom: 0 }}
        >
          <XAxis
            dataKey="date"
            hide
          />
          <YAxis
            domain={[1, 4]}
            ticks={[1, 2, 3, 4]}
            width={18}
            tick={{ fontSize: 9, fill: '#6B9A87' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: 6,
              border: '1px solid #E2EDE8',
              padding: '4px 8px',
            }}
            formatter={(value: any) => [`S${value}`, 'Severity']}
            labelFormatter={(label: any) => String(label)}
          />
          <Line
            type="monotone"
            dataKey="severity"
            stroke={BRAND}
            strokeWidth={2}
            dot={{ r: 2, fill: BRAND }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


// ── small layout primitives ─────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-card mb-6">
      {children}
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-slate-700 uppercase tracking-wider">
        Analytics
      </h2>
      <Link
        href="/analytics"
        className="text-[12px] font-semibold text-sky-600 hover:text-sky-800"
      >
        See all assets →
      </Link>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6B9A87] mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

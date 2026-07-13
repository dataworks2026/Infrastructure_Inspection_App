'use client';
import { useQuery } from '@tanstack/react-query';
import { reviewApi } from '@/lib/api';
import { ClipboardCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import type { DamageTypeAccuracy } from '@/types';

const TEAL = '#082E29';
const BRAND = '#0891B2';

function damageLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function CvAccuracyWidget() {
  const { data, isError } = useQuery({
    queryKey: ['review-stats'],
    queryFn: reviewApi.getReviewStats,
    refetchInterval: 120_000,
    retry: 1,
  });

  // Endpoint unavailable — render nothing so the dashboard never breaks
  if (isError) return null;
  if (!data) return null;

  const { overall, by_damage_type, recent } = data;

  if (overall.reviewed_inspections === 0) {
    return (
      <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col"
        style={{ border: '1px solid #C8E6D4' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EDF6F0' }}>
          <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
            Detection Review
          </h2>
        </div>
        <div className="flex flex-col items-center justify-center py-8 gap-2 flex-1">
          <ClipboardCheck size={26} style={{ color: '#C8E6D4' }} />
          <p className="text-[13px]" style={{ color: '#6B9A87' }}>No completed reviews yet</p>
        </div>
      </div>
    );
  }

  // Report-style summary counts (mirrors the review report's header row).
  const summaryStats: { label: string; value: number; color: string }[] = [
    { label: 'Total CV', value: overall.total_cv_detections, color: '#0891B2' },
    { label: 'Accepted', value: overall.accepted,            color: '#4CAF50' },
    { label: 'Rejected', value: overall.rejected,            color: '#EF4444' },
    { label: 'Modified', value: overall.modified,            color: '#E6A817' },
    { label: 'Added',    value: overall.engineer_added,      color: '#10B981' },
  ];

  const topDamageTypes: [string, DamageTypeAccuracy][] = Object.entries(by_damage_type)
    .sort((a, b) => b[1].cv - a[1].cv)
    .slice(0, 3);
  const maxCv = topDamageTypes.reduce((m, [, dt]) => Math.max(m, dt.cv), 0) || 1;

  return (
    <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col"
      style={{ border: '1px solid #C8E6D4' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #EDF6F0' }}>
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
            Detection Review
          </h2>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: '#F0FDF4', color: '#10B981', border: '1px solid #BBF7D0' }}>
            <CheckCircle2 size={8} /> ENGINEER REVIEWED
          </span>
        </div>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Report-style summary row: Total CV / Accepted / Rejected / Modified / Added (counts) */}
        <div>
          <div className="grid grid-cols-5 gap-1.5">
            {summaryStats.map(s => (
              <div key={s.label} className="flex flex-col items-center py-1.5 rounded-lg" style={{ background: '#F7FBF9', border: '1px solid #EDF6F0' }}>
                <span className="text-[18px] font-black leading-none tabular-nums" style={{ color: s.color }}>{s.value}</span>
                <span className="text-[8px] font-bold uppercase tracking-wide mt-1 text-center" style={{ color: '#9AB8AD' }}>{s.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-semibold mt-1.5" style={{ color: '#6B9A87' }}>
            {overall.reviewed_inspections} inspection{overall.reviewed_inspections === 1 ? '' : 's'} reviewed
          </p>
        </div>

        {/* Top damage types — detection counts (no accuracy %) */}
        {topDamageTypes.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#9AB8AD' }}>
              Top Damage Types
            </p>
            {topDamageTypes.map(([key, dt]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-bold w-28 truncate" style={{ color: TEAL }}>
                  {damageLabel(key)}
                </span>
                <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: '#EDF6F0' }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${(dt.cv / maxCv) * 100}%`, background: '#4CAF50' }} />
                </div>
                <span className="text-[10px] font-black tabular-nums w-16 text-right" style={{ color: '#6B9A87' }}>
                  {dt.cv} detection{dt.cv === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent reviews — detection counts only */}
        {recent.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: '#9AB8AD' }}>
              Recent Reviews
            </p>
            {recent.slice(0, 3).map(r => (
              <Link key={r.inspection_id}
                href={`/inspections/${r.inspection_id}/review-summary`}
                className="interactive-row flex items-center gap-2 px-2 py-1.5 rounded-lg group hover:bg-[#FAFCFB] transition-colors">
                <span className="flex-1 min-w-0 text-[11px] font-bold truncate group-hover:text-[#0891B2] transition-colors"
                  style={{ color: TEAL }}>
                  {r.name || `Inspection ${r.inspection_id.slice(0, 8)}`}
                </span>
                <span className="text-[10px] font-semibold tabular-nums flex-shrink-0" style={{ color: '#6B9A87' }}>
                  {r.cv_detections} detection{r.cv_detections === 1 ? '' : 's'}
                </span>
                <ArrowRight size={11} style={{ color: BRAND }}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

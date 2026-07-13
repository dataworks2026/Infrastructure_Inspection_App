'use client';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { ClipboardList } from 'lucide-react';

const TEAL = '#082E29';

// Severity palette — matches the dashboard Asset Health section
const SEV: Record<string, { label: string; color: string }> = {
  S1: { label: 'Minor',    color: '#4CAF50' },
  S2: { label: 'Moderate', color: '#E6A817' },
  S3: { label: 'Advanced', color: '#FF7043' },
  S4: { label: 'Severe',   color: '#B71C1C' },
};

interface DefectAsset {
  asset_id: string;
  asset_name: string;
  damage_types: { damage_type: string; S1: number; S2: number; S3: number; S4: number; total: number }[];
  totals: { S1: number; S2: number; S3: number; S4: number; total: number };
  total_annotations: number;
}

/**
 * Inspection Findings — a condition summary that mirrors the inspection report:
 * total verified findings, severity breakdown, and top damage types. Deliberately
 * NOT the CV-review diff (accepted/rejected/model accuracy) — that lives in the
 * review report / export for the CV team, not on the operator's dashboard.
 */
export default function CvAccuracyWidget() {
  const { data, isError } = useQuery({
    queryKey: ['defect-summary'],
    queryFn: dashboardApi.defectSummary,
    refetchInterval: 120_000,
    retry: 1,
  });

  if (isError || !data) return null;
  const assets: DefectAsset[] = (data as { assets?: DefectAsset[] }).assets ?? [];

  // Aggregate org-wide (matches the report's asset condition summary)
  const totals = { S1: 0, S2: 0, S3: 0, S4: 0, total: 0 };
  const byType = new Map<string, number>();
  for (const a of assets) {
    totals.S1 += a.totals.S1; totals.S2 += a.totals.S2;
    totals.S3 += a.totals.S3; totals.S4 += a.totals.S4;
    totals.total += a.totals.total;
    for (const dt of a.damage_types) {
      byType.set(dt.damage_type, (byType.get(dt.damage_type) ?? 0) + dt.total);
    }
  }
  const topTypes = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxType = topTypes.reduce((m, [, n]) => Math.max(m, n), 0) || 1;

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div className="interactive-card bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col"
      style={{ border: '1px solid #C8E6D4' }}>
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #EDF6F0' }}>
        <h2 className="text-[12px] font-black uppercase tracking-wider" style={{ color: '#6B9A87' }}>
          Inspection Findings
        </h2>
      </div>
      {children}
    </div>
  );

  if (totals.total === 0) {
    return (
      <Wrapper>
        <div className="flex flex-col items-center justify-center py-8 gap-2 flex-1">
          <ClipboardList size={26} style={{ color: '#C8E6D4' }} />
          <p className="text-[13px]" style={{ color: '#6B9A87' }}>No findings yet</p>
        </div>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Total findings */}
        <div className="flex items-end gap-2">
          <p className="text-[34px] font-black leading-none tabular-nums" style={{ color: TEAL }}>
            {totals.total}
          </p>
          <p className="text-[11px] font-semibold pb-1" style={{ color: '#6B9A87' }}>
            finding{totals.total === 1 ? '' : 's'}
            {' · '}{assets.length} asset{assets.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* Severity breakdown */}
        <div className="grid grid-cols-4 gap-1.5">
          {(['S1', 'S2', 'S3', 'S4'] as const).map(k => (
            <div key={k} className="flex flex-col items-center py-1.5 rounded-lg" style={{ background: `${SEV[k].color}12`, border: `1px solid ${SEV[k].color}30` }}>
              <span className="text-[16px] font-black leading-none tabular-nums" style={{ color: SEV[k].color }}>{totals[k]}</span>
              <span className="text-[8px] font-bold uppercase tracking-wide mt-1" style={{ color: SEV[k].color }}>{k}</span>
            </div>
          ))}
        </div>

        {/* Top damage types (counts) */}
        {topTypes.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#9AB8AD' }}>
              Top Damage Types
            </p>
            {topTypes.map(([label, count]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] font-bold w-28 truncate" style={{ color: TEAL }}>{label}</span>
                <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: '#EDF6F0' }}>
                  <div className="h-full rounded-full" style={{ width: `${(count / maxType) * 100}%`, background: '#4CAF50' }} />
                </div>
                <span className="text-[10px] font-black tabular-nums w-16 text-right" style={{ color: '#6B9A87' }}>
                  {count} finding{count === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

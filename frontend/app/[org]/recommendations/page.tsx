'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, ShieldCheck, Loader2, AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react';

import { recommendationsApi } from '@/lib/api';

const TEAL    = '#082E29';
const MINT    = '#6B9A87';
const BORDER  = '#E2EDE8';
const SURFACE = '#F8FAFB';
const BRAND   = '#0891B2';

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  'Approved':             { bg: '#DCFCE7', fg: '#166534' },
  'Draft':                { bg: '#E0F2FE', fg: '#075985' },
  'Needs Recommendation': { bg: '#FEF3C7', fg: '#92400E' },
  'Rejected':             { bg: '#FEE2E2', fg: '#991B1B' },
  'Superseded':           { bg: '#E5E7EB', fg: '#374151' },
};

const SEV_COLOR: Record<string, string> = {
  S1: '#16a34a', S2: '#d97706', S3: '#ea580c', S4: '#dc2626',
};

const TIER_COLOR: Record<number, string> = { 1: '#dc2626', 2: '#ea580c', 3: '#0891B2' };

type Run = {
  id: string; inspection_id: string | null; inspection_name: string; rollup_scope: string;
  producer: string | null; total_detections: number; total_matched: number; total_unmatched: number;
  total_dismissed: number; total_skipped: number; skipped_manifest: { detection_id: string; reason: string }[];
  created_at: string | null;
};
type Vocabulary = {
  producer: string; version: number; status: string; hash: string; weights_sha256: string;
  signed_by: string | null; signed_at: string | null; classes: string[];
};
type Overview = {
  summary: { counts: Record<string, number>; review_incomplete: boolean };
  library: { active_rules: number };
  vocabularies: Vocabulary[];
  tiers: Record<string, string>;
  runs: Run[];
};
type Rec = {
  id: string; status: string; rollup_scope: string; scope_key: string; inspection_id: string | null;
  inspection_name: string; detection_class: string | null; severity: string[]; detections: number;
  rule_version: number | null; tier: number | null; tier_label: string | null; action_class: string | null;
  recommendation_text: string | null; supersedes_record_id: string | null;
};
type OutputItem = { record_id: string; recommendation_text: string; action_class: string; quantity: number; detection_ids: string[] };
type Output = {
  tiers: { tier: number; label: string; [k: string]: any }[];
  summary: { approved_counts_by_tier: Record<string, number>; needs_recommendation_count: number; superseded_count: number };
};

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function RecommendationsPage() {
  const [inspectionId, setInspectionId] = useState<string>('');
  const [openRun, setOpenRun] = useState<string>('');

  const overviewQ = useQuery<Overview>({ queryKey: ['rec-overview'], queryFn: () => recommendationsApi.overview() });
  const recordsQ  = useQuery<Rec[]>({ queryKey: ['rec-records', inspectionId], queryFn: () => recommendationsApi.records(inspectionId || undefined) });
  const outputQ   = useQuery<Output>({ queryKey: ['rec-output'], queryFn: () => recommendationsApi.output() });

  const ov = overviewQ.data;
  const inspections = Array.from(new Map((ov?.runs ?? []).map(r => [r.inspection_id ?? '', r.inspection_name])).entries())
    .filter(([id]) => id);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[24px] font-black mb-1" style={{ color: TEAL }}>Recommendations</h1>
          <p className="text-[13px]" style={{ color: MINT }}>
            Repair recommendations matched from the rule library for engineer-reviewed findings. Read only preview, approve and reject arrive with Stage 3.
          </p>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>
          STAGE 3 PREVIEW
        </span>
      </div>

      {overviewQ.isLoading && <Loading text="Loading engine state…" />}
      {overviewQ.error && <ErrorBox error={overviewQ.error} />}

      {ov && (
        <>
          <KpiRow ov={ov} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 space-y-6">
              <RunsCard runs={ov.runs} openRun={openRun} setOpenRun={setOpenRun} />
            </div>
            <VocabularyCard vocabularies={ov.vocabularies} rules={ov.library.active_rules} />
          </div>
          {outputQ.data && <OutputCard out={outputQ.data} />}
          <div className="bg-white rounded-xl border p-5 mb-6 shadow-card-dark" style={{ borderColor: BORDER }}>
            <label className="block text-[12px] font-bold mb-2" style={{ color: TEAL }}>FILTER BY INSPECTION</label>
            <select
              value={inspectionId}
              onChange={(e) => setInspectionId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-[14px] bg-white"
              style={{ borderColor: BORDER, color: TEAL }}
            >
              <option value="">All inspections</option>
              {inspections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          {recordsQ.isLoading ? <Loading text="Loading records…" /> : <RecordsTable recs={recordsQ.data ?? []} />}
        </>
      )}
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-xl border p-12 text-center" style={{ borderColor: BORDER }}>
      <Loader2 size={28} className="animate-spin mx-auto mb-3" style={{ color: BRAND }} />
      <p className="text-[13px]" style={{ color: MINT }}>{text}</p>
    </div>
  );
}

function ErrorBox({ error }: { error: any }) {
  const detail = error?.response?.data?.detail;
  return (
    <div className="bg-white rounded-xl border p-8 flex items-start gap-3" style={{ borderColor: '#FECACA' }}>
      <AlertTriangle size={22} className="text-red-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-[14px] font-semibold text-red-700">Could not load recommendations</p>
        <p className="text-[13px] text-red-600 mt-0.5">{typeof detail === 'string' ? detail : String(error?.message ?? '')}</p>
      </div>
    </div>
  );
}

function KpiRow({ ov }: { ov: Overview }) {
  const c = ov.summary.counts;
  const kpis = [
    { label: 'APPROVED',             value: c['Approved'] ?? 0,             color: '#166534' },
    { label: 'DRAFT',                value: c['Draft'] ?? 0,                color: '#075985' },
    { label: 'NEEDS RECOMMENDATION', value: c['Needs Recommendation'] ?? 0, color: '#92400E' },
    { label: 'REJECTED',             value: c['Rejected'] ?? 0,             color: '#991B1B' },
    { label: 'SUPERSEDED',           value: c['Superseded'] ?? 0,           color: '#374151' },
    { label: 'ACTIVE RULES',         value: ov.library.active_rules,        color: TEAL },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {kpis.map(k => (
        <div key={k.label} className="bg-white rounded-xl border p-4 shadow-card-dark" style={{ borderColor: BORDER }}>
          <p className="text-[10px] font-bold tracking-wide" style={{ color: MINT }}>{k.label}</p>
          <p className="text-[26px] font-black mt-1" style={{ color: k.color }}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}

function VocabularyCard({ vocabularies, rules }: { vocabularies: Vocabulary[]; rules: number }) {
  return (
    <div className="bg-white rounded-xl border p-5 shadow-card-dark" style={{ borderColor: BORDER }}>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck size={18} style={{ color: BRAND }} />
        <p className="text-[12px] font-bold" style={{ color: TEAL }}>SIGNED VOCABULARY</p>
      </div>
      {vocabularies.length === 0 && <p className="text-[13px]" style={{ color: MINT }}>No vocabulary loaded.</p>}
      {vocabularies.map(v => (
        <div key={v.producer + v.version} className="mb-3">
          <p className="text-[14px] font-semibold" style={{ color: TEAL }}>
            {v.producer} v{v.version}
            <span
              className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: v.status === 'signed' ? '#DCFCE7' : '#FEF3C7', color: v.status === 'signed' ? '#166534' : '#92400E' }}
            >
              {v.status.toUpperCase()}
            </span>
          </p>
          <p className="text-[12px] mt-1" style={{ color: MINT }}>
            hash <code>{v.hash}</code> · weights <code>{v.weights_sha256.slice(0, 12)}…</code>
          </p>
          <p className="text-[12px]" style={{ color: MINT }}>
            {v.signed_by ? `Signed by ${v.signed_by}` : 'Not signed'}{v.signed_at ? ` · ${new Date(v.signed_at).toLocaleDateString()}` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {v.classes.map(c => (
              <span key={c} className="text-[11px] px-2 py-0.5 rounded-md border" style={{ borderColor: BORDER, color: TEAL, background: SURFACE }}>{c}</span>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[12px] mt-3 pt-3 border-t" style={{ borderColor: BORDER, color: MINT }}>
        {rules} active rule{rules === 1 ? '' : 's'} in this organization&apos;s library.
      </p>
    </div>
  );
}

function RunsCard({ runs, openRun, setOpenRun }: { runs: Run[]; openRun: string; setOpenRun: (id: string) => void }) {
  return (
    <div className="bg-white rounded-xl border p-5 shadow-card-dark" style={{ borderColor: BORDER }}>
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={18} style={{ color: BRAND }} />
        <p className="text-[12px] font-bold" style={{ color: TEAL }}>RESOLUTION RUNS</p>
      </div>
      {runs.length === 0 && <p className="text-[13px]" style={{ color: MINT }}>No runs yet.</p>}
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ color: MINT }}>
            <th className="text-left font-semibold pb-2">Inspection</th>
            <th className="text-left font-semibold pb-2">When</th>
            <th className="text-right font-semibold pb-2">Total</th>
            <th className="text-right font-semibold pb-2">Matched</th>
            <th className="text-right font-semibold pb-2">Unmatched</th>
            <th className="text-right font-semibold pb-2">Dismissed</th>
            <th className="text-right font-semibold pb-2">Skipped</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => {
            const open = openRun === r.id;
            const ok = r.total_matched + r.total_unmatched + r.total_dismissed + r.total_skipped === r.total_detections;
            return (
              <RunRows key={r.id} r={r} open={open} ok={ok} toggle={() => setOpenRun(open ? '' : r.id)} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunRows({ r, open, ok, toggle }: { r: Run; open: boolean; ok: boolean; toggle: () => void }) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: BORDER, color: TEAL }}>
        <td className="py-2 pr-2">
          <button onClick={toggle} className="flex items-center gap-1 text-left font-medium" disabled={r.total_skipped === 0}>
            {r.total_skipped > 0 ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-[14px] inline-block" />}
            {r.inspection_name}
          </button>
          <span className="text-[11px] ml-5" style={{ color: MINT }}>scope {r.rollup_scope}{r.producer ? ` · ${r.producer}` : ''}</span>
        </td>
        <td className="py-2 pr-2 whitespace-nowrap" style={{ color: MINT }}>{fmtDate(r.created_at)}</td>
        <td className="py-2 text-right font-semibold">{r.total_detections}</td>
        <td className="py-2 text-right" style={{ color: '#166534' }}>{r.total_matched}</td>
        <td className="py-2 text-right" style={{ color: '#92400E' }}>{r.total_unmatched}</td>
        <td className="py-2 text-right">{r.total_dismissed}</td>
        <td className="py-2 text-right" style={{ color: r.total_skipped ? '#991B1B' : TEAL }}>
          {r.total_skipped}{!ok && <span title="totals do not reconcile" className="ml-1 text-red-600">!</span>}
        </td>
      </tr>
      {open && r.skipped_manifest.length > 0 && (
        <tr>
          <td colSpan={7} className="pb-3">
            <div className="rounded-lg border p-3 text-[12px]" style={{ borderColor: '#FDE68A', background: '#FFFBEB', color: '#92400E' }}>
              <p className="font-bold mb-1">Skipped findings (not matched, still counted)</p>
              {r.skipped_manifest.map(m => (
                <p key={m.detection_id}><code>{m.detection_id.slice(0, 8)}</code> · {m.reason}</p>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function OutputCard({ out }: { out: Output }) {
  return (
    <div className="bg-white rounded-xl border p-5 mb-6 shadow-card-dark" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-bold" style={{ color: TEAL }}>APPROVED RECOMMENDATIONS, AS THE REPORT SECTION WOULD RENDER THEM</p>
        <p className="text-[12px]" style={{ color: MINT }}>
          {out.summary.needs_recommendation_count} finding{out.summary.needs_recommendation_count === 1 ? '' : 's'} still need a rule · {out.summary.superseded_count} superseded
        </p>
      </div>
      {out.tiers.map(t => {
        const items: OutputItem[] = (Object.values(t).find(v => Array.isArray(v)) as OutputItem[]) ?? [];
        return (
          <div key={t.tier} className="mb-4">
            <p className="text-[13px] font-bold mb-2" style={{ color: TIER_COLOR[t.tier] ?? TEAL }}>
              Tier {t.tier} · {t.label} <span className="font-normal" style={{ color: MINT }}>· {items.length} record{items.length === 1 ? '' : 's'}</span>
            </p>
            {items.length === 0 && <p className="text-[12px]" style={{ color: MINT }}>None approved in this tier.</p>}
            {items.map(it => (
              <div key={it.record_id} className="flex items-start gap-3 rounded-lg border p-3 mb-2" style={{ borderColor: BORDER, background: SURFACE }}>
                <span className="text-[12px] font-black px-2 py-0.5 rounded-md" style={{ background: TEAL, color: 'white' }}>x{it.quantity}</span>
                <div>
                  <p className="text-[14px]" style={{ color: TEAL }}>{it.recommendation_text}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: MINT }}>{it.action_class} · {it.detection_ids.length} finding{it.detection_ids.length === 1 ? '' : 's'}</p>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function RecordsTable({ recs }: { recs: Rec[] }) {
  return (
    <div className="bg-white rounded-xl border p-5 shadow-card-dark" style={{ borderColor: BORDER }}>
      <p className="text-[12px] font-bold mb-3" style={{ color: TEAL }}>RECORDS ({recs.length})</p>
      {recs.length === 0 && <p className="text-[13px]" style={{ color: MINT }}>No records for this selection.</p>}
      {recs.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: MINT }}>
              <th className="text-left font-semibold pb-2">Status</th>
              <th className="text-left font-semibold pb-2">Finding</th>
              <th className="text-left font-semibold pb-2">Severity</th>
              <th className="text-left font-semibold pb-2">Tier</th>
              <th className="text-left font-semibold pb-2">Recommendation (verbatim from rule)</th>
              <th className="text-right font-semibold pb-2">Findings</th>
              <th className="text-right font-semibold pb-2">Rule v</th>
            </tr>
          </thead>
          <tbody>
            {recs.map(r => {
              const st = STATUS_STYLE[r.status] ?? { bg: '#E5E7EB', fg: '#374151' };
              return (
                <tr key={r.id} className="border-t align-top" style={{ borderColor: BORDER, color: TEAL }}>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{r.status}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="font-medium capitalize">{r.detection_class ?? '—'}</span>
                    <span className="block text-[11px]" style={{ color: MINT }}>{r.inspection_name}</span>
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {r.severity.map(s => <span key={s} className="font-bold mr-1" style={{ color: SEV_COLOR[s] ?? TEAL }}>{s}</span>)}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap" style={{ color: r.tier ? TIER_COLOR[r.tier] : MINT }}>
                    {r.tier ? `${r.tier} · ${r.tier_label}` : '—'}
                  </td>
                  <td className="py-2 pr-2">
                    {r.recommendation_text ?? <span style={{ color: MINT }}>No rule matches this class and severity yet.</span>}
                    {r.action_class && <span className="block text-[11px]" style={{ color: MINT }}>{r.action_class}</span>}
                  </td>
                  <td className="py-2 text-right">{r.detections}</td>
                  <td className="py-2 text-right">{r.rule_version ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

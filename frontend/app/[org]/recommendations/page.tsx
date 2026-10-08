'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, ShieldCheck, Loader2, AlertTriangle, ChevronDown, ChevronRight, Download,
  Play, Check, X, Plus, Upload, Archive, History, BookOpen, ListChecks, ScrollText,
} from 'lucide-react';

import { recommendationsApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

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
const SEV_COLOR: Record<string, string> = { S1: '#16a34a', S2: '#d97706', S3: '#ea580c', S4: '#dc2626' };
const TIER_COLOR: Record<number, string> = { 1: '#dc2626', 2: '#ea580c', 3: '#0891B2' };
const INSPECTION_STATUS: Record<string, string> = {
  pending: 'Pending', processing: 'Processing', completed: 'Analysis done, not reviewed',
  pending_review: 'Review in progress', review_completed: 'Review completed', failed: 'Failed',
};

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
  inspections: { id: string; name: string; status: string }[];
  can_review: boolean;
  role: string;
};
type Rec = {
  id: string; status: string; rollup_scope: string; scope_key: string; inspection_id: string | null;
  inspection_name: string; detection_class: string | null; severity: string[]; detections: number;
  rule_version: number | null; rule_id: string | null; tier: number | null; tier_label: string | null;
  action_class: string | null; recommendation_text: string | null; supersedes_record_id: string | null;
  supersede_reason: string | null;
};
type OutputItem = { record_id: string; recommendation_text: string; action_class: string; quantity: number; detection_ids: string[] };
type Output = {
  tiers: { tier: number; label: string; [k: string]: any }[];
  summary: { approved_counts_by_tier: Record<string, number>; needs_recommendation_count: number; superseded_count: number };
};
type Rule = {
  entry_id: string; version: number; is_active: boolean; detection_class: string; severity: number;
  asset_type: string | null; asset_id: string | null; recommendation_text: string; action_class: string;
  derived_tier: number; created_by: string | null;
};
type AuditEvent = { id: number; created_at: string; actor: string; action: string; entity_type: string; entity_id: string; detail: any };

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function errText(e: any, fallback: string) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (d?.message) return d.message;
  return fallback;
}

export default function RecommendationsPage() {
  const [tab, setTab] = useState<'review' | 'library' | 'audit'>('review');
  const overviewQ = useQuery<Overview>({ queryKey: ['rec-overview'], queryFn: () => recommendationsApi.overview() });
  const ov = overviewQ.data;

  return (
    <div className="p-8">
      <div className="mb-5">
        <h1 className="text-[24px] font-black mb-1" style={{ color: TEAL }}>Recommendations</h1>
        <p className="text-[13px]" style={{ color: MINT }}>
          Repair recommendations for engineer reviewed findings, matched from your rule library. Approved ones go into the report.
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        {([['review', 'Review queue', ListChecks], ['library', 'Rule library', BookOpen], ['audit', 'Audit trail', ScrollText]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 text-[13px] font-bold px-3.5 py-2 rounded-lg border"
            style={tab === key ? { background: TEAL, color: 'white', borderColor: TEAL } : { background: 'white', color: TEAL, borderColor: BORDER }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {overviewQ.isLoading && <Loading text="Loading engine state…" />}
      {overviewQ.error && <ErrorBox error={overviewQ.error} />}
      {ov && tab === 'review' && <ReviewTab ov={ov} />}
      {ov && tab === 'library' && <LibraryTab ov={ov} />}
      {ov && tab === 'audit' && <AuditTab />}
    </div>
  );
}

/* ----------------------------------------------------------------- shared bits */

function Loading({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-xl border p-12 text-center" style={{ borderColor: BORDER }}>
      <Loader2 size={28} className="animate-spin mx-auto mb-3" style={{ color: BRAND }} />
      <p className="text-[13px]" style={{ color: MINT }}>{text}</p>
    </div>
  );
}

function ErrorBox({ error }: { error: any }) {
  return (
    <div className="bg-white rounded-xl border p-8 flex items-start gap-3" style={{ borderColor: '#FECACA' }}>
      <AlertTriangle size={22} className="text-red-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-[14px] font-semibold text-red-700">Could not load recommendations</p>
        <p className="text-[13px] text-red-600 mt-0.5">{errText(error, String(error?.message ?? ''))}</p>
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, right, children }: { title: string; icon?: any; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border p-5 shadow-card-dark" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={18} style={{ color: BRAND }} />}
          <p className="text-[12px] font-bold" style={{ color: TEAL }}>{title}</p>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Btn({ onClick, disabled, kind = 'primary', children }: { onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'ghost' | 'danger' | 'ok'; children: React.ReactNode }) {
  const style = kind === 'primary' ? { background: TEAL, color: 'white', borderColor: TEAL }
    : kind === 'ok' ? { background: '#166534', color: 'white', borderColor: '#166534' }
    : kind === 'danger' ? { background: 'white', color: '#991B1B', borderColor: '#FECACA' }
    : { background: 'white', color: TEAL, borderColor: BORDER };
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg border disabled:opacity-50" style={style}>
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- review tab */

function ReviewTab({ ov }: { ov: Overview }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [inspectionId, setInspectionId] = useState<string>('');
  const [openRun, setOpenRun] = useState<string>('');
  const [allowUnreviewed, setAllowUnreviewed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const recordsQ = useQuery<Rec[]>({ queryKey: ['rec-records', inspectionId], queryFn: () => recommendationsApi.records(inspectionId || undefined) });
  const outputQ  = useQuery<Output>({ queryKey: ['rec-output', inspectionId], queryFn: () => recommendationsApi.output(inspectionId || undefined) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['rec-overview'] });
    queryClient.invalidateQueries({ queryKey: ['rec-records'] });
    queryClient.invalidateQueries({ queryKey: ['rec-output'] });
  };

  const runM = useMutation({
    mutationFn: () => recommendationsApi.run(inspectionId, { allow_unreviewed: allowUnreviewed }),
    onSuccess: (res: any) => {
      const r = res.run;
      toast.success(`${res.rerun ? 'Rerun' : 'Run'} done: ${r.total_matched} matched, ${r.total_unmatched} unmatched, ${r.total_dismissed} dismissed, ${r.total_skipped} skipped of ${r.total_detections}`);
      refresh();
    },
    onError: (e: any) => toast.error(errText(e, 'The engine did not run')),
  });
  const decideM = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      decision === 'approve' ? recommendationsApi.approve(id) : recommendationsApi.reject(id),
    onSuccess: (rec: any) => { toast.success(`${rec.status}: ${rec.detection_class ?? ''} ${rec.severity?.join(' ') ?? ''}`); refresh(); },
    onError: (e: any) => toast.error(errText(e, 'Not applied')),
  });
  const bulkM = useMutation({
    mutationFn: (ids: string[]) => recommendationsApi.bulk('approve', ids),
    onSuccess: (res: any) => { toast.success(`Approved ${res.succeeded?.length ?? 0} records`); refresh(); },
    onError: (e: any) => toast.error(errText(e, 'Bulk approve failed')),
  });

  async function downloadPdf() {
    if (!inspectionId) return;
    setDownloading(true);
    try {
      const blob = await recommendationsApi.pdf(inspectionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'recommendations.pdf'; a.click();
      URL.revokeObjectURL(url);
      toast.success('PDF issued and archived');
      queryClient.invalidateQueries({ queryKey: ['rec-audit'] });
    } catch (e: any) {
      toast.error(e?.response?.status === 422 ? 'No approved recommendations for this inspection yet.' : 'Could not issue the PDF.');
    } finally { setDownloading(false); }
  }

  const selected = ov.inspections.find(i => i.id === inspectionId);
  const runs = inspectionId ? ov.runs.filter(r => r.inspection_id === inspectionId) : ov.runs;
  const recs = recordsQ.data ?? [];
  const drafts = recs.filter(r => r.status === 'Draft');
  const canReview = ov.can_review;

  return (
    <>
      <KpiRow ov={ov} />

      <div className="bg-white rounded-xl border p-5 mb-6 shadow-card-dark" style={{ borderColor: BORDER }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-[12px] font-bold mb-2" style={{ color: TEAL }}>INSPECTION</label>
            <select
              value={inspectionId}
              onChange={(e) => setInspectionId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-[14px] bg-white"
              style={{ borderColor: BORDER, color: TEAL }}
            >
              <option value="">All inspections</option>
              {ov.inspections.map(i => <option key={i.id} value={i.id}>{i.name} · {INSPECTION_STATUS[i.status] ?? i.status}</option>)}
            </select>
          </div>
          {inspectionId && canReview && (
            <Btn onClick={() => runM.mutate()} disabled={runM.isPending}>
              {runM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {runs.length ? 'Rerun engine' : 'Run engine'}
            </Btn>
          )}
          {inspectionId && (
            <Btn kind="ghost" onClick={downloadPdf} disabled={downloading}>
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Issue PDF
            </Btn>
          )}
        </div>
        {selected && selected.status !== 'review_completed' && canReview && (
          <label className="flex items-center gap-2 mt-3 text-[12px]" style={{ color: '#92400E' }}>
            <input type="checkbox" checked={allowUnreviewed} onChange={e => setAllowUnreviewed(e.target.checked)} />
            This inspection is {INSPECTION_STATUS[selected.status]?.toLowerCase() ?? selected.status}. The engine only runs on a completed review; tick to run on unreviewed findings anyway (development only, recorded in the audit trail).
          </label>
        )}
        {!canReview && (
          <p className="text-[12px] mt-3" style={{ color: MINT }}>Your role ({ov.role}) is read only here. Running the engine, approving and rejecting need an admin or analyst.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 space-y-6">
          <RunsCard runs={runs} openRun={openRun} setOpenRun={setOpenRun} />
        </div>
        <VocabularyCard vocabularies={ov.vocabularies} rules={ov.library.active_rules} />
      </div>

      <Card
        title={`RECORDS (${recs.length})`}
        right={canReview && drafts.length > 1 ? (
          <Btn kind="ok" onClick={() => bulkM.mutate(drafts.map(d => d.id))} disabled={bulkM.isPending}>
            <Check size={14} /> Approve all {drafts.length} drafts
          </Btn>
        ) : null}
      >
        {recordsQ.isLoading ? <Loading text="Loading records…" /> : (
          <RecordsTable recs={recs} canReview={canReview} onDecide={(id, decision) => decideM.mutate({ id, decision })} busy={decideM.isPending} />
        )}
      </Card>

      <div className="mt-6">
        {outputQ.data && <OutputCard out={outputQ.data} />}
      </div>
    </>
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
    <Card title="SIGNED VOCABULARY" icon={ShieldCheck}>
      {vocabularies.length === 0 && <p className="text-[13px]" style={{ color: MINT }}>No vocabulary loaded.</p>}
      {vocabularies.map(v => (
        <div key={v.producer + v.version} className="mb-3">
          <p className="text-[14px] font-semibold" style={{ color: TEAL }}>
            {v.producer} v{v.version}
            <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: v.status === 'signed' ? '#DCFCE7' : '#FEF3C7', color: v.status === 'signed' ? '#166534' : '#92400E' }}>
              {v.status.toUpperCase()}
            </span>
          </p>
          <p className="text-[12px] mt-1" style={{ color: MINT }}>hash <code>{v.hash}</code> · weights <code>{v.weights_sha256.slice(0, 12)}…</code></p>
          <p className="text-[12px]" style={{ color: MINT }}>{v.signed_by ? `Signed by ${v.signed_by}` : 'Not signed'}{v.signed_at ? ` · ${new Date(v.signed_at).toLocaleDateString()}` : ''}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {v.classes.map(c => <span key={c} className="text-[11px] px-2 py-0.5 rounded-md border" style={{ borderColor: BORDER, color: TEAL, background: SURFACE }}>{c}</span>)}
          </div>
        </div>
      ))}
      <p className="text-[12px] mt-3 pt-3 border-t" style={{ borderColor: BORDER, color: MINT }}>{rules} active rule{rules === 1 ? '' : 's'} in this organization&apos;s library.</p>
    </Card>
  );
}

function RunsCard({ runs, openRun, setOpenRun }: { runs: Run[]; openRun: string; setOpenRun: (id: string) => void }) {
  return (
    <Card title="RESOLUTION RUNS" icon={ClipboardList}>
      {runs.length === 0 && <p className="text-[13px]" style={{ color: MINT }}>No runs yet. Pick an inspection with a completed review and run the engine.</p>}
      {runs.length > 0 && (
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
              return <RunRows key={r.id} r={r} open={open} ok={ok} toggle={() => setOpenRun(open ? '' : r.id)} />;
            })}
          </tbody>
        </table>
      )}
    </Card>
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
              {r.skipped_manifest.map(m => <p key={m.detection_id}><code>{m.detection_id.slice(0, 8)}</code> · {m.reason}</p>)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RecordsTable({ recs, canReview, onDecide, busy }: { recs: Rec[]; canReview: boolean; onDecide: (id: string, d: 'approve' | 'reject') => void; busy: boolean }) {
  if (recs.length === 0) return <p className="text-[13px]" style={{ color: MINT }}>No records for this selection.</p>;
  return (
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
          {canReview && <th className="text-right font-semibold pb-2">Decision</th>}
        </tr>
      </thead>
      <tbody>
        {recs.map(r => {
          const st = STATUS_STYLE[r.status] ?? { bg: '#E5E7EB', fg: '#374151' };
          return (
            <tr key={r.id} className="border-t align-top" style={{ borderColor: BORDER, color: TEAL }}>
              <td className="py-2 pr-2 whitespace-nowrap">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{r.status}</span>
                {r.supersede_reason && <span className="block text-[10px] mt-1" style={{ color: MINT }}>{r.supersede_reason.replace('_', ' ')}</span>}
              </td>
              <td className="py-2 pr-2">
                <span className="font-medium capitalize">{r.detection_class ?? '—'}</span>
                <span className="block text-[11px]" style={{ color: MINT }}>{r.inspection_name}</span>
              </td>
              <td className="py-2 pr-2 whitespace-nowrap">
                {r.severity.map(s => <span key={s} className="font-bold mr-1" style={{ color: SEV_COLOR[s] ?? TEAL }}>{s}</span>)}
              </td>
              <td className="py-2 pr-2 whitespace-nowrap" style={{ color: r.tier ? TIER_COLOR[r.tier] : MINT }}>{r.tier ? `${r.tier} · ${r.tier_label}` : '—'}</td>
              <td className="py-2 pr-2">
                {r.recommendation_text ?? <span style={{ color: MINT }}>No rule matches this class and severity yet.</span>}
                {r.action_class && <span className="block text-[11px]" style={{ color: MINT }}>{r.action_class}</span>}
              </td>
              <td className="py-2 text-right">{r.detections}</td>
              <td className="py-2 text-right">{r.rule_version ?? '—'}</td>
              {canReview && (
                <td className="py-2 text-right whitespace-nowrap">
                  {r.status === 'Draft' && (
                    <span className="inline-flex gap-1.5">
                      <Btn kind="ok" onClick={() => onDecide(r.id, 'approve')} disabled={busy}><Check size={13} /> Approve</Btn>
                      <Btn kind="danger" onClick={() => onDecide(r.id, 'reject')} disabled={busy}><X size={13} /> Reject</Btn>
                    </span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OutputCard({ out }: { out: Output }) {
  return (
    <Card
      title="APPROVED RECOMMENDATIONS, AS THE REPORT SECTION RENDERS THEM"
      right={<p className="text-[12px]" style={{ color: MINT }}>{out.summary.needs_recommendation_count} finding{out.summary.needs_recommendation_count === 1 ? '' : 's'} still need a rule · {out.summary.superseded_count} superseded</p>}
    >
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
    </Card>
  );
}

/* ----------------------------------------------------------------- library tab */

const EMPTY_RULE = { detection_class: '', severity: 4, asset_type: '', asset_id: '', recommendation_text: '', action_class: '', tier_override: '' };

function LibraryTab({ ov }: { ov: Overview }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_RULE);
  const [editing, setEditing] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ row: number; error: string }[]>([]);
  const [importing, setImporting] = useState(false);

  const rulesQ = useQuery<Rule[]>({ queryKey: ['rec-library', showArchived], queryFn: () => recommendationsApi.library(showArchived) });
  const classes = useMemo(() => Array.from(new Set(ov.vocabularies.flatMap(v => v.classes))).sort(), [ov.vocabularies]);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['rec-library'] }); queryClient.invalidateQueries({ queryKey: ['rec-overview'] }); };

  const body = () => ({
    detection_class: form.detection_class, severity: Number(form.severity),
    asset_type: form.asset_type || null, asset_id: form.asset_id || null,
    recommendation_text: form.recommendation_text, action_class: form.action_class,
    tier_override: form.tier_override ? Number(form.tier_override) : null,
  });
  const saveM = useMutation({
    mutationFn: () => editing ? recommendationsApi.editRule(editing, body()) : recommendationsApi.createRule(body()),
    onSuccess: () => { toast.success(editing ? 'Rule updated (new version)' : 'Rule added'); setForm(EMPTY_RULE); setEditing(null); refresh(); },
    onError: (e: any) => toast.error(errText(e, 'Could not save the rule')),
  });
  const archiveM = useMutation({
    mutationFn: (id: string) => recommendationsApi.archiveRule(id),
    onSuccess: () => { toast.success('Rule archived'); refresh(); },
    onError: (e: any) => toast.error(errText(e, 'Could not archive')),
  });

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setProblems([]);
    try {
      const res = await recommendationsApi.importRules(file);
      toast.success(`Imported ${res.created} rules`);
      refresh();
    } catch (err: any) {
      const d = err?.response?.data?.detail;
      if (d?.problems) { setProblems(d.problems); toast.error(d.message); } else toast.error(errText(err, 'Import failed'));
    } finally { setImporting(false); e.target.value = ''; }
  }

  function template() {
    const csv = 'detection_class,severity,recommendation_text,action_class,asset_type,asset_id,tier_override\ncorrosion,4,Remove section loss and weld a new plate within 30 days.,structural repair,,,\nbiological growth,2,Pressure wash and log coverage at the next routine inspection.,cleaning,,,\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'rules_template.csv'; a.click(); URL.revokeObjectURL(url);
  }

  const rules = rulesQ.data ?? [];
  const canEdit = ov.can_review;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card
          title={`RULES (${rules.length})`}
          icon={BookOpen}
          right={
            <label className="flex items-center gap-2 text-[12px]" style={{ color: MINT }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> show archived
            </label>
          }
        >
          {rulesQ.isLoading ? <Loading text="Loading rules…" /> : rules.length === 0 ? (
            <p className="text-[13px]" style={{ color: MINT }}>No rules yet. Add one on the right or import a spreadsheet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: MINT }}>
                  <th className="text-left font-semibold pb-2">Finding</th>
                  <th className="text-left font-semibold pb-2">Sev</th>
                  <th className="text-left font-semibold pb-2">Scope</th>
                  <th className="text-left font-semibold pb-2">Tier</th>
                  <th className="text-left font-semibold pb-2">Recommendation</th>
                  <th className="text-right font-semibold pb-2">v</th>
                  {canEdit && <th className="text-right font-semibold pb-2"></th>}
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.entry_id} className="border-t align-top" style={{ borderColor: BORDER, color: r.is_active ? TEAL : MINT }}>
                    <td className="py-2 pr-2 capitalize font-medium">{r.detection_class}{!r.is_active && <span className="block text-[10px]">archived</span>}</td>
                    <td className="py-2 pr-2 font-bold" style={{ color: SEV_COLOR[`S${r.severity}`] }}>S{r.severity}</td>
                    <td className="py-2 pr-2 text-[12px]">{r.asset_id ? `asset ${r.asset_id.slice(0, 8)}` : r.asset_type ? r.asset_type : 'any'}</td>
                    <td className="py-2 pr-2 whitespace-nowrap" style={{ color: TIER_COLOR[r.derived_tier] }}>{r.derived_tier} · {ov.tiers[String(r.derived_tier)] ?? ''}</td>
                    <td className="py-2 pr-2">{r.recommendation_text}<span className="block text-[11px]" style={{ color: MINT }}>{r.action_class}</span></td>
                    <td className="py-2 text-right">{r.version}</td>
                    {canEdit && (
                      <td className="py-2 text-right whitespace-nowrap">
                        {r.is_active && (
                          <span className="inline-flex gap-1.5">
                            <Btn kind="ghost" onClick={() => { setEditing(r.entry_id); setForm({ detection_class: r.detection_class, severity: r.severity, asset_type: r.asset_type ?? '', asset_id: r.asset_id ?? '', recommendation_text: r.recommendation_text, action_class: r.action_class, tier_override: '' }); }}>
                              <History size={13} /> Edit
                            </Btn>
                            <Btn kind="danger" onClick={() => { if (window.confirm('Archive this rule? Existing approved records keep pointing at the version they were approved against.')) archiveM.mutate(r.entry_id); }}>
                              <Archive size={13} /> Archive
                            </Btn>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        {canEdit && (
          <Card title={editing ? 'EDIT RULE (MAKES A NEW VERSION)' : 'ADD RULE'} icon={Plus}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveM.mutate(); }}>
              <Field label="Finding class">
                <select value={form.detection_class} onChange={e => setForm({ ...form, detection_class: e.target.value })} className={inputCls} style={inputStyle} required>
                  <option value="">Choose…</option>
                  {classes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Severity">
                <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })} className={inputCls} style={inputStyle}>
                  {[4, 3, 2, 1].map(s => <option key={s} value={s}>S{s}{s === 4 ? ' severe' : s === 3 ? ' advanced' : s === 2 ? ' moderate' : ' minor'}</option>)}
                </select>
              </Field>
              <Field label="Recommendation text (printed verbatim)">
                <textarea value={form.recommendation_text} onChange={e => setForm({ ...form, recommendation_text: e.target.value })} rows={3} className={inputCls} style={inputStyle} required />
              </Field>
              <Field label="Action class">
                <input value={form.action_class} onChange={e => setForm({ ...form, action_class: e.target.value })} placeholder="structural repair, coating, cleaning…" className={inputCls} style={inputStyle} required />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Asset type (optional)">
                  <input value={form.asset_type} onChange={e => setForm({ ...form, asset_type: e.target.value })} placeholder="coastal" className={inputCls} style={inputStyle} />
                </Field>
                <Field label="Asset id (optional)">
                  <input value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })} className={inputCls} style={inputStyle} />
                </Field>
              </div>
              <Field label="Tier override (optional, more urgent only)">
                <select value={form.tier_override} onChange={e => setForm({ ...form, tier_override: e.target.value })} className={inputCls} style={inputStyle}>
                  <option value="">derive from severity</option>
                  <option value="1">1 · Immediate action</option>
                  <option value="2">2 · Planned repair</option>
                </select>
              </Field>
              <div className="flex gap-2 justify-end">
                {editing && <Btn kind="ghost" onClick={() => { setEditing(null); setForm(EMPTY_RULE); }}>Cancel</Btn>}
                <button type="submit" disabled={saveM.isPending} className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: TEAL }}>
                  {saveM.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {editing ? 'Save new version' : 'Add rule'}
                </button>
              </div>
            </form>
          </Card>
        )}

        {canEdit && (
          <Card title="IMPORT FROM SPREADSHEET" icon={Upload}>
            <p className="text-[12px] mb-3" style={{ color: MINT }}>
              A CSV with detection_class, severity, recommendation_text, action_class and the optional asset_type, asset_id, tier_override. Every row is validated like a single rule. One bad row and nothing is written.
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: BORDER, color: TEAL }}>
                <Upload size={13} /> {importing ? 'Importing…' : 'Choose CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={onImport} disabled={importing} />
              </label>
              <Btn kind="ghost" onClick={template}><Download size={13} /> Template</Btn>
            </div>
            {problems.length > 0 && (
              <div className="rounded-lg border p-3 text-[12px] mt-3" style={{ borderColor: '#FECACA', background: '#FEF2F2', color: '#991B1B' }}>
                <p className="font-bold mb-1">Nothing imported. Fix these rows:</p>
                {problems.map(p => <p key={p.row}>row {p.row}: {p.error}</p>)}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg border text-[13px] bg-white';
const inputStyle = { borderColor: BORDER, color: TEAL };
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold mb-1" style={{ color: MINT }}>{label.toUpperCase()}</label>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- audit tab */

function AuditTab() {
  const auditQ = useQuery<AuditEvent[]>({ queryKey: ['rec-audit'], queryFn: () => recommendationsApi.audit({ limit: 200 }) });
  const events = [...(auditQ.data ?? [])].reverse();
  return (
    <Card title={`AUDIT TRAIL (${events.length}, append only)`} icon={ScrollText}>
      {auditQ.isLoading ? <Loading text="Loading audit trail…" /> : events.length === 0 ? (
        <p className="text-[13px]" style={{ color: MINT }}>Nothing recorded yet.</p>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: MINT }}>
              <th className="text-left font-semibold pb-2">When</th>
              <th className="text-left font-semibold pb-2">Who</th>
              <th className="text-left font-semibold pb-2">Action</th>
              <th className="text-left font-semibold pb-2">On</th>
              <th className="text-left font-semibold pb-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id} className="border-t align-top" style={{ borderColor: BORDER, color: TEAL }}>
                <td className="py-1.5 pr-2 whitespace-nowrap" style={{ color: MINT }}>{fmtDate(e.created_at)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{e.actor}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap font-medium">{e.action}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{e.entity_type} <code>{String(e.entity_id).slice(0, 8)}</code></td>
                <td className="py-1.5 pr-2" style={{ color: MINT }}>{e.detail ? JSON.stringify(e.detail).slice(0, 160) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

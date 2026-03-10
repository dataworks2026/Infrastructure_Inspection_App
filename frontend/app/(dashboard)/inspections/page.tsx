'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inspectionsApi, assetsApi } from '@/lib/api';
import {
  Plus, ChevronUp, ChevronDown, ArrowRight, Trash2,
  ClipboardList, ImageIcon, Calendar, Building2, CheckCircle, Clock, Activity,
} from 'lucide-react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

type StatusFilter = 'all' | 'completed' | 'pending' | 'processing';
type SortKey      = 'name' | 'asset' | 'images' | 'date' | 'status';
type SortDir      = 'asc' | 'desc';

const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';   // accent (was lime #DAFDA3)
const BRAND = '#0891B2';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
    completed:  { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', icon: <CheckCircle size={10} /> },
    pending:    { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', icon: <Clock size={10} /> },
    processing: { bg: '#E0F2FE', text: '#0C4A6E', border: '#BAE6FD', icon: <Activity size={10} /> },
  };
  const s = styles[status] || { bg: MINT, text: '#6B9A87', border: '#C8E6D4', icon: null };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
      {s.icon}{status}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="inline-flex flex-col ml-1" style={{ opacity: active ? 1 : 0.3 }}>
      <ChevronUp size={9} style={{ color: active && dir === 'asc' ? TEAL : '#6B9A87', marginBottom: -2 }} />
      <ChevronDown size={9} style={{ color: active && dir === 'desc' ? TEAL : '#6B9A87' }} />
    </span>
  );
}

export default function InspectionsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['inspections'],
    queryFn: inspectionsApi.list,
  });
  const { data: assets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: assetsApi.list,
  });

  const assetMap = useMemo(
    () => Object.fromEntries((assets as any[]).map((a: any) => [a.id, a])),
    [assets]
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inspectionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections'] });
      showToast('Inspection deleted', 'success');
      setDeleteTarget(null);
    },
    onError: () => showToast('Delete failed', 'error'),
  });

  const counts = useMemo(() => {
    const all: Record<StatusFilter, number> = { all: 0, completed: 0, pending: 0, processing: 0 };
    (inspections as any[]).forEach((i: any) => {
      all.all++;
      if (i.status in all) all[i.status as StatusFilter]++;
    });
    return all;
  }, [inspections]);

  const filtered = useMemo(() => {
    let list = statusFilter === 'all'
      ? [...(inspections as any[])]
      : (inspections as any[]).filter((i: any) => i.status === statusFilter);

    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a: any, b: any) => {
      switch (sortKey) {
        case 'name':   return dir * a.name.localeCompare(b.name);
        case 'asset':  return dir * ((assetMap[a.asset_id]?.name || '').localeCompare(assetMap[b.asset_id]?.name || ''));
        case 'images': return dir * ((a.image_count || 0) - (b.image_count || 0));
        case 'date':   return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case 'status': return dir * a.status.localeCompare(b.status);
        default:       return 0;
      }
    });
    return list;
  }, [inspections, statusFilter, sortKey, sortDir, assetMap]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'completed', label: 'Completed' },
    { key: 'pending', label: 'Pending' },
    { key: 'processing', label: 'Processing' },
  ];

  const ColHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)}
      className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wider transition-colors"
      style={{ color: sortKey === k ? TEAL : '#6B9A87', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      onMouseEnter={e => (e.currentTarget.style.color = TEAL)}
      onMouseLeave={e => (e.currentTarget.style.color = sortKey === k ? TEAL : '#6B9A87')}>
      {label}<SortIcon active={sortKey === k} dir={sortDir} />
    </button>
  );

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: TEAL }}>Inspections</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B9A87' }}>All inspection records · {counts.all} total</p>
        </div>
        <Link href="/upload"
          className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm hover:shadow-md transition-all"
          style={{ background: TEAL, color: BLUE }}>
          <Plus size={14} color={BLUE} /> New Inspection
        </Link>
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className="flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-full transition-all"
            style={statusFilter === key
              ? { background: TEAL, color: BLUE, boxShadow: '0 2px 8px rgba(8,46,41,0.2)', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }
              : { background: '#fff', color: '#2E6B5B', border: '1px solid #C8E6D4', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => { if (statusFilter !== key) (e.currentTarget as HTMLElement).style.borderColor = '#A5D4BB'; }}
            onMouseLeave={e => { if (statusFilter !== key) (e.currentTarget as HTMLElement).style.borderColor = '#C8E6D4'; }}>
            {label}
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
              style={statusFilter === key
                ? { background: 'rgba(147,197,253,0.15)', color: BLUE }
                : { background: MINT, color: '#6B9A87' }}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="bg-white border border-[#C8E6D4] rounded-2xl shadow-sm overflow-hidden">

        {/* Column headers */}
        <div className="grid items-center px-5 py-3"
          style={{
            gridTemplateColumns: '2fr 1.5fr 80px 130px 130px 36px 36px',
            borderBottom: '1px solid #EDF6F0',
            background: MINT,
          }}>
          <ColHeader k="name"   label="Name" />
          <ColHeader k="asset"  label="Asset" />
          <ColHeader k="images" label="Images" />
          <ColHeader k="date"   label="Date" />
          <ColHeader k="status" label="Status" />
          <div /><div />
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="divide-y divide-[#EDF6F0]">
            {[...Array(5)].map((_, i) => <TableRowSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ClipboardList size={36} className="mb-3" style={{ color: '#C8E6D4' }} />
            <p className="text-sm font-medium" style={{ color: '#6B9A87' }}>No inspections found</p>
            <Link href="/upload" className="text-xs font-medium mt-2 hover:underline" style={{ color: BRAND }}>
              Create your first inspection →
            </Link>
          </div>
        ) : (
          <div>
            {filtered.map((insp: any) => {
              const asset = assetMap[insp.asset_id];
              return (
                <div key={insp.id}
                  className="group grid items-center px-5 py-3.5 cursor-pointer"
                  style={{
                    gridTemplateColumns: '2fr 1.5fr 80px 130px 130px 36px 36px',
                    borderBottom: '1px solid #EDF6F0',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F4FBF7')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                  {/* Name */}
                  <Link href={`/inspections/${insp.id}`} className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: MINT, border: '1px solid #C8E6D4', color: TEAL }}>
                      <ClipboardList size={13} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate hover:underline" style={{ color: TEAL }}>
                        {insp.name}
                      </p>
                    </div>
                  </Link>

                  {/* Asset */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Building2 size={12} style={{ color: '#6B9A87', flexShrink: 0 }} />
                    <span className="text-[13px] truncate" style={{ color: '#2E6B5B' }}>
                      {asset?.name || '—'}
                    </span>
                  </div>

                  {/* Images */}
                  <div className="flex items-center gap-1.5">
                    <ImageIcon size={12} style={{ color: '#6B9A87' }} />
                    <span className="text-[13px] font-mono font-semibold" style={{ color: TEAL }}>
                      {insp.image_count ?? '—'}
                    </span>
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1.5">
                    <Calendar size={12} style={{ color: '#6B9A87' }} />
                    <span className="text-[13px]" style={{ color: '#2E6B5B' }}>
                      {insp.created_at
                        ? new Date(insp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : '—'}
                    </span>
                  </div>

                  {/* Status */}
                  <div><StatusBadge status={insp.status} /></div>

                  {/* Arrow */}
                  <Link href={`/inspections/${insp.id}`}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                    style={{ background: MINT, color: TEAL }}>
                    <ArrowRight size={13} />
                  </Link>

                  {/* Delete */}
                  <button onClick={() => setDeleteTarget(insp.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 hover:bg-red-50"
                    style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}

            {/* Footer */}
            <div className="px-5 py-3 text-[12px]" style={{ color: '#6B9A87', background: MINT, borderTop: '1px solid #C8E6D4' }}>
              Showing {filtered.length} of {counts.all} inspection{counts.all !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete inspection"
          message="This will permanently delete the inspection and all associated images and detections."
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

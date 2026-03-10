'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inspectionsApi, assetsApi } from '@/lib/api';
import {
  ClipboardList, ImageIcon, Calendar, ArrowRight,
  ChevronUp, ChevronDown, ChevronsUpDown, Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { TableRowSkeleton } from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

type StatusFilter = 'all' | 'completed' | 'pending' | 'processing';
type SortKey      = 'name' | 'asset' | 'images' | 'date' | 'status';
type SortDir      = 'asc' | 'desc';

const STATUS_STYLES: Record<string, { wrap: string; dot: string; pulse?: boolean }> = {
  completed:  { wrap: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
  pending:    { wrap: 'bg-amber-500/10  text-amber-400  border-amber-500/20',     dot: 'bg-amber-400 status-pulse' },
  processing: { wrap: 'bg-sky-500/10    text-sky-400    border-sky-500/20',       dot: 'bg-sky-400 status-pulse'   },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { wrap: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold border ${s.wrap}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {status}
    </span>
  );
}

function SortIcon({ col, active, dir, userSorted }: { col: SortKey; active: SortKey; dir: SortDir; userSorted: boolean }) {
  if (!userSorted || col !== active) return <ChevronsUpDown size={12} className="text-card-faint opacity-40" />;
  return dir === 'asc'
    ? <ChevronUp   size={12} className="text-sky-400" />
    : <ChevronDown size={12} className="text-sky-400" />;
}

const FILTER_LABELS: { key: StatusFilter; label: string }[] = [
  { key: 'all',        label: 'All'        },
  { key: 'completed',  label: 'Completed'  },
  { key: 'pending',    label: 'Pending'    },
  { key: 'processing', label: 'Processing' },
];

export default function InspectionsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey]           = useState<SortKey>('date');
  const [sortDir, setSortDir]           = useState<SortDir>('desc');
  const [userHasSorted, setUserHasSorted] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: inspections = [], isLoading } = useQuery({ queryKey: ['inspections'], queryFn: () => inspectionsApi.list() });
  const { data: assets = [] }                 = useQuery({ queryKey: ['assets'],      queryFn: () => assetsApi.list() });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inspectionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Inspection deleted');
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error('Failed to delete inspection');
      setDeleteTarget(null);
    },
  });

  const assetMap = useMemo(() => Object.fromEntries((assets as any[]).map(a => [a.id, a])), [assets]);

  function handleSort(key: SortKey) {
    setUserHasSorted(true);
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    let list = (inspections as any[]).filter(i => statusFilter === 'all' || i.status === statusFilter);
    list = [...list].sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'name')   { av = a.name;                        bv = b.name; }
      if (sortKey === 'asset')  { av = assetMap[a.asset_id]?.name ?? ''; bv = assetMap[b.asset_id]?.name ?? ''; }
      if (sortKey === 'images') { av = a.image_count;                 bv = b.image_count; }
      if (sortKey === 'date')   { av = new Date(a.created_at);        bv = new Date(b.created_at); }
      if (sortKey === 'status') { av = a.status;                      bv = b.status; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1  : -1;
      return 0;
    });
    return list;
  }, [inspections, assetMap, statusFilter, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, completed: 0, pending: 0, processing: 0 };
    (inspections as any[]).forEach(i => { c.all++; if (i.status in c) (c as any)[i.status]++; });
    return c;
  }, [inspections]);

  const thClass = (key: SortKey) =>
    `flex items-center gap-1.5 text-[11px] font-bold text-card-muted uppercase tracking-wider cursor-pointer select-none hover:text-card-text transition-colors ${userHasSorted && sortKey === key ? 'text-sky-400' : ''}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 card-animate">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Inspections</h1>
          <p className="text-sm text-mira-muted mt-1">All inspection records</p>
        </div>
        <Link href="/upload"
          className="bg-gradient-to-r from-sky-500 to-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/35 hover:-translate-y-px transition-all">
          New Inspection
        </Link>
      </div>

      {/* Status filter chips */}
      <div className="card-animate flex items-center gap-2 mb-5" style={{ animationDelay: '60ms' }}>
        {FILTER_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              statusFilter === key
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                : 'bg-card-dark text-card-muted border border-card-border hover:border-card-border-hover hover:text-card-text'
            }`}
          >
            {label}
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
              statusFilter === key ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-600/60 text-slate-300'
            }`}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="bg-card-dark border border-card-border rounded-xl shadow-card-dark overflow-hidden card-animate" style={{ animationDelay: '120ms' }}>
          {[0,1,2,3,4].map(i => <TableRowSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-animate flex flex-col items-center justify-center py-20 bg-card-dark border border-card-border rounded-2xl shadow-card-dark" style={{ animationDelay: '120ms' }}>
          <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-4">
            <ClipboardList size={28} className="text-sky-400" />
          </div>
          <p className="text-base font-semibold text-card-text">
            {statusFilter === 'all' ? 'No inspections yet' : `No ${statusFilter} inspections`}
          </p>
          <p className="text-sm text-card-muted mt-1">
            {statusFilter === 'all' ? 'Upload images to create your first inspection.' : 'Try a different filter.'}
          </p>
          {statusFilter === 'all' && (
            <Link href="/upload"
              className="mt-5 inline-flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all">
              Upload Images
            </Link>
          )}
        </div>
      ) : (
        <div className="card-animate bg-card-dark border border-card-border rounded-xl shadow-card-dark overflow-hidden" style={{ animationDelay: '120ms' }}>
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1.5fr_80px_120px_120px_40px_40px] items-center gap-4 px-5 py-3 border-b border-card-border bg-slate-800/40">
            <button className={thClass('name')}   onClick={() => handleSort('name')}>   Name   <SortIcon col="name"   active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('asset')}  onClick={() => handleSort('asset')}>  Asset  <SortIcon col="asset"  active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('images')} onClick={() => handleSort('images')}> Images <SortIcon col="images" active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('date')}   onClick={() => handleSort('date')}>   Date   <SortIcon col="date"   active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('status')} onClick={() => handleSort('status')}> Status <SortIcon col="status" active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <div />
            <div />
          </div>

          {/* Table rows */}
          <div className="divide-y divide-card-border">
            {filtered.map((insp: any, i: number) => {
              const asset = assetMap[insp.asset_id];
              return (
                <div key={insp.id} className="grid grid-cols-[2fr_1.5fr_80px_120px_120px_40px_40px] items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors group">
                  {/* Name — clickable */}
                  <Link href={`/inspections/${insp.id}`} className="min-w-0">
                    <p className="text-[13px] font-semibold text-card-text group-hover:text-sky-300 transition-colors truncate">
                      {insp.name}
                    </p>
                  </Link>

                  {/* Asset */}
                  <Link href={`/inspections/${insp.id}`} className="min-w-0">
                    {asset ? (
                      <span className="text-[12px] text-card-muted truncate block">{asset.name}</span>
                    ) : (
                      <span className="text-[12px] text-card-faint">—</span>
                    )}
                  </Link>

                  {/* Images */}
                  <Link href={`/inspections/${insp.id}`} className="flex items-center gap-1.5">
                    <ImageIcon size={12} className="text-card-faint" />
                    <span className="text-[12px] text-card-muted font-mono">{insp.image_count}</span>
                  </Link>

                  {/* Date */}
                  <Link href={`/inspections/${insp.id}`} className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-card-faint" />
                    <span className="text-[12px] text-card-muted">
                      {new Date(insp.created_at).toLocaleDateString()}
                    </span>
                  </Link>

                  {/* Status */}
                  <Link href={`/inspections/${insp.id}`}>
                    <StatusChip status={insp.status} />
                  </Link>

                  {/* Arrow */}
                  <Link href={`/inspections/${insp.id}`} className="flex justify-end">
                    <ArrowRight size={14} className="text-card-faint group-hover:text-sky-400 transition-colors" />
                  </Link>

                  {/* Delete */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => setDeleteTarget({ id: insp.id, name: insp.name })}
                      className="p-1.5 rounded-lg text-card-faint hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                      title="Delete inspection"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer count */}
          <div className="px-5 py-3 border-t border-card-border bg-slate-800/20">
            <span className="text-[11px] text-card-faint">
              Showing {filtered.length} of {(inspections as any[]).length} inspections
            </span>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Inspection"
        message={`"${deleteTarget?.name}" and all its images and detections will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Inspection"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

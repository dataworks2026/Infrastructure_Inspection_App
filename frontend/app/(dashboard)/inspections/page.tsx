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

const TEAL  = '#082E29';
const BLUE  = '#93C5FD';

type StatusFilter = 'all' | 'completed' | 'pending' | 'processing';
type SortKey      = 'name' | 'asset' | 'images' | 'date' | 'status';
type SortDir      = 'asc' | 'desc';

function StatusChip({ status }: { status: string }) {
  if (status === 'completed')  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /> Completed
    </span>
  );
  if (status === 'pending') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" /> Pending
    </span>
  );
  if (status === 'processing') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold bg-sky-50 text-sky-700 border border-sky-200">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0" /> Processing
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      {status}
    </span>
  );
}

function SortIcon({ col, active, dir, userSorted }: { col: SortKey; active: SortKey; dir: SortDir; userSorted: boolean }) {
  if (!userSorted || col !== active) return <ChevronsUpDown size={12} className="text-slate-400 opacity-50" />;
  return dir === 'asc'
    ? <ChevronUp   size={12} style={{ color: TEAL }} />
    : <ChevronDown size={12} style={{ color: TEAL }} />;
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

  const [statusFilter, setStatusFilter]     = useState<StatusFilter>('all');
  const [sortKey, setSortKey]               = useState<SortKey>('date');
  const [sortDir, setSortDir]               = useState<SortDir>('desc');
  const [userHasSorted, setUserHasSorted]   = useState(false);
  const [deleteTarget, setDeleteTarget]     = useState<{ id: string; name: string } | null>(null);

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
      if (sortKey === 'name')   { av = a.name;                           bv = b.name; }
      if (sortKey === 'asset')  { av = assetMap[a.asset_id]?.name ?? ''; bv = assetMap[b.asset_id]?.name ?? ''; }
      if (sortKey === 'images') { av = a.image_count;                    bv = b.image_count; }
      if (sortKey === 'date')   { av = new Date(a.created_at);           bv = new Date(b.created_at); }
      if (sortKey === 'status') { av = a.status;                         bv = b.status; }
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
    `flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors ${userHasSorted && sortKey === key ? '' : 'text-slate-500 hover:text-slate-700'}`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEAL }}>Inspections</h1>
          <p className="text-sm text-slate-500 mt-1">All inspection records</p>
        </div>
        <Link href="/upload"
          className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 shadow-sm"
          style={{ background: TEAL, color: BLUE }}>
          New Inspection
        </Link>
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {FILTER_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-[12px] font-semibold transition-all"
            style={statusFilter === key
              ? { background: TEAL, color: BLUE, border: 'none' }
              : { background: 'white', color: '#64748b', border: '1px solid #C8E6D4' }
            }
          >
            {label}
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
              style={statusFilter === key
                ? { background: 'rgba(147,197,253,0.2)', color: BLUE }
                : { background: '#EDF6F0', color: '#6B9A87' }
              }>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#C8E6D4] rounded-xl shadow-sm overflow-hidden">
          {[0,1,2,3,4].map(i => <TableRowSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
            <ClipboardList size={28} style={{ color: TEAL }} />
          </div>
          <p className="text-base font-semibold text-slate-700">
            {statusFilter === 'all' ? 'No inspections yet' : `No ${statusFilter} inspections`}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {statusFilter === 'all' ? 'Upload images to create your first inspection.' : 'Try a different filter.'}
          </p>
          {statusFilter === 'all' && (
            <Link href="/upload"
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 shadow-sm"
              style={{ background: TEAL, color: BLUE }}>
              Upload Images
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white border border-[#C8E6D4] rounded-xl shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1.5fr_80px_120px_120px_40px_40px] items-center gap-4 px-5 py-3 border-b border-[#C8E6D4]" style={{ background: '#EDF6F0' }}>
            <button className={thClass('name')}   onClick={() => handleSort('name')}   style={userHasSorted && sortKey === 'name'   ? { color: TEAL } : {}}>Name   <SortIcon col="name"   active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('asset')}  onClick={() => handleSort('asset')}  style={userHasSorted && sortKey === 'asset'  ? { color: TEAL } : {}}>Asset  <SortIcon col="asset"  active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('images')} onClick={() => handleSort('images')} style={userHasSorted && sortKey === 'images' ? { color: TEAL } : {}}>Images <SortIcon col="images" active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('date')}   onClick={() => handleSort('date')}   style={userHasSorted && sortKey === 'date'   ? { color: TEAL } : {}}>Date   <SortIcon col="date"   active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <button className={thClass('status')} onClick={() => handleSort('status')} style={userHasSorted && sortKey === 'status' ? { color: TEAL } : {}}>Status <SortIcon col="status" active={sortKey} dir={sortDir} userSorted={userHasSorted} /></button>
            <div /><div />
          </div>

          {/* Table rows */}
          <div className="divide-y divide-[#EDF6F0]">
            {filtered.map((insp: any) => {
              const asset = assetMap[insp.asset_id];
              return (
                <div key={insp.id} className="grid grid-cols-[2fr_1.5fr_80px_120px_120px_40px_40px] items-center gap-4 px-5 py-4 hover:bg-[#EDF6F0]/50 transition-colors group">
                  <Link href={`/inspections/${insp.id}`} className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-700 group-hover:text-[#082E29] transition-colors truncate">
                      {insp.name}
                    </p>
                  </Link>
                  <Link href={`/inspections/${insp.id}`} className="min-w-0">
                    {asset ? (
                      <span className="text-[12px] text-slate-500 truncate block">{asset.name}</span>
                    ) : (
                      <span className="text-[12px] text-slate-300">—</span>
                    )}
                  </Link>
                  <Link href={`/inspections/${insp.id}`} className="flex items-center gap-1.5">
                    <ImageIcon size={12} className="text-slate-400" />
                    <span className="text-[12px] text-slate-500 font-mono">{insp.image_count}</span>
                  </Link>
                  <Link href={`/inspections/${insp.id}`} className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-400" />
                    <span className="text-[12px] text-slate-500">{new Date(insp.created_at).toLocaleDateString()}</span>
                  </Link>
                  <Link href={`/inspections/${insp.id}`}>
                    <StatusChip status={insp.status} />
                  </Link>
                  <Link href={`/inspections/${insp.id}`} className="flex justify-end">
                    <ArrowRight size={14} className="text-slate-300 group-hover:text-[#0891B2] transition-colors" />
                  </Link>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setDeleteTarget({ id: insp.id, name: insp.name })}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                      title="Delete inspection">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer count */}
          <div className="px-5 py-3 border-t border-[#C8E6D4]" style={{ background: '#EDF6F0' }}>
            <span className="text-[11px] text-slate-500">
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

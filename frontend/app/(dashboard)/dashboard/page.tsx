'use client';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import KPICard from '@/components/dashboard/KPICard';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { Building2, ClipboardList, AlertTriangle, ImageIcon, ArrowRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, Tooltip as RechartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';

const INFRA_CONFIG: Record<string, { label: string; color: string; hex: string }> = {
  wind_turbine: { label: 'Wind Turbine', color: 'text-sky-400',    hex: '#38BDF8' },
  coastal:      { label: 'Coastal',      color: 'text-cyan-400',   hex: '#22D3EE' },
  pier:         { label: 'Pier & Dock',  color: 'text-blue-400',   hex: '#60A5FA' },
  railway:      { label: 'Railway',      color: 'text-indigo-400', hex: '#818CF8' },
};

const STATUS_BAR_COLORS: Record<string, string> = {
  completed:  '#10B981',
  pending:    '#F59E0B',
  processing: '#38BDF8',
};

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed:  'bg-emerald-400',
    pending:    'bg-amber-400',
    processing: 'bg-sky-400 status-pulse',
  };
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${colors[status] ?? 'bg-slate-500'}`} />
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  dashboardApi.overview,
    refetchInterval: 120_000,
  });

  if (isLoading) return <DashboardSkeleton />;

  // ── Build chart data ──
  const pieData = Object.entries(data?.assets_by_type || {}).map(([type, count]) => ({
    name:  INFRA_CONFIG[type]?.label || type,
    value: count as number,
    hex:   INFRA_CONFIG[type]?.hex || '#64748B',
  }));

  const statusCounts = (data?.recent_inspections || []).reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});
  const barData = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

  return (
    <div>
      {/* Page header */}
      <div className="mb-8 card-animate">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Dashboard</h1>
        <p className="text-sm text-mira-muted mt-1">Platform overview and recent activity</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard label="Active Assets"       value={data?.active_assets ?? 0}       color="blue"   icon={<Building2   size={18} />} delay={0}   />
        <KPICard label="Total Inspections"   value={data?.total_inspections ?? 0}   color="green"  icon={<ClipboardList size={18} />} delay={60}  />
        <KPICard label="Pending Inspections" value={data?.pending_inspections ?? 0} color="orange" icon={<AlertTriangle size={18} />} delay={120} />
        <KPICard label="Images Processed"    value={data?.total_images ?? 0}        color="blue"   icon={<ImageIcon   size={18} />} delay={180} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

        {/* Asset type donut */}
        <div className="card-animate bg-card-dark border border-card-border rounded-xl p-6 shadow-card-dark" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-bold text-card-muted uppercase tracking-wider">Assets by Type</h2>
            <Link href="/assets" className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1">
              View all <ArrowRight size={11} />
            </Link>
          </div>

          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <PieChart width={110} height={110}>
                <Pie data={pieData} cx={50} cy={50} innerRadius={32} outerRadius={50}
                  dataKey="value" paddingAngle={3} startAngle={90} endAngle={450}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.hex} />)}
                </Pie>
                <RechartTooltip
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #C8E6D4', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#082E29' }}
                  itemStyle={{ color: '#082E29' }}
                />
              </PieChart>
              <div className="space-y-2 flex-1">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[12px] text-card-muted">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.hex }} />
                      {d.name}
                    </span>
                    <span className="text-[13px] font-bold font-mono text-card-text">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <Building2 size={28} className="text-card-faint mb-2" />
              <p className="text-xs text-card-muted">No assets yet</p>
              <Link href="/assets" className="text-xs text-sky-400 hover:underline mt-1">Create one</Link>
            </div>
          )}
        </div>

        {/* Inspection status bar chart — spans 2 cols */}
        <div className="card-animate bg-card-dark border border-card-border rounded-xl p-6 shadow-card-dark lg:col-span-2" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-bold text-card-muted uppercase tracking-wider">Inspections by Status</h2>
            <TrendingUp size={14} className="text-card-faint" />
          </div>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={barData} barCategoryGap="40%">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="status"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  axisLine={false} tickLine={false}
                  allowDecimals={false}
                />
                <RechartTooltip
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #C8E6D4', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#082E29' }}
                  itemStyle={{ color: '#082E29' }}
                  cursor={{ fill: 'rgba(8,46,41,0.04)' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={STATUS_BAR_COLORS[entry.status] || '#64748B'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <ClipboardList size={28} className="text-card-faint mb-2" />
              <p className="text-xs text-card-muted">No inspections yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent inspections list */}
      <div className="card-animate bg-card-dark border border-card-border rounded-xl shadow-card-dark overflow-hidden" style={{ animationDelay: '360ms' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border">
          <h2 className="text-[11px] font-bold text-card-muted uppercase tracking-wider">Recent Inspections</h2>
          <Link href="/inspections" className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1">
            View all <ArrowRight size={11} />
          </Link>
        </div>

        {(data?.recent_inspections || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <ClipboardList size={32} className="text-card-faint mb-2" />
            <p className="text-sm text-card-muted">No inspections yet</p>
            <Link href="/upload" className="text-xs text-sky-400 hover:underline mt-1">Create your first inspection</Link>
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {(data?.recent_inspections || []).map((insp, i) => (
              <Link
                key={insp.id}
                href={`/inspections/${insp.id}`}
                className="flex items-center justify-between px-6 py-3.5 hover:bg-white/[0.03] transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 flex-shrink-0">
                    <ClipboardList size={14} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-card-text group-hover:text-sky-300 transition-colors">{insp.name}</p>
                    <p className="text-[11px] text-card-faint mt-0.5">{new Date(insp.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center text-[11px] px-2.5 py-1 rounded-full font-medium ${
                    insp.status === 'completed'  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                    insp.status === 'pending'    ? 'bg-amber-500/10  text-amber-400  border border-amber-500/20'  :
                    insp.status === 'processing' ? 'bg-sky-500/10    text-sky-400    border border-sky-500/20'    :
                    'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                  }`}>
                    <StatusDot status={insp.status} />
                    {insp.status}
                  </span>
                  <ArrowRight size={13} className="text-card-faint group-hover:text-sky-400 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

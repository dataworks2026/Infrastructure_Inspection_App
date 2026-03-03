'use client';

import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';
import { Asset } from '@/types';
import Link from 'next/link';
import { Box, Wind, Waves, Building2, TrainFront, BarChart3, GitCompareArrows, Flame, Eye } from 'lucide-react';

const INFRA_ICONS: Record<string, any> = {
  wind_turbine: Wind,
  coastal: Waves,
  pier: Building2,
  railway: TrainFront,
};

const FEATURES = [
  {
    href: '/digital-twin/viewer',
    icon: Box,
    title: '3D Asset Viewer',
    description: 'Interactive 3D models with damage annotations pinned to structures and surfaces',
    gradient: 'from-sky-500 to-blue-600',
    shadow: 'shadow-sky-500/20',
  },
  {
    href: '/digital-twin/compare',
    icon: GitCompareArrows,
    title: 'Temporal Comparison',
    description: 'Side-by-side before/after slider to track damage progression over time',
    gradient: 'from-violet-500 to-purple-600',
    shadow: 'shadow-violet-500/20',
  },
  {
    href: '/digital-twin/heatmap',
    icon: Flame,
    title: 'Damage Heatmap',
    description: 'Color-coded damage density overlay on asset diagrams and imagery',
    gradient: 'from-orange-500 to-red-600',
    shadow: 'shadow-orange-500/20',
  },
];

export default function DigitalTwinPage() {
  const { data: assets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(),
  });

  const assetsByType = assets.reduce((acc: Record<string, number>, a: Asset) => {
    acc[a.infrastructure_type] = (acc[a.infrastructure_type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-8 mb-8">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Box size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Digital Twin</h1>
              <p className="text-sm text-slate-400">Advanced asset visualization & analytics</p>
            </div>
          </div>
          <p className="text-sm text-slate-300 max-w-2xl mt-4 leading-relaxed">
            Explore your infrastructure assets through interactive 3D models, damage heatmaps,
            and temporal comparison tools. Track how damage evolves between inspections and
            prioritize maintenance across your entire fleet.
          </p>

          {/* Asset type pills */}
          <div className="flex items-center gap-3 mt-5">
            {Object.entries(assetsByType).map(([type, count]) => {
              const Icon = INFRA_ICONS[type] || Building2;
              return (
                <div key={type} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/80 px-3 py-1.5 rounded-lg text-xs font-medium">
                  <Icon size={13} />
                  {count} {type.replace('_', ' ')}{(count as number) !== 1 ? 's' : ''}
                </div>
              );
            })}
            {assets.length === 0 && (
              <span className="text-xs text-slate-500">No assets yet — create some to get started</span>
            )}
          </div>
        </div>

        {/* Decorative 3D grid */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-20">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <defs>
              <linearGradient id="gridGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 25} x2="200" y2={i * 25} stroke="url(#gridGrad)" strokeWidth="0.5" />
            ))}
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 25} y1="0" x2={i * 25} y2="200" stroke="url(#gridGrad)" strokeWidth="0.5" />
            ))}
          </svg>
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.href} href={feature.href}
              className="group bg-white border border-slate-200 rounded-2xl p-6 shadow-card hover:shadow-card-hover hover:border-sky-200 transition-all cursor-pointer relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 opacity-5 group-hover:opacity-10 transition-opacity">
                <Icon size={120} strokeWidth={0.5} className="text-slate-800 transform translate-x-6 -translate-y-4" />
              </div>
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg ${feature.shadow} mb-4`}>
                <Icon size={20} className="text-white" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-800 group-hover:text-sky-600 transition-colors mb-1.5">{feature.title}</h3>
              <p className="text-xs text-mira-muted leading-relaxed">{feature.description}</p>
              <div className="flex items-center gap-1.5 mt-4 text-xs font-semibold text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <Eye size={13} /> Explore →
              </div>
            </Link>
          );
        })}
      </div>

      {/* Asset quick list */}
      {assets.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card p-6">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">Your Assets</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {assets.slice(0, 6).map((asset: Asset) => {
              const Icon = INFRA_ICONS[asset.infrastructure_type] || Building2;
              return (
                <Link key={asset.id} href={`/digital-twin/viewer?asset=${asset.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-sky-50 transition-all group border border-transparent hover:border-sky-100">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-sky-100 flex items-center justify-center transition-colors">
                    <Icon size={16} className="text-slate-500 group-hover:text-sky-600 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 group-hover:text-sky-600 truncate transition-colors">{asset.name}</p>
                    <p className="text-[10px] text-mira-faint">{asset.infrastructure_type.replace('_', ' ')} · {asset.inspection_count} inspections</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

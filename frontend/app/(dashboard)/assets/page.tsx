'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';
import { Asset, InfrastructureType } from '@/types';
import { Building2, Plus, MapPin, X, Navigation, ChevronDown, ArrowRight, Wind, Waves, Train, Anchor } from 'lucide-react';
import Link from 'next/link';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const INFRA_TYPES: { value: InfrastructureType; label: string; hex: string; Icon: React.ElementType }[] = [
  { value: 'wind_turbine', label: 'Wind Turbine', hex: '#38BDF8', Icon: Wind   },
  { value: 'coastal',      label: 'Coastal',      hex: '#22D3EE', Icon: Waves  },
  { value: 'pier',         label: 'Pier & Dock',  hex: '#60A5FA', Icon: Anchor },
  { value: 'railway',      label: 'Railway',      hex: '#818CF8', Icon: Train  },
];

const PRESET_LOCATIONS = [
  { name: 'Hornsea Wind Farm, UK',       lat: 53.885,  lng: 1.791,   type: 'wind_turbine' },
  { name: 'Dogger Bank Wind Farm, UK',   lat: 54.750,  lng: 2.250,   type: 'wind_turbine' },
  { name: 'London Array, UK',            lat: 51.628,  lng: 1.450,   type: 'wind_turbine' },
  { name: 'Walney Extension, UK',        lat: 54.040,  lng: -3.520,  type: 'wind_turbine' },
  { name: 'Block Island Wind Farm, US',  lat: 41.127,  lng: -71.520, type: 'wind_turbine' },
  { name: 'Vineyard Wind, US',           lat: 41.133,  lng: -70.600, type: 'wind_turbine' },
  { name: 'South Fork Wind Farm, US',    lat: 40.960,  lng: -72.140, type: 'wind_turbine' },
  { name: 'Dover Harbour, UK',           lat: 51.117,  lng: 1.320,   type: 'coastal' },
  { name: 'Plymouth Breakwater, UK',     lat: 50.330,  lng: -4.152,  type: 'coastal' },
  { name: 'Felixstowe Port, UK',         lat: 51.957,  lng: 1.305,   type: 'pier' },
];

interface AssetForm {
  name: string;
  infrastructure_type: InfrastructureType;
  location_name: string;
  latitude: string;
  longitude: string;
}

const emptyForm: AssetForm = {
  name: '', infrastructure_type: 'wind_turbine', location_name: '', latitude: '', longitude: '',
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:         'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    maintenance:    'bg-amber-500/10  text-amber-400  border-amber-500/20',
    decommissioned: 'bg-slate-500/10  text-slate-400  border-slate-500/20',
  };
  const isPending = status === 'maintenance';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-medium border ${map[status] ?? map.decommissioned}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-emerald-400' : status === 'maintenance' ? 'bg-amber-400 status-pulse' : 'bg-slate-400'}`} />
      {status}
    </span>
  );
}

export default function AssetsPage() {
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState<AssetForm>(emptyForm);
  const [showPresets, setShowPresets] = useState(false);
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });

  const typeMap = useMemo(() => Object.fromEntries(INFRA_TYPES.map(t => [t.value, t])), []);

  const createMutation = useMutation({
    mutationFn: assetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Asset created successfully');
    },
    onError: () => toast.error('Failed to create asset'),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      name: form.name,
      infrastructure_type: form.infrastructure_type,
      location_name: form.location_name || undefined,
    };
    if (form.latitude && form.longitude) {
      payload.latitude  = parseFloat(form.latitude);
      payload.longitude = parseFloat(form.longitude);
    }
    createMutation.mutate(payload);
  }

  function applyPreset(preset: typeof PRESET_LOCATIONS[0]) {
    setForm({ ...form, location_name: preset.name, latitude: preset.lat.toString(), longitude: preset.lng.toString(), infrastructure_type: preset.type as InfrastructureType });
    setShowPresets(false);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 card-animate">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Assets</h1>
          <p className="text-sm text-mira-muted mt-1">Infrastructure assets under inspection</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/35 hover:-translate-y-px transition-all"
        >
          <Plus size={16} /> New Asset
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card-dark border border-card-border rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto palette-animate">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-card-text">Create Asset</h2>
              <button onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                className="text-card-faint hover:text-card-text p-1 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-card-muted uppercase tracking-wider block mb-1.5">Asset Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full bg-slate-800 border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-card-text placeholder:text-card-faint focus:border-sky-500/50 focus:bg-slate-700/50 outline-none transition-colors"
                  placeholder="e.g. Turbine T-12" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-card-muted uppercase tracking-wider block mb-1.5">Infrastructure Type</label>
                <select value={form.infrastructure_type} onChange={e => setForm({ ...form, infrastructure_type: e.target.value as InfrastructureType })}
                  className="w-full bg-slate-800 border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-card-text focus:border-sky-500/50 outline-none transition-colors">
                  {INFRA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="border border-card-border rounded-lg p-4 bg-slate-800/50">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[11px] font-semibold text-card-muted uppercase tracking-wider flex items-center gap-1.5">
                    <Navigation size={12} /> Location
                  </label>
                  <div className="relative">
                    <button type="button" onClick={() => setShowPresets(!showPresets)}
                      className="text-[10px] font-semibold text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 px-2.5 py-1 rounded-md flex items-center gap-1 transition-all">
                      Quick Fill <ChevronDown size={10} />
                    </button>
                    {showPresets && (
                      <div className="absolute right-0 top-full mt-1 bg-card-dark border border-card-border rounded-lg shadow-2xl z-50 w-64 max-h-56 overflow-y-auto">
                        {PRESET_LOCATIONS.map((p, i) => (
                          <button key={i} type="button" onClick={() => applyPreset(p)}
                            className="w-full text-left px-3 py-2.5 text-xs hover:bg-white/5 transition-colors border-b border-card-border last:border-0">
                            <span className="font-medium text-card-text">{p.name}</span>
                            <span className="text-[10px] text-card-faint block mt-0.5">{p.lat.toFixed(3)}°, {p.lng.toFixed(3)}°</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <input value={form.location_name} onChange={e => setForm({ ...form, location_name: e.target.value })}
                    className="w-full bg-slate-800 border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-card-text placeholder:text-card-faint focus:border-sky-500/50 outline-none transition-colors"
                    placeholder="Location name, e.g. Hornsea Wind Farm" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-card-faint block mb-1">Latitude</label>
                      <input value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })}
                        type="number" step="any" min="-90" max="90"
                        className="w-full bg-slate-800 border border-card-border rounded-lg px-3 py-2 text-sm text-card-text placeholder:text-card-faint font-mono focus:border-sky-500/50 outline-none transition-colors"
                        placeholder="53.885" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-card-faint block mb-1">Longitude</label>
                      <input value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })}
                        type="number" step="any" min="-180" max="180"
                        className="w-full bg-slate-800 border border-card-border rounded-lg px-3 py-2 text-sm text-card-text placeholder:text-card-faint font-mono focus:border-sky-500/50 outline-none transition-colors"
                        placeholder="1.791" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={createMutation.isPending}
                  className="flex-1 bg-gradient-to-r from-sky-500 to-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50">
                  {createMutation.isPending ? 'Creating...' : 'Create Asset'}
                </button>
                <button type="button" onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                  className="flex-1 border border-card-border text-card-muted py-2.5 rounded-lg text-sm font-medium hover:bg-white/5 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asset grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0,1,2,3,4,5].map(i => <CardSkeleton key={i} />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="card-animate flex flex-col items-center justify-center py-20 bg-card-dark border border-card-border rounded-2xl shadow-card-dark">
          <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-4">
            <Building2 size={28} className="text-sky-400" />
          </div>
          <p className="text-base font-semibold text-card-text">No assets yet</p>
          <p className="text-sm text-card-muted mt-1">Create your first infrastructure asset to get started.</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-5 inline-flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all">
            <Plus size={16} /> Create Asset
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(assets as Asset[]).map((asset, i) => {
            const typeInfo = typeMap[asset.infrastructure_type];
            const Icon = typeInfo?.Icon || Building2;
            return (
              <Link
                key={asset.id}
                href={`/assets/${asset.id}`}
                className="card-animate group bg-card-dark border border-card-border rounded-xl p-5 shadow-card-dark hover:shadow-card-dark-hover hover:border-card-border-hover hover:-translate-y-0.5 transition-all"
                style={{ animationDelay: `${Math.min(i * 50, 400)}ms` }}
              >
                {/* Top row: type + status */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: (typeInfo?.hex || '#64748B') + '20', border: `1px solid ${typeInfo?.hex || '#64748B'}30` }}>
                      <Icon size={15} style={{ color: typeInfo?.hex || '#94A3B8' }} />
                    </div>
                    <span className="text-[11px] font-semibold capitalize"
                      style={{ color: typeInfo?.hex || '#94A3B8' }}>
                      {typeInfo?.label || asset.infrastructure_type}
                    </span>
                  </div>
                  <StatusBadge status={asset.status} />
                </div>

                {/* Name */}
                <h3 className="text-[15px] font-semibold text-card-text group-hover:text-sky-300 transition-colors leading-snug">
                  {asset.name}
                </h3>

                {/* Location */}
                {asset.location_name && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-card-muted">
                    <MapPin size={11} /> {asset.location_name}
                  </div>
                )}
                {asset.latitude != null && asset.longitude != null && (
                  <div className="text-[10px] text-card-faint font-mono mt-1 ml-4">
                    {asset.latitude.toFixed(3)}°, {asset.longitude.toFixed(3)}°
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-card-border">
                  <span className="text-xs text-card-faint font-medium">
                    {asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-1 text-card-faint group-hover:text-sky-400 transition-colors">
                    {asset.last_inspection_at && (
                      <span className="text-xs">{new Date(asset.last_inspection_at).toLocaleDateString()}</span>
                    )}
                    <ArrowRight size={12} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

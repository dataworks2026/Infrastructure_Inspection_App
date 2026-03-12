'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';
import { Asset, InfrastructureType } from '@/types';
import {
  Building2, Plus, MapPin, X, Navigation, ChevronDown, ArrowRight,
  Wind, Waves, Train, Anchor, CheckCircle, Clock,
} from 'lucide-react';
import Link from 'next/link';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const TEAL  = '#082E29';
const BLUE  = '#93C5FD';

const INFRA_TYPES: { value: InfrastructureType; label: string; hex: string; Icon: React.ElementType }[] = [
  { value: 'wind_turbine', label: 'Wind Turbine', hex: '#0891B2', Icon: Wind   },
  { value: 'coastal',      label: 'Coastal',      hex: '#0EA5E9', Icon: Waves  },
  { value: 'pier',         label: 'Pier & Dock',  hex: '#6366F1', Icon: Anchor },
  { value: 'railway',      label: 'Railway',      hex: '#8B5CF6', Icon: Train  },
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
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle size={13} /> Active
    </span>
  );
  if (status === 'maintenance') return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      <Clock size={13} /> Maintenance
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      {status}
    </span>
  );
}

export default function AssetsPage() {
  const toast = useToast();
  const [showCreate, setShowCreate]   = useState(false);
  const [form, setForm]               = useState<AssetForm>(emptyForm);
  const [showPresets, setShowPresets] = useState(false);
  const queryClient = useQueryClient();

  const { data: assets = [], isLoading } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });

  const typeMap = useMemo(() => Object.fromEntries(INFRA_TYPES.map(t => [t.value, t])), []);

  const createMutation = useMutation({
    mutationFn: assetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
      <div className="flex items-center justify-between mb-6 sm:mb-8 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: TEAL }}>Assets</h1>
          <p className="text-sm sm:text-base text-slate-500 mt-1">Infrastructure assets under inspection</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm sm:text-base font-semibold transition-all hover:opacity-90 shadow-sm active:scale-[0.98]"
          style={{ background: TEAL, color: BLUE }}
        >
          <Plus size={18} /> New Asset
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#C8E6D4] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: '#EDF6F0', borderBottom: '1px solid #C8E6D4' }}>
              <h2 className="text-base font-bold" style={{ color: TEAL }}>Create Asset</h2>
              <button onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                className="p-1.5 rounded-lg transition-colors hover:bg-[#C8E6D4]/60"
                style={{ color: '#6B9A87' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: TEAL }}>Asset Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 outline-none transition-colors"
                  style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}
                  placeholder="e.g. Turbine T-12" />
              </div>
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: TEAL }}>Infrastructure Type</label>
                <select value={form.infrastructure_type} onChange={e => setForm({ ...form, infrastructure_type: e.target.value as InfrastructureType })}
                  className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 outline-none"
                  style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
                  {INFRA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="rounded-xl p-4" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[12px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: TEAL }}>
                    <Navigation size={14} /> Location
                  </label>
                  <div className="relative">
                    <button type="button" onClick={() => setShowPresets(!showPresets)}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1 transition-all"
                      style={{ background: 'white', color: TEAL, border: '1px solid #C8E6D4' }}>
                      Quick Fill <ChevronDown size={10} />
                    </button>
                    {showPresets && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-[#C8E6D4] rounded-xl shadow-xl z-50 w-64 max-h-56 overflow-y-auto">
                        {PRESET_LOCATIONS.map((p, i) => (
                          <button key={i} type="button" onClick={() => applyPreset(p)}
                            className="w-full text-left px-3 py-2.5 text-sm transition-colors border-b border-[#C8E6D4] last:border-0 hover:bg-[#EDF6F0]">
                            <span className="font-semibold text-slate-700">{p.name}</span>
                            <span className="text-[11px] text-slate-400 block mt-0.5">{p.lat.toFixed(3)}°, {p.lng.toFixed(3)}°</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <input value={form.location_name} onChange={e => setForm({ ...form, location_name: e.target.value })}
                    className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 outline-none"
                    style={{ background: 'white', border: '1px solid #C8E6D4' }}
                    placeholder="Location name, e.g. Hornsea Wind Farm" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">Latitude</label>
                      <input value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })}
                        type="number" step="any" min="-90" max="90"
                        className="w-full rounded-lg px-3 py-2 text-base font-mono outline-none"
                        style={{ background: 'white', border: '1px solid #C8E6D4', color: '#082E29' }}
                        placeholder="53.885" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">Longitude</label>
                      <input value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })}
                        type="number" step="any" min="-180" max="180"
                        className="w-full rounded-lg px-3 py-2 text-base font-mono outline-none"
                        style={{ background: 'white', border: '1px solid #C8E6D4', color: '#082E29' }}
                        placeholder="1.791" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={createMutation.isPending}
                  className="flex-1 py-2.5 rounded-xl text-base font-bold transition-all disabled:opacity-50 hover:opacity-90"
                  style={{ background: TEAL, color: BLUE }}>
                  {createMutation.isPending ? 'Creating...' : 'Create Asset'}
                </button>
                <button type="button" onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                  className="flex-1 py-2.5 rounded-xl text-base font-medium transition-all hover:bg-slate-50"
                  style={{ border: '1px solid #C8E6D4', color: '#6B9A87' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asset grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {[0,1,2,3,4,5].map(i => <CardSkeleton key={i} />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
            <Building2 size={30} style={{ color: TEAL }} />
          </div>
          <p className="text-lg font-semibold text-slate-700">No assets yet</p>
          <p className="text-base text-slate-500 mt-1">Create your first infrastructure asset to get started.</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-bold transition-all hover:opacity-90 shadow-sm"
            style={{ background: TEAL, color: BLUE }}>
            <Plus size={18} /> Create Asset
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {(assets as Asset[]).map((asset, i) => {
            const typeInfo = typeMap[asset.infrastructure_type];
            const Icon = typeInfo?.Icon || Building2;
            return (
              <Link
                key={asset.id}
                href={`/assets/${asset.id}`}
                className="group bg-white rounded-xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
                style={{ border: '1px solid #C8E6D4' }}
              >
                {/* Top row: type + status */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: (typeInfo?.hex || '#64748B') + '18', border: `1px solid ${typeInfo?.hex || '#64748B'}30` }}>
                      <Icon size={17} style={{ color: typeInfo?.hex || '#64748B' }} />
                    </div>
                    <span className="text-[12px] font-bold capitalize"
                      style={{ color: typeInfo?.hex || '#64748B' }}>
                      {typeInfo?.label || asset.infrastructure_type}
                    </span>
                  </div>
                  <StatusBadge status={asset.status} />
                </div>

                {/* Name */}
                <h3 className="text-[15px] font-semibold text-slate-800 group-hover:text-[#0891B2] transition-colors leading-snug">
                  {asset.name}
                </h3>

                {/* Location */}
                {asset.location_name && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm text-slate-500">
                    <MapPin size={13} /> {asset.location_name}
                  </div>
                )}
                {asset.latitude != null && asset.longitude != null && (
                  <div className="text-[11px] text-slate-400 font-mono mt-1 ml-4">
                    {asset.latitude.toFixed(3)}°, {asset.longitude.toFixed(3)}°
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid #C8E6D4' }}>
                  <span className="text-sm text-slate-500 font-medium">
                    {asset.inspection_count} inspection{asset.inspection_count !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-1 text-slate-400 group-hover:text-[#0891B2] transition-colors">
                    {asset.last_inspection_at && (
                      <span className="text-sm">{new Date(asset.last_inspection_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</span>
                    )}
                    <ArrowRight size={14} />
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

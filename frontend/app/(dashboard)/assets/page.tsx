'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';
import { Asset, InfrastructureType } from '@/types';
import { Building2, Plus, MapPin, X, Navigation, ChevronDown, ArrowRight, Wind, Waves, Train, Anchor, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

const INFRA_TYPES: { value: InfrastructureType; label: string; hex: string; Icon: React.ElementType }[] = [
  { value: 'wind_turbine', label: 'Wind Turbine', hex: '#0EA5E9', Icon: Wind   },
  { value: 'coastal',      label: 'Coastal',      hex: '#06B6D4', Icon: Waves  },
  { value: 'pier',         label: 'Pier & Dock',  hex: '#3B82F6', Icon: Anchor },
  { value: 'railway',      label: 'Railway',      hex: '#6366F1', Icon: Train  },
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
  const styles: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
    active:         { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0', icon: <CheckCircle size={10} /> },
    maintenance:    { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A', icon: <Clock size={10} /> },
    decommissioned: { bg: MINT,     text: '#6B9A87', border: '#C8E6D4', icon: null },
  };
  const s = styles[status] || styles.decommissioned;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
      {s.icon}{status}
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
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setShowCreate(false);
      setForm(emptyForm);
      toast.success('Asset created successfully');
    },
    onError: () => toast.error('Failed to create asset'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      infrastructure_type: form.infrastructure_type,
      location_name: form.location_name || undefined,
      latitude:  form.latitude  ? parseFloat(form.latitude)  : undefined,
      longitude: form.longitude ? parseFloat(form.longitude) : undefined,
    } as any);
  }

  function applyPreset(p: typeof PRESET_LOCATIONS[0]) {
    setForm(f => ({
      ...f,
      infrastructure_type: p.type as InfrastructureType,
      location_name: p.name,
      latitude:  String(p.lat),
      longitude: String(p.lng),
    }));
    setShowPresets(false);
  }

  const inputCls = `w-full px-3 py-2 text-sm rounded-lg outline-none transition-all`;
  const inputStyle = {
    background: MINT, border: '1.5px solid #C8E6D4', color: TEAL,
    fontFamily: 'inherit',
  };

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: TEAL }}>Assets</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B9A87' }}>
            Infrastructure registry · {(assets as Asset[]).length} total
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-lg shadow-sm hover:shadow-md transition-all"
          style={{ background: TEAL, color: BLUE }}>
          <Plus size={14} color={BLUE} /> New Asset
        </button>
      </div>

      {/* ── Create Asset Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(8,46,41,0.55)', backdropFilter: 'blur(6px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            style={{ border: '1px solid #C8E6D4' }}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid #EDF6F0', background: MINT }}>
              <h2 className="text-sm font-bold" style={{ color: TEAL }}>Register New Asset</h2>
              <button onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: '#6B9A87', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#C8E6D4')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Asset name */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: '#2E6B5B' }}>
                  Asset Name *
                </label>
                <input
                  type="text" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Hornsea Turbine 7A"
                  className={inputCls} style={inputStyle}
                />
              </div>

              {/* Infrastructure type */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: '#2E6B5B' }}>
                  Type *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {INFRA_TYPES.map(({ value, label, hex, Icon }) => (
                    <button key={value} type="button"
                      onClick={() => setForm(f => ({ ...f, infrastructure_type: value }))}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[12px] font-medium transition-all"
                      style={form.infrastructure_type === value
                        ? { background: hex + '18', color: hex, border: `1.5px solid ${hex}50` }
                        : { background: MINT, color: '#2E6B5B', border: '1.5px solid #C8E6D4' }}>
                      <Icon size={14} style={{ color: form.infrastructure_type === value ? hex : '#6B9A87' }} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#2E6B5B' }}>Location</label>
                  <button type="button" onClick={() => setShowPresets(p => !p)}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors"
                    style={{ color: BRAND, background: 'none', border: 'none', cursor: 'pointer' }}>
                    <Navigation size={10} /> Presets <ChevronDown size={10} style={{ transform: showPresets ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                </div>
                {showPresets && (
                  <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid #C8E6D4' }}>
                    {PRESET_LOCATIONS.map(p => (
                      <button key={p.name} type="button" onClick={() => applyPreset(p)}
                        className="w-full text-left px-3 py-2 text-[11px] transition-colors"
                        style={{ borderBottom: '1px solid #EDF6F0', color: TEAL, background: 'white', fontFamily: 'inherit', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = MINT)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                        <span className="font-semibold">{p.name}</span>
                        <span className="ml-2 text-[10px]" style={{ color: '#6B9A87' }}>
                          {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <input type="text" value={form.location_name}
                  onChange={e => setForm(f => ({ ...f, location_name: e.target.value }))}
                  placeholder="e.g. Hornsea, East Yorkshire"
                  className={inputCls} style={inputStyle} />
              </div>

              {/* Coordinates */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Latitude', key: 'latitude', placeholder: '53.885' },
                  { label: 'Longitude', key: 'longitude', placeholder: '1.791' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: '#2E6B5B' }}>{label}</label>
                    <input type="number" step="any" value={form[key as keyof AssetForm]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className={inputCls} style={{ ...inputStyle, fontFamily: 'monospace' }} />
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors"
                  style={{ background: MINT, color: '#2E6B5B', border: '1px solid #C8E6D4', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
                <button type="submit" disabled={createMutation.isPending}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg shadow-sm transition-all"
                  style={{ background: TEAL, color: BLUE, border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: createMutation.isPending ? 0.65 : 1 }}>
                  {createMutation.isPending ? 'Creating…' : 'Create Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Asset Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : (assets as Asset[]).length === 0 ? (
        <div className="bg-white border border-[#C8E6D4] rounded-2xl flex flex-col items-center justify-center py-20 shadow-sm">
          <Building2 size={40} className="mb-4" style={{ color: '#C8E6D4' }} />
          <p className="text-sm font-semibold" style={{ color: TEAL }}>No assets registered yet</p>
          <p className="text-xs mt-1" style={{ color: '#6B9A87' }}>Create your first infrastructure asset</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-5 flex items-center gap-2 text-xs font-bold px-5 py-2.5 rounded-lg"
            style={{ background: TEAL, color: BLUE, border: 'none', cursor: 'pointer' }}>
            <Plus size={14} /> Add First Asset
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(assets as Asset[]).map(asset => {
            const t = typeMap[asset.infrastructure_type];
            const Icon = t?.Icon || Building2;
            return (
              <Link key={asset.id} href={`/assets/${asset.id}`}
                className="group bg-white border border-[#C8E6D4] rounded-2xl shadow-sm overflow-hidden hover:shadow-md hover:border-[#A5D4BB] transition-all duration-200 flex flex-col">
                {/* Card header */}
                <div className="px-5 py-4" style={{ borderBottom: '1px solid #EDF6F0' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: (t?.hex || BRAND) + '18', border: `1px solid ${(t?.hex || BRAND)}30`, color: t?.hex || BRAND }}>
                      <Icon size={18} />
                    </div>
                    <StatusBadge status={asset.status} />
                  </div>
                  <h2 className="text-[14px] font-bold mt-3 leading-tight group-hover:text-[#0891B2] transition-colors" style={{ color: TEAL }}>
                    {asset.name}
                  </h2>
                  {asset.location_name && (
                    <p className="flex items-center gap-1 text-[11px] mt-1" style={{ color: '#6B9A87' }}>
                      <MapPin size={10} /> {asset.location_name}
                    </p>
                  )}
                </div>

                {/* Card body */}
                <div className="px-5 py-3.5 flex-1 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span style={{ color: '#6B9A87' }}>Type</span>
                    <span className="font-semibold px-2 py-0.5 rounded-md text-[10px]"
                      style={{ background: (t?.hex || BRAND) + '15', color: t?.hex || BRAND }}>
                      {t?.label || asset.infrastructure_type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span style={{ color: '#6B9A87' }}>Inspections</span>
                    <span className="font-bold" style={{ color: TEAL }}>{asset.inspection_count}</span>
                  </div>
                  {asset.latitude && asset.longitude && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span style={{ color: '#6B9A87' }}>Coordinates</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B9A87' }}>
                        {asset.latitude.toFixed(3)}, {asset.longitude.toFixed(3)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card footer */}
                <div className="px-5 py-3 flex items-center justify-between"
                  style={{ borderTop: '1px solid #EDF6F0', background: MINT }}>
                  <span className="text-[11px]" style={{ color: '#6B9A87' }}>
                    {asset.last_inspection_at
                      ? `Last: ${new Date(asset.last_inspection_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : 'No inspections yet'}
                  </span>
                  <ArrowRight size={13} style={{ color: '#A5D4BB' }} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

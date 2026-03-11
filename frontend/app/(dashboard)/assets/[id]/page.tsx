'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi, inspectionsApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, ClipboardList, Calendar, Pencil, X, Check, ChevronDown, Navigation } from 'lucide-react';
import { InfrastructureType } from '@/types';

const PRESET_LOCATIONS = [
  { name: 'Hornsea Wind Farm, UK',       lat: 53.885,  lng: 1.791 },
  { name: 'Dogger Bank Wind Farm, UK',   lat: 54.750,  lng: 2.250 },
  { name: 'London Array, UK',            lat: 51.628,  lng: 1.450 },
  { name: 'Walney Extension, UK',        lat: 54.040,  lng: -3.520 },
  { name: 'Block Island Wind Farm, US',  lat: 41.127,  lng: -71.520 },
  { name: 'Vineyard Wind, US',           lat: 41.133,  lng: -70.600 },
  { name: 'South Fork Wind Farm, US',    lat: 40.960,  lng: -72.140 },
  { name: 'Dover Harbour, UK',           lat: 51.117,  lng: 1.320 },
  { name: 'Plymouth Breakwater, UK',     lat: 50.330,  lng: -4.152 },
  { name: 'Felixstowe Port, UK',         lat: 51.957,  lng: 1.305 },
];

export default function AssetDetailPage() {
  const params = useParams();
  const assetId = params.id as string;
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    location_name: '',
    latitude: '',
    longitude: '',
    status: '',
  });
  const [showPresets, setShowPresets] = useState(false);

  const { data: asset, isLoading: assetLoading } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => assetsApi.get(assetId),
  });

  const { data: inspections = [] } = useQuery({
    queryKey: ['inspections', { asset_id: assetId }],
    queryFn: () => inspectionsApi.list({ asset_id: assetId }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => assetsApi.update(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setEditing(false);
    },
  });

  function startEditing() {
    if (!asset) return;
    setEditForm({
      name: asset.name || '',
      location_name: asset.location_name || '',
      latitude: asset.latitude?.toString() || '',
      longitude: asset.longitude?.toString() || '',
      status: asset.status || 'active',
    });
    setEditing(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      name: editForm.name,
      location_name: editForm.location_name || undefined,
      status: editForm.status,
    };
    if (editForm.latitude && editForm.longitude) {
      payload.latitude = parseFloat(editForm.latitude);
      payload.longitude = parseFloat(editForm.longitude);
    } else {
      payload.latitude = null;
      payload.longitude = null;
    }
    updateMutation.mutate(payload);
  }

  function applyPreset(preset: typeof PRESET_LOCATIONS[0]) {
    setEditForm({
      ...editForm,
      location_name: preset.name,
      latitude: preset.lat.toString(),
      longitude: preset.lng.toString(),
    });
    setShowPresets(false);
  }

  if (assetLoading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-mira-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!asset) return <div className="text-red-500">Asset not found.</div>;

  return (
    <div>
      <Link href="/assets" className="inline-flex items-center gap-2 text-base text-mira-muted hover:text-mira-blue mb-6 font-medium">
        <ArrowLeft size={18} /> Back to Assets
      </Link>

      {/* Asset info card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-card mb-6">
        {!editing ? (
          /* View mode */
          <>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{asset.name}</h1>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-sm px-2.5 py-1 rounded-md font-medium bg-sky-100 text-sky-700">{asset.infrastructure_type.replace('_', ' ')}</span>
                  <span className={`text-sm px-2.5 py-1 rounded-md font-medium ${
                    asset.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
                    asset.status === 'maintenance' ? 'bg-amber-50 text-amber-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>{asset.status}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={startEditing}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-all">
                  <Pencil size={15} /> Edit
                </button>
                <Link href="/upload"
                  className="bg-gradient-to-r from-sky-500 to-blue-600 text-white px-4 py-2 rounded-lg text-base font-semibold shadow-md hover:shadow-lg transition-all">
                  New Inspection
                </Link>
              </div>
            </div>

            {/* Location info */}
            <div className="mt-4 space-y-1.5">
              {asset.location_name && (
                <div className="flex items-center gap-2 text-base text-mira-muted">
                  <MapPin size={16} /> {asset.location_name}
                </div>
              )}
              {asset.latitude != null && asset.longitude != null ? (
                <div className="flex items-center gap-2 text-sm text-mira-faint font-mono ml-5">
                  {asset.latitude.toFixed(4)}°, {asset.longitude.toFixed(4)}°
                  <Link href="/map" className="text-sky-500 hover:text-sky-700 font-sans font-medium ml-1">
                    View on Map →
                  </Link>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-amber-600 mt-2 bg-amber-50 px-3 py-2 rounded-lg">
                  <Navigation size={14} />
                  No coordinates set.
                  <button onClick={startEditing} className="underline font-medium hover:text-amber-800">Add location</button>
                  to see this asset on the map.
                </div>
              )}
              <div className="flex items-center gap-2 text-base text-mira-faint">
                <Calendar size={16} /> Created {new Date(asset.created_at).toLocaleDateString()}
              </div>
            </div>
          </>
        ) : (
          /* Edit mode */
          <form onSubmit={handleSave}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-800">Edit Asset</h2>
              <button type="button" onClick={() => setEditing(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wider block mb-1.5">Asset Name</label>
                <input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} required
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-base text-slate-800 placeholder:text-slate-400 focus:bg-white"
                  placeholder="e.g. Turbine T-12" />
              </div>

              {/* Status */}
              <div>
                <label className="text-sm font-semibold text-slate-600 uppercase tracking-wider block mb-1.5">Status</label>
                <select value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-base text-slate-800 focus:bg-white">
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="decommissioned">Decommissioned</option>
                </select>
              </div>

              {/* Location section */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Navigation size={14} /> Location & Coordinates
                  </label>
                  <div className="relative">
                    <button type="button" onClick={() => setShowPresets(!showPresets)}
                      className="text-[11px] font-semibold text-sky-600 hover:text-sky-800 bg-sky-50 hover:bg-sky-100 px-2.5 py-1 rounded-md flex items-center gap-1 transition-all">
                      Quick Fill <ChevronDown size={10} />
                    </button>
                    {showPresets && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 w-64 max-h-56 overflow-y-auto">
                        {PRESET_LOCATIONS.map((p, i) => (
                          <button key={i} type="button" onClick={() => applyPreset(p)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0">
                            <span className="font-medium text-slate-700">{p.name}</span>
                            <span className="text-[11px] text-mira-faint block mt-0.5">
                              {p.lat.toFixed(3)}°, {p.lng.toFixed(3)}°
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <input value={editForm.location_name} onChange={e => setEditForm({...editForm, location_name: e.target.value})}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-base text-slate-800 placeholder:text-slate-400 focus:border-sky-300"
                    placeholder="Location name, e.g. Hornsea Wind Farm" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-mira-faint block mb-1">Latitude</label>
                      <input value={editForm.latitude}
                        onChange={e => setEditForm({...editForm, latitude: e.target.value})}
                        type="number" step="any" min="-90" max="90"
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-base text-slate-800 placeholder:text-slate-400 font-mono focus:border-sky-300"
                        placeholder="e.g. 53.885" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-mira-faint block mb-1">Longitude</label>
                      <input value={editForm.longitude}
                        onChange={e => setEditForm({...editForm, longitude: e.target.value})}
                        type="number" step="any" min="-180" max="180"
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-base text-slate-800 placeholder:text-slate-400 font-mono focus:border-sky-300"
                        placeholder="e.g. 1.791" />
                    </div>
                  </div>
                  <p className="text-[11px] text-mira-faint">
                    Use &quot;Quick Fill&quot; to pick from known locations, or enter coordinates from Google Maps.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={updateMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white py-2.5 rounded-lg text-base font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50">
                  <Check size={17} /> {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setEditing(false)}
                  className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg text-base font-medium hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>

              {updateMutation.isError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  Failed to update. Please try again.
                </p>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Inspections list */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-card">
        <h2 className="text-base font-semibold text-slate-700 uppercase tracking-wider mb-4">Inspections ({inspections.length})</h2>
        {inspections.length === 0 ? (
          <div className="text-center py-8">
            <ClipboardList size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-base text-mira-muted">No inspections for this asset yet.</p>
            <Link href="/upload" className="text-base text-mira-blue hover:underline font-medium mt-1 inline-block">Upload one</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {inspections.map((insp: any) => (
              <Link key={insp.id} href={`/inspections/${insp.id}`}
                className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                <div>
                  <p className="text-base font-medium text-slate-700">{insp.name}</p>
                  <p className="text-sm text-mira-faint mt-0.5">{insp.image_count} image{insp.image_count !== 1 ? 's' : ''} &middot; {new Date(insp.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-sm px-2.5 py-1 rounded-md font-medium ${
                  insp.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                  insp.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                  'bg-slate-100 text-slate-500'
                }`}>{insp.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

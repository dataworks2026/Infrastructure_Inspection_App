'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Thermometer, Wind, Waves, Activity, RefreshCw, Anchor,
  ChevronDown, Calendar, ArrowRight, Droplets, Gauge,
} from 'lucide-react';
import { sensorsApi, assetsApi } from '@/lib/api';
import type { SensorLiveResponse, SensorAssetLive, SensorHistoryResponse } from '@/types';

const TEAL = '#082E29';
const MINT = '#EDF6F0';
const MINT_BORDER = '#C8E6D4';
const BRAND = '#0891B2';

// ── Helpers ──────────────────────────────────────────────────
function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── Sensor Card ──────────────────────────────────────────────
function SensorCard({
  icon, label, value, unit, source, color, subtitle,
}: {
  icon: React.ReactNode; label: string; value: string; unit: string;
  source: string; color: string; subtitle?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 relative overflow-hidden"
      style={{ border: `1px solid ${MINT_BORDER}` }}>
      {/* Live dot */}
      <span className="absolute top-3 right-3 flex items-center gap-1.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Live</span>
      </span>

      {/* Icon */}
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
        style={{ background: color + '15' }}>
        {icon}
      </div>

      {/* Label */}
      <p className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color }}>{label}</p>

      {/* Value */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-black leading-none" style={{ color: TEAL }}>{value}</span>
        <span className="text-sm font-semibold" style={{ color: '#6B9A87' }}>{unit}</span>
      </div>

      {subtitle && (
        <p className="text-[11px] mt-1" style={{ color: '#6B9A87' }}>{subtitle}</p>
      )}

      {/* Source */}
      <div className="mt-3 pt-2 flex items-center gap-1.5"
        style={{ borderTop: `1px solid ${MINT_BORDER}` }}>
        <Anchor size={10} style={{ color: '#9CB8AC' }} />
        <span className="text-[10px] font-semibold" style={{ color: '#9CB8AC' }}>{source}</span>
      </div>
    </div>
  );
}

// ── History Bar ──────────────────────────────────────────────
function HistoryBar({
  date, min, max, globalMin, globalMax, unit, color,
}: {
  date: string; min: number; max: number;
  globalMin: number; globalMax: number; unit: string; color: string;
}) {
  const range = globalMax - globalMin || 1;
  const left = ((min - globalMin) / range) * 100;
  const width = Math.max(((max - min) / range) * 100, 2);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[#F8FBF9] transition-colors"
      style={{ borderBottom: `1px solid ${MINT}` }}>
      <span className="text-xs font-semibold w-20 flex-shrink-0" style={{ color: TEAL }}>{date}</span>
      <div className="flex-1 h-6 rounded-full relative" style={{ background: MINT }}>
        <div className="absolute top-0.5 bottom-0.5 rounded-full"
          style={{ left: `${left}%`, width: `${width}%`, background: color + '40', minWidth: 8 }}>
          <div className="absolute inset-y-0 left-0 right-0 rounded-full" style={{ background: color, opacity: 0.6 }} />
        </div>
      </div>
      <span className="text-xs font-bold w-28 text-right flex-shrink-0" style={{ color: TEAL }}>
        {fmt(min)} — {fmt(max)} {unit}
      </span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { label: 'Last 3 Days', days: 3 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 14 Days', days: 14 },
  { label: 'Last 30 Days', days: 30 },
];

const SENSOR_TYPES = [
  { value: 'air_temperature', label: 'Temperature', unit: '°F', color: '#EF4444', icon: Thermometer },
  { value: 'wind', label: 'Wind Speed', unit: 'kn', color: BRAND, icon: Wind },
  { value: 'water_level', label: 'Water Level', unit: 'ft', color: '#3B82F6', icon: Droplets },
  { value: 'wave_height', label: 'Wave Height', unit: 'm', color: '#8B5CF6', icon: Waves },
];

export default function SensorsPage() {
  const queryClient = useQueryClient();

  // State
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState(7);
  const [sensorType, setSensorType] = useState('air_temperature');
  const [showRangeDropdown, setShowRangeDropdown] = useState(false);
  const [showSensorDropdown, setShowSensorDropdown] = useState(false);

  // Live data
  const { data: liveData, isFetching: liveFetching } = useQuery<SensorLiveResponse>({
    queryKey: ['sensors-live'],
    queryFn: sensorsApi.getLive,
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  // Assets list (for dropdown)
  const { data: assetsList } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetsApi.list(),
    staleTime: 600_000,
  });

  const liveAssets = liveData?.assets || {};
  const assetIds = Object.keys(liveAssets);
  const activeAssetId = selectedAssetId || assetIds[0] || null;
  const activeAsset: SensorAssetLive | undefined = activeAssetId ? liveAssets[activeAssetId] : undefined;

  // History
  const { data: historyData, isFetching: histFetching } = useQuery<SensorHistoryResponse>({
    queryKey: ['sensors-history', activeAssetId, sensorType, rangeDays],
    queryFn: () => sensorsApi.getHistory({
      asset_id: activeAssetId!,
      sensor_type: sensorType,
      start: dateStr(rangeDays),
      end: dateStr(0),
    }),
    enabled: !!activeAssetId,
    staleTime: 300_000,
  });

  // Process history into daily min/max
  const dailyStats = useMemo(() => {
    if (!historyData?.readings?.length) return [];
    const byDay: Record<string, number[]> = {};
    for (const r of historyData.readings) {
      const day = r.t?.slice(0, 10) || '';
      if (!day) continue;
      const val = sensorType === 'wind' ? parseFloat(r.s || '0') : parseFloat(r.v || '0');
      if (isNaN(val)) continue;
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(val);
    }
    return Object.entries(byDay)
      .map(([day, vals]) => ({
        date: day,
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [historyData, sensorType]);

  const globalMin = dailyStats.length ? Math.min(...dailyStats.map(d => d.min)) : 0;
  const globalMax = dailyStats.length ? Math.max(...dailyStats.map(d => d.max)) : 1;
  const activeSensor = SENSOR_TYPES.find(s => s.value === sensorType)!;

  const formatDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight" style={{ color: TEAL }}>
              Environmental Sensors
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
              style={{ background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              NOAA Live
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: '#6B9A87' }}>
            Real-time data from US government stations — NOAA CO-OPS &amp; NDBC
          </p>
        </div>

        <div className="flex items-center gap-3">
          {liveData?.updated_at && (
            <span className="text-[11px] font-medium" style={{ color: '#9CB8AC' }}>
              Updated {timeAgo(liveData.updated_at)}
            </span>
          )}
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['sensors-live'] })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105"
            style={{ background: MINT, color: '#059669', border: `1px solid ${MINT_BORDER}` }}>
            <RefreshCw size={14} className={liveFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Asset Selector ────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#9CB8AC' }}>
          Monitoring Station
        </span>
        <div className="relative">
          <select
            value={activeAssetId || ''}
            onChange={e => setSelectedAssetId(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
            style={{ background: 'white', border: `1px solid ${MINT_BORDER}`, color: TEAL, minWidth: 220 }}>
            {assetIds.map(id => (
              <option key={id} value={id}>
                {liveAssets[id]?.asset_name || `Asset ${id}`}
                {liveAssets[id]?.location_name ? ` — ${liveAssets[id].location_name}` : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#9CB8AC' }} />
        </div>
        {activeAsset?.sources && (
          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-lg"
            style={{ background: MINT, color: '#6B9A87' }}>
            CO-OPS Stn {activeAsset.sources.coops_station} &bull; NDBC Buoy {activeAsset.sources.ndbc_station}
          </span>
        )}
      </div>

      {/* ── Live Sensor Cards ─────────────────────────────── */}
      {activeAsset ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SensorCard
            icon={<Thermometer size={24} color="#EF4444" />}
            label="Air Temperature"
            value={fmt(activeAsset.temperature_f)}
            unit="°F"
            source={`NOAA CO-OPS — Station ${activeAsset.sources.coops_station}`}
            color="#EF4444"
            subtitle={activeAsset.water_temp_f != null ? `Water: ${fmt(activeAsset.water_temp_f)}°F` : undefined}
          />
          <SensorCard
            icon={<Wind size={24} color={BRAND} />}
            label="Wind"
            value={fmt(activeAsset.wind_speed_kn)}
            unit="kn"
            source={`NOAA NDBC — Buoy ${activeAsset.sources.ndbc_station}`}
            color={BRAND}
            subtitle={activeAsset.wind_gust_kn != null ? `Gusts: ${fmt(activeAsset.wind_gust_kn)} kn · ${activeAsset.wind_direction_deg != null ? activeAsset.wind_direction_deg + '°' : ''}` : undefined}
          />
          <SensorCard
            icon={<Droplets size={24} color="#3B82F6" />}
            label="Water Level"
            value={fmt(activeAsset.water_level_ft)}
            unit="ft"
            source={`NOAA CO-OPS — Station ${activeAsset.sources.coops_station}`}
            color="#3B82F6"
            subtitle="MLLW datum reference"
          />
          <SensorCard
            icon={<Waves size={24} color="#8B5CF6" />}
            label="Wave Height"
            value={fmt(activeAsset.wave_height_m)}
            unit="m"
            source={`NOAA NDBC — Buoy ${activeAsset.sources.ndbc_station}`}
            color="#8B5CF6"
            subtitle={activeAsset.wave_period_s != null ? `Period: ${fmt(activeAsset.wave_period_s)}s` : undefined}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl p-12 text-center" style={{ border: `1px solid ${MINT_BORDER}` }}>
          <Activity size={40} className="mx-auto mb-3" style={{ color: '#C8E6D4' }} />
          <p className="text-sm font-semibold" style={{ color: '#9CB8AC' }}>
            {liveFetching ? 'Loading sensor data from NOAA...' : 'No assets with coordinates found'}
          </p>
        </div>
      )}

      {/* ── Historical Data ───────────────────────────────── */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${MINT_BORDER}` }}>
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between"
          style={{ background: MINT, borderBottom: `1px solid ${MINT_BORDER}` }}>
          <div className="flex items-center gap-3">
            <Calendar size={16} style={{ color: TEAL }} />
            <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: TEAL }}>
              Historical Data
            </h2>
            {histFetching && (
              <RefreshCw size={12} className="animate-spin" style={{ color: '#9CB8AC' }} />
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Sensor type dropdown */}
            <div className="relative">
              <button
                onClick={() => { setShowSensorDropdown(!showSensorDropdown); setShowRangeDropdown(false); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold"
                style={{ background: 'white', border: `1px solid ${MINT_BORDER}`, color: TEAL }}>
                {activeSensor.label}
                <ChevronDown size={12} />
              </button>
              {showSensorDropdown && (
                <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg z-20 min-w-[160px]"
                  style={{ border: `1px solid ${MINT_BORDER}` }}>
                  {SENSOR_TYPES.map(s => (
                    <button key={s.value}
                      onClick={() => { setSensorType(s.value); setShowSensorDropdown(false); }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold hover:bg-[#F8FBF9] first:rounded-t-lg last:rounded-b-lg flex items-center gap-2"
                      style={{ color: sensorType === s.value ? BRAND : TEAL }}>
                      <s.icon size={14} color={s.color} />
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Range dropdown */}
            <div className="relative">
              <button
                onClick={() => { setShowRangeDropdown(!showRangeDropdown); setShowSensorDropdown(false); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold"
                style={{ background: 'white', border: `1px solid ${MINT_BORDER}`, color: TEAL }}>
                {RANGE_OPTIONS.find(r => r.days === rangeDays)?.label}
                <ChevronDown size={12} />
              </button>
              {showRangeDropdown && (
                <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg z-20 min-w-[140px]"
                  style={{ border: `1px solid ${MINT_BORDER}` }}>
                  {RANGE_OPTIONS.map(r => (
                    <button key={r.days}
                      onClick={() => { setRangeDays(r.days); setShowRangeDropdown(false); }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold hover:bg-[#F8FBF9] first:rounded-t-lg last:rounded-b-lg"
                      style={{ color: rangeDays === r.days ? BRAND : TEAL }}>
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Daily bars */}
        <div className="p-4">
          {dailyStats.length > 0 ? (
            <div className="space-y-0.5">
              {dailyStats.map(d => (
                <HistoryBar
                  key={d.date}
                  date={formatDate(d.date)}
                  min={d.min}
                  max={d.max}
                  globalMin={globalMin}
                  globalMax={globalMax}
                  unit={activeSensor.unit}
                  color={activeSensor.color}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Gauge size={32} className="mx-auto mb-2" style={{ color: '#C8E6D4' }} />
              <p className="text-sm font-semibold" style={{ color: '#9CB8AC' }}>
                {histFetching ? 'Loading historical data from NOAA...' : 'No data available for this range'}
              </p>
            </div>
          )}
        </div>

        {/* Footer — data attribution */}
        <div className="px-6 py-3 flex items-center gap-4"
          style={{ background: '#FAFDFB', borderTop: `1px solid ${MINT}` }}>
          <span className="text-[10px] font-semibold" style={{ color: '#9CB8AC' }}>
            Data sources: NOAA Center for Operational Oceanographic Products &amp; Services (CO-OPS) &bull; National Data Buoy Center (NDBC)
          </span>
        </div>
      </div>
    </div>
  );
}

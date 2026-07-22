'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from '@/components/OrgLink';
import {
  ArrowLeft, Box, Camera, Clock, Cpu, CheckCircle2,
  AlertCircle, Loader2, Play, Upload, Eye, FileDown,
} from 'lucide-react';
import { missionsApi, assetsApi, flightLogsApi } from '@/lib/api';

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  planned:     { label: 'Planned',     color: '#6366F1', bg: '#EDE9FE', icon: Clock },
  preflight:   { label: 'Pre-flight',  color: '#0891B2', bg: '#E0F2FE', icon: CheckCircle2 },
  in_progress: { label: 'In Progress', color: '#F59E0B', bg: '#FEF3C7', icon: Play },
  uploading:   { label: 'Uploading',   color: '#3B82F6', bg: '#EFF6FF', icon: Upload },
  processing:  { label: 'Processing',  color: '#8B5CF6', bg: '#F5F3FF', icon: Loader2 },
  completed:   { label: 'Completed',   color: '#10B981', bg: '#ECFDF5', icon: CheckCircle2 },
  failed:      { label: 'Failed',      color: '#EF4444', bg: '#FEF2F2', icon: AlertCircle },
  aborted:     { label: 'Aborted',     color: '#6B7280', bg: '#F3F4F6', icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, color: '#6B7280', bg: '#F3F4F6', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color }}>
      <Icon size={14} />
      {cfg.label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-bold text-slate-700">{value ?? '—'}</span>
    </div>
  );
}

export default function MissionDetailPage() {
  const params = useParams();
  const missionId = params.id as string;
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadReport() {
    setDownloading(true);
    try {
      const blob = await flightLogsApi.exportByMission(missionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flight_report_${missionId}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const { data: mission, isLoading } = useQuery({
    queryKey: ['mission', missionId],
    queryFn: () => missionsApi.get(missionId),
  });

  const { data: asset } = useQuery({
    queryKey: ['asset', mission?.asset_id],
    queryFn: () => assetsApi.get(mission!.asset_id),
    enabled: !!mission?.asset_id,
  });

  const { data: detections = [] } = useQuery({
    queryKey: ['mission-detections', missionId],
    queryFn: () => missionsApi.getDetections(missionId),
    enabled: mission?.status === 'completed',
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!mission) return <div className="text-red-500">Mission not found.</div>;

  const isCompleted = mission.status === 'completed';
  const duration = mission.actual_start && mission.actual_end
    ? Math.round((new Date(mission.actual_end).getTime() - new Date(mission.actual_start).getTime()) / 60000)
    : null;

  return (
    <div className="space-y-5">
      <Link href={asset ? `/assets/${asset.id}` : '/assets'}
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-sky-600 font-medium transition-colors">
        <ArrowLeft size={16} />
        {asset ? `Back to ${asset.name}` : 'Back to Assets'}
      </Link>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{mission.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <StatusBadge status={mission.status} />
              {mission.routine_type && (
                <span className="text-xs px-2.5 py-1 rounded-md font-medium bg-slate-100 text-slate-600">
                  {mission.routine_type.replace('_', ' ')}
                </span>
              )}
              {asset && (
                <Link href={`/assets/${asset.id}`}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-800 transition-colors">
                  {asset.name} →
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDownloadReport}
              disabled={downloading}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:shadow transition-all disabled:opacity-50">
              {downloading
                ? <Loader2 size={15} className="animate-spin" />
                : <FileDown size={15} />}
              {downloading ? 'Downloading…' : 'Download Report'}
            </button>
            {isCompleted && (
              <Link
                href={`/digital-twin/viewer?missionId=${mission.id}&assetId=${mission.asset_id}`}
                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all hover:scale-105">
                <Box size={16} />
                Open in 3D Twin
              </Link>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mt-6 pt-5 border-t border-slate-100">
          <Stat label="Drone" value={mission.drone_model} />
          <Stat label="Photos" value={`${mission.photos_uploaded} / ${mission.total_photos}`} />
          <Stat label="Analyzed" value={mission.photos_analyzed} />
          <Stat label="Duration" value={duration != null ? `${duration} min` : null} />
        </div>

        {mission.actual_start && (
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <Clock size={13} />
            Started {new Date(mission.actual_start).toLocaleString()}
            {mission.actual_end && ` · Ended ${new Date(mission.actual_end).toLocaleString()}`}
          </div>
        )}
      </div>

      {/* Detections summary (completed missions) */}
      {isCompleted && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
              <Eye size={15} className="text-sky-500" />
              Detections ({detections.length})
            </h2>
            <Link
              href={`/digital-twin/viewer?missionId=${mission.id}&assetId=${mission.asset_id}`}
              className="text-xs font-semibold text-sky-600 hover:text-sky-800 transition-colors">
              View on 3D Twin →
            </Link>
          </div>
          {detections.length === 0 ? (
            <p className="text-sm text-slate-400">No detections recorded for this mission.</p>
          ) : (
            <div className="space-y-2">
              {detections.slice(0, 10).map(d => (
                <div key={d.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50">
                  <span className="text-sm font-medium text-slate-700">{d.label}</span>
                  <div className="flex items-center gap-3">
                    {d.severity && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        d.severity === 'S4' ? 'bg-red-100 text-red-700' :
                        d.severity === 'S3' ? 'bg-orange-100 text-orange-700' :
                        d.severity === 'S2' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-green-100 text-green-700'
                      }`}>{d.severity}</span>
                    )}
                    <span className="text-xs text-slate-400">{(d.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
              {detections.length > 10 && (
                <p className="text-xs text-slate-400 text-center pt-1">
                  + {detections.length - 10} more — view all in 3D Twin
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ODM status (if processing) */}
      {mission.odm_status && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2 mb-2">
            <Cpu size={15} className="text-violet-500" />
            3D Reconstruction
          </h2>
          <span className="text-sm font-semibold text-slate-700 capitalize">{mission.odm_status}</span>
        </div>
      )}

      {/* Photos progress */}
      {mission.total_photos > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2 mb-3">
            <Camera size={15} className="text-sky-500" />
            Photo Progress
          </h2>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-500 mb-1">
                <span>Uploaded</span>
                <span>{mission.photos_uploaded} / {mission.total_photos}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-sky-500 transition-all"
                  style={{ width: `${Math.min(100, (mission.photos_uploaded / mission.total_photos) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-500 mb-1">
                <span>Analyzed</span>
                <span>{mission.photos_analyzed} / {mission.total_photos}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-violet-500 transition-all"
                  style={{ width: `${Math.min(100, (mission.photos_analyzed / mission.total_photos) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

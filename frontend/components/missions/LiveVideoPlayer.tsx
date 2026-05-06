'use client';

import { useState } from 'react';
import { Video, VideoOff, Signal, Wifi, WifiOff } from 'lucide-react';

interface LiveVideoPlayerProps {
  streamUrl?: string;
  missionName?: string;
  className?: string;
}

export default function LiveVideoPlayer({ streamUrl, missionName, className = '' }: LiveVideoPlayerProps) {
  const [error, setError] = useState(false);

  return (
    <div className={`relative rounded-xl overflow-hidden bg-slate-900 ${className}`} style={{ aspectRatio: '16/9' }}>
      {streamUrl && !error ? (
        <video
          key={streamUrl}
          autoPlay
          muted
          playsInline
          onError={() => setError(true)}
          className="w-full h-full object-cover"
        >
          <source src={streamUrl} type="application/x-mpegURL" />
        </video>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center">
            {streamUrl ? <WifiOff size={24} className="text-red-400" /> : <VideoOff size={24} className="text-slate-500" />}
          </div>
          <div className="text-center">
            <p className="text-[13px] font-semibold text-slate-300">
              {streamUrl ? 'Stream unavailable' : 'No live feed'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {streamUrl ? 'Check drone connection' : 'Activate drone to start streaming'}
            </p>
          </div>
        </div>
      )}

      {/* HUD overlay */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 bg-black/60 rounded-lg px-2 py-1 backdrop-blur-sm">
          <div className={`w-1.5 h-1.5 rounded-full ${streamUrl && !error ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
          <span className="text-[10px] font-bold text-white">{streamUrl && !error ? 'LIVE' : 'OFFLINE'}</span>
        </div>
        {missionName && (
          <div className="bg-black/60 rounded-lg px-2 py-1 backdrop-blur-sm">
            <span className="text-[10px] font-semibold text-slate-300 truncate max-w-[140px] block">{missionName}</span>
          </div>
        )}
        <div className="flex items-center gap-1 bg-black/60 rounded-lg px-2 py-1 backdrop-blur-sm">
          {streamUrl && !error ? <Signal size={10} className="text-emerald-400" /> : <Wifi size={10} className="text-slate-500" />}
        </div>
      </div>
    </div>
  );
}

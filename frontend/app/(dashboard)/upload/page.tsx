'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi, inspectionsApi, imagesApi, analysisApi } from '@/lib/api';
import { useDropzone } from 'react-dropzone';
import { Upload, CheckCircle, AlertCircle, X, ImageIcon, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const TEAL = '#082E29';
const BLUE = '#93C5FD';

export default function UploadPage() {
  const [assetId, setAssetId]           = useState('');
  const [inspectionName, setInspectionName] = useState('');
  const [files, setFiles]               = useState<File[]>([]);
  const [step, setStep]                 = useState<'form' | 'uploading' | 'analyzing' | 'done'>('form');
  const [results, setResults]           = useState<any[]>([]);
  const [error, setError]               = useState('');
  const [progress, setProgress]         = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.tiff'] },
    onDrop: (accepted) => setFiles(prev => [...prev, ...accepted]),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId || !inspectionName || files.length === 0) {
      setError('Please fill all fields and add at least one image.'); return;
    }
    setError(''); setStep('uploading'); setProgress(5);
    setProgressLabel('Creating inspection...');
    try {
      const inspection = await inspectionsApi.create({ asset_id: assetId, name: inspectionName });

      const BATCH_SIZE = 5;
      const allImages: any[] = [];
      const totalBatches = Math.ceil(files.length / BATCH_SIZE);
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        setProgressLabel(`Uploading batch ${batchNum} of ${totalBatches}...`);
        setProgress(5 + Math.round((batchNum / totalBatches) * 35));
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchResult = await imagesApi.upload(inspection.id, batch);
        allImages.push(...batchResult.images);
      }

      setStep('analyzing'); setProgress(40);
      const analysisResults = [];
      for (let idx = 0; idx < allImages.length; idx++) {
        const img = allImages[idx];
        setProgressLabel(`Analysing image ${idx + 1} of ${allImages.length}...`);
        setProgress(40 + Math.round(((idx + 1) / allImages.length) * 55));
        try {
          const result = await analysisApi.analyze(img.id);
          analysisResults.push({ ...img, analysis: result });
        } catch {
          analysisResults.push({ ...img, analysis: null, failed: true });
        }
      }

      setResults(analysisResults);
      setProgress(100);
      setProgressLabel('Finalising...');
      const allFailed = analysisResults.every(r => r.failed);
      await inspectionsApi.update(inspection.id, { status: allFailed ? 'failed' : 'completed' });
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed');
      setStep('form');
    }
  }

  // ── Progress screen (upload + analyze) ──────────────────────────────────────
  if (step === 'uploading' || step === 'analyzing') return (
    <div className="max-w-lg mx-auto mt-20 flex flex-col items-center gap-6">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
        <Upload size={28} style={{ color: TEAL }} />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-bold" style={{ color: TEAL }}>
          {step === 'uploading' ? 'Uploading Images' : 'Running AI Analysis'}
        </h2>
        <p className="text-sm text-slate-500 mt-1">{progressLabel}</p>
      </div>
      {/* Progress bar */}
      <div className="w-full rounded-full overflow-hidden" style={{ height: 8, background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress}%`, background: TEAL }}
        />
      </div>
      <p className="text-sm font-semibold" style={{ color: TEAL }}>{progress}%</p>
    </div>
  );

  // ── Done screen ──────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
            <CheckCircle size={20} style={{ color: TEAL }} />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: TEAL }}>Analysis Complete</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1 ml-12">{results.length} image{results.length !== 1 ? 's' : ''} processed successfully</p>
      </div>
      <div className="space-y-4">
        {results.map((r) => (
          <div key={r.id} className="bg-white rounded-xl p-5 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ImageIcon size={16} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{r.filename}</span>
              </div>
              {r.failed ? (
                <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded-lg font-semibold border border-red-200">
                  <AlertCircle size={13} /> Failed
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg font-semibold border border-emerald-200">
                  <CheckCircle size={13} /> Completed
                </span>
              )}
            </div>
            {r.analysis && (
              <>
                <p className="text-sm text-slate-500 mb-2">{r.analysis.total_detections} detection{r.analysis.total_detections !== 1 ? 's' : ''} found</p>
                <div className="space-y-1.5">
                  {r.analysis.detections.map((d: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-xs rounded-lg px-3 py-2" style={{ background: '#EDF6F0' }}>
                      <span className="font-semibold text-slate-700">{d.damage_type}</span>
                      <span className="text-slate-400">{(d.confidence * 100).toFixed(0)}%</span>
                      {d.severity && <span className={`px-2 py-0.5 rounded-md font-semibold ${
                        d.severity === 'S0' ? 'bg-emerald-50 text-emerald-700' :
                        d.severity === 'S1' ? 'bg-yellow-50 text-yellow-700' :
                        d.severity === 'S2' ? 'bg-amber-50 text-amber-700' :
                        d.severity === 'S3' ? 'bg-red-50 text-red-700' :
                        'bg-purple-50 text-purple-700'
                      }`}>{d.severity}</span>}
                    </div>
                  ))}
                </div>
                {r.analysis.annotated_image_url && (
                  <img src={r.analysis.annotated_image_url} alt="Annotated"
                    className="mt-3 rounded-lg border border-[#C8E6D4] max-h-64 object-contain" />
                )}
              </>
            )}
            {r.analysis?.total_detections === 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 mt-1">
                <CheckCircle size={14} /> No damage detected
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-6">
        <button onClick={() => { setStep('form'); setFiles([]); setResults([]); setInspectionName(''); setProgress(0); }}
          className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 shadow-sm"
          style={{ background: TEAL, color: BLUE }}>
          New Upload
        </button>
        <Link href="/inspections"
          className="flex items-center gap-2 border border-[#C8E6D4] text-slate-600 px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-[#EDF6F0] transition-all">
          View Inspections <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );

  // ── Upload form ──────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEAL }}>Upload Inspection</h1>
        <p className="text-sm text-slate-500 mt-1">Upload images for AI-powered damage analysis</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {/* Inspection Details */}
        <div className="bg-white rounded-xl p-6 shadow-sm space-y-4" style={{ border: '1px solid #C8E6D4' }}>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: TEAL }}>Inspection Details</h2>
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Asset</label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} required
              className="w-full rounded-lg px-3.5 py-2.5 text-sm text-slate-800 outline-none"
              style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
              <option value="">Select asset...</option>
              {assets.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name} ({a.infrastructure_type.replace('_', ' ')})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Inspection Name</label>
            <input value={inspectionName} onChange={e => setInspectionName(e.target.value)} required
              className="w-full rounded-lg px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none"
              style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}
              placeholder="e.g. Q1 2026 Routine Inspection" />
          </div>
        </div>

        {/* Image Upload */}
        <div className="bg-white rounded-xl p-6 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: TEAL }}>Images</h2>
          <div {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              isDragActive ? 'border-[#0891B2]' : 'border-[#C8E6D4] hover:border-[#0891B2]'
            }`}
            style={{ background: isDragActive ? '#EDF6F0' : 'transparent' }}>
            <input {...getInputProps()} />
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
              <Upload size={24} style={{ color: TEAL }} />
            </div>
            <p className="text-sm font-medium text-slate-700">Drag & drop images here, or click to select</p>
            <p className="text-xs text-slate-400 mt-1">JPEG, PNG, TIFF supported</p>
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs rounded-lg px-3.5 py-2.5" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
                  <div className="flex items-center gap-2">
                    <ImageIcon size={14} className="text-slate-400" />
                    <span className="text-slate-700 font-medium">{f.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500 transition-colors p-0.5 rounded hover:bg-red-50">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 font-medium">
            {error}
          </div>
        )}

        <button type="submit"
          className="px-8 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 shadow-sm disabled:opacity-50"
          style={{ background: TEAL, color: BLUE }}
          disabled={files.length === 0}>
          Upload & Analyse {files.length > 0 ? `(${files.length} image${files.length !== 1 ? 's' : ''})` : ''}
        </button>
      </form>
    </div>
  );
}

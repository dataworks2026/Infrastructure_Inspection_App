'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi, inspectionsApi, imagesApi, analysisApi } from '@/lib/api';
import { useDropzone } from 'react-dropzone';
import { Upload, CheckCircle, AlertCircle, X, ImageIcon, ArrowRight, CloudUpload, Zap } from 'lucide-react';
import Link from 'next/link';

const TEAL  = '#082E29';
const MINT  = '#EDF6F0';
const BLUE  = '#93C5FD';
const BRAND = '#0891B2';

export default function UploadPage() {
  const [assetId, setAssetId]               = useState('');
  const [inspectionName, setInspectionName] = useState('');
  const [files, setFiles]                   = useState<File[]>([]);
  const [step, setStep]                     = useState<'form' | 'uploading' | 'analyzing' | 'done'>('form');
  const [results, setResults]               = useState<any[]>([]);
  const [error, setError]                   = useState('');
  const [progress, setProgress]             = useState({ uploaded: 0, analyzed: 0, total: 0 });

  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.tiff'] },
    onDrop: accepted => setFiles(prev => [...prev, ...accepted]),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId || !inspectionName || files.length === 0) {
      setError('Please fill all fields and add at least one image.'); return;
    }
    setError(''); setStep('uploading');
    try {
      const inspection = await inspectionsApi.create({ asset_id: assetId, name: inspectionName });
      const BATCH = 5;
      const allImages: any[] = [];
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const res = await imagesApi.upload(inspection.id, batch);
        allImages.push(...res.images);
        setProgress(p => ({ ...p, uploaded: Math.min(i + BATCH, files.length), total: files.length }));
      }

      setStep('analyzing');
      const analysisResults: any[] = [];
      for (const img of allImages) {
        try {
          const result = await analysisApi.analyze(img.id);
          analysisResults.push({ ...img, analysis: result });
        } catch {
          analysisResults.push({ ...img, analysis: null, failed: true });
        }
        setProgress(p => ({ ...p, analyzed: analysisResults.length, total: allImages.length }));
      }

      setResults(analysisResults);
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

  /* ── Loading screens ── */
  if (step === 'uploading' || step === 'analyzing') {
    const isAnalyzing = step === 'analyzing';
    const pct = progress.total > 0
      ? Math.round(((isAnalyzing ? progress.analyzed : progress.uploaded) / progress.total) * 100)
      : 0;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
          style={{ background: TEAL }}>
          {isAnalyzing
            ? <Zap size={28} color={BLUE} className="animate-pulse" />
            : <CloudUpload size={28} color={BLUE} className="animate-bounce" />}
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold" style={{ color: TEAL }}>
            {isAnalyzing ? 'Running AI Analysis' : `Uploading Images`}
          </h2>
          <p className="text-sm mt-1" style={{ color: '#6B9A87' }}>
            {isAnalyzing
              ? `Analysing ${progress.analyzed} of ${progress.total} images…`
              : `Uploading ${progress.uploaded} of ${files.length} images…`}
          </p>
        </div>
        {/* Progress bar */}
        <div className="w-64 h-2 rounded-full overflow-hidden" style={{ background: '#C8E6D4' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: isAnalyzing ? BRAND : TEAL }} />
        </div>
        <p className="text-xs font-mono font-bold" style={{ color: '#6B9A87' }}>{pct}%</p>
        <p className="text-xs" style={{ color: '#A5D4BB' }}>Please don't close this page</p>
      </div>
    );
  }

  /* ── Done screen ── */
  if (step === 'done') {
    const failed  = results.filter(r => r.failed).length;
    const success = results.length - failed;
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-white border border-[#C8E6D4] rounded-2xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4"
            style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
            <CheckCircle size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold" style={{ color: TEAL }}>Analysis Complete</h2>
          <p className="text-sm mt-2" style={{ color: '#6B9A87' }}>
            {success} image{success !== 1 ? 's' : ''} analysed successfully
            {failed > 0 && <span className="text-amber-600"> · {failed} failed</span>}
          </p>
          <div className="flex items-center justify-center gap-4 mt-6">
            <button onClick={() => { setStep('form'); setFiles([]); setResults([]); setAssetId(''); setInspectionName(''); setProgress({ uploaded: 0, analyzed: 0, total: 0 }); }}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors"
              style={{ background: MINT, color: '#2E6B5B', border: '1px solid #C8E6D4', cursor: 'pointer', fontFamily: 'inherit' }}>
              New Inspection
            </button>
            <Link href="/inspections"
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-lg shadow-sm"
              style={{ background: TEAL, color: BLUE }}>
              View Inspections <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Results grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {results.map((r, i) => (
            <div key={i} className={`bg-white rounded-xl overflow-hidden border shadow-sm ${r.failed ? 'border-red-200' : 'border-[#C8E6D4]'}`}>
              <div className="aspect-video bg-gray-100 relative">
                {r.analysis?.annotated_url ? (
                  <img src={r.analysis.annotated_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon size={24} style={{ color: '#C8E6D4' }} />
                  </div>
                )}
                {r.failed && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-50/80">
                    <AlertCircle size={20} className="text-red-400" />
                  </div>
                )}
              </div>
              <div className="px-3 py-2">
                <p className="text-[11px] font-medium truncate" style={{ color: TEAL }}>{r.filename}</p>
                {!r.failed && r.analysis && (
                  <p className="text-[10px] mt-0.5" style={{ color: '#6B9A87' }}>
                    {r.analysis.detections_count ?? 0} detection{(r.analysis.detections_count ?? 0) !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Upload form ── */
  const inputCls = 'w-full px-3 py-2.5 text-sm rounded-lg outline-none transition-all';
  const inputStyle = { background: MINT, border: '1.5px solid #C8E6D4', color: TEAL, fontFamily: 'inherit' };

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: TEAL }}>New Inspection</h1>
        <p className="text-xs mt-0.5" style={{ color: '#6B9A87' }}>Upload drone imagery for AI defect analysis</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Step 1 — Inspection details */}
        <div className="bg-white border border-[#C8E6D4] rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold" style={{ color: TEAL }}>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black mr-2"
              style={{ background: TEAL, color: BLUE }}>1</span>
            Inspection Details
          </h2>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: '#2E6B5B' }}>
              Asset *
            </label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} required
              className={inputCls} style={inputStyle}>
              <option value="">Select an asset…</option>
              {(assets as any[]).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: '#2E6B5B' }}>
              Inspection Name *
            </label>
            <input type="text" value={inspectionName} onChange={e => setInspectionName(e.target.value)} required
              placeholder="e.g. Q1 2025 Annual Survey"
              className={inputCls} style={inputStyle} />
          </div>
        </div>

        {/* Step 2 — Image upload */}
        <div className="bg-white border border-[#C8E6D4] rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold" style={{ color: TEAL }}>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black mr-2"
              style={{ background: TEAL, color: BLUE }}>2</span>
            Upload Images
          </h2>

          {/* Dropzone */}
          <div {...getRootProps()}
            className="rounded-xl cursor-pointer transition-all flex flex-col items-center justify-center gap-3 py-10"
            style={{
              border: `2px dashed ${isDragActive ? BRAND : '#C8E6D4'}`,
              background: isDragActive ? '#EFF6FF' : MINT,
            }}>
            <input {...getInputProps()} />
            <div className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: isDragActive ? '#DBEAFE' : '#C8E6D4' }}>
              <CloudUpload size={24} style={{ color: isDragActive ? BRAND : '#6B9A87' }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: isDragActive ? BRAND : TEAL }}>
                {isDragActive ? 'Drop images here' : 'Drag & drop images'}
              </p>
              <p className="text-[11px] mt-1" style={{ color: '#6B9A87' }}>
                or click to browse · JPG, PNG, TIFF supported
              </p>
            </div>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold" style={{ color: TEAL }}>
                  {files.length} image{files.length !== 1 ? 's' : ''} selected
                </p>
                <button type="button" onClick={() => setFiles([])}
                  className="text-[10px] font-medium hover:underline"
                  style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Clear all
                </button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-40 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="relative group aspect-square rounded-lg overflow-hidden"
                    style={{ border: '1px solid #C8E6D4' }}>
                    <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setFiles(fl => fl.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'rgba(0,0,0,0.6)' }}>
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        <button type="submit"
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold rounded-xl shadow-sm hover:shadow-md transition-all"
          style={{ background: TEAL, color: BLUE, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Upload size={16} color={BLUE} /> Start Analysis
        </button>
      </form>
    </div>
  );
}

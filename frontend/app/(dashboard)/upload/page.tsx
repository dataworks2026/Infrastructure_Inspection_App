'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi, inspectionsApi, imagesApi, analysisApi } from '@/lib/api';
import { useDropzone } from 'react-dropzone';
import { Upload, CheckCircle, AlertCircle, Loader, X, ImageIcon, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function UploadPage() {
  const [assetId, setAssetId] = useState('');
  const [inspectionName, setInspectionName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<'form' | 'uploading' | 'analyzing' | 'done'>('form');
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');

  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.tiff'] },
    onDrop: (accepted) => setFiles(prev => [...prev, ...accepted])
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId || !inspectionName || files.length === 0) {
      setError('Please fill all fields and add at least one image.'); return;
    }
    setError(''); setStep('uploading');
    try {
      const inspection = await inspectionsApi.create({ asset_id: assetId, name: inspectionName });
      // Upload in batches of 5 to avoid overwhelming the server with a huge multipart request
      const BATCH_SIZE = 5;
      const allImages: any[] = [];
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchResult = await imagesApi.upload(inspection.id, batch);
        allImages.push(...batchResult.images);
      }
      const uploadResult = { images: allImages };
      setStep('analyzing');
      const analysisResults = [];
      for (const img of uploadResult.images) {
        try {
          const result = await analysisApi.analyze(img.id);
          analysisResults.push({ ...img, analysis: result });
        } catch {
          analysisResults.push({ ...img, analysis: null, failed: true });
        }
      }
      setResults(analysisResults);
      // Mark inspection completed/failed based on results
      const allFailed = analysisResults.every(r => r.failed);
      await inspectionsApi.update(inspection.id, { status: allFailed ? 'failed' : 'completed' });
      // Invalidate caches so inspections/assets pages show fresh data immediately
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed');
      setStep('form');
    }
  }

  if (step === 'uploading') return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-12 h-12 border-3 border-mira-blue border-t-transparent rounded-full animate-spin" />
      <p className="text-mira-muted text-sm font-medium">Uploading {files.length} image{files.length !== 1 ? 's' : ''}...</p>
    </div>
  );

  if (step === 'analyzing') return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-12 h-12 border-3 border-mira-blue border-t-transparent rounded-full animate-spin" />
      <div className="text-center">
        <p className="text-slate-700 text-sm font-semibold">Running AI Analysis</p>
        <p className="text-mira-muted text-xs mt-1">This may take a moment...</p>
      </div>
    </div>
  );

  if (step === 'done') return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle size={18} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Analysis Complete</h1>
        </div>
        <p className="text-sm text-mira-muted mt-1 ml-11">{results.length} image{results.length !== 1 ? 's' : ''} processed successfully</p>
      </div>
      <div className="space-y-4">
        {results.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ImageIcon size={16} className="text-mira-muted" />
                <span className="text-sm font-semibold text-slate-700">{r.filename}</span>
              </div>
              {r.failed ? (
                <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded-md font-medium"><AlertCircle size={14} /> Failed</span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md font-medium"><CheckCircle size={14} /> Completed</span>
              )}
            </div>
            {r.analysis && (
              <>
                <p className="text-sm text-mira-muted mb-2">{r.analysis.total_detections} detection{r.analysis.total_detections !== 1 ? 's' : ''} found</p>
                <div className="space-y-1.5">
                  {r.analysis.detections.map((d: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <span className="font-semibold text-slate-700">{d.damage_type}</span>
                      <span className="text-mira-faint">{(d.confidence * 100).toFixed(0)}%</span>
                      {d.severity && <span className={`px-2 py-0.5 rounded-md font-medium ${
                        d.severity === 'S0' ? 'bg-emerald-50 text-emerald-700' :
                        d.severity === 'S1' ? 'bg-lime-50 text-lime-700' :
                        d.severity === 'S2' ? 'bg-amber-50 text-amber-700' :
                        d.severity === 'S3' ? 'bg-red-50 text-red-700' :
                        'bg-purple-50 text-purple-700'
                      }`}>{d.severity}</span>}
                    </div>
                  ))}
                </div>
                {r.analysis.annotated_image_url && (
                  <img src={r.analysis.annotated_image_url} alt="Annotated"
                    className="mt-3 rounded-lg border border-slate-200 max-h-64 object-contain" />
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
        <button onClick={() => { setStep('form'); setFiles([]); setResults([]); setInspectionName(''); }}
          className="bg-gradient-to-r from-sky-500 to-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all">
          New Upload
        </button>
        <Link href="/inspections"
          className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all flex items-center gap-2">
          View Inspections <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Upload Inspection</h1>
        <p className="text-sm text-mira-muted mt-1">Upload images for AI-powered damage analysis</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {/* Inspection Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-card space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Inspection Details</h2>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1.5">Asset</label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-800 focus:bg-white">
              <option value="">Select asset...</option>
              {assets.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.infrastructure_type.replace('_', ' ')})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1.5">Inspection Name</label>
            <input value={inspectionName} onChange={e => setInspectionName(e.target.value)} required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white"
              placeholder="e.g. Q1 2026 Routine Inspection" />
          </div>
        </div>

        {/* Image Upload */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Images</h2>
          <div {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              isDragActive ? 'border-mira-blue bg-sky-50' : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50'
            }`}>
            <input {...getInputProps()} />
            <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center mx-auto mb-3">
              <Upload size={24} className="text-mira-blue" />
            </div>
            <p className="text-sm font-medium text-slate-700">Drag & drop images here, or click to select</p>
            <p className="text-xs text-mira-faint mt-1">JPEG, PNG, TIFF supported</p>
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-slate-50 border border-slate-100 rounded-lg px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={14} className="text-mira-muted" />
                    <span className="text-slate-700 font-medium">{f.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-mira-faint">{(f.size / 1024).toFixed(0)} KB</span>
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

        {error && <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 font-medium">{error}</div>}

        <button type="submit"
          className="bg-gradient-to-r from-sky-500 to-blue-600 text-white px-8 py-2.5 rounded-lg text-sm font-semibold shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 transition-all disabled:opacity-50"
          disabled={files.length === 0}>
          Upload & Analyse {files.length > 0 ? `(${files.length} image${files.length !== 1 ? 's' : ''})` : ''}
        </button>
      </form>
    </div>
  );
}

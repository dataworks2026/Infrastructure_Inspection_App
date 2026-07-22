'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assetsApi, inspectionsApi, imagesApi, analysisApi } from '@/lib/api';
import { useDropzone } from 'react-dropzone';
import { Upload, CheckCircle, AlertCircle, X, ImageIcon, ArrowRight, FileText } from 'lucide-react';
import Link from '@/components/OrgLink';
import ReviewOverlay from '@/components/review/ReviewOverlay';
import { normSeverity, severityHex, SEVERITY_LABEL } from '@/lib/severity';
import type { Inspection } from '@/types';

const TEAL = '#082E29';
const BLUE = '#93C5FD';

const INSPECTION_TYPE_OPTIONS = ['Routine', 'Detailed', 'Special', 'Damage Assessment', 'Follow-up', 'Other'];

const todayYMD = () => new Date().toISOString().split('T')[0];

export default function UploadPage() {
  const [assetId, setAssetId]           = useState('');
  const [inspectionName, setInspectionName] = useState('');
  const [inspectedAt, setInspectedAt]   = useState(todayYMD());
  const [inspectorName, setInspectorName] = useState('');
  const [inspectionType, setInspectionType] = useState('');
  const [files, setFiles]               = useState<File[]>([]);
  const [step, setStep]                 = useState<'form' | 'uploading' | 'analyzing' | 'done'>('form');
  const [results, setResults]           = useState<any[]>([]);
  const [inspectionId, setInspectionId] = useState('');
  const [error, setError]               = useState('');
  const [progress, setProgress]         = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: () => assetsApi.list() });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.tiff'],
      'application/pdf': ['.pdf'],
    },
    onDrop: (accepted) => setFiles(prev => [...prev, ...accepted]),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!assetId || !inspectionName || files.length === 0) {
      setError('Please fill all fields and add at least one image.'); return;
    }
    setError(''); setStep('uploading'); setProgress(5);
    setProgressLabel('Creating inspection...');
    // Track the created inspection so a failed/empty upload can be cleaned up
    // instead of leaving an orphan "pending" inspection behind.
    let createdId: string | null = null;
    const allImages: any[] = [];
    try {
      const createPayload: Partial<Inspection> = {
        asset_id: assetId,
        name: inspectionName,
        // Always send inspected_at (defaults to today); convert YYYY-MM-DD → ISO
        inspected_at: new Date(inspectedAt || todayYMD()).toISOString(),
      };
      if (inspectorName.trim()) createPayload.inspector_name = inspectorName.trim();
      if (inspectionType) createPayload.inspection_type = inspectionType;
      const inspection = await inspectionsApi.create(createPayload);
      createdId = inspection.id;
      setInspectionId(inspection.id);

      const imageFiles = files.filter(f => f.type !== 'application/pdf');
      const pdfFiles = files.filter(f => f.type === 'application/pdf');

      const warnings: string[] = [];

      // Upload PDFs first (extract images server-side). A PDF with no images
      // must NOT abort the whole upload — warn and continue with the rest.
      if (pdfFiles.length > 0) {
        for (let i = 0; i < pdfFiles.length; i++) {
          setProgressLabel(`Extracting images from PDF ${i + 1} of ${pdfFiles.length}...`);
          setProgress(5 + Math.round(((i + 1) / (pdfFiles.length + 1)) * 15));
          try {
            const pdfResult = await imagesApi.uploadPdf(inspection.id, pdfFiles[i]);
            allImages.push(...pdfResult.images);
          } catch (pdfErr: any) {
            const detail = pdfErr?.response?.data?.detail || 'could not be processed';
            warnings.push(`"${pdfFiles[i].name}": ${detail}`);
          }
        }
      }

      // Upload regular images in batches
      const BATCH_SIZE = 5;
      const totalBatches = Math.ceil(imageFiles.length / BATCH_SIZE);
      for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        setProgressLabel(`Uploading batch ${batchNum} of ${totalBatches}...`);
        setProgress(20 + Math.round((batchNum / totalBatches) * 20));
        const batch = imageFiles.slice(i, i + BATCH_SIZE);
        const batchResult = await imagesApi.upload(inspection.id, batch);
        allImages.push(...batchResult.images);
      }

      // Nothing usable was uploaded (e.g. only an image-less PDF) — remove the
      // empty inspection so it never lingers as a "pending" orphan.
      if (allImages.length === 0) {
        try { await inspectionsApi.delete(inspection.id); } catch { /* best effort */ }
        createdId = null;
        setInspectionId('');
        setError(warnings.length ? `No images to analyze. ${warnings.join(' · ')}` : 'No images found to analyze.');
        setStep('form');
        return;
      }

      setStep('analyzing'); setProgress(40);
      const analysisResults = [];
      for (let idx = 0; idx < allImages.length; idx++) {
        const img = allImages[idx];
        setProgressLabel(`Analysing image ${idx + 1} of ${allImages.length}...`);
        setProgress(40 + Math.round(((idx + 1) / allImages.length) * 55));
        try {
          const result = await analysisApi.analyze(img.id);
          // The upload response item has no image URL; fetch the full record so we
          // can render the ORIGINAL image (same `/storage/...` url the detail page
          // uses) with severity-colored overlay boxes — not the YOLO image.
          let imageUrl = '';
          try {
            const record = await imagesApi.get(img.id);
            imageUrl = record.url;
          } catch { /* leave imageUrl empty — card falls back gracefully */ }
          analysisResults.push({ ...img, analysis: result, imageUrl });
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
      // If we failed before any image was uploaded, delete the empty inspection
      // so a failed upload never leaves a "pending" orphan behind.
      if (createdId && allImages.length === 0) {
        try { await inspectionsApi.delete(createdId); } catch { /* best effort */ }
        setInspectionId('');
      }
      setError(err.response?.data?.detail || 'Upload failed');
      setStep('form');
    }
  }

  // ── Progress screen (upload + analyze) ──────────────────────────────────────
  if (step === 'uploading' || step === 'analyzing') return (
    <div className="max-w-lg mx-auto mt-20 flex flex-col items-center gap-6">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
        <Upload size={30} style={{ color: TEAL }} />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold" style={{ color: TEAL }}>
          {step === 'uploading' ? 'Uploading Images' : 'Running AI Analysis'}
        </h2>
        <p className="text-base text-slate-500 mt-1">{progressLabel}</p>
      </div>
      {/* Progress bar */}
      <div className="w-full rounded-full overflow-hidden" style={{ height: 8, background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress}%`, background: TEAL }}
        />
      </div>
      <p className="text-base font-semibold" style={{ color: TEAL }}>{progress}%</p>
    </div>
  );

  // ── Done screen ──────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
            <CheckCircle size={22} style={{ color: TEAL }} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: TEAL }}>Analysis Complete</h1>
        </div>
        <p className="text-base text-slate-500 mt-1 ml-12">{results.length} image{results.length !== 1 ? 's' : ''} processed successfully</p>
      </div>
      <div className="space-y-4">
        {results.map((r) => (
          <div key={r.id} className="bg-white rounded-xl p-5 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ImageIcon size={18} className="text-slate-400" />
                <span className="text-base font-semibold text-slate-700">{r.filename}</span>
              </div>
              {r.failed ? (
                <span className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-2.5 py-1 rounded-lg font-semibold border border-red-200">
                  <AlertCircle size={15} /> Failed
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg font-semibold border border-emerald-200">
                  <CheckCircle size={15} /> Completed
                </span>
              )}
            </div>
            {r.analysis && (
              <>
                <p className="text-base text-slate-500 mb-2">{r.analysis.total_detections} detection{r.analysis.total_detections !== 1 ? 's' : ''} found</p>
                <div className="space-y-1.5">
                  {r.analysis.detections.map((d: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-sm rounded-lg px-3 py-2" style={{ background: '#EDF6F0' }}>
                      <span className="font-semibold text-slate-700">{d.damage_type}</span>
                      <span className="text-slate-400">{(d.confidence * 100).toFixed(0)}%</span>
                      {d.severity && (() => {
                        const ns = normSeverity(d.severity);
                        const hex = severityHex(d.severity);
                        const label = ns ? SEVERITY_LABEL[ns] : '';
                        return (
                          <span className="flex items-center gap-1.5 font-semibold" style={{ color: hex }}>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: hex }} />
                            {ns || d.severity}{label ? ` · ${label}` : ''}
                          </span>
                        );
                      })()}
                    </div>
                  ))}
                </div>
                {r.imageUrl && r.analysis.detections.length > 0 && (
                  <div className="mt-3 max-w-md">
                    <ReviewOverlay
                      imageUrl={r.imageUrl}
                      detections={r.analysis.detections}
                      mode="view"
                    />
                  </div>
                )}
              </>
            )}
            {r.analysis?.total_detections === 0 && (
              <div className="flex items-center gap-2 text-base text-emerald-600 mt-1">
                <CheckCircle size={16} /> No damage detected
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-6">
        <button onClick={() => { setStep('form'); setFiles([]); setResults([]); setInspectionName(''); setInspectedAt(todayYMD()); setInspectorName(''); setInspectionType(''); setInspectionId(''); setProgress(0); }}
          className="px-6 py-2.5 rounded-xl text-base font-bold transition-all hover:opacity-90 shadow-sm"
          style={{ background: TEAL, color: BLUE }}>
          New Upload
        </button>
        <Link href={inspectionId ? `/inspections/${inspectionId}` : '/inspections'}
          className="flex items-center gap-2 border border-[#C8E6D4] text-slate-600 px-6 py-2.5 rounded-xl text-base font-medium hover:bg-[#EDF6F0] transition-all">
          View Inspection <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );

  // ── Upload form ──────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: TEAL }}>Upload Inspection</h1>
        <p className="text-base text-slate-500 mt-1">Upload images for AI-powered damage analysis</p>
      </div>

      <form onSubmit={handleSubmit} data-tour="upload-form" className="max-w-3xl space-y-6">
        {/* Inspection Details */}
        <div className="bg-white rounded-xl p-6 shadow-sm space-y-4" style={{ border: '1px solid #C8E6D4' }}>
          <h2 className="text-base font-bold uppercase tracking-wider" style={{ color: TEAL }}>Inspection Details</h2>
          <div>
            <label className="text-[12px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Asset</label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} required
              className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 outline-none"
              style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
              <option value="">Select asset...</option>
              {assets.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name} ({a.infrastructure_type.replace('_', ' ')})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Inspection Name</label>
            <input value={inspectionName} onChange={e => setInspectionName(e.target.value)} required
              className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 placeholder:text-slate-400 outline-none"
              style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}
              placeholder="e.g. Q1 2026 Routine Inspection" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Inspection Date</label>
              <input type="date" value={inspectedAt} onChange={e => setInspectedAt(e.target.value)}
                className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 outline-none"
                style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }} />
            </div>
            <div>
              <label className="text-[12px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Inspection Type</label>
              <select value={inspectionType} onChange={e => setInspectionType(e.target.value)}
                className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 outline-none"
                style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
                <option value="">-- Select --</option>
                {INSPECTION_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Inspector Name</label>
            <input value={inspectorName} onChange={e => setInspectorName(e.target.value)}
              className="w-full rounded-lg px-3.5 py-2.5 text-base text-slate-800 placeholder:text-slate-400 outline-none"
              style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}
              placeholder="e.g. Jane Smith" />
          </div>
        </div>

        {/* Image Upload */}
        <div className="bg-white rounded-xl p-6 shadow-sm" style={{ border: '1px solid #C8E6D4' }}>
          <h2 className="text-base font-bold uppercase tracking-wider mb-4" style={{ color: TEAL }}>Images</h2>
          <div {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              isDragActive ? 'border-[#0891B2]' : 'border-[#C8E6D4] hover:border-[#0891B2]'
            }`}
            style={{ background: isDragActive ? '#EDF6F0' : 'transparent' }}>
            <input {...getInputProps()} />
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
              <Upload size={26} style={{ color: TEAL }} />
            </div>
            <p className="text-base font-medium text-slate-700">Drag & drop files here, or click to select</p>
            <p className="text-sm text-slate-400 mt-1">JPEG, PNG, TIFF, and PDF supported</p>
            <p className="text-xs text-slate-400 mt-0.5">PDFs will have their images extracted automatically</p>
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm rounded-lg px-3.5 py-2.5" style={{ background: '#EDF6F0', border: '1px solid #C8E6D4' }}>
                  <div className="flex items-center gap-2">
                    {f.type === 'application/pdf' ? <FileText size={16} className="text-red-400" /> : <ImageIcon size={16} className="text-slate-400" />}
                    <span className="text-slate-700 font-medium">{f.name}</span>
                    {f.type === 'application/pdf' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-500 border border-red-200">PDF</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500 transition-colors p-0.5 rounded hover:bg-red-50">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 font-medium">
            {error}
          </div>
        )}

        <button type="submit"
          className="px-8 py-2.5 rounded-xl text-base font-bold transition-all hover:opacity-90 shadow-sm disabled:opacity-50"
          style={{ background: TEAL, color: BLUE }}
          disabled={files.length === 0}>
          Upload & Analyse {files.length > 0 ? `(${files.length} file${files.length !== 1 ? 's' : ''})` : ''}
        </button>
      </form>
    </div>
  );
}

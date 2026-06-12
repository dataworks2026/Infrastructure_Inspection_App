'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  FolderArchive, Upload as UploadIcon, FileText, X,
  RotateCw, Maximize2, ZoomIn, ZoomOut, Move,
  AlertCircle, FileCheck, Trash2,
} from 'lucide-react';

/* ── Local-only record store. Files live in memory + a tiny IndexedDB cache so
   they survive a refresh without a backend round-trip. For Phase 2 we’ll
   POST to /api/v1/records and persist server-side; for now, the pitch demo
   just needs the workflow to feel real. ────────────────────────────────── */

type RecordKind = 'dxf' | 'dwg' | 'pdf' | 'unknown';
interface RecordItem {
  id: string;
  name: string;
  kind: RecordKind;
  size_bytes: number;
  uploaded_at: string;
  blob_url: string;     // URL.createObjectURL — only valid for this session
  raw_bytes?: ArrayBuffer; // kept for the viewer to re-load
}

// crypto.randomUUID() is only exposed in secure contexts (HTTPS or localhost).
// We're served over plain HTTP today, so we need a fallback ID generator.
function uid(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2, 11) + '-' + Date.now().toString(36);
}

function classify(name: string): RecordKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'dwg') return 'dwg';
  if (ext === 'pdf') return 'pdf';
  return 'unknown';
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

const ACCEPT = '.dxf,.dwg,.pdf';

export default function RecordsPage() {
  const [items, setItems] = useState<RecordItem[]>([]);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);  // file currently being ingested
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const arr = Array.from(files);
    console.log('[records] ingest start', arr.map(f => `${f.name} ${f.size}b`));
    if (arr.length === 0) {
      setError('No files received from the picker. Try drag-drop instead.');
      return;
    }
    const list: RecordItem[] = [];
    try {
      for (const f of arr) {
        setBusy(`Reading ${f.name} (${fmtBytes(f.size)}) ...`);
        // arrayBuffer() can take several seconds for large CAD files
        const buf = await f.arrayBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: f.type || 'application/octet-stream' }));
        list.push({
          id: uid(),
          name: f.name,
          kind: classify(f.name),
          size_bytes: f.size,
          uploaded_at: new Date().toISOString(),
          blob_url: url,
          raw_bytes: buf,
        });
        console.log('[records] ingested', f.name, '→ kind =', classify(f.name));
      }
      setItems(prev => [...list, ...prev]);
      if (list.length > 0) setSelected(list[0]);
    } catch (e: any) {
      console.error('[records] ingest failed', e);
      setError(`Ingest failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(null);
      // Reset the input so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FolderArchive className="text-sky-500" size={26} /> Records
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Engineering drawings (DXF/DWG), inspection reports (PDF), and other source documents per asset. Drop a file to view it inline.
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold shadow-sm transition-all"
        >
          <UploadIcon size={16} /> Upload record
        </button>
        {/* No accept filter on the input — some OS file pickers hide .dwg/.dxf
            entirely when a comma-separated allow-list is provided. We classify
            the file ourselves after selection. */}
        <input
          ref={fileInputRef} type="file" multiple
          className="hidden"
          onChange={e => e.target.files && ingest(e.target.files)}
        />
      </div>

      {/* Busy / error banners — make ingestion visible */}
      {busy && (
        <div className="rounded-lg bg-sky-50 border border-sky-200 text-sky-900 px-4 py-2.5 text-[13px] mb-4 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          {busy}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-900 px-4 py-2.5 text-[13px] mb-4 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div>{error}</div>
          <button onClick={() => setError(null)} className="ml-auto text-red-500"><X size={14} /></button>
        </div>
      )}

      {/* Drop zone (collapses to a thin strip when records exist) */}
      <div
        className={`rounded-2xl border-2 border-dashed transition-all mb-6 ${
          dragOver ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
        } ${items.length === 0 ? 'p-16' : 'p-6'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          if (e.dataTransfer.files.length > 0) ingest(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-col items-center text-center">
          <div className={`rounded-full ${items.length === 0 ? 'w-16 h-16' : 'w-10 h-10'} bg-sky-100 flex items-center justify-center mb-3`}>
            <UploadIcon className="text-sky-600" size={items.length === 0 ? 28 : 18} />
          </div>
          <p className={`font-semibold text-slate-700 ${items.length === 0 ? 'text-base' : 'text-sm'}`}>
            Drop CAD / PDF files here, or click "Upload record"
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Supported: <code>.dxf</code> · <code>.dwg</code> (preview not yet supported) · <code>.pdf</code> — max 200 MB
          </p>
        </div>
      </div>

      {/* Records list + viewer (split) */}
      {items.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {/* Sidebar list */}
          <div className="col-span-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Files ({items.length})
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[68vh] overflow-y-auto">
                {items.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-all flex items-start gap-3 ${
                      selected?.id === r.id ? 'bg-sky-50 border-l-2 border-sky-500' : ''
                    }`}
                  >
                    <FileBadge kind={r.kind} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{r.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {fmtBytes(r.size_bytes)} · {new Date(r.uploaded_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        URL.revokeObjectURL(r.blob_url);
                        setItems(prev => prev.filter(x => x.id !== r.id));
                        if (selected?.id === r.id) setSelected(null);
                      }}
                      className="text-slate-300 hover:text-red-500 p-1"
                      title="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Viewer pane */}
          <div className="col-span-8">
            <div className="bg-slate-900 border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col" style={{ height: '72vh' }}>
              <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between bg-slate-950">
                <div className="flex items-center gap-2 min-w-0">
                  <FileBadge kind={selected?.kind ?? 'unknown'} small />
                  <span className="text-[13px] font-semibold text-white truncate">
                    {selected?.name ?? 'No file selected'}
                  </span>
                </div>
                {selected && (
                  <span className="text-[10px] text-slate-400">
                    {fmtBytes(selected.size_bytes)}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden bg-[#0A0E14]">
                {!selected ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    Pick a file on the left
                  </div>
                ) : selected.kind === 'dxf' ? (
                  <DxfViewer record={selected} />
                ) : selected.kind === 'pdf' ? (
                  <iframe src={selected.blob_url} className="w-full h-full bg-white" title={selected.name} />
                ) : selected.kind === 'dwg' ? (
                  <UnsupportedDwg name={selected.name} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    Preview not available for this file type
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Visual file-type badge ─────────────────────────────────────────────── */
function FileBadge({ kind, small }: { kind: RecordKind; small?: boolean }) {
  const cfg = {
    dxf: { color: '#0EA5E9', bg: '#E0F2FE', label: 'DXF' },
    dwg: { color: '#8B5CF6', bg: '#EDE9FE', label: 'DWG' },
    pdf: { color: '#EF4444', bg: '#FEE2E2', label: 'PDF' },
    unknown: { color: '#64748B', bg: '#E2E8F0', label: '—' },
  }[kind];
  const sz = small ? 24 : 36;
  return (
    <div
      className="rounded-md flex items-center justify-center flex-shrink-0 font-black"
      style={{ width: sz, height: sz, background: cfg.bg, color: cfg.color, fontSize: small ? 9 : 11 }}
    >
      {cfg.label}
    </div>
  );
}

/* ── DXF viewer using `dxf-viewer` (Three.js based) ────────────────────────
   Lazy-loaded so the bundle doesn't pay the cost on pages that don't need it. */
function DxfViewer({ record }: { record: RecordItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ entities: number; layers: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !record.raw_bytes) return;
    let viewer: any = null;
    let disposed = false;

    (async () => {
      try {
        // dxf-viewer is browser-only; dynamic import keeps SSR happy
        const [mod, THREE] = await Promise.all([
          import('dxf-viewer'),
          import('three'),
        ]);
        const DxfViewerClass = mod.DxfViewer ?? (mod as any).default;
        if (!DxfViewerClass) throw new Error('dxf-viewer module shape unexpected');

        // dxf-viewer's clearColor option expects a THREE.Color instance
        // (it calls .getHex() on it internally). Passing a plain {r,g,b,a}
        // object throws "this.options.clearColor.getHex is not a function".
        viewer = new DxfViewerClass(containerRef.current, {
          clearColor: new THREE.Color(0x0A0E14),
          autoResize: true,
          colorCorrection: true,
        });

        const blob = new Blob([record.raw_bytes!], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        await viewer.Load({
          url,
          fonts: [],
          progressCbk: () => {},
        });
        URL.revokeObjectURL(url);

        if (disposed) { viewer.Destroy?.(); return; }
        const layers = viewer.GetLayers?.() ?? [];
        const ent = viewer.GetScene?.()?.children?.length ?? 0;
        setStats({ entities: ent, layers: Array.isArray(layers) ? layers.length : 0 });
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();

    return () => {
      disposed = true;
      try { viewer?.Destroy?.(); } catch {}
    };
  }, [record]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md">
            <div className="flex items-center gap-2 text-red-400 text-[13px] font-semibold mb-1">
              <AlertCircle size={14} /> Could not parse DXF
            </div>
            <p className="text-[11px] text-red-300/80 font-mono break-all">{error}</p>
          </div>
        </div>
      )}
      {stats && !error && (
        <div className="absolute bottom-3 left-3 bg-slate-900/85 backdrop-blur border border-white/10 rounded-md px-2.5 py-1.5 text-[10px] text-slate-300 font-mono">
          {stats.layers} layers · {stats.entities} entities · drag to pan · scroll to zoom
        </div>
      )}
    </div>
  );
}

/* ── DWG: free in-browser DWG parsing isn't possible (proprietary format).
   We show a clean explanatory state with a clear next step. */
function UnsupportedDwg({ name }: { name: string }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="bg-slate-800/50 border border-white/10 rounded-xl p-6 max-w-md">
        <div className="flex items-center gap-2 text-amber-400 mb-3">
          <AlertCircle size={18} />
          <span className="font-semibold">DWG preview not supported in-browser</span>
        </div>
        <p className="text-[12px] text-slate-300 leading-relaxed">
          DWG is Autodesk’s proprietary format and cannot be rendered client-side without a paid license. To preview <code className="text-sky-300">{name}</code> inline, export it as <strong>DXF</strong> from AutoCAD/BricsCAD (File → Save As → AutoCAD DXF) and re-upload.
        </p>
        <p className="text-[10px] text-slate-500 mt-3">
          (Phase 2: we can run a server-side ODA File Converter to auto-convert DWG → DXF on upload.)
        </p>
      </div>
    </div>
  );
}

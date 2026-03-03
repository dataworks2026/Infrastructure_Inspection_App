'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { assetsApi, inspectionsApi } from '@/lib/api';
import {
  Search, Building2, ClipboardList, Map, Upload,
  LayoutDashboard, FileText, X, ArrowRight,
} from 'lucide-react';

interface CmdItem {
  id:       string;
  label:    string;
  sub?:     string;
  href:     string;
  Icon:     React.ElementType;
  category: string;
}

const STATIC: CmdItem[] = [
  { id: 'nav-dash',   label: 'Dashboard',      sub: 'Overview & KPIs',      href: '/dashboard',   Icon: LayoutDashboard, category: 'Pages' },
  { id: 'nav-assets', label: 'Assets',          sub: 'Infrastructure assets', href: '/assets',      Icon: Building2,       category: 'Pages' },
  { id: 'nav-map',    label: 'Map',             sub: 'Live asset map',        href: '/map',         Icon: Map,             category: 'Pages' },
  { id: 'nav-insp',   label: 'Inspections',     sub: 'All inspection records',href: '/inspections', Icon: ClipboardList,   category: 'Pages' },
  { id: 'nav-up',     label: 'New Inspection',  sub: 'Upload images',         href: '/upload',      Icon: Upload,          category: 'Pages' },
  { id: 'nav-rep',    label: 'Reports',         sub: 'Generate PDF reports',  href: '/reports',     Icon: FileText,        category: 'Pages' },
];

export default function CommandPalette() {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel]     = useState(0);
  const router  = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: assets = [] }      = useQuery({ queryKey: ['assets'],      queryFn: () => assetsApi.list(),      enabled: open });
  const { data: inspections = [] } = useQuery({ queryKey: ['inspections'], queryFn: () => inspectionsApi.list(), enabled: open });

  // Keyboard open/close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 40); setQuery(''); setSel(0); }
  }, [open]);

  const results: CmdItem[] = [
    ...STATIC,
    ...(assets as any[]).map(a => ({
      id: a.id, label: a.name, sub: a.infrastructure_type?.replace(/_/g, ' '),
      href: `/assets/${a.id}`, Icon: Building2, category: 'Assets',
    })),
    ...(inspections as any[]).map(i => ({
      id: i.id, label: i.name, sub: `${i.status} · ${i.image_count ?? 0} images`,
      href: `/inspections/${i.id}`, Icon: ClipboardList, category: 'Inspections',
    })),
  ].filter(r => {
    if (!query) return true;
    const q = query.toLowerCase();
    return r.label.toLowerCase().includes(q) || r.sub?.toLowerCase().includes(q);
  });

  const go = useCallback((href: string) => { router.push(href); setOpen(false); }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && results[sel]) go(results[sel].href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, sel, go]);

  if (!open) return null;

  const grouped = results.reduce<Record<string, CmdItem[]>>((acc, r) => {
    (acc[r.category] = acc[r.category] || []).push(r);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[14vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="palette-animate w-full max-w-xl bg-card-dark border border-card-border rounded-2xl shadow-2xl overflow-hidden mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-card-border">
          <Search size={17} className="text-slate-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSel(0); }}
            placeholder="Search assets, inspections, pages..."
            className="flex-1 bg-transparent text-[14px] text-slate-100 placeholder:text-slate-500 outline-none"
          />
          <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-400 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[380px] overflow-y-auto py-1.5">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <div className="px-4 py-2">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.12em]">{cat}</span>
              </div>
              {items.map(r => {
                const gIdx = results.indexOf(r);
                const isSelected = gIdx === sel;
                return (
                  <button
                    key={r.id}
                    onClick={() => go(r.href)}
                    onMouseEnter={() => setSel(gIdx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-sky-500/15' : 'hover:bg-white/5'
                    }`}
                  >
                    <r.Icon size={15} className={isSelected ? 'text-sky-400' : 'text-slate-500'} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-medium truncate ${isSelected ? 'text-sky-300' : 'text-slate-200'}`}>
                        {r.label}
                      </p>
                      {r.sub && (
                        <p className="text-[11px] text-slate-500 capitalize truncate">{r.sub}</p>
                      )}
                    </div>
                    {isSelected && <ArrowRight size={13} className="text-sky-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
          {results.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-slate-500">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-card-border px-4 py-2 flex items-center gap-4">
          <span className="text-[10px] text-slate-600 font-mono">↑↓&nbsp;navigate</span>
          <span className="text-[10px] text-slate-600 font-mono">↵&nbsp;open</span>
          <span className="text-[10px] text-slate-600 font-mono">esc&nbsp;close</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-600 font-mono">
            <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">⌘</kbd>
            <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}

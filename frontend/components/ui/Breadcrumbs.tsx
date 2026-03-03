'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

const LABELS: Record<string, string> = {
  dashboard:     'Dashboard',
  assets:        'Assets',
  map:           'Map',
  inspections:   'Inspections',
  upload:        'New Inspection',
  reports:       'Reports',
  'digital-twin':'Digital Twin',
  viewer:        '3D Viewer',
  compare:       'Compare',
  heatmap:       'Heatmap',
};

function isUuid(s: string) {
  return /^[0-9a-f-]{32,}$/i.test(s);
}

export default function Breadcrumbs() {
  const pathname = usePathname();
  const raw      = pathname.split('/').filter(Boolean);

  if (raw.length <= 1) return null;

  const crumbs = raw.map((seg, i) => {
    const href    = '/' + raw.slice(0, i + 1).join('/');
    const isLast  = i === raw.length - 1;
    const isId    = isUuid(seg) || (seg.length > 16 && !LABELS[seg]);
    const label   = LABELS[seg] || (isId ? 'Detail' : seg.replace(/-/g, ' '));
    return { href, label, isLast };
  });

  return (
    <nav className="flex items-center gap-1 text-[12px]" aria-label="Breadcrumb">
      <Link href="/dashboard" className="text-slate-500 hover:text-slate-300 transition-colors flex items-center">
        <Home size={12} />
      </Link>
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight size={11} className="text-slate-600" />
          {c.isLast
            ? <span className="text-slate-300 font-medium capitalize">{c.label}</span>
            : <Link href={c.href} className="text-slate-500 hover:text-slate-300 transition-colors capitalize">{c.label}</Link>
          }
        </span>
      ))}
    </nav>
  );
}

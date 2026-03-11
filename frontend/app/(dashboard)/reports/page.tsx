'use client';
import { FileText, Clock } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#082E29' }}>Reports</h1>
        <p className="text-sm text-slate-500 mt-1">PDF inspection reports</p>
      </div>
      <div className="text-center py-20 bg-white border border-slate-200 rounded-2xl shadow-card">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <FileText size={28} className="text-slate-400" />
        </div>
        <p className="text-base font-medium text-slate-500">Report Generation Coming Soon</p>
        <p className="text-sm text-mira-faint mt-1 max-w-sm mx-auto">
          This feature will be available in Phase 1.5. Complete inspections via the Upload page to start generating reports.
        </p>
        <div className="flex items-center justify-center gap-2 mt-4 text-xs text-mira-faint">
          <Clock size={12} /> Expected in next release
        </div>
      </div>
    </div>
  );
}

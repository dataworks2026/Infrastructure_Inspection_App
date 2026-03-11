'use client';
import { useEffect } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card-dark border border-card-border rounded-2xl p-6 w-full max-w-sm shadow-2xl palette-animate"
        onClick={e => e.stopPropagation()}
      >
        {/* Icon + text */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertTriangle size={22} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-card-text leading-snug">{title}</h2>
            <p className="text-base text-card-muted mt-1 leading-relaxed">{message}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 border border-card-border text-card-muted py-2.5 rounded-xl text-base font-semibold hover:bg-white/5 transition-all disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white py-2.5 rounded-xl text-base font-bold transition-all shadow-lg shadow-red-500/20 hover:shadow-red-500/35 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 size={16} />
                {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

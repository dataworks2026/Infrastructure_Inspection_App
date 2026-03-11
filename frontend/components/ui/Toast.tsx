'use client';
import { createContext, useCallback, useContext, useState, useRef, ReactNode } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  exiting?: boolean;
}

interface ToastCtx {
  toast:   (msg: string, type?: ToastType) => void;
  success: (msg: string) => void;
  error:   (msg: string) => void;
  warning: (msg: string) => void;
  info:    (msg: string) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error:   XCircle,
  warning: AlertTriangle,
  info:    Info,
};

const STYLES: Record<ToastType, { wrap: string; icon: string }> = {
  success: { wrap: 'border-emerald-500/30 bg-[#1b3a30]', icon: 'text-emerald-400' },
  error:   { wrap: 'border-red-500/30    bg-[#3a1b1b]', icon: 'text-red-400'     },
  warning: { wrap: 'border-amber-500/30  bg-[#3a2e1b]', icon: 'text-amber-400'   },
  info:    { wrap: 'border-sky-500/30    bg-[#1b2e3a]', icon: 'text-sky-400'     },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev.slice(-4), { id, type, message }]);
    timers.current[id] = setTimeout(() => remove(id), 4200);
  }, [remove]);

  const success = useCallback((m: string) => toast(m, 'success'), [toast]);
  const error   = useCallback((m: string) => toast(m, 'error'),   [toast]);
  const warning = useCallback((m: string) => toast(m, 'warning'), [toast]);
  const info    = useCallback((m: string) => toast(m, 'info'),    [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 pointer-events-none">
        {toasts.map(t => {
          const Icon = ICONS[t.type];
          const s    = STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl min-w-[300px] max-w-[380px] toast-enter ${s.wrap}`}
            >
              <Icon size={18} className={`mt-0.5 flex-shrink-0 ${s.icon}`} />
              <p className="text-[13px] font-medium flex-1 text-slate-100 leading-snug">{t.message}</p>
              <button
                onClick={() => remove(t.id)}
                className="text-slate-500 hover:text-white transition-colors flex-shrink-0 mt-0.5"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside <ToastProvider>');
  return ctx;
}

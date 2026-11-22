import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ShowToastOptions {
  message: string;
  type?: ToastType;
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (
    messageOrOptions: string | ShowToastOptions,
    type?: ToastType,
    durationMs?: number
  ) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (
      messageOrOptions: string | ShowToastOptions,
      typeArg: ToastType = 'success',
      durationArg = 4000
    ) => {
      const opts =
        typeof messageOrOptions === 'string'
          ? { message: messageOrOptions, type: typeArg, durationMs: durationArg }
          : {
              message: messageOrOptions.message,
              type: messageOrOptions.type || typeArg,
              durationMs: messageOrOptions.durationMs ?? durationArg,
            };
      if (!opts.message.trim()) return;

      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type: opts.type, message: opts.message }]);

      if (opts.durationMs > 0) {
        const timer = window.setTimeout(() => {
          dismissToast(id);
        }, opts.durationMs);
        timersRef.current.set(id, timer);
      }
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="no-print fixed bottom-4 right-4 z-[90] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0 pointer-events-none"
        >
          {toasts.map((toast) => {
            const style =
              toast.type === 'error'
                ? 'border-rose-200 bg-white/95 text-rose-900'
                : toast.type === 'info'
                ? 'border-sky-200 bg-white/95 text-slate-900'
                : 'border-emerald-200 bg-white/95 text-emerald-950';
            const Icon =
              toast.type === 'error'
                ? AlertCircle
                : toast.type === 'info'
                ? Info
                : CheckCircle2;
            const iconColor =
              toast.type === 'error'
                ? 'text-rose-600'
                : toast.type === 'info'
                ? 'text-[#0B5A8E]'
                : 'text-emerald-600';

            return (
              <div
                key={toast.id}
                role="status"
                className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs font-medium shadow-lg backdrop-blur-sm transition-all ${style}`}
              >
                <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
                <p className="flex-1 leading-relaxed">{toast.message}</p>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Tutup notifikasi"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

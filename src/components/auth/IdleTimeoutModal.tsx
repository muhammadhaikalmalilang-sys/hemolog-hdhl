import React from 'react';
import { Clock, LogOut, ShieldAlert } from 'lucide-react';

interface IdleTimeoutModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  onExtend: () => void;
  onLogoutNow: () => void;
}

export function IdleTimeoutModal({
  isOpen,
  remainingSeconds,
  onExtend,
  onLogoutNow,
}: IdleTimeoutModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-timeout-title"
      data-idle-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-200">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="idle-timeout-title"
              className="font-display text-base font-bold text-slate-900"
            >
              Sesi Akan Berakhir Otomatis
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Tidak ada aktivitas terdeteksi selama hampir 15 menit. Demi keamanan data
              rekam dialisis unit, Anda akan otomatis logout dalam:
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3.5">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-900">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-600" />
              Waktu tersisa sebelum logout
            </span>
            <span className="font-mono text-base font-bold tabular-nums text-amber-700">
              {remainingSeconds} detik
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-700">
            Klik tombol di bawah atau tekan tombol pada papan ketik untuk melanjutkan sesi kerja Anda.
          </p>
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button
            type="button"
            onClick={onLogoutNow}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Keluar Sekarang
          </button>
          <button
            type="button"
            onClick={onExtend}
            className="inline-flex items-center justify-center rounded-lg bg-teal-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-teal-700 transition-colors shadow-xs"
          >
            Tetap Masuk (Lanjutkan Sesi)
          </button>
        </div>
      </div>
    </div>
  );
}

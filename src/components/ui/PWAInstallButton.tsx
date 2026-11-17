import React, { useState } from 'react';
import { Download, Monitor, Share, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#094a75] whitespace-nowrap"
      >
        <Download className="h-3.5 w-3.5" />
        Instal di PC
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#0B5A8E] hover:text-[#0B5A8E] whitespace-nowrap"
      >
        <Monitor className="h-3.5 w-3.5 text-[#0B5A8E]" />
        Instal di PC
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-[#0B5A8E] border border-sky-200">
                  {isIOS ? <Share className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    {isIOS ? 'Instal di iPhone / iPad' : 'Cara Instal HemoLog di PC'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Menjadi aplikasi desktop mandiri tanpa bar browser
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="list-decimal pl-4 space-y-1.5 text-xs text-slate-700">
                <li>
                  Ketuk tombol <strong>Bagikan (Share)</strong> pada toolbar Safari.
                </li>
                <li>
                  Gulir ke bawah lalu pilih <strong>Add to Home Screen / Tambah ke Layar Utama</strong>.
                </li>
              </ol>
            ) : (
              <div className="space-y-2.5 text-xs text-slate-700">
                <p>
                  Gunakan <strong>Google Chrome</strong> atau <strong>Microsoft Edge</strong> dan buka
                  alamat aplikasi Vercel Anda secara langsung:
                </p>
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>
                    <strong>Google Chrome:</strong> Klik ikon <strong>Instal (layar + panah)</strong>{' '}
                    di ujung kanan kolom alamat URL, atau klik menu <strong>⋮ → Cast, save, and share → Install HemoLog</strong>.
                  </li>
                  <li>
                    <strong>Microsoft Edge:</strong> Klik ikon <strong>App available</strong> di ujung
                    kanan address bar, atau menu <strong>⋯ → Apps → Install this site as an app</strong>.
                  </li>
                  <li>
                    Klik <strong>Install</strong> — pintasan HemoLog otomatis muncul di{' '}
                    <strong>Desktop / Start Menu / Taskbar</strong> dan bisa disematkan di setiap PC unit HD.
                  </li>
                </ol>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg bg-[#0B5A8E] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#094a75]"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

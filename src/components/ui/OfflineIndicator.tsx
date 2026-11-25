import React, { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const handleUpdateEvent = () => {
      setUpdateAvailable(true);
    };
    window.addEventListener('hemolog:pwa-update', handleUpdateEvent);
    return () => {
      window.removeEventListener('hemolog:pwa-update', handleUpdateEvent);
    };
  }, []);

  const handleApplyUpdate = () => {
    if (updating) return;
    setUpdating(true);
    const applyFn = window.__hemologApplyPwaUpdate;
    if (applyFn) {
      void applyFn();
    } else {
      window.location.reload();
    }
  };

  if (isOnline && !updateAvailable) return null;

  return (
    <>
      {!isOnline && (
        <div className="no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          Mode Offline — Koneksi terputus, perubahan menunggu jaringan kembali.
        </div>
      )}
      {updateAvailable && (
        <div className="no-print fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border border-sky-200 bg-white px-3.5 py-2 text-xs text-slate-800 shadow-lg">
          <span className="font-medium">Pembaruan aplikasi tersedia.</span>
          <button
            type="button"
            disabled={updating}
            onClick={handleApplyUpdate}
            className="rounded-md bg-[#0B5A8E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#094a75] disabled:opacity-60"
          >
            {updating ? 'Memuat...' : 'Perbarui'}
          </button>
          <button
            type="button"
            onClick={() => setUpdateAvailable(false)}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
          >
            Nanti
          </button>
        </div>
      )}
    </>
  );
};

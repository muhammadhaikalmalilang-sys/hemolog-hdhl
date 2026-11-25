import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const PWA_SESSION_DISMISS_KEY = 'hemolog:pwa-update-dismissed-session';
const PWA_SNOOZE_UNTIL_KEY = 'hemolog:pwa-update-snooze-until';
const PWA_SNOOZE_MS = 24 * 60 * 60 * 1000;
const OFFLINE_DEBOUNCE_MS = 3000;

function isPwaUpdateDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(PWA_SESSION_DISMISS_KEY) === '1') {
      return true;
    }
    const snoozeUntil = Number(window.localStorage.getItem(PWA_SNOOZE_UNTIL_KEY) || '0');
    if (Number.isFinite(snoozeUntil) && snoozeUntil > Date.now()) {
      return true;
    }
  } catch {
    // Ignore storage access errors
  }
  return false;
}

function persistPwaUpdateDismissal() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PWA_SESSION_DISMISS_KEY, '1');
    window.localStorage.setItem(PWA_SNOOZE_UNTIL_KEY, String(Date.now() + PWA_SNOOZE_MS));
  } catch {
    // Ignore storage access errors
  }
}

function clearPwaUpdateDismissal() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PWA_SESSION_DISMISS_KEY);
    window.localStorage.removeItem(PWA_SNOOZE_UNTIL_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const offlineTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearOfflineTimer = () => {
      if (offlineTimerRef.current !== null) {
        window.clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    };

    const handleOnline = () => {
      clearOfflineTimer();
      setIsOnline(true);
    };

    const handleOffline = () => {
      clearOfflineTimer();
      offlineTimerRef.current = window.setTimeout(() => {
        offlineTimerRef.current = null;
        if (typeof navigator === 'undefined' || !navigator.onLine) {
          setIsOnline(false);
        }
      }, OFFLINE_DEBOUNCE_MS);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearOfflineTimer();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (isOnline) {
      setOfflineDismissed(false);
    }
  }, [isOnline]);

  useEffect(() => {
    const handleUpdateEvent = () => {
      if (!isPwaUpdateDismissed()) {
        setUpdateAvailable(true);
      }
    };
    window.addEventListener('hemolog:pwa-update', handleUpdateEvent);
    return () => {
      window.removeEventListener('hemolog:pwa-update', handleUpdateEvent);
    };
  }, []);

  const handleApplyUpdate = () => {
    if (updating) return;
    setUpdating(true);
    clearPwaUpdateDismissal();
    const applyFn = window.__hemologApplyPwaUpdate;
    if (applyFn) {
      void applyFn();
    } else {
      window.location.reload();
    }
  };

  const handleDismissUpdate = () => {
    persistPwaUpdateDismissal();
    setUpdateAvailable(false);
  };

  const showOfflineBanner = !isOnline && !offlineDismissed;
  if (!showOfflineBanner && !updateAvailable) return null;

  return (
    <>
      {showOfflineBanner && (
        <div className="no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          <span>Mode Offline — Koneksi terputus, perubahan menunggu jaringan kembali.</span>
          <button
            type="button"
            onClick={() => setOfflineDismissed(true)}
            className="ml-1 rounded p-0.5 text-white/80 hover:bg-white/20 hover:text-white"
            aria-label="Tutup pemberitahuan mode offline"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
            onClick={handleDismissUpdate}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
          >
            Nanti
          </button>
        </div>
      )}
    </>
  );
};

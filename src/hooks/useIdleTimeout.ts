import { useCallback, useEffect, useRef, useState } from 'react';

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 menit
export const IDLE_WARNING_MS = 60 * 1000; // Peringatan 60 detik terakhir sebelum logout
export const LAST_ACTIVITY_STORAGE_KEY = 'hemolog_last_activity_at';

const PASSIVE_ACTIVITY_THROTTLE_MS = 5000;
const ACTIVE_ACTIVITY_THROTTLE_MS = 1000;

export function stampLastActivity(timestamp = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // Abaikan jika storage penuh/dibatasi
  }
}

export function clearLastActivity(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    // Abaikan error storage
  }
}

function readStoredLastActivity(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

interface UseIdleTimeoutOptions {
  enabled: boolean;
  timeoutMs?: number;
  warningMs?: number;
  onTimeout: () => void | Promise<void>;
}

export function useIdleTimeout({
  enabled,
  timeoutMs = IDLE_TIMEOUT_MS,
  warningMs = IDLE_WARNING_MS,
  onTimeout,
}: UseIdleTimeoutOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(warningMs / 1000));

  const lastActivityRef = useRef<number>(Date.now());
  const lastThrottleRef = useRef<number>(0);
  const showWarningRef = useRef<boolean>(false);
  const timedOutRef = useRef<boolean>(false);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);

  const resetActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    lastThrottleRef.current = now;
    timedOutRef.current = false;
    stampLastActivity(now);
    if (showWarningRef.current) {
      showWarningRef.current = false;
      setShowWarning(false);
    }
    setRemainingSeconds(Math.ceil(warningMs / 1000));
  }, [warningMs]);

  useEffect(() => {
    if (!enabled) {
      timedOutRef.current = false;
      showWarningRef.current = false;
      setShowWarning(false);
      return;
    }

    const stored = readStoredLastActivity();
    const now = Date.now();
    if (stored !== null) {
      lastActivityRef.current = stored;
    } else {
      lastActivityRef.current = now;
      stampLastActivity(now);
    }
    timedOutRef.current = false;

    const evaluateIdleState = () => {
      if (timedOutRef.current) return;

      const latestStored = readStoredLastActivity();
      if (latestStored !== null && latestStored > lastActivityRef.current) {
        lastActivityRef.current = latestStored;
      }

      const elapsed = Date.now() - lastActivityRef.current;
      const remainingMs = timeoutMs - elapsed;

      if (remainingMs <= 0) {
        timedOutRef.current = true;
        showWarningRef.current = false;
        setShowWarning(false);
        setRemainingSeconds(0);
        void onTimeoutRef.current();
        return;
      }

      if (remainingMs <= warningMs) {
        const secs = Math.max(1, Math.ceil(remainingMs / 1000));
        if (!showWarningRef.current) {
          showWarningRef.current = true;
          setShowWarning(true);
        }
        setRemainingSeconds(secs);
      } else if (showWarningRef.current) {
        showWarningRef.current = false;
        setShowWarning(false);
      }
    };

    const handlePassiveActivity = () => {
      if (timedOutRef.current) return;
      // Saat modal peringatan 60 detik terakhir tampil, abaikan gerakan mouse pasif
      // agar getaran mouse tidak menutup peringatan secara tidak sengaja.
      if (showWarningRef.current) return;

      const current = Date.now();
      if (current - lastThrottleRef.current < PASSIVE_ACTIVITY_THROTTLE_MS) return;
      lastThrottleRef.current = current;
      lastActivityRef.current = current;
      stampLastActivity(current);
    };

    const handleActiveInteraction = (event: Event) => {
      if (timedOutRef.current) return;
      if (
        showWarningRef.current &&
        event.target instanceof Element &&
        event.target.closest('[data-idle-modal="true"]')
      ) {
        return;
      }
      const current = Date.now();
      if (!showWarningRef.current && current - lastThrottleRef.current < ACTIVE_ACTIVITY_THROTTLE_MS) {
        return;
      }
      resetActivity();
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      evaluateIdleState();
    };

    const passiveEvents: Array<keyof WindowEventMap> = ['mousemove', 'scroll', 'wheel'];
    const activeEvents: Array<keyof WindowEventMap> = [
      'mousedown',
      'pointerdown',
      'keydown',
      'touchstart',
    ];

    passiveEvents.forEach((evt) =>
      window.addEventListener(evt, handlePassiveActivity, { passive: true })
    );
    activeEvents.forEach((evt) =>
      window.addEventListener(evt, handleActiveInteraction, { passive: true })
    );
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    evaluateIdleState();
    const intervalId = window.setInterval(evaluateIdleState, showWarning ? 1000 : 15000);

    return () => {
      window.clearInterval(intervalId);
      passiveEvents.forEach((evt) => window.removeEventListener(evt, handlePassiveActivity));
      activeEvents.forEach((evt) => window.removeEventListener(evt, handleActiveInteraction));
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [enabled, timeoutMs, warningMs, showWarning, resetActivity]);

  return {
    showWarning,
    remainingSeconds,
    resetActivity,
  };
}

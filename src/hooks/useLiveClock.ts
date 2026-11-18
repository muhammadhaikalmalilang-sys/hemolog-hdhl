import { useEffect, useState } from 'react';
import { getCurrentMonthKey, getCurrentShiftLabel, getTodayDateStr } from '../lib/formatters';
import type { ShiftType } from '../types';

export interface LiveClockSnapshot {
  todayDate: string;
  currentMonthKey: string;
  currentShift: ShiftType;
  currentShiftLabel: 'Shift Pagi' | 'Shift Siang' | 'Shift Malam';
}

function readClockSnapshot(): LiveClockSnapshot {
  const todayDate = getTodayDateStr();
  const currentMonthKey = getCurrentMonthKey();
  const currentShiftLabel = getCurrentShiftLabel();
  const currentShift: ShiftType =
    currentShiftLabel === 'Shift Pagi'
      ? 'Pagi'
      : currentShiftLabel === 'Shift Siang'
      ? 'Siang'
      : 'Malam';

  return {
    todayDate,
    currentMonthKey,
    currentShift,
    currentShiftLabel,
  };
}

/**
 * Provides reactive calendar date, month key, and current shift that stay synchronized
 * across midnight rollovers, tab switches, window focus, and device wakeups without reloading.
 */
export function useLiveClock(): LiveClockSnapshot {
  const [clock, setClock] = useState<LiveClockSnapshot>(() => readClockSnapshot());

  useEffect(() => {
    const syncClock = () => {
      const next = readClockSnapshot();
      setClock((prev) => {
        if (
          prev.todayDate === next.todayDate &&
          prev.currentMonthKey === next.currentMonthKey &&
          prev.currentShift === next.currentShift
        ) {
          return prev;
        }
        return next;
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncClock();
      }
    };

    const intervalId = window.setInterval(syncClock, 15000);
    window.addEventListener('focus', syncClock);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncClock);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return clock;
}

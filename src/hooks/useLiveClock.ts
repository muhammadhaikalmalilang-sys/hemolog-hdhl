import { useEffect, useState } from 'react';
import {
  getCurrentMonthKey,
  getCurrentShiftLabel,
  getTodayDateStr,
  getWibDateAndMinutes,
} from '../lib/formatters';
import type { ShiftType } from '../types';

export interface LiveClockSnapshot {
  todayDate: string;
  currentMonthKey: string;
  currentShift: ShiftType;
  currentShiftLabel: 'Shift Pagi' | 'Shift Siang' | 'Shift Malam';
  nowMs: number;
  wibMinutes: number;
  wibTimeLabel: string;
}

function readClockSnapshot(): LiveClockSnapshot {
  const nowMs = Date.now();
  const wib = getWibDateAndMinutes(nowMs);
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
    nowMs,
    wibMinutes: wib.minutes,
    wibTimeLabel: wib.timeLabel,
  };
}

/**
 * Provides reactive calendar date, month key, current shift, and WIB clock snapshot
 * that stay synchronized across midnight rollovers, tab switches, window focus, and device wakeups.
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
          prev.currentShift === next.currentShift &&
          prev.wibMinutes === next.wibMinutes
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


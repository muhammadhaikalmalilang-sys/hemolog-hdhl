import type { ShiftType, VerificationStatus } from '../types';

export interface WibDateTimeSnapshot {
  dateStr: string;
  monthKey: string;
  hour: number;
  minute: number;
  minutes: number;
  timeLabel: string;
}

export function getWibDateAndMinutes(nowInput: number | Date = Date.now()): WibDateTimeSnapshot {
  const dateObj = nowInput instanceof Date ? nowInput : new Date(nowInput);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(dateObj);
    const getPart = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value || '';
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const rawHour = Number(getPart('hour'));
    const hour = rawHour === 24 ? 0 : rawHour;
    const minute = Number(getPart('minute'));
    if (year && month && day && Number.isFinite(hour) && Number.isFinite(minute)) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(minute).padStart(2, '0');
      return {
        dateStr: `${year}-${month}-${day}`,
        monthKey: `${year}-${month}`,
        hour,
        minute,
        minutes: hour * 60 + minute,
        timeLabel: `${hh}.${mm} WIB`,
      };
    }
  } catch {
    // Fallback to UTC+7 offset calculation
  }
  const wibMs = dateObj.getTime() + 7 * 60 * 60 * 1000;
  const wibDate = new Date(wibMs);
  const year = String(wibDate.getUTCFullYear());
  const month = String(wibDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(wibDate.getUTCDate()).padStart(2, '0');
  const hour = wibDate.getUTCHours();
  const minute = wibDate.getUTCMinutes();
  return {
    dateStr: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
    hour,
    minute,
    minutes: hour * 60 + minute,
    timeLabel: `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')} WIB`,
  };
}

export function getTodayDateStr(): string {
  return getWibDateAndMinutes().dateStr;
}

export function getCurrentMonthKey(): string {
  return getWibDateAndMinutes().monthKey;
}

export const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export const MONTH_SHORT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agt',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const idx = Number(month) - 1;
  if (idx >= 0 && idx < 12) {
    return `${MONTH_NAMES_ID[idx]} ${year}`;
  }
  return monthKey;
}

export function formatDateId(dateStr: string): string {
  if (!dateStr || !dateStr.includes('-')) return dateStr;
  const [year, month, day] = dateStr.split('-');
  const idx = Number(month) - 1;
  if (idx >= 0 && idx < 12) {
    return `${Number(day)} ${MONTH_SHORT_ID[idx]} ${year}`;
  }
  return dateStr;
}

export function formatFullDayDateId(dateStr?: string): string {
  const target = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getTodayDateStr();
  const [y, m, d] = target.split('-').map(Number);
  const localDate = new Date(y, m - 1, d);
  const dayName = DAY_NAMES_ID[localDate.getDay()] || 'Senin';
  const monthName = MONTH_NAMES_ID[m - 1] || '';
  return `${dayName}, ${d} ${monthName} ${y}`;
}

export function getCurrentShiftLabel(): 'Shift Pagi' | 'Shift Siang' | 'Shift Malam' {
  const { hour } = getWibDateAndMinutes();
  if (hour >= 6 && hour < 14) return 'Shift Pagi';
  return 'Shift Siang';
}

export function getDaysInMonth(monthKey: string): string[] {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return [];
  const totalDays = new Date(year, month, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= totalDays; d++) {
    days.push(`${yearStr}-${monthStr}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

export const DAY_NAMES_ID = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

export function getDayNameId(dateStr?: string): string {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    return DAY_NAMES_ID[localDate.getDay()] || 'Senin';
  }
  const today = getTodayDateStr();
  const [y, m, d] = today.split('-').map(Number);
  return DAY_NAMES_ID[new Date(y, m - 1, d).getDay()] || 'Senin';
}

export function isPatientScheduledOnDay(
  routineSchedule: string | undefined,
  dayName: string,
  shiftFilter: string = 'ALL'
): boolean {
  if (!routineSchedule) return false;
  const normalizedSchedule = routineSchedule
    .toLowerCase()
    .replace(/jum'at/g, 'jumat')
    .replace(/ahad/g, 'minggu');
  const normalizedDay = dayName.toLowerCase();

  const matchesDay =
    normalizedSchedule.includes(normalizedDay) ||
    normalizedSchedule.includes('setiap hari') ||
    normalizedSchedule.includes('harian');

  if (!matchesDay) return false;

  if (shiftFilter && shiftFilter !== 'ALL') {
    const targetShift = shiftFilter.toLowerCase();
    const mentionsAnyShift =
      normalizedSchedule.includes('pagi') ||
      normalizedSchedule.includes('siang') ||
      normalizedSchedule.includes('malam');
    if (mentionsAnyShift && !normalizedSchedule.includes(targetShift)) {
      return false;
    }
  }

  return true;
}

export function isRegularPatient(
  patient: { patientType?: string } | null | undefined
): boolean {
  if (!patient) return false;
  return patient.patientType !== 'Non-Reguler';
}

export function formatVerificationStatusLabel(status: VerificationStatus | string): string {
  switch (status) {
    case 'Pending':
      return 'Menunggu Verifikasi';
    case 'Revision':
      return 'Revisi';
    case 'Approved':
      return 'Approved';
    case 'Draft':
      return 'Draft';
    default:
      return String(status || 'Menunggu Verifikasi');
  }
}

export function extractShiftFromSchedule(
  routineSchedule: string | undefined
): 'Pagi' | 'Siang' | 'Malam' | null {
  if (!routineSchedule) return null;
  const s = routineSchedule.toLowerCase();
  const hasPagi = s.includes('pagi');
  const hasSiang = s.includes('siang');
  const hasMalam = s.includes('malam');
  if (hasPagi && !hasSiang && !hasMalam) return 'Pagi';
  if (hasSiang && !hasPagi && !hasMalam) return 'Siang';
  if (hasMalam && !hasPagi && !hasSiang) return 'Malam';
  return null;
}

export function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function parseTimestampMs(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (val instanceof Date) return Number.isFinite(val.getTime()) ? val.getTime() : null;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof val === 'object') {
    const obj = val as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') {
      const ms = obj.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof obj.seconds === 'number') {
      return obj.seconds * 1000;
    }
  }
  return null;
}

export const SUBMISSION_WINDOW_WIB: Record<'Pagi' | 'Siang', { startMin: number; endMin: number; label: string }> = {
  Pagi: { startMin: 7 * 60, endMin: 17 * 60, label: '07.00 – 17.00 WIB' },
  Siang: { startMin: 12 * 60, endMin: 22 * 60, label: '12.00 – 22.00 WIB' },
};

export const VERIFICATION_WINDOW_WIB: Record<'Pagi' | 'Siang', { startMin: number; endMin: number; label: string }> = {
  Pagi: { startMin: 7 * 60, endMin: 18 * 60, label: '07.00 – 18.00 WIB' },
  Siang: { startMin: 12 * 60, endMin: 23 * 60, label: '12.00 – 23.00 WIB' },
};

const REVISION_GRACE_MS = 60 * 60 * 1000;

export interface LogbookSubmissionAccess {
  canSubmitPending: boolean;
  canEditRevision: boolean;
  isWithinNormalWindow: boolean;
  isRevisionGrace: boolean;
  revisionExpired: boolean;
  remainingRevisionMinutes: number | null;
  deadlineWibLabel: string | null;
  windowLabel: string;
  reason: string | null;
}

export function getLogbookSubmissionAccess(
  entryDate: string,
  shift: ShiftType,
  entry?: {
    verificationStatus?: VerificationStatus;
    verifiedAt?: unknown;
    updatedAt?: unknown;
  } | null,
  nowMs: number = Date.now()
): LogbookSubmissionAccess {
  const wib = getWibDateAndMinutes(nowMs);
  if (shift === 'Malam') {
    const isToday = entryDate === wib.dateStr;
    return {
      canSubmitPending: isToday,
      canEditRevision: true,
      isWithinNormalWindow: isToday,
      isRevisionGrace: false,
      revisionExpired: false,
      remainingRevisionMinutes: null,
      deadlineWibLabel: null,
      windowLabel: '21.00 – 07.00 WIB',
      reason: isToday
        ? null
        : `Pengajuan verifikasi hanya berlaku pada tanggal tindakan berjalan (${formatDateId(wib.dateStr)}).`,
    };
  }

  const win = SUBMISSION_WINDOW_WIB[shift];
  const isWithinNormalWindow =
    entryDate === wib.dateStr && wib.minutes >= win.startMin && wib.minutes < win.endMin;

  if (isWithinNormalWindow) {
    return {
      canSubmitPending: true,
      canEditRevision: true,
      isWithinNormalWindow: true,
      isRevisionGrace: false,
      revisionExpired: false,
      remainingRevisionMinutes: null,
      deadlineWibLabel: null,
      windowLabel: win.label,
      reason: null,
    };
  }

  if (entry?.verificationStatus === 'Revision') {
    const revStartMs = parseTimestampMs(entry.verifiedAt) ?? parseTimestampMs(entry.updatedAt);
    if (revStartMs !== null) {
      const deadlineMs = revStartMs + REVISION_GRACE_MS;
      const deadlineWib = getWibDateAndMinutes(deadlineMs);
      if (nowMs < deadlineMs) {
        const remainingMinutes = Math.max(1, Math.ceil((deadlineMs - nowMs) / 60000));
        return {
          canSubmitPending: true,
          canEditRevision: true,
          isWithinNormalWindow: false,
          isRevisionGrace: true,
          revisionExpired: false,
          remainingRevisionMinutes: remainingMinutes,
          deadlineWibLabel: deadlineWib.timeLabel,
          windowLabel: win.label,
          reason: null,
        };
      }
      return {
        canSubmitPending: false,
        canEditRevision: false,
        isWithinNormalWindow: false,
        isRevisionGrace: false,
        revisionExpired: true,
        remainingRevisionMinutes: 0,
        deadlineWibLabel: deadlineWib.timeLabel,
        windowLabel: win.label,
        reason: `Batas waktu perbaikan revisi (1 jam sejak diminta revisi, berakhir pukul ${deadlineWib.timeLabel}) telah lewat. Logbook sudah tidak dapat diubah atau diajukan.`,
      };
    }

    return {
      canSubmitPending: false,
      canEditRevision: false,
      isWithinNormalWindow: false,
      isRevisionGrace: false,
      revisionExpired: true,
      remainingRevisionMinutes: 0,
      deadlineWibLabel: null,
      windowLabel: win.label,
      reason: `Batas waktu perbaikan revisi di luar jam Shift ${shift} (${win.label}) telah berakhir.`,
    };
  }

  const startLabel = shift === 'Pagi' ? '07.00 WIB' : '12.00 WIB';
  const closeLabel = shift === 'Pagi' ? '17.00 WIB' : '22.00 WIB';
  let reason: string;
  if (entryDate !== wib.dateStr) {
    reason = `Pengajuan verifikasi Shift ${shift} hanya dibuka pada tanggal berjalan (${formatDateId(wib.dateStr)}) pukul ${win.label}.`;
  } else if (wib.minutes < win.startMin) {
    reason = `Pengajuan verifikasi Shift ${shift} baru dibuka mulai pukul ${startLabel} (sekarang ${wib.timeLabel}).`;
  } else {
    reason = `Batas pengajuan verifikasi Shift ${shift} (${win.label}, ditutup tepat pukul ${closeLabel}) telah berakhir (sekarang ${wib.timeLabel}).`;
  }

  return {
    canSubmitPending: false,
    canEditRevision: true,
    isWithinNormalWindow: false,
    isRevisionGrace: false,
    revisionExpired: false,
    remainingRevisionMinutes: null,
    deadlineWibLabel: null,
    windowLabel: win.label,
    reason,
  };
}

export interface LogbookVerificationAccess {
  allowed: boolean;
  windowLabel: string;
  reason: string | null;
}

export function getLogbookVerificationAccess(
  entry: { date: string; shift: ShiftType; nurseId?: string },
  verifierUser: { uid: string; role: string } | null | undefined,
  nowMs: number = Date.now()
): LogbookVerificationAccess {
  if (!verifierUser) {
    return { allowed: false, windowLabel: '-', reason: 'Sesi pengguna tidak ditemukan.' };
  }
  if (verifierUser.role === 'Administrator') {
    return {
      allowed: false,
      windowLabel: '-',
      reason: 'Administrator tidak diperbolehkan memberikan verifikasi logbook.',
    };
  }
  if (verifierUser.role !== 'Kepala Ruang' && verifierUser.role !== 'PJ Shift') {
    return {
      allowed: false,
      windowLabel: '-',
      reason: 'Peran Anda tidak memiliki wewenang verifikasi logbook.',
    };
  }
  if (entry.nurseId && entry.nurseId === verifierUser.uid) {
    return {
      allowed: false,
      windowLabel: '-',
      reason: 'Penginput tidak dapat memverifikasi logbook miliknya sendiri.',
    };
  }

  const wib = getWibDateAndMinutes(nowMs);
  if (entry.shift === 'Malam') {
    const isToday = entry.date === wib.dateStr;
    return {
      allowed: isToday,
      windowLabel: '21.00 – 07.00 WIB',
      reason: isToday
        ? null
        : `Verifikasi logbook hanya dapat dilakukan pada tanggal berjalan (${formatDateId(wib.dateStr)}).`,
    };
  }

  const win = VERIFICATION_WINDOW_WIB[entry.shift];
  const withinWindow =
    entry.date === wib.dateStr && wib.minutes >= win.startMin && wib.minutes < win.endMin;

  if (withinWindow) {
    return { allowed: true, windowLabel: win.label, reason: null };
  }

  const startLabel = entry.shift === 'Pagi' ? '07.00 WIB' : '12.00 WIB';
  const closeLabel = entry.shift === 'Pagi' ? '18.00 WIB' : '23.00 WIB';
  let reason: string;
  if (entry.date !== wib.dateStr) {
    reason = `Verifikasi Shift ${entry.shift} hanya dibuka pada tanggal berjalan (${formatDateId(wib.dateStr)}) pukul ${win.label}.`;
  } else if (wib.minutes < win.startMin) {
    reason = `Verifikasi Shift ${entry.shift} baru dibuka mulai pukul ${startLabel} (sekarang ${wib.timeLabel}).`;
  } else {
    reason = `Batas waktu verifikasi Shift ${entry.shift} (${win.label}, ditutup tepat pukul ${closeLabel}) telah berakhir (sekarang ${wib.timeLabel}).`;
  }

  return { allowed: false, windowLabel: win.label, reason };
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (cell: string | number) => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function isLogbookAssignedToVerifier(
  entry: {
    targetVerifierId?: string;
    targetVerifierRole?: string;
    verifiedBy?: string;
    verificationStatus?: string;
  },
  user: { uid: string; role: string } | null | undefined
): boolean {
  if (!user) return false;
  if (user.role !== 'Kepala Ruang' && user.role !== 'PJ Shift') return false;

  const targetId = entry.targetVerifierId?.trim();
  if (targetId) {
    if (entry.verificationStatus === 'Approved') {
      return targetId === user.uid || entry.verifiedBy === user.uid;
    }
    return targetId === user.uid;
  }

  if (entry.targetVerifierRole) {
    return entry.targetVerifierRole === user.role;
  }

  return true;
}

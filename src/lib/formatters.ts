export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
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
  const hour = new Date().getHours();
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
  return DAY_NAMES_ID[new Date().getDay()] || 'Senin';
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
  if (user.role === 'Administrator') return true;
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


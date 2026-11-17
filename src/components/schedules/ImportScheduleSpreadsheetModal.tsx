import React, { useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  clampString,
  exportToCsv,
  formatMonthLabel,
  getDaysInMonth,
} from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import {
  ROLE_SORT_ORDER,
  type ScheduleEntry,
  type ScheduleShiftType,
  type StaffDirectoryEntry,
} from '../../types';

interface ImportScheduleSpreadsheetModalProps {
  defaultMonthKey: string;
  staffDirectory: StaffDirectoryEntry[];
  existingSchedules: ScheduleEntry[];
  onClose: () => void;
  onImported: (summary: { monthKey: string; savedCount: number }) => void;
}

interface ParsedCellValue {
  raw: string;
  shift: ScheduleShiftType | null;
  isInvalid: boolean;
}

interface ParsedScheduleDraftRow {
  rowKey: string;
  rowNo: string;
  rawName: string;
  rawNip: string;
  rawRole: string;
  matchedUid: string;
  cellsByDay: Record<number, ParsedCellValue>;
}

const SHIFT_CODE_DISPLAY: Record<ScheduleShiftType, string> = {
  Pagi: 'P',
  Siang: 'S',
  Malam: 'M',
  Libur: 'L',
  Cuti: 'C',
};

const SHIFT_CHIP_CLASS: Record<ScheduleShiftType, string> = {
  Pagi: 'bg-sky-100 text-sky-800 border-sky-200',
  Siang: 'bg-amber-100 text-amber-800 border-amber-200',
  Malam: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Libur: 'bg-slate-100 text-slate-600 border-slate-200',
  Cuti: 'bg-purple-100 text-purple-800 border-purple-200',
};

function createRowKey(): string {
  return `sched-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNipExact(nip: string): string {
  return nip.trim().toLowerCase();
}

function normalizeNipCompact(nip: string): string {
  return nip
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/([a-z])0+(\d+)/g, '$1$2');
}

function normalizeNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ');
}

function stripAcademicTitles(name: string): string {
  return normalizeNameKey(name)
    .replace(
      /\b(ns|ners|s\s*tr\s*kep|s\s*kep|m\s*kep|a\s*md\s*kep|amd\s*kep|amk|skep|s\s*km|skm|m\s*kes)\b/g,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyRoleValue(val: string): boolean {
  return /(kepala\s*ruang|karu|pj\s*shif|pj\b|perawat|pelaksana|admin|manager)/i.test(val.trim());
}

function parseShiftCode(rawValue: string): ParsedCellValue {
  const cleaned = rawValue.trim();
  if (!cleaned || cleaned === '-' || cleaned === '·' || cleaned === '.') {
    return { raw: '', shift: null, isInvalid: false };
  }
  const upper = cleaned.toUpperCase();
  if (upper === 'P' || upper === 'PAGI' || upper === 'SHIFT PAGI') {
    return { raw: 'P', shift: 'Pagi', isInvalid: false };
  }
  if (upper === 'S' || upper === 'SIANG' || upper === 'SHIFT SIANG') {
    return { raw: 'S', shift: 'Siang', isInvalid: false };
  }
  if (upper === 'M' || upper === 'MALAM' || upper === 'SHIFT MALAM') {
    return { raw: 'M', shift: 'Malam', isInvalid: false };
  }
  if (upper === 'L' || upper === 'LIBUR' || upper === 'OFF') {
    return { raw: 'L', shift: 'Libur', isInvalid: false };
  }
  if (upper === 'C' || upper === 'CUTI') {
    return { raw: 'C', shift: 'Cuti', isInvalid: false };
  }
  return { raw: cleaned, shift: null, isInvalid: true };
}

function isKnownShiftToken(val: string): boolean {
  const s = val.trim().toUpperCase();
  return ['P', 'S', 'M', 'L', 'C', 'PAGI', 'SIANG', 'MALAM', 'LIBUR', 'CUTI', 'OFF'].includes(s);
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5).join('\n');
  const tabs = (sample.match(/\t/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
  if (semis >= commas && semis > 0) return ';';
  return ',';
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim());
  }
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function extractDayNumberFromHeader(headerCell: string): number | null {
  const cleaned = headerCell.trim();
  if (!cleaned) return null;
  if (/^\d{1,2}$/.test(cleaned)) {
    const num = Number(cleaned);
    return num >= 1 && num <= 31 ? num : null;
  }
  const isoMatch = /^\d{4}-\d{2}-(\d{2})$/.exec(cleaned);
  if (isoMatch) {
    const num = Number(isoMatch[1]);
    return num >= 1 && num <= 31 ? num : null;
  }
  const tglMatch = /^(?:tgl|tanggal|hari)\s*(\d{1,2})$/i.exec(cleaned);
  if (tglMatch) {
    const num = Number(tglMatch[1]);
    return num >= 1 && num <= 31 ? num : null;
  }
  const slashMatch = /^(\d{1,2})[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?$/.exec(cleaned);
  if (slashMatch) {
    const num = Number(slashMatch[1]);
    return num >= 1 && num <= 31 ? num : null;
  }
  return null;
}

function findBestStaffMatch(
  rawName: string,
  rawNip: string,
  activeStaff: StaffDirectoryEntry[]
): string {
  const cleanNip = normalizeNipExact(rawNip);
  const compactNip = normalizeNipCompact(rawNip);
  const cleanName = normalizeNameKey(rawName);
  const bareName = stripAcademicTitles(rawName);

  if (cleanNip) {
    const exactNipMatches = activeStaff.filter((s) => normalizeNipExact(s.nip || '') === cleanNip);
    if (exactNipMatches.length === 1) return exactNipMatches[0].uid;
  }

  if (compactNip) {
    const compactNipMatches = activeStaff.filter(
      (s) => normalizeNipCompact(s.nip || '') === compactNip
    );
    if (compactNipMatches.length === 1) return compactNipMatches[0].uid;
  }

  if (cleanName) {
    const exactNameMatches = activeStaff.filter(
      (s) => normalizeNameKey(s.fullName) === cleanName
    );
    if (exactNameMatches.length === 1) return exactNameMatches[0].uid;
  }

  if (bareName && bareName.length >= 4) {
    const bareNameMatches = activeStaff.filter(
      (s) => stripAcademicTitles(s.fullName) === bareName
    );
    if (bareNameMatches.length === 1) return bareNameMatches[0].uid;

    const partialMatches = activeStaff.filter((s) => {
      const targetBare = stripAcademicTitles(s.fullName);
      return targetBare.includes(bareName) || bareName.includes(targetBare);
    });
    if (partialMatches.length === 1) return partialMatches[0].uid;
  }

  return '';
}

function parseScheduleSpreadsheet(
  rawText: string,
  activeStaff: StaffDirectoryEntry[],
  maxDayInMonth: number
): ParsedScheduleDraftRow[] {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  const parsed = lines.map((l) => parseDelimitedLine(l, delimiter));
  const firstRow = parsed[0] || [];
  const firstRowLower = firstRow.map((c) => c.trim().toLowerCase());

  const dayHeadersInFirstRow: { colIdx: number; day: number }[] = [];
  firstRow.forEach((cell, idx) => {
    // Skip column 0 if it's the "No" column header or row index
    if (idx === 0 && (cell.toLowerCase() === 'no' || cell.toLowerCase() === 'no.')) return;
    const dayNum = extractDayNumberFromHeader(cell);
    if (dayNum !== null) {
      dayHeadersInFirstRow.push({ colIdx: idx, day: dayNum });
    }
  });

  const hasHeader =
    firstRowLower.some(
      (c) =>
        c.includes('nama') ||
        c === 'nip' ||
        c.includes('peran') ||
        c.includes('role') ||
        c === 'no' ||
        c === 'no.'
    ) || dayHeadersInFirstRow.length >= 3;

  let nameCol = 1;
  let nipCol = 2;
  let roleCol = 3;
  let noCol: number | null = 0;
  let dayCols: { colIdx: number; day: number }[] = [];
  let dataStartIdx = 0;

  if (hasHeader) {
    dataStartIdx = 1;
    const foundNo = firstRowLower.findIndex((c) => c === 'no' || c === 'no.' || c === '#');
    const foundName = firstRowLower.findIndex((c) => c.includes('nama'));
    const foundNip = firstRowLower.findIndex((c) => c.includes('nip'));
    const foundRole = firstRowLower.findIndex((c) => c.includes('peran') || c.includes('role'));

    noCol = foundNo >= 0 ? foundNo : null;
    nameCol = foundName >= 0 ? foundName : noCol === 0 ? 1 : 0;
    nipCol = foundNip >= 0 ? foundNip : -1;
    roleCol = foundRole >= 0 ? foundRole : -1;

    const minMetaEnd = Math.max(
      noCol ?? -1,
      nameCol,
      nipCol >= 0 ? nipCol : -1,
      roleCol >= 0 ? roleCol : -1
    );

    const validDayHeaders = dayHeadersInFirstRow.filter((d) => d.colIdx > minMetaEnd);
    if (validDayHeaders.length > 0) {
      dayCols = validDayHeaders;
    } else {
      const startShiftCol = minMetaEnd + 1;
      for (let idx = startShiftCol; idx < firstRow.length; idx++) {
        const day = idx - startShiftCol + 1;
        if (day <= 31) dayCols.push({ colIdx: idx, day });
      }
    }
  } else {
    // Infer column positions from first few data rows (supports with or without No / NIP / Peran)
    const sampleRows = parsed.slice(0, 5);
    const col0 = (firstRow[0] || '').trim();
    const col1 = (firstRow[1] || '').trim();
    const hasLeadingNo = /^\d{1,3}\.?$/.test(col0) && col1.length > 0 && !isKnownShiftToken(col1);
    noCol = hasLeadingNo ? 0 : null;
    nameCol = hasLeadingNo ? 1 : 0;

    // Locate the first column where daily shift codes begin
    let shiftStartCol = nameCol + 1;
    for (let c = nameCol + 1; c < Math.min(firstRow.length, nameCol + 5); c++) {
      const colVals = sampleRows.map((r) => (r[c] || '').trim()).filter(Boolean);
      const hasShiftToken = colVals.some((v) => isKnownShiftToken(v));
      const allShiftOrDash =
        colVals.length > 0 && colVals.every((v) => isKnownShiftToken(v) || v === '-' || v === '·');
      if (hasShiftToken && allShiftOrDash) {
        shiftStartCol = c;
        break;
      }
      if (c === Math.min(firstRow.length, nameCol + 5) - 1) {
        shiftStartCol = c + 1;
      }
    }

    const gapCols = shiftStartCol - nameCol - 1;
    if (gapCols <= 0) {
      nipCol = -1;
      roleCol = -1;
    } else if (gapCols === 1) {
      const midVals = sampleRows.map((r) => (r[nameCol + 1] || '').trim()).filter(Boolean);
      const midIsRole = midVals.some((v) => isLikelyRoleValue(v));
      if (midIsRole) {
        nipCol = -1;
        roleCol = nameCol + 1;
      } else {
        nipCol = nameCol + 1;
        roleCol = -1;
      }
    } else {
      nipCol = nameCol + 1;
      roleCol = nameCol + 2;
    }

    const maxRowLen = Math.max(...parsed.map((r) => r.length));
    for (let idx = shiftStartCol; idx < maxRowLen; idx++) {
      const day = idx - shiftStartCol + 1;
      if (day <= 31) dayCols.push({ colIdx: idx, day });
    }
  }

  const dataRows = parsed.slice(dataStartIdx).filter((r) => r.some((cell) => cell.trim().length > 0));

  return dataRows.map((cells, rowIdx) => {
    const rowNo = noCol !== null ? (cells[noCol] || '').trim() || String(rowIdx + 1) : String(rowIdx + 1);
    const rawName = (cells[nameCol] || '').trim();
    const rawNip = nipCol >= 0 ? (cells[nipCol] || '').trim() : '';
    const rawRole = roleCol >= 0 ? (cells[roleCol] || '').trim() : '';
    const matchedUid = findBestStaffMatch(rawName, rawNip, activeStaff);

    const cellsByDay: Record<number, ParsedCellValue> = {};
    for (const { colIdx, day } of dayCols) {
      if (day < 1 || day > maxDayInMonth) continue;
      const cellRaw = cells[colIdx] || '';
      const parsedVal = parseShiftCode(cellRaw);
      if (parsedVal.shift || parsedVal.isInvalid) {
        cellsByDay[day] = parsedVal;
      }
    }

    return {
      rowKey: createRowKey(),
      rowNo,
      rawName,
      rawNip,
      rawRole,
      matchedUid,
      cellsByDay,
    };
  });
}

export function ImportScheduleSpreadsheetModal({
  defaultMonthKey,
  staffDirectory,
  existingSchedules,
  onClose,
  onImported,
}: ImportScheduleSpreadsheetModalProps) {
  const { userProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [targetMonthKey, setTargetMonthKey] = useState(defaultMonthKey);
  const [validationMode, setValidationMode] = useState<'Draft' | 'Validated'>('Draft');
  const [stepTab, setStepTab] = useState<'input' | 'preview'>('input');
  const [rawText, setRawText] = useState('');
  const [parseFeedback, setParseFeedback] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedScheduleDraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sortedActiveStaff = useMemo(() => {
    return staffDirectory
      .filter((s) => s.isActive)
      .sort((a, b) => {
        const orderDiff = (ROLE_SORT_ORDER[a.role] ?? 99) - (ROLE_SORT_ORDER[b.role] ?? 99);
        if (orderDiff !== 0) return orderDiff;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [staffDirectory]);

  const staffMap = useMemo(
    () => new Map(sortedActiveStaff.map((s) => [s.uid, s])),
    [sortedActiveStaff]
  );

  const daysInMonth = useMemo(() => getDaysInMonth(targetMonthKey), [targetMonthKey]);

  const existingScheduleIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of existingSchedules) {
      set.add(s.id);
    }
    return set;
  }, [existingSchedules]);

  const stats = useMemo(() => {
    let matchedRows = 0;
    let unmatchedRows = 0;
    let readyCells = 0;
    let invalidCells = 0;
    const matchedUidCounts = new Map<string, number>();

    for (const r of rows) {
      if (r.matchedUid) {
        matchedRows++;
        matchedUidCounts.set(r.matchedUid, (matchedUidCounts.get(r.matchedUid) || 0) + 1);
      } else {
        unmatchedRows++;
      }

      for (let d = 1; d <= daysInMonth.length; d++) {
        const cell = r.cellsByDay[d];
        if (!cell) continue;
        if (cell.isInvalid) {
          invalidCells++;
        } else if (cell.shift && r.matchedUid) {
          readyCells++;
        }
      }
    }

    const duplicateStaffRows = Array.from(matchedUidCounts.values()).filter((c) => c > 1).length;

    return {
      matchedRows,
      unmatchedRows,
      readyCells,
      invalidCells,
      duplicateStaffRows,
    };
  }, [rows, daysInMonth.length]);

  const handleDownloadTemplate = () => {
    const dayNumbers = daysInMonth.map((_, idx) => String(idx + 1));
    const headers = ['No', 'Nama Perawat', 'Peran', ...dayNumbers];
    const sampleCycle = ['L', 'P', 'S', 'P', 'S', 'M', 'L'];
    const templateRows = sortedActiveStaff.map((s, idx) => [
      idx + 1,
      s.fullName,
      s.role,
      ...daysInMonth.map((_, dayIdx) => sampleCycle[(dayIdx + idx) % sampleCycle.length]),
    ]);

    exportToCsv(`template-jadwal-dinas-${targetMonthKey}.csv`, headers, templateRows);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      setRawText(text);
      const parsed = parseScheduleSpreadsheet(text, sortedActiveStaff, daysInMonth.length);
      if (parsed.length > 0) {
        setRows(parsed);
        setParseFeedback(null);
        setStepTab('preview');
      } else {
        setParseFeedback(
          `File "${file.name}" dimuat, tetapi tidak ditemukan baris jadwal yang valid.`
        );
      }
    } catch {
      setParseFeedback('Gagal membaca file CSV / TSV. Pastikan file bertipe teks UTF-8.');
    } finally {
      e.target.value = '';
    }
  };

  const handleProcessText = () => {
    setParseFeedback(null);
    setSaveError(null);
    const parsed = parseScheduleSpreadsheet(rawText, sortedActiveStaff, daysInMonth.length);
    if (parsed.length === 0) {
      setParseFeedback(
        'Data spreadsheet masih kosong atau format kolom tidak terbaca. Pastikan menyalin kolom Nama Perawat dan tanggal.'
      );
      return;
    }
    setRows(parsed);
    setStepTab('preview');
  };

  const handleUpdateRowStaff = (rowKey: string, uid: string) => {
    setRows((prev) =>
      prev.map((r) => (r.rowKey === rowKey ? { ...r, matchedUid: uid } : r))
    );
  };

  const handleUpdateCell = (rowKey: string, day: number, rawInput: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const nextCells = { ...r.cellsByDay };
        const parsed = parseShiftCode(rawInput);
        if (!parsed.shift && !parsed.isInvalid) {
          delete nextCells[day];
        } else {
          nextCells[day] = parsed;
        }
        return { ...r, cellsByDay: nextCells };
      })
    );
  };

  const handleRemoveRow = (rowKey: string) => {
    setRows((prev) => prev.filter((r) => r.rowKey !== rowKey));
  };

  const handleSaveSchedules = async () => {
    if (!userProfile) return;
    setSaveError(null);

    if (stats.invalidCells > 0) {
      setSaveError(
        'Masih ada kode shift yang tidak dikenali (ditandai merah). Gunakan P (Pagi), S (Siang), M (Malam), L (Libur), C (Cuti), atau kosongkan.'
      );
      return;
    }
    if (stats.duplicateStaffRows > 0) {
      setSaveError(
        'Ada nama staf yang terpetakan lebih dari 1 baris. Hapus atau pilih staf berbeda terlebih dahulu.'
      );
      return;
    }

    type WriteOp = {
      docId: string;
      exists: boolean;
      nurse: StaffDirectoryEntry;
      date: string;
      shift: ScheduleShiftType;
    };

    const ops: WriteOp[] = [];
    for (const r of rows) {
      if (!r.matchedUid) continue;
      const nurse = staffMap.get(r.matchedUid);
      if (!nurse) continue;

      for (let d = 1; d <= daysInMonth.length; d++) {
        const cell = r.cellsByDay[d];
        if (!cell?.shift) continue;
        const dateStr = `${targetMonthKey}-${String(d).padStart(2, '0')}`;
        const docId = `${nurse.uid}_${dateStr}`;
        ops.push({
          docId,
          exists: existingScheduleIdSet.has(docId),
          nurse,
          date: dateStr,
          shift: cell.shift,
        });
      }
    }

    if (ops.length === 0) {
      setSaveError('Tidak ada sel jadwal yang siap disimpan. Pastikan baris sudah terpetakan ke akun staf.');
      return;
    }

    setSaving(true);
    try {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const chunk = ops.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const op of chunk) {
          const ref = doc(db, 'schedules', op.docId);
          if (op.exists) {
            batch.update(ref, {
              nurseName: clampString(op.nurse.fullName, 120),
              date: op.date,
              monthKey: targetMonthKey,
              shift: op.shift,
              validationStatus: validationMode,
              ...(validationMode === 'Validated'
                ? {
                    validatedBy: userProfile.uid,
                    validatedByName: clampString(userProfile.fullName, 120),
                  }
                : {}),
              notes: 'Impor Spreadsheet',
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(ref, {
              nurseId: op.nurse.uid,
              nurseName: clampString(op.nurse.fullName, 120),
              date: op.date,
              monthKey: targetMonthKey,
              shift: op.shift,
              validationStatus: validationMode,
              ...(validationMode === 'Validated'
                ? {
                    validatedBy: userProfile.uid,
                    validatedByName: clampString(userProfile.fullName, 120),
                  }
                : {}),
              notes: 'Impor Spreadsheet',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
        await batch.commit();
      }
      onImported({ monthKey: targetMonthKey, savedCount: ops.length });
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan jadwal ke Firestore. Pastikan akun Administrator aktif.'
      );
      handleFirestoreError(err, OperationType.WRITE, 'schedules');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-[#0B5A8E]">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Input Jadwal Dinas dari Spreadsheet (Google Sheets / Excel / CSV)
              </h3>
              <p className="text-xs text-slate-500">
                Bisa <strong>tanpa kolom NIP</strong> — cukup sesuaikan <strong>Nama Perawat</strong> (mis.{' '}
                <span className="font-mono font-semibold text-slate-700">No | Nama Perawat | 1 | 2 | ...</span> atau{' '}
                <span className="font-mono font-semibold text-slate-700">No | Nama Perawat | Peran | 1 | 2 | ...</span>) dengan kode shift{' '}
                <span className="font-mono">P, S, M, L, C</span>.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Settings & Mode Tabs */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStepTab('input')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                  stepTab === 'input'
                    ? 'bg-[#0B5A8E] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                1. Tempel / Upload Spreadsheet
              </button>
              <button
                type="button"
                disabled={rows.length === 0}
                onClick={() => setStepTab('preview')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition disabled:opacity-45 ${
                  stepTab === 'preview'
                    ? 'bg-[#0B5A8E] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                2. Pratinjau Matriks ({rows.length} Baris)
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5 text-[#0B5A8E]" />
              Unduh Template CSV ({formatMonthLabel(targetMonthKey)})
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs items-end">
            <div>
              <label className="block font-medium text-slate-600 mb-1">
                Bulan &amp; Tahun Jadwal Target
              </label>
              <input
                type="month"
                value={targetMonthKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setTargetMonthKey(val);
                  if (rawText.trim()) {
                    const nextDays = getDaysInMonth(val);
                    setRows(parseScheduleSpreadsheet(rawText, sortedActiveStaff, nextDays.length));
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs focus:border-[#0B5A8E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600 mb-1">
                Status Jadwal Setelah Impor
              </label>
              <select
                value={validationMode}
                onChange={(e) => setValidationMode(e.target.value as 'Draft' | 'Validated')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#0B5A8E] focus:outline-none"
              >
                <option value="Draft">Draft (Validasi oleh Kepala Ruang)</option>
                <option value="Validated">Langsung Validated (Disetujui)</option>
              </select>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600">
              Kode shift:{' '}
              <span className="font-mono font-bold text-sky-700">P</span>=Pagi,{' '}
              <span className="font-mono font-bold text-amber-700">S</span>=Siang,{' '}
              <span className="font-mono font-bold text-indigo-700">M</span>=Malam,{' '}
              <span className="font-mono font-bold text-slate-700">L</span>=Libur,{' '}
              <span className="font-mono font-bold text-purple-700">C</span>=Cuti
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {stepTab === 'input' ? (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <p className="font-semibold text-slate-800">
                  Cara tercepat dari Google Sheets / Excel:
                </p>
                <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                  <li>
                    Blok sel tabel di Google Sheets / Excel yang berisi{' '}
                    <strong>Nama Perawat</strong> dan kolom tanggal{' '}
                    <strong>1..{daysInMonth.length}</strong> — <strong>tanpa kolom NIP pun bisa</strong> (misal <code className="font-mono">No | Nama Perawat | 1 | 2 | ...</code> atau <code className="font-mono">No | Nama Perawat | Peran | 1 | 2 | ...</code>; kolom NIP tetap didukung jika ada).
                  </li>
                  <li>
                    Salin (<code className="font-mono">Ctrl+C</code>), lalu tempel (<code className="font-mono">Ctrl+V</code>) ke area teks di bawah atau unggah file <code className="font-mono">.csv</code> / <code className="font-mono">.tsv</code>.
                  </li>
                  <li>
                    Klik <strong>Proses &amp; Pratinjau Matriks</strong> untuk memeriksa pencocokan nama setiap perawat dengan akun staf sebelum disimpan.
                  </li>
                </ol>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-4 w-4 text-[#0B5A8E]" />
                  Pilih File CSV / TSV
                </button>
                {parseFeedback && (
                  <span className="text-xs font-medium text-rose-600">{parseFeedback}</span>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">
                  Tempel Data Jadwal dari Google Sheets / Excel / CSV
                </label>
                <textarea
                  rows={11}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={
                    'No\tNama Perawat\tPeran\t1\t2\t3\t4\t5\t6\t7\n1\tTWIS FERTILIANTI PW\tKepala Ruang\tL\tP\tP\tP\tP\tP\tP\n2\tM HAIKAL MALILANG\tPJ Shift\tL\tP\tS\tS\tP\tP\tS'
                  }
                  className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs focus:border-[#0B5A8E] focus:outline-none"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleProcessText}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75]"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Proses &amp; Pratinjau Matriks
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Preview Metrics Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {stats.matchedRows} Staf Cocok ({stats.readyCells} sel shift siap simpan)
                  </span>
                  {stats.unmatchedRows > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {stats.unmatchedRows} Baris Belum Terpetakan ke Akun
                    </span>
                  )}
                  {stats.invalidCells > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {stats.invalidCells} Kode Shift Tidak Valid
                    </span>
                  )}
                  {stats.duplicateStaffRows > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Ada Akun Staf Terpetakan Ganda
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setStepTab('input')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Ubah Teks Spreadsheet
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                Periksa pemetaan akun dan sel tanggal di bawah sebelum menyimpan. Anda dapat memilih ulang akun pada dropdown atau mengetik kode{' '}
                <code className="font-mono">P / S / M / L / C</code> langsung pada sel tanggal untuk koreksi cepat.
              </p>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-50 px-2.5 py-2 font-semibold border-r border-slate-200 w-9 text-center">
                        No
                      </th>
                      <th className="sticky left-9 z-20 bg-slate-50 px-3 py-2 font-semibold border-r border-slate-200 min-w-[170px]">
                        Data Spreadsheet
                      </th>
                      <th className="px-2.5 py-2 font-semibold border-r border-slate-200 min-w-[210px]">
                        Akun Staf Sistem
                      </th>
                      {daysInMonth.map((d, idx) => (
                        <th
                          key={d}
                          className="px-1 py-2 text-center font-mono font-semibold tabular-nums min-w-[34px]"
                        >
                          {idx + 1}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-center font-semibold border-l border-slate-200">
                        Hapus
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const isUnmatched = !r.matchedUid;
                      return (
                        <tr
                          key={r.rowKey}
                          className={isUnmatched ? 'bg-amber-50/40' : 'hover:bg-slate-50/60'}
                        >
                          <td className="sticky left-0 z-10 bg-white px-2 py-2 text-center font-mono text-slate-500 border-r border-slate-200">
                            {r.rowNo}
                          </td>
                          <td className="sticky left-9 z-10 bg-white px-3 py-2 border-r border-slate-200">
                            <div className="font-semibold text-slate-900 truncate max-w-[165px]">
                              {r.rawName || '-'}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate max-w-[165px]">
                              {[r.rawRole, r.rawNip ? `NIP: ${r.rawNip}` : '']
                                .filter(Boolean)
                                .join(' · ') || 'Pencocokan via Nama'}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 border-r border-slate-200">
                            <select
                              value={r.matchedUid}
                              onChange={(e) => handleUpdateRowStaff(r.rowKey, e.target.value)}
                              className={`w-full rounded border px-2 py-1 text-[11px] focus:outline-none ${
                                isUnmatched
                                  ? 'border-amber-400 bg-amber-50 text-amber-900 font-semibold'
                                  : 'border-slate-300 bg-white text-slate-800'
                              }`}
                            >
                              <option value="">-- Pilih Akun Staf (Lewati Baris) --</option>
                              {sortedActiveStaff.map((s) => (
                                <option key={s.uid} value={s.uid}>
                                  {s.fullName} ({s.role}
                                  {s.nip ? ` · ${s.nip}` : ''})
                                </option>
                              ))}
                            </select>
                          </td>
                          {daysInMonth.map((d, idx) => {
                            const dayNum = idx + 1;
                            const cell = r.cellsByDay[dayNum];
                            const val = cell?.shift
                              ? SHIFT_CODE_DISPLAY[cell.shift]
                              : cell?.raw || '';
                            const cellStyle = cell?.isInvalid
                              ? 'border-rose-400 bg-rose-100 text-rose-800 font-bold'
                              : cell?.shift
                              ? `${SHIFT_CHIP_CLASS[cell.shift]} font-bold`
                              : 'border-slate-200 bg-white text-slate-400';

                            return (
                              <td key={d} className="p-0.5 text-center">
                                <input
                                  type="text"
                                  maxLength={6}
                                  value={val}
                                  onChange={(e) =>
                                    handleUpdateCell(r.rowKey, dayNum, e.target.value)
                                  }
                                  title={
                                    cell?.isInvalid
                                      ? `Kode "${cell.raw}" tidak dikenali (gunakan P, S, M, L, C)`
                                      : cell?.shift
                                      ? `${d}: ${cell.shift}`
                                      : `${d}: Kosong`
                                  }
                                  className={`h-7 w-7 rounded border text-center font-mono text-[11px] uppercase focus:border-[#0B5A8E] focus:outline-none ${cellStyle}`}
                                />
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center border-l border-slate-200">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(r.rowKey)}
                              title="Hapus baris dari impor"
                              className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 space-y-2.5">
          {saveError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700">
              {saveError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">
              Jadwal untuk tanggal yang sudah ada pada staf yang sama akan diperbarui otomatis sesuai spreadsheet.
            </p>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              {stepTab === 'preview' && (
                <button
                  type="button"
                  disabled={
                    saving ||
                    stats.readyCells === 0 ||
                    stats.invalidCells > 0 ||
                    stats.duplicateStaffRows > 0
                  }
                  onClick={handleSaveSchedules}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#094a75] disabled:opacity-60"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {saving
                    ? `Menyimpan ${stats.readyCells} Jadwal...`
                    : `Simpan ${stats.readyCells} Jadwal (${formatMonthLabel(targetMonthKey)})`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

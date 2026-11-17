import React, { useMemo, useRef, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { clampString, exportToCsv } from '../../lib/formatters';
import type { Patient, PatientStatus } from '../../types';

type AllowedFirestoreAccess = 'AV Shunt' | 'CDL' | 'Femoral' | 'AVG';
type ShiftHdOption = 'PAGI' | 'SIANG' | 'MALAM';

interface BulkPatientDraftRow {
  rowKey: string;
  fullName: string;
  gender: 'L' | 'P';
  birthDateInput: string;
  mrn: string;
  diagnosis: string;
  routineSchedule: string;
  shiftHd: ShiftHdOption;
  vascularAccess: AllowedFirestoreAccess;
  status: PatientStatus;
  notes: string;
}

interface BulkAddPatientsModalProps {
  existingPatients: Patient[];
  onClose: () => void;
  onSuccess: (addedCount: number) => void;
}

const ALLOWED_ACCESS_OPTIONS: AllowedFirestoreAccess[] = ['AV Shunt', 'CDL', 'Femoral', 'AVG'];
const ALLOWED_STATUS_OPTIONS: PatientStatus[] = ['Aktif', 'Rujuk', 'Nonaktif', 'Meninggal'];
const SHIFT_HD_OPTIONS: ShiftHdOption[] = ['PAGI', 'SIANG', 'MALAM'];
const SCHEDULE_PRESETS = [
  'SENIN-KAMIS',
  'SELASA-JUMAT',
  'RABU-SABTU',
  'SENIN',
  'SELASA',
  'RABU',
  'KAMIS',
  'JUMAT',
  'SABTU',
];

function createRowKey(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRow(defaults: {
  vascularAccess: AllowedFirestoreAccess;
  routineSchedule: string;
  shiftHd: ShiftHdOption;
  diagnosis: string;
  status: PatientStatus;
}): BulkPatientDraftRow {
  return {
    rowKey: createRowKey(),
    fullName: '',
    gender: 'L',
    birthDateInput: '',
    mrn: '',
    diagnosis: defaults.diagnosis,
    routineSchedule: defaults.routineSchedule,
    shiftHd: defaults.shiftHd,
    vascularAccess: defaults.vascularAccess,
    status: defaults.status,
    notes: '',
  };
}

function normalizeGender(raw: string): 'L' | 'P' {
  const s = raw.trim().toLowerCase();
  if (s === 'p' || s.startsWith('perem') || s.startsWith('wanita') || s === 'f' || s === 'female') {
    return 'P';
  }
  return 'L';
}

function normalizeShiftHd(raw: string, fallback: ShiftHdOption): ShiftHdOption {
  const s = raw.trim().toLowerCase();
  if (!s) return fallback;
  if (s.includes('siang')) return 'SIANG';
  if (s.includes('malam')) return 'MALAM';
  if (s.includes('pagi')) return 'PAGI';
  return fallback;
}

function stripShiftSuffix(scheduleRaw: string): { cleanSchedule: string; extractedShift: ShiftHdOption | null } {
  const trimmed = scheduleRaw.trim();
  const match = trimmed.match(/^(.*?)\s*\((pagi|siang|malam)\)\s*$/i);
  if (match) {
    return {
      cleanSchedule: match[1].trim(),
      extractedShift: match[2].toUpperCase() as ShiftHdOption,
    };
  }
  return { cleanSchedule: trimmed, extractedShift: null };
}

function formatRoutineScheduleWithShift(schedule: string, shiftHd: ShiftHdOption): string {
  const { cleanSchedule } = stripShiftSuffix(schedule);
  if (!cleanSchedule) return '';
  return `${cleanSchedule} (${shiftHd})`;
}

function parseBirthDateInput(raw: string): { year: number | null; formattedDob: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { year: null, formattedDob: null };

  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    if (year >= 1900 && year <= 2030) {
      return { year, formattedDob: null };
    }
    return { year: null, formattedDob: null };
  }

  const dmy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2030) {
      return {
        year,
        formattedDob: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
      };
    }
    return { year: null, formattedDob: null };
  }

  const ymd = trimmed.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2030) {
      return {
        year,
        formattedDob: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
      };
    }
    return { year: null, formattedDob: null };
  }

  const fallback = trimmed.match(/(19\d{2}|20\d{2})/);
  if (fallback) {
    const year = Number(fallback[1]);
    if (year >= 1900 && year <= 2030) {
      return { year, formattedDob: trimmed };
    }
  }

  return { year: null, formattedDob: null };
}

function normalizeVascularAccess(raw: string): AllowedFirestoreAccess {
  const s = raw.trim().toLowerCase();
  if (s.includes('cdl') || s.includes('cvc') || s.includes('kateter')) return 'CDL';
  if (s.includes('femoral')) return 'Femoral';
  if (s.includes('avg') || s.includes('graft')) return 'AVG';
  return 'AV Shunt';
}

function looksLikeVascularAccess(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return (
    s === 'av shunt' ||
    s === 'avf' ||
    s === 'av fistula' ||
    s === 'cimino' ||
    s === 'cdl' ||
    s === 'cvc' ||
    s === 'femoral' ||
    s === 'avg'
  );
}

function normalizePatientStatus(raw: string): PatientStatus {
  const s = raw.trim().toLowerCase();
  if (s.includes('rujuk')) return 'Rujuk';
  if (s.includes('meninggal')) return 'Meninggal';
  if (s.includes('nonaktif') || s.includes('non aktif') || s.includes('tidak aktif')) return 'Nonaktif';
  return 'Aktif';
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((cell) => cell.trim());
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

function detectDelimiter(sampleLines: string[]): string {
  const joined = sampleLines.slice(0, 5).join('\n');
  const tabCount = (joined.match(/\t/g) || []).length;
  const semiCount = (joined.match(/;/g) || []).length;
  const commaCount = (joined.match(/,/g) || []).length;
  if (tabCount >= semiCount && tabCount >= commaCount && tabCount > 0) return '\t';
  if (semiCount >= commaCount && semiCount > 0) return ';';
  return ',';
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.slice(0, 8).join(' ').toLowerCase();
  return (
    joined.includes('nama pasien') ||
    joined.includes('jenis kelamin') ||
    joined.includes('tanggal lahir') ||
    joined.includes('no rm') ||
    joined.includes('no. rm') ||
    joined.includes('diagnosa') ||
    joined.includes('jadwal hd') ||
    joined.includes('shift hd')
  );
}

function parseSpreadsheetTextToRows(
  rawText: string,
  defaults: {
    vascularAccess: AllowedFirestoreAccess;
    routineSchedule: string;
    shiftHd: ShiftHdOption;
    diagnosis: string;
    status: PatientStatus;
  }
): BulkPatientDraftRow[] {
  const rawLines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (rawLines.length === 0) return [];

  const delimiter = detectDelimiter(rawLines);
  const parsedLines = rawLines.map((line) => parseDelimitedLine(line, delimiter));
  const headerDetected = parsedLines.length > 0 && isHeaderRow(parsedLines[0]);
  const headerCells = headerDetected ? parsedLines[0].map((c) => c.toLowerCase()) : [];
  const startIdx = headerDetected ? 1 : 0;
  const dataRows = parsedLines.slice(startIdx).filter((cells) => cells.some((c) => c.length > 0));
  if (dataRows.length === 0) return [];

  const headerHasNo = headerDetected && (headerCells[0] === 'no' || headerCells[0] === 'no.' || headerCells[0] === '#');

  return dataRows.map((cells) => {
    const col0 = (cells[0] || '').trim();
    const col1 = (cells[1] || '').trim();
    const col2 = (cells[2] || '').trim();

    const looksLikeNoIndex = /^\d{1,4}\.?$/.test(col0) && col1.length > 0 && !/^[lp]$/i.test(col1);
    const hasNoColumn = headerHasNo || looksLikeNoIndex;

    const looksLikeLegacyMrnFirst =
      !hasNoColumn &&
      /^(rm|skp|sks)/i.test(col0) &&
      /^[lp]$/i.test(col2);

    if (looksLikeLegacyMrnFirst) {
      const schedInfo = stripShiftSuffix(cells[5] || defaults.routineSchedule);
      return {
        rowKey: createRowKey(),
        mrn: cells[0] || '',
        fullName: cells[1] || '',
        gender: normalizeGender(cells[2] || 'L'),
        birthDateInput: cells[3] || '1970',
        vascularAccess: normalizeVascularAccess(cells[4] || defaults.vascularAccess),
        routineSchedule: schedInfo.cleanSchedule || defaults.routineSchedule,
        shiftHd: schedInfo.extractedShift || defaults.shiftHd,
        diagnosis: cells[6] || defaults.diagnosis,
        status: normalizePatientStatus(cells[7] || defaults.status),
        notes: cells[8] || '',
      };
    }

    const offset = hasNoColumn ? 1 : 0;
    const rawSchedule = cells[offset + 5] || defaults.routineSchedule;
    const schedInfo = stripShiftSuffix(rawSchedule);
    const cellAfterSchedule = (cells[offset + 6] || '').trim();
    const cellIsAccess = looksLikeVascularAccess(cellAfterSchedule);

    const resolvedShift = cellIsAccess
      ? schedInfo.extractedShift || defaults.shiftHd
      : normalizeShiftHd(cellAfterSchedule, schedInfo.extractedShift || defaults.shiftHd);

    const resolvedAccess = cellIsAccess
      ? normalizeVascularAccess(cellAfterSchedule)
      : cells[offset + 7]
      ? normalizeVascularAccess(cells[offset + 7])
      : defaults.vascularAccess;

    const resolvedStatus = cellIsAccess
      ? cells[offset + 7]
        ? normalizePatientStatus(cells[offset + 7])
        : defaults.status
      : cells[offset + 8]
      ? normalizePatientStatus(cells[offset + 8])
      : defaults.status;

    const resolvedNotes = cellIsAccess ? cells[offset + 8] || '' : cells[offset + 9] || '';

    return {
      rowKey: createRowKey(),
      fullName: cells[offset] || '',
      gender: normalizeGender(cells[offset + 1] || 'L'),
      birthDateInput: cells[offset + 2] || '',
      mrn: cells[offset + 3] || '',
      diagnosis: cells[offset + 4] || defaults.diagnosis,
      routineSchedule: schedInfo.cleanSchedule || defaults.routineSchedule,
      shiftHd: resolvedShift,
      vascularAccess: resolvedAccess,
      status: resolvedStatus,
      notes: resolvedNotes,
    };
  });
}

export function BulkAddPatientsModal({
  existingPatients,
  onClose,
  onSuccess,
}: BulkAddPatientsModalProps) {
  const [activeTab, setActiveTab] = useState<'table' | 'import'>('table');

  const [defaultVascularAccess, setDefaultVascularAccess] = useState<AllowedFirestoreAccess>('AV Shunt');
  const [defaultSchedule, setDefaultSchedule] = useState('SENIN-KAMIS');
  const [defaultShiftHd, setDefaultShiftHd] = useState<ShiftHdOption>('PAGI');
  const [defaultDiagnosis, setDefaultDiagnosis] = useState('CKD ST V');
  const [defaultStatus, setDefaultStatus] = useState<PatientStatus>('Aktif');

  const [rows, setRows] = useState<BulkPatientDraftRow[]>(() =>
    Array.from({ length: 5 }, () =>
      createEmptyRow({
        vascularAccess: 'AV Shunt',
        routineSchedule: 'SENIN-KAMIS',
        shiftHd: 'PAGI',
        diagnosis: 'CKD ST V',
        status: 'Aktif',
      })
    )
  );

  const [rawImportText, setRawImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const existingMrnSet = useMemo(() => {
    const set = new Set<string>();
    existingPatients.forEach((p) => {
      const normalized = p.mrn.trim().toLowerCase();
      if (normalized) set.add(normalized);
    });
    return set;
  }, [existingPatients]);

  const rowEvaluations = useMemo(() => {
    const mrnCounts = new Map<string, number>();
    rows.forEach((r) => {
      const isBlank = !r.mrn.trim() && !r.fullName.trim();
      if (isBlank) return;
      const key = r.mrn.trim().toLowerCase();
      if (key) {
        mrnCounts.set(key, (mrnCounts.get(key) || 0) + 1);
      }
    });

    return rows.map((r) => {
      const isBlank = !r.mrn.trim() && !r.fullName.trim();
      if (isBlank) {
        return { isBlank: true, parsedBirthYear: null as number | null, formattedDob: null as string | null, errors: [] as string[] };
      }

      const errors: string[] = [];
      const mrnTrimmed = r.mrn.trim();
      const nameTrimmed = r.fullName.trim();
      const parsedBirth = parseBirthDateInput(r.birthDateInput);
      const combinedSchedule = formatRoutineScheduleWithShift(r.routineSchedule, r.shiftHd);

      if (nameTrimmed.length < 2 || nameTrimmed.length > 120) {
        errors.push('Nama pasien wajib 2-120 karakter');
      }

      if (parsedBirth.year === null || parsedBirth.year < 1900 || parsedBirth.year > 2030) {
        errors.push('Tanggal lahir wajib diisi (format DD/MM/YYYY atau tahun 1900-2030)');
      }

      if (mrnTrimmed.length < 2 || mrnTrimmed.length > 40) {
        errors.push('No. RM wajib 2-40 karakter');
      } else {
        const mrnKey = mrnTrimmed.toLowerCase();
        if (existingMrnSet.has(mrnKey)) {
          errors.push('No. RM sudah terdaftar');
        } else if ((mrnCounts.get(mrnKey) || 0) > 1) {
          errors.push('No. RM duplikat di daftar ini');
        }
      }

      if (!r.diagnosis.trim() || r.diagnosis.trim().length > 200) {
        errors.push('Diagnosa wajib 1-200 karakter');
      }

      if (!combinedSchedule || combinedSchedule.length > 80) {
        errors.push('Jadwal & Shift HD wajib 1-80 karakter');
      }

      if (r.notes.trim().length > 500) {
        errors.push('Catatan maks 500 karakter');
      }

      return {
        isBlank: false,
        parsedBirthYear: parsedBirth.year,
        formattedDob: parsedBirth.formattedDob,
        errors,
      };
    });
  }, [rows, existingMrnSet]);

  const summary = useMemo(() => {
    let validCount = 0;
    let invalidCount = 0;
    let emptyCount = 0;
    rowEvaluations.forEach((ev) => {
      if (ev.isBlank) emptyCount++;
      else if (ev.errors.length === 0) validCount++;
      else invalidCount++;
    });
    return { validCount, invalidCount, emptyCount };
  }, [rowEvaluations]);

  const updateRow = <K extends keyof BulkPatientDraftRow>(
    rowKey: string,
    field: K,
    value: BulkPatientDraftRow[K]
  ) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, [field]: value } : r)));
  };

  const addRows = (count: number) => {
    const created = Array.from({ length: count }, () =>
      createEmptyRow({
        vascularAccess: defaultVascularAccess,
        routineSchedule: defaultSchedule,
        shiftHd: defaultShiftHd,
        diagnosis: defaultDiagnosis,
        status: defaultStatus,
      })
    );
    setRows((prev) => [...prev, ...created]);
  };

  const removeRow = (rowKey: string) => {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [
          createEmptyRow({
            vascularAccess: defaultVascularAccess,
            routineSchedule: defaultSchedule,
            shiftHd: defaultShiftHd,
            diagnosis: defaultDiagnosis,
            status: defaultStatus,
          }),
        ];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
  };

  const applyDefaultsToAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        vascularAccess: defaultVascularAccess,
        routineSchedule: defaultSchedule,
        shiftHd: defaultShiftHd,
        diagnosis: defaultDiagnosis,
        status: defaultStatus,
      }))
    );
  };

  const clearBlankRows = () => {
    setRows((prev) => {
      const nonEmpty = prev.filter((r) => r.mrn.trim() || r.fullName.trim());
      if (nonEmpty.length === 0) {
        return [
          createEmptyRow({
            vascularAccess: defaultVascularAccess,
            routineSchedule: defaultSchedule,
            shiftHd: defaultShiftHd,
            diagnosis: defaultDiagnosis,
            status: defaultStatus,
          }),
        ];
      }
      return nonEmpty;
    });
  };

  const handleDownloadTemplate = () => {
    exportToCsv(
      'template-data-pasien-hd.csv',
      ['NO', 'NAMA PASIEN', 'JENIS KELAMIN', 'TANGGAL LAHIR', 'NO RM', 'DIAGNOSA', 'JADWAL HD', 'SHIFT HD'],
      [
        [1, 'ADJI DHARMANTO, DRS. TN', 'L', '12/12/1958', 'SKP-0001', 'CKD ST V', 'SENIN-KAMIS', 'PAGI'],
        [2, 'BAGUS SETIAWAN,A,TN', 'L', '07/02/1984', 'SKS-0001', 'CKD ST V', 'SENIN-KAMIS', 'SIANG'],
      ]
    );
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawImportText(text.replace(/^\uFEFF/, ''));
      setImportFeedback(`File "${file.name}" berhasil dimuat. Klik "Proses ke Tabel Input" untuk pratinjau.`);
    } catch {
      setImportFeedback('Gagal membaca file CSV. Pastikan format teks UTF-8.');
    } finally {
      e.target.value = '';
    }
  };

  const handleParseImportText = () => {
    setImportFeedback(null);
    setSubmitError(null);

    const mappedRows = parseSpreadsheetTextToRows(rawImportText, {
      vascularAccess: defaultVascularAccess,
      routineSchedule: defaultSchedule,
      shiftHd: defaultShiftHd,
      diagnosis: defaultDiagnosis,
      status: defaultStatus,
    });

    if (mappedRows.length === 0) {
      setImportFeedback('Tidak ada baris data pasien yang valid untuk diproses.');
      return;
    }

    setRows((prev) => {
      const existingNonEmpty = prev.filter((r) => r.mrn.trim() || r.fullName.trim());
      return [...existingNonEmpty, ...mappedRows];
    });
    setRawImportText('');
    setActiveTab('table');
  };

  const handleTablePaste = (e: React.ClipboardEvent<HTMLInputElement>, targetRowIdx: number) => {
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted || (!pasted.includes('\t') && !pasted.includes('\n'))) {
      return;
    }
    const parsedRows = parseSpreadsheetTextToRows(pasted, {
      vascularAccess: defaultVascularAccess,
      routineSchedule: defaultSchedule,
      shiftHd: defaultShiftHd,
      diagnosis: defaultDiagnosis,
      status: defaultStatus,
    });
    if (parsedRows.length === 0) return;

    e.preventDefault();
    setSubmitError(null);
    setRows((prev) => {
      const before = prev.slice(0, targetRowIdx);
      const remainingAfter = prev
        .slice(targetRowIdx + parsedRows.length)
        .filter((r) => r.mrn.trim() || r.fullName.trim());
      return [...before, ...parsedRows, ...remainingAfter];
    });
  };

  const handleSaveAll = async () => {
    setSubmitError(null);
    if (summary.invalidCount > 0) {
      setSubmitError('Masih ada baris yang belum valid. Perbaiki kolom bertanda merah terlebih dahulu.');
      return;
    }

    const validEntries = rows
      .map((row, idx) => ({ row, evalResult: rowEvaluations[idx] }))
      .filter(({ evalResult }) => evalResult && !evalResult.isBlank && evalResult.errors.length === 0);

    if (validEntries.length === 0) {
      setSubmitError('Isi minimal satu data pasien sebelum menyimpan.');
      return;
    }

    setSaving(true);
    try {
      const BATCH_LIMIT = 400;
      const patientsRef = collection(db, 'patients');

      for (let i = 0; i < validEntries.length; i += BATCH_LIMIT) {
        const chunk = validEntries.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);

        chunk.forEach(({ row, evalResult }) => {
          const patientRef = doc(patientsRef);
          const parsedYear = Math.min(2030, Math.max(1900, evalResult.parsedBirthYear || 1970));
          const mergedNotes = row.notes.trim()
            ? row.notes.trim()
            : evalResult.formattedDob
            ? `Tgl Lahir: ${evalResult.formattedDob}`
            : '';
          const combinedSchedule = formatRoutineScheduleWithShift(
            row.routineSchedule || defaultSchedule || 'SENIN-KAMIS',
            row.shiftHd || defaultShiftHd
          );

          batch.set(patientRef, {
            mrn: clampString(row.mrn, 40),
            fullName: clampString(row.fullName, 120),
            gender: row.gender,
            birthYear: parsedYear,
            vascularAccess: row.vascularAccess,
            diagnosis: clampString(row.diagnosis || defaultDiagnosis || 'CKD ST V', 200),
            dpjpId: '-',
            dpjpName: '-',
            routineSchedule: clampString(combinedSchedule, 80),
            status: row.status,
            notes: clampString(mergedNotes, 500),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

      onSuccess(validEntries.length);
    } catch (err) {
      setSubmitError('Gagal menyimpan data pasien massal. Periksa koneksi atau kelengkapan data.');
      handleFirestoreError(err, OperationType.CREATE, 'patients');
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Tambah Banyak Pasien Hemodialisa
              </h3>
              <p className="text-xs text-slate-500">
                Format kolom mengikuti spreadsheet: NO, NAMA PASIEN, JENIS KELAMIN, TANGGAL LAHIR, NO RM, DIAGNOSA, JADWAL HD, dan SHIFT HD.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Tabs & Default Values Bar */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('table')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                  activeTab === 'table'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Tabel Input Cepat ({summary.validCount} siap)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                  activeTab === 'import'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Tempel Spreadsheet / Import CSV
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5 text-teal-600" />
              Unduh Template CSV
            </button>
          </div>

          {/* Defaults */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end text-xs">
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Diagnosa</label>
              <input
                type="text"
                value={defaultDiagnosis}
                onChange={(e) => setDefaultDiagnosis(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Jadwal HD</label>
              <input
                type="text"
                list="bulk-schedule-presets"
                value={defaultSchedule}
                onChange={(e) => setDefaultSchedule(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
              <datalist id="bulk-schedule-presets">
                {SCHEDULE_PRESETS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Shift HD</label>
              <select
                value={defaultShiftHd}
                onChange={(e) => setDefaultShiftHd(e.target.value as ShiftHdOption)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {SHIFT_HD_OPTIONS.map((sh) => (
                  <option key={sh} value={sh}>
                    {sh}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Akses Vaskular</label>
              <select
                value={defaultVascularAccess}
                onChange={(e) => setDefaultVascularAccess(e.target.value as AllowedFirestoreAccess)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {ALLOWED_ACCESS_OPTIONS.map((acc) => (
                  <option key={acc} value={acc}>
                    {acc}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Status</label>
              <select
                value={defaultStatus}
                onChange={(e) => setDefaultStatus(e.target.value as PatientStatus)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {ALLOWED_STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button
                type="button"
                onClick={applyDefaultsToAll}
                className="w-full rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
              >
                Terapkan Default ke Semua
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'import' ? (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <p className="font-semibold text-slate-800">
                  Cukup blok &amp; salin langsung dari Google Sheets / Excel (dengan atau tanpa baris header):
                </p>
                <p className="font-mono text-[11px] text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">
                  NO | NAMA PASIEN | JENIS KELAMIN | TANGGAL LAHIR | NO RM | DIAGNOSA | JADWAL HD | SHIFT HD
                </p>
                <p className="text-[11px] text-slate-500">
                  Kolom <strong>JADWAL HD</strong> (misal <code className="font-mono">SENIN-KAMIS</code>) dan <strong>SHIFT HD</strong> (<code className="font-mono">PAGI</code>/<code className="font-mono">SIANG</code>) akan otomatis digabungkan menjadi jadwal shift pasien di sistem (misal <code className="font-mono">SENIN-KAMIS (PAGI)</code>).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  onChange={handleFileSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-4 w-4 text-teal-600" />
                  Pilih File CSV / TSV
                </button>
                {importFeedback && (
                  <span className="text-xs font-medium text-teal-700">{importFeedback}</span>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">
                  Tempel Data dari Google Sheets / Excel / CSV
                </label>
                <textarea
                  rows={10}
                  value={rawImportText}
                  onChange={(e) => setRawImportText(e.target.value)}
                  placeholder={
                    '1\tADJI DHARMANTO, DRS. TN\tL\t12/12/1958\tSKP-0001\tCKD ST V\tSENIN-KAMIS\tPAGI\n26\tBAGUS SETIAWAN,A,TN\tL\t07/02/1984\tSKS-0001\tCKD ST V\tSENIN-KAMIS\tSIANG'
                  }
                  className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParseImportText}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Proses ke Tabel Input
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addRows(1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />1 Baris
                  </button>
                  <button
                    type="button"
                    onClick={() => addRows(5)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />5 Baris
                  </button>
                  <button
                    type="button"
                    onClick={() => addRows(25)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />25 Baris
                  </button>
                  <button
                    type="button"
                    onClick={clearBlankRows}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Hapus Baris Kosong
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {summary.validCount} Valid
                  </span>
                  {summary.invalidCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {summary.invalidCount} Perlu Diperbaiki
                    </span>
                  )}
                  <span className="text-slate-400">{summary.emptyCount} Kosong</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Tips: Anda juga bisa langsung <strong>Ctrl+V / Paste</strong> salinan tabel dari Google Sheets atau Excel ke kolom <strong>NAMA PASIEN</strong>.
              </p>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1060px] text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2.5 font-semibold w-10 text-center">NO</th>
                      <th className="px-2 py-2.5 font-semibold w-52">NAMA PASIEN *</th>
                      <th className="px-2 py-2.5 font-semibold w-20">JENIS KELAMIN</th>
                      <th className="px-2 py-2.5 font-semibold w-28">TANGGAL LAHIR *</th>
                      <th className="px-2 py-2.5 font-semibold w-28">NO RM *</th>
                      <th className="px-2 py-2.5 font-semibold w-32">DIAGNOSA</th>
                      <th className="px-2 py-2.5 font-semibold w-36">JADWAL HD</th>
                      <th className="px-2 py-2.5 font-semibold w-26">SHIFT HD</th>
                      <th className="px-2 py-2.5 font-semibold w-28">AKSES</th>
                      <th className="px-2 py-2.5 font-semibold w-24">STATUS</th>
                      <th className="px-2 py-2.5 font-semibold w-10 text-center">AKSI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, idx) => {
                      const evalResult = rowEvaluations[idx];
                      const hasError = !evalResult.isBlank && evalResult.errors.length > 0;
                      return (
                        <React.Fragment key={row.rowKey}>
                          <tr className={hasError ? 'bg-rose-50/40' : 'hover:bg-slate-50/60'}>
                            <td className="px-2 py-2 text-center font-mono text-[11px] text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.fullName}
                                onChange={(e) => updateRow(row.rowKey, 'fullName', e.target.value)}
                                onPaste={(e) => handleTablePaste(e, idx)}
                                placeholder="ADJI DHARMANTO, DRS. TN"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.gender}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'gender', e.target.value as 'L' | 'P')
                                }
                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                <option value="L">L</option>
                                <option value="P">P</option>
                              </select>
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.birthDateInput}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'birthDateInput', e.target.value)
                                }
                                placeholder="12/12/1958"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.mrn}
                                onChange={(e) => updateRow(row.rowKey, 'mrn', e.target.value)}
                                placeholder="SKP-0001"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.diagnosis}
                                onChange={(e) => updateRow(row.rowKey, 'diagnosis', e.target.value)}
                                placeholder="CKD ST V"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                list="bulk-schedule-presets"
                                value={row.routineSchedule}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'routineSchedule', e.target.value)
                                }
                                placeholder="SENIN-KAMIS"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.shiftHd}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'shiftHd', e.target.value as ShiftHdOption)
                                }
                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs font-medium focus:border-teal-600 focus:outline-none"
                              >
                                {SHIFT_HD_OPTIONS.map((sh) => (
                                  <option key={sh} value={sh}>
                                    {sh}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.vascularAccess}
                                onChange={(e) =>
                                  updateRow(
                                    row.rowKey,
                                    'vascularAccess',
                                    e.target.value as AllowedFirestoreAccess
                                  )
                                }
                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                {ALLOWED_ACCESS_OPTIONS.map((acc) => (
                                  <option key={acc} value={acc}>
                                    {acc}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.status}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'status', e.target.value as PatientStatus)
                                }
                                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                {ALLOWED_STATUS_OPTIONS.map((st) => (
                                  <option key={st} value={st}>
                                    {st}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1.5 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeRow(row.rowKey)}
                                title="Hapus baris"
                                className="rounded p-1 text-rose-500 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                          {hasError && (
                            <tr className="bg-rose-50/70">
                              <td />
                              <td colSpan={10} className="px-2 pb-2 text-[11px] font-medium text-rose-700">
                                Baris {idx + 1}: {evalResult.errors.join(' · ')}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/70 rounded-b-xl">
          <div className="text-xs">
            {submitError ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-rose-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {submitError}
              </span>
            ) : (
              <span className="text-slate-500">
                Baris yang Nama Pasien dan No. RM-nya kosong akan otomatis diabaikan saat penyimpanan.
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving || summary.validCount === 0 || summary.invalidCount > 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Users className="h-4 w-4" />
              {saving ? 'Menyimpan...' : `Simpan ${summary.validCount} Pasien`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

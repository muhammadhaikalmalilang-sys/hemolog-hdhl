import React, { useMemo, useRef, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Stethoscope,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { clampString, exportToCsv } from '../../lib/formatters';
import type { Doctor, DoctorStatus } from '../../types';

interface BulkDoctorDraftRow {
  rowKey: string;
  fullName: string;
  sipNumber: string;
  phone: string;
  specialization: string;
  status: DoctorStatus;
}

interface BulkAddDoctorsModalProps {
  existingDoctors: Doctor[];
  onClose: () => void;
  onSuccess: (addedCount: number) => void;
}

const DOCTOR_CATEGORY_OPTIONS = ['DOKTER UMUM', 'DOKTER DPJP'] as const;
const DOCTOR_STATUS_OPTIONS: DoctorStatus[] = ['Aktif', 'Cuti', 'Nonaktif'];

function createRowKey(): string {
  return `doc-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRow(defaults: {
  specialization: string;
  status: DoctorStatus;
}): BulkDoctorDraftRow {
  return {
    rowKey: createRowKey(),
    fullName: '',
    sipNumber: '',
    phone: '',
    specialization: defaults.specialization,
    status: defaults.status,
  };
}

function normalizeDoctorCategory(raw: string, fallback: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return fallback;
  if (s.includes('dpjp') || s.includes('sp.pd') || s.includes('spesialis') || s.includes('kgh')) {
    return 'DOKTER DPJP';
  }
  if (s.includes('umum') || s.includes('jaga') || s === 'dr') {
    return 'DOKTER UMUM';
  }
  return raw.trim();
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed === '—') return '';
  return trimmed;
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
  const joined = cells.slice(0, 6).join(' ').toLowerCase();
  return (
    joined.includes('nama dokter') ||
    joined.includes('no hp dokter') ||
    (joined.includes('sip') && joined.includes('kategori'))
  );
}

function parseSpreadsheetTextToRows(
  rawText: string,
  defaults: {
    specialization: string;
    status: DoctorStatus;
  }
): BulkDoctorDraftRow[] {
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

  const headerHasNo =
    headerDetected &&
    (headerCells[0] === 'no' || headerCells[0] === 'no.' || headerCells[0] === '#');

  return dataRows.map((cells) => {
    const col0 = (cells[0] || '').trim();
    const col1 = (cells[1] || '').trim();
    const looksLikeNoIndex = /^\d{1,4}\.?$/.test(col0) && col1.length > 0;
    const offset = headerHasNo || looksLikeNoIndex ? 1 : 0;

    return {
      rowKey: createRowKey(),
      fullName: cells[offset] || '',
      sipNumber: cells[offset + 1] || '',
      phone: normalizePhone(cells[offset + 2] || ''),
      specialization: normalizeDoctorCategory(cells[offset + 3] || '', defaults.specialization),
      status: defaults.status,
    };
  });
}

export function BulkAddDoctorsModal({
  existingDoctors,
  onClose,
  onSuccess,
}: BulkAddDoctorsModalProps) {
  const [activeTab, setActiveTab] = useState<'table' | 'import'>('table');
  const [defaultCategory, setDefaultCategory] = useState<string>('DOKTER UMUM');
  const [defaultStatus, setDefaultStatus] = useState<DoctorStatus>('Aktif');

  const [rows, setRows] = useState<BulkDoctorDraftRow[]>(() =>
    Array.from({ length: 5 }, () =>
      createEmptyRow({
        specialization: 'DOKTER UMUM',
        status: 'Aktif',
      })
    )
  );

  const [rawImportText, setRawImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const existingSipSet = useMemo(() => {
    const set = new Set<string>();
    existingDoctors.forEach((d) => {
      const key = d.sipNumber.trim().toLowerCase();
      if (key) set.add(key);
    });
    return set;
  }, [existingDoctors]);

  const rowEvaluations = useMemo(() => {
    const sipCounts = new Map<string, number>();
    rows.forEach((r) => {
      const isBlank = !r.fullName.trim() && !r.sipNumber.trim() && !r.phone.trim();
      if (isBlank) return;
      const key = r.sipNumber.trim().toLowerCase();
      if (key) {
        sipCounts.set(key, (sipCounts.get(key) || 0) + 1);
      }
    });

    return rows.map((r) => {
      const isBlank = !r.fullName.trim() && !r.sipNumber.trim() && !r.phone.trim();
      if (isBlank) {
        return { isBlank: true, errors: [] as string[] };
      }

      const errors: string[] = [];
      const cleanName = r.fullName.trim();
      const cleanSip = r.sipNumber.trim();
      const cleanSpec = r.specialization.trim();
      const cleanPhone = r.phone.trim();

      if (cleanName.length < 2 || cleanName.length > 120) {
        errors.push('Nama dokter wajib 2–120 karakter');
      }

      if (cleanSip.length < 2 || cleanSip.length > 60) {
        errors.push('Nomor SIP wajib 2–60 karakter');
      } else {
        const sipKey = cleanSip.toLowerCase();
        if (existingSipSet.has(sipKey)) {
          errors.push('Nomor SIP sudah terdaftar');
        } else if ((sipCounts.get(sipKey) || 0) > 1) {
          errors.push('Nomor SIP duplikat di daftar ini');
        }
      }

      if (cleanSpec.length < 2 || cleanSpec.length > 80) {
        errors.push('Kategori dokter wajib 2–80 karakter');
      }

      if (cleanPhone.length > 30) {
        errors.push('No. HP maks 30 karakter');
      }

      return { isBlank: false, errors };
    });
  }, [rows, existingSipSet]);

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

  const updateRow = <K extends keyof BulkDoctorDraftRow>(
    rowKey: string,
    field: K,
    value: BulkDoctorDraftRow[K]
  ) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, [field]: value } : r)));
  };

  const addRows = (count: number) => {
    const created = Array.from({ length: count }, () =>
      createEmptyRow({
        specialization: defaultCategory,
        status: defaultStatus,
      })
    );
    setRows((prev) => [...prev, ...created]);
  };

  const removeRow = (rowKey: string) => {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [createEmptyRow({ specialization: defaultCategory, status: defaultStatus })];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
  };

  const clearBlankRows = () => {
    setRows((prev) => {
      const nonEmpty = prev.filter((r) => r.fullName.trim() || r.sipNumber.trim() || r.phone.trim());
      if (nonEmpty.length === 0) {
        return [createEmptyRow({ specialization: defaultCategory, status: defaultStatus })];
      }
      return nonEmpty;
    });
  };

  const applyDefaultsToAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        specialization: defaultCategory,
        status: defaultStatus,
      }))
    );
  };

  const handleDownloadTemplate = () => {
    exportToCsv(
      'template-data-dokter-hd.csv',
      ['NO', 'NAMA DOKTER', 'SIP', 'NO HP DOKTER', 'KATEGORI'],
      [
        [1, 'dr. Addiniya Nurul Azmi Burhan', 'DRU-0001', '081911996556', 'DOKTER UMUM'],
        [2, 'dr. RADEN HERU PRASANTO, Sp.PD-KGH', 'DRS-0001', '-', 'DOKTER DPJP'],
      ]
    );
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawImportText(text.replace(/^\uFEFF/, ''));
      setImportFeedback(`File "${file.name}" berhasil dimuat. Klik "Proses ke Tabel Input".`);
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
      specialization: defaultCategory,
      status: defaultStatus,
    });

    if (mappedRows.length === 0) {
      setImportFeedback('Tidak ada baris data dokter yang valid untuk diproses.');
      return;
    }

    setRows((prev) => {
      const existingNonEmpty = prev.filter(
        (r) => r.fullName.trim() || r.sipNumber.trim() || r.phone.trim()
      );
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
      specialization: defaultCategory,
      status: defaultStatus,
    });
    if (parsedRows.length === 0) return;

    e.preventDefault();
    setSubmitError(null);
    setRows((prev) => {
      const before = prev.slice(0, targetRowIdx);
      const remainingAfter = prev
        .slice(targetRowIdx + parsedRows.length)
        .filter((r) => r.fullName.trim() || r.sipNumber.trim() || r.phone.trim());
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
      .filter(
        ({ evalResult }) => evalResult && !evalResult.isBlank && evalResult.errors.length === 0
      );

    if (validEntries.length === 0) {
      setSubmitError('Isi minimal satu data dokter sebelum menyimpan.');
      return;
    }

    setSaving(true);
    try {
      const BATCH_LIMIT = 400;
      const doctorsRef = collection(db, 'doctors');

      for (let i = 0; i < validEntries.length; i += BATCH_LIMIT) {
        const chunk = validEntries.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);

        chunk.forEach(({ row }) => {
          const doctorRef = doc(doctorsRef);
          batch.set(doctorRef, {
            fullName: clampString(row.fullName, 120),
            sipNumber: clampString(row.sipNumber, 60),
            specialization: clampString(row.specialization || defaultCategory, 80),
            phone: clampString(normalizePhone(row.phone), 30),
            status: row.status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

      onSuccess(validEntries.length);
    } catch (err) {
      setSubmitError('Gagal menyimpan data dokter massal. Periksa koneksi atau hak akses admin.');
      handleFirestoreError(err, OperationType.CREATE, 'doctors');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Tambah Banyak Dokter Unit Hemodialisa
              </h3>
              <p className="text-xs text-slate-500">
                Format kolom mengikuti spreadsheet: NO, NAMA DOKTER, SIP, NO HP DOKTER, dan KATEGORI.
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
                <Stethoscope className="h-3.5 w-3.5" />
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end text-xs">
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Kategori</label>
              <select
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {DOCTOR_CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Status</label>
              <select
                value={defaultStatus}
                onChange={(e) => setDefaultStatus(e.target.value as DoctorStatus)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {DOCTOR_STATUS_OPTIONS.map((st) => (
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
                Terapkan Default ke Semua Baris
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
                  NO | NAMA DOKTER | SIP | NO HP DOKTER | KATEGORI
                </p>
                <p className="text-[11px] text-slate-500">
                  Kategori <code className="font-mono">DOKTER UMUM</code> dan{' '}
                  <code className="font-mono">DOKTER DPJP</code> otomatis dikenali, sedangkan
                  tanda <code className="font-mono">-</code> pada kolom No HP dianggap kosong.
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
                    '1\tdr. Addiniya Nurul Azmi Burhan\tDRU-0001\t081911996556\tDOKTER UMUM\n11\tdr. RADEN HERU PRASANTO, Sp.PD-KGH\tDRS-0001\t-\tDOKTER DPJP'
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
                    onClick={() => addRows(15)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />15 Baris
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
                Tips: Anda bisa langsung <strong>Ctrl+V / Paste</strong> salinan tabel dari Google
                Sheets atau Excel ke kolom <strong>NAMA DOKTER</strong>.
              </p>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2.5 font-semibold w-10 text-center">NO</th>
                      <th className="px-2 py-2.5 font-semibold w-64">NAMA DOKTER *</th>
                      <th className="px-2 py-2.5 font-semibold w-32">SIP *</th>
                      <th className="px-2 py-2.5 font-semibold w-36">NO HP DOKTER</th>
                      <th className="px-2 py-2.5 font-semibold w-40">KATEGORI *</th>
                      <th className="px-2 py-2.5 font-semibold w-28">STATUS</th>
                      <th className="px-2 py-2.5 font-semibold w-10 text-center">AKSI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, idx) => {
                      const evalResult = rowEvaluations[idx];
                      const hasError = !evalResult.isBlank && evalResult.errors.length > 0;
                      const isKnownCat = DOCTOR_CATEGORY_OPTIONS.includes(
                        row.specialization as (typeof DOCTOR_CATEGORY_OPTIONS)[number]
                      );
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
                                placeholder="dr. Addiniya Nurul Azmi Burhan"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.sipNumber}
                                onChange={(e) => updateRow(row.rowKey, 'sipNumber', e.target.value)}
                                placeholder="DRU-0001"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.phone}
                                onChange={(e) => updateRow(row.rowKey, 'phone', e.target.value)}
                                placeholder="081911996556"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.specialization}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'specialization', e.target.value)
                                }
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                {DOCTOR_CATEGORY_OPTIONS.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                                {!isKnownCat && row.specialization && (
                                  <option value={row.specialization}>{row.specialization}</option>
                                )}
                              </select>
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.status}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'status', e.target.value as DoctorStatus)
                                }
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                {DOCTOR_STATUS_OPTIONS.map((st) => (
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
                                title="Hapus baris ini"
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                          {hasError && (
                            <tr className="bg-rose-50/70">
                              <td />
                              <td colSpan={6} className="px-2 pb-2 pt-0.5 text-[11px] text-rose-700 font-medium">
                                {evalResult.errors.join(' • ')}
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
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 space-y-2.5">
          {submitError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700">
              {submitError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">
              Data dokter akan langsung tersedia pada pilihan DPJP &amp; Dokter Jaga.
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
              {activeTab === 'table' && (
                <button
                  type="button"
                  disabled={saving || summary.validCount === 0}
                  onClick={handleSaveAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  <Stethoscope className="h-3.5 w-3.5" />
                  {saving
                    ? `Menyimpan ${summary.validCount} Dokter...`
                    : `Simpan ${summary.validCount} Dokter`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

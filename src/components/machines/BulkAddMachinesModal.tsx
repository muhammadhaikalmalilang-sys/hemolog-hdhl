import React, { useMemo, useRef, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { clampString, exportToCsv, getTodayDateStr } from '../../lib/formatters';
import type { Machine, MachineStatus } from '../../types';

interface BulkMachineDraftRow {
  rowKey: string;
  machineNumber: string;
  roomZone: string;
  status: MachineStatus;
  brand: string;
}

interface BulkAddMachinesModalProps {
  existingMachines: Machine[];
  onClose: () => void;
  onSuccess: (addedCount: number) => void;
}

const MACHINE_STATUS_OPTIONS: MachineStatus[] = ['Ready', 'In Use', 'Sterilisasi', 'Maintenance'];
const MACHINE_CATEGORY_SUGGESTIONS = ['REGULER', 'ISOLASI', 'VIP', 'HCU / ICU', 'Ruang A (Reguler)'];

function createRowKey(): string {
  return `mch-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRow(defaults: {
  roomZone: string;
  status: MachineStatus;
  brand: string;
}): BulkMachineDraftRow {
  return {
    rowKey: createRowKey(),
    machineNumber: '',
    roomZone: defaults.roomZone,
    status: defaults.status,
    brand: defaults.brand,
  };
}

function normalizeMachineStatus(raw: string, fallback: MachineStatus): MachineStatus {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return fallback;
  if (s === 'ready' || s.includes('aktif') || s === 'active' || s.includes('siap') || s.includes('tersedia')) {
    if (s.includes('nonaktif') || s.includes('tidak aktif')) {
      return 'Maintenance';
    }
    return 'Ready';
  }
  if (s.includes('in use') || s === 'inuse' || s.includes('digunakan') || s.includes('dipakai') || s.includes('terpakai')) {
    return 'In Use';
  }
  if (s.includes('steril')) {
    return 'Sterilisasi';
  }
  if (
    s.includes('maint') ||
    s.includes('perbaikan') ||
    s.includes('rusak') ||
    s.includes('nonaktif') ||
    s.includes('tidak aktif') ||
    s === 'off'
  ) {
    return 'Maintenance';
  }
  return fallback;
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
    joined.includes('nama mesin') ||
    joined.includes('nomor mesin') ||
    joined.includes('merk') ||
    (joined.includes('kategori') && joined.includes('status'))
  );
}

function parseSpreadsheetTextToRows(
  rawText: string,
  defaults: {
    roomZone: string;
    status: MachineStatus;
    brand: string;
  }
): BulkMachineDraftRow[] {
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
      machineNumber: cells[offset] || '',
      roomZone: (cells[offset + 1] || '').trim() || defaults.roomZone,
      status: normalizeMachineStatus(cells[offset + 2] || '', defaults.status),
      brand: (cells[offset + 3] || '').trim() || defaults.brand,
    };
  });
}

export function BulkAddMachinesModal({
  existingMachines,
  onClose,
  onSuccess,
}: BulkAddMachinesModalProps) {
  const [activeTab, setActiveTab] = useState<'table' | 'import'>('table');
  const [defaultCategory, setDefaultCategory] = useState('REGULER');
  const [defaultStatus, setDefaultStatus] = useState<MachineStatus>('Ready');
  const [defaultBrand, setDefaultBrand] = useState('SAS 1000');
  const [defaultMaintenanceDate, setDefaultMaintenanceDate] = useState(getTodayDateStr());

  const [rows, setRows] = useState<BulkMachineDraftRow[]>(() =>
    Array.from({ length: 5 }, () =>
      createEmptyRow({
        roomZone: 'REGULER',
        status: 'Ready',
        brand: 'SAS 1000',
      })
    )
  );

  const [rawImportText, setRawImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const existingMachineSet = useMemo(() => {
    const set = new Set<string>();
    existingMachines.forEach((m) => {
      const key = m.machineNumber.trim().toLowerCase();
      if (key) set.add(key);
    });
    return set;
  }, [existingMachines]);

  const rowEvaluations = useMemo(() => {
    const isRowBlank = (r: BulkMachineDraftRow) =>
      !r.machineNumber.trim() &&
      (!r.roomZone.trim() || r.roomZone.trim() === defaultCategory.trim()) &&
      (!r.brand.trim() || r.brand.trim() === defaultBrand.trim());

    const machineCounts = new Map<string, number>();
    rows.forEach((r) => {
      if (isRowBlank(r)) return;
      const key = r.machineNumber.trim().toLowerCase();
      if (key) {
        machineCounts.set(key, (machineCounts.get(key) || 0) + 1);
      }
    });

    return rows.map((r) => {
      if (isRowBlank(r)) {
        return { isBlank: true, errors: [] as string[] };
      }

      const errors: string[] = [];
      const cleanName = r.machineNumber.trim();
      const cleanZone = r.roomZone.trim();
      const cleanBrand = r.brand.trim();

      if (cleanName.length < 1 || cleanName.length > 40) {
        errors.push('Nama/Nomor mesin wajib 1–40 karakter');
      } else {
        const key = cleanName.toLowerCase();
        if (existingMachineSet.has(key)) {
          errors.push('Mesin sudah terdaftar');
        } else if ((machineCounts.get(key) || 0) > 1) {
          errors.push('Nama mesin duplikat di daftar ini');
        }
      }

      if (cleanZone.length > 60) {
        errors.push('Kategori/Zona maks 60 karakter');
      }

      if (cleanBrand.length < 2 || cleanBrand.length > 80) {
        errors.push('Merk & Model wajib 2–80 karakter');
      }

      return { isBlank: false, errors };
    });
  }, [rows, existingMachineSet, defaultCategory, defaultBrand]);

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

  const updateRow = <K extends keyof BulkMachineDraftRow>(
    rowKey: string,
    field: K,
    value: BulkMachineDraftRow[K]
  ) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, [field]: value } : r)));
  };

  const addRows = (count: number) => {
    const created = Array.from({ length: count }, () =>
      createEmptyRow({
        roomZone: defaultCategory,
        status: defaultStatus,
        brand: defaultBrand,
      })
    );
    setRows((prev) => [...prev, ...created]);
  };

  const removeRow = (rowKey: string) => {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [
          createEmptyRow({
            roomZone: defaultCategory,
            status: defaultStatus,
            brand: defaultBrand,
          }),
        ];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
  };

  const clearBlankRows = () => {
    setRows((prev) => {
      const nonEmpty = prev.filter((r) => r.machineNumber.trim());
      if (nonEmpty.length === 0) {
        return [
          createEmptyRow({
            roomZone: defaultCategory,
            status: defaultStatus,
            brand: defaultBrand,
          }),
        ];
      }
      return nonEmpty;
    });
  };

  const applyDefaultsToAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        roomZone: defaultCategory,
        status: defaultStatus,
        brand: defaultBrand,
      }))
    );
  };

  const handleDownloadTemplate = () => {
    exportToCsv(
      'template-data-mesin-hd.csv',
      ['No', 'NAMA MESIN', 'Kategori', 'Status', 'Merk & Model'],
      [
        [1, 'A01', 'REGULER', 'AKTIF', 'SAS 1000'],
        [2, 'A02', 'REGULER', 'AKTIF', 'SAS 1000'],
        [3, 'B01', 'REGULER', 'AKTIF', 'SAS 1000'],
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
      roomZone: defaultCategory,
      status: defaultStatus,
      brand: defaultBrand,
    });

    if (mappedRows.length === 0) {
      setImportFeedback('Tidak ada baris data mesin yang valid untuk diproses.');
      return;
    }

    setRows((prev) => {
      const existingNonEmpty = prev.filter((r) => r.machineNumber.trim());
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
      roomZone: defaultCategory,
      status: defaultStatus,
      brand: defaultBrand,
    });
    if (parsedRows.length === 0) return;

    e.preventDefault();
    setSubmitError(null);
    setRows((prev) => {
      const before = prev.slice(0, targetRowIdx);
      const remainingAfter = prev
        .slice(targetRowIdx + parsedRows.length)
        .filter((r) => r.machineNumber.trim());
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
      setSubmitError('Isi minimal satu data mesin sebelum menyimpan.');
      return;
    }

    setSaving(true);
    try {
      const BATCH_LIMIT = 400;
      const machinesRef = collection(db, 'machines');
      const cleanDate = clampString(defaultMaintenanceDate, 20);

      for (let i = 0; i < validEntries.length; i += BATCH_LIMIT) {
        const chunk = validEntries.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);

        chunk.forEach(({ row }) => {
          const machineRef = doc(machinesRef);
          batch.set(machineRef, {
            machineNumber: clampString(row.machineNumber, 40),
            brand: clampString(row.brand || defaultBrand, 80),
            serialNumber: '',
            roomZone: clampString(row.roomZone || defaultCategory, 60),
            status: row.status,
            lastMaintenanceDate: cleanDate,
            notes: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

      onSuccess(validEntries.length);
    } catch (err) {
      setSubmitError('Gagal menyimpan data mesin massal. Periksa koneksi atau hak akses admin.');
      handleFirestoreError(err, OperationType.CREATE, 'machines');
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
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Tambah Banyak Mesin Hemodialisa
              </h3>
              <p className="text-xs text-slate-500">
                Format kolom mengikuti spreadsheet: No, NAMA MESIN, Kategori, Status, dan Merk &amp; Model.
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
                <Activity className="h-3.5 w-3.5" />
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 items-end text-xs">
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Kategori</label>
              <input
                type="text"
                list="machine-category-suggestions"
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
                placeholder="REGULER"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
              <datalist id="machine-category-suggestions">
                {MACHINE_CATEGORY_SUGGESTIONS.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Status</label>
              <select
                value={defaultStatus}
                onChange={(e) => setDefaultStatus(e.target.value as MachineStatus)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {MACHINE_STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st === 'Ready' ? 'Ready (Aktif)' : st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Default Merk &amp; Model</label>
              <input
                type="text"
                value={defaultBrand}
                onChange={(e) => setDefaultBrand(e.target.value)}
                placeholder="SAS 1000"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Tgl Maintenance</label>
              <input
                type="date"
                value={defaultMaintenanceDate}
                onChange={(e) => setDefaultMaintenanceDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={applyDefaultsToAll}
                className="w-full rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
              >
                Terapkan Default ke Baris
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
                  No | NAMA MESIN | Kategori | Status | Merk &amp; Model
                </p>
                <p className="text-[11px] text-slate-500">
                  Status <code className="font-mono">AKTIF</code> otomatis dipetakan menjadi{' '}
                  <code className="font-mono">Ready</code> agar sesuai dengan status unit HD.
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
                    '1\tA01\tREGULER\tAKTIF\tSAS 1000\n2\tA02\tREGULER\tAKTIF\tSAS 1000\n3\tB01\tREGULER\tAKTIF\tSAS 1000'
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
                Sheets atau Excel ke kolom <strong>NAMA MESIN</strong>.
              </p>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2.5 font-semibold w-10 text-center">No</th>
                      <th className="px-2 py-2.5 font-semibold w-40">NAMA MESIN *</th>
                      <th className="px-2 py-2.5 font-semibold w-44">KATEGORI</th>
                      <th className="px-2 py-2.5 font-semibold w-40">STATUS</th>
                      <th className="px-2 py-2.5 font-semibold w-56">MERK &amp; MODEL *</th>
                      <th className="px-2 py-2.5 font-semibold w-12 text-center">AKSI</th>
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
                                value={row.machineNumber}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'machineNumber', e.target.value)
                                }
                                onPaste={(e) => handleTablePaste(e, idx)}
                                placeholder="A01"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                list="machine-category-suggestions"
                                value={row.roomZone}
                                onChange={(e) => updateRow(row.rowKey, 'roomZone', e.target.value)}
                                placeholder="REGULER"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.status}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'status', e.target.value as MachineStatus)
                                }
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                {MACHINE_STATUS_OPTIONS.map((st) => (
                                  <option key={st} value={st}>
                                    {st === 'Ready' ? 'Ready (Aktif)' : st}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.brand}
                                onChange={(e) => updateRow(row.rowKey, 'brand', e.target.value)}
                                placeholder="SAS 1000"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
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
                              <td colSpan={5} className="px-2 pb-2 pt-0.5 text-[11px] text-rose-700 font-medium">
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
              Mesin berstatus Ready akan langsung tersedia di pilihan Bed/Mesin pada halaman Logbook.
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
                  <Activity className="h-3.5 w-3.5" />
                  {saving
                    ? `Menyimpan ${summary.validCount} Mesin...`
                    : `Simpan ${summary.validCount} Mesin`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

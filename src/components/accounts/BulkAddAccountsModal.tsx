import React, { useMemo, useRef, useState } from 'react';
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
import { useAuth } from '../../context/AuthContext';
import { clampString, exportToCsv } from '../../lib/formatters';
import { USER_ROLES, type UserProfile, type UserRole } from '../../types';

interface BulkAccountDraftRow {
  rowKey: string;
  fullName: string;
  nip: string;
  email: string;
  password: string;
  role: UserRole;
  phone: string;
  specialization: string;
  serverError?: string;
}

interface BulkAddAccountsModalProps {
  existingUsers: UserProfile[];
  onClose: () => void;
  onSuccess: (createdCount: number) => void;
}

function createRowKey(): string {
  return `acc-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRow(defaults: {
  role: UserRole;
  specialization: string;
}): BulkAccountDraftRow {
  return {
    rowKey: createRowKey(),
    fullName: '',
    nip: '',
    email: '',
    password: '',
    role: defaults.role,
    phone: '',
    specialization: defaults.specialization,
  };
}

function normalizeRole(raw: string, fallback: UserRole): UserRole {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return fallback;
  if (s === 'administrator' || s === 'admin') return 'Administrator';
  if (s === 'managerial' || s === 'manajerial' || s === 'manajer') return 'Managerial';
  if (s === 'kepala ruang' || s === 'karu' || s === 'kepala ruangan') return 'Kepala Ruang';
  if (
    s === 'pj shift' ||
    s === 'pj shif' ||
    s === 'pj' ||
    s.startsWith('pj shif') ||
    s.includes('penanggung jawab shift')
  ) {
    return 'PJ Shift';
  }
  if (s === 'perawat pelaksana' || s === 'perawat' || s === 'pelaksana') {
    return 'Perawat Pelaksana';
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
  const joined = cells.slice(0, 8).join(' ').toLowerCase();
  return (
    joined.includes('nama lengkap') ||
    joined.includes('email login') ||
    joined.includes('hak akses') ||
    joined.includes('sertifikasi') ||
    (joined.includes('nip') && joined.includes('password'))
  );
}

function parseSpreadsheetTextToRows(
  rawText: string,
  defaults: {
    role: UserRole;
    specialization: string;
  }
): BulkAccountDraftRow[] {
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
    const looksLikeNoIndex = /^\d{1,4}\.?$/.test(col0) && col1.length > 0 && !col1.includes('@');
    const offset = headerHasNo || looksLikeNoIndex ? 1 : 0;

    return {
      rowKey: createRowKey(),
      fullName: cells[offset] || '',
      nip: cells[offset + 1] || '',
      email: (cells[offset + 2] || '').trim().toLowerCase(),
      password: cells[offset + 3] || '',
      role: normalizeRole(cells[offset + 4] || '', defaults.role),
      phone: cells[offset + 5] || '',
      specialization: (cells[offset + 6] || '').trim() || defaults.specialization,
    };
  });
}

export function BulkAddAccountsModal({
  existingUsers,
  onClose,
  onSuccess,
}: BulkAddAccountsModalProps) {
  const { adminBulkCreateAccounts } = useAuth();
  const [activeTab, setActiveTab] = useState<'table' | 'import'>('table');
  const [defaultRole, setDefaultRole] = useState<UserRole>('Perawat Pelaksana');
  const [defaultSpecialization, setDefaultSpecialization] = useState('Perawat Hemodialisa');

  const [rows, setRows] = useState<BulkAccountDraftRow[]>(() =>
    Array.from({ length: 5 }, () =>
      createEmptyRow({
        role: 'Perawat Pelaksana',
        specialization: 'Perawat Hemodialisa',
      })
    )
  );

  const [rawImportText, setRawImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitInfo, setSubmitInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const existingEmailSet = useMemo(() => {
    const set = new Set<string>();
    existingUsers.forEach((u) => {
      const key = u.email.trim().toLowerCase();
      if (key) set.add(key);
    });
    return set;
  }, [existingUsers]);

  const existingNipSet = useMemo(() => {
    const set = new Set<string>();
    existingUsers.forEach((u) => {
      const key = u.nip.trim().toLowerCase();
      if (key) set.add(key);
    });
    return set;
  }, [existingUsers]);

  const rowEvaluations = useMemo(() => {
    const emailCounts = new Map<string, number>();
    const nipCounts = new Map<string, number>();

    rows.forEach((r) => {
      const isBlank = !r.fullName.trim() && !r.nip.trim() && !r.email.trim() && !r.password;
      if (isBlank) return;

      const emailKey = r.email.trim().toLowerCase();
      if (emailKey) emailCounts.set(emailKey, (emailCounts.get(emailKey) || 0) + 1);

      const nipKey = r.nip.trim().toLowerCase();
      if (nipKey) nipCounts.set(nipKey, (nipCounts.get(nipKey) || 0) + 1);
    });

    return rows.map((r) => {
      const isBlank = !r.fullName.trim() && !r.nip.trim() && !r.email.trim() && !r.password;
      if (isBlank) {
        return { isBlank: true, errors: [] as string[] };
      }

      const errors: string[] = [];
      const cleanName = r.fullName.trim();
      const cleanNip = r.nip.trim();
      const cleanEmail = r.email.trim().toLowerCase();
      const cleanPhone = r.phone.trim();
      const cleanSpec = r.specialization.trim();

      if (cleanName.length < 2 || cleanName.length > 120) {
        errors.push('Nama wajib 2–120 karakter');
      }
      if (cleanNip.length < 1 || cleanNip.length > 40) {
        errors.push('NIP wajib 1–40 karakter');
      } else {
        const nipKey = cleanNip.toLowerCase();
        if (existingNipSet.has(nipKey)) {
          errors.push('NIP sudah terdaftar');
        } else if ((nipCounts.get(nipKey) || 0) > 1) {
          errors.push('NIP duplikat di daftar ini');
        }
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 200) {
        errors.push('Format email login tidak valid');
      } else if (existingEmailSet.has(cleanEmail)) {
        errors.push('Email sudah terdaftar di Data Akun');
      } else if ((emailCounts.get(cleanEmail) || 0) > 1) {
        errors.push('Email duplikat di daftar ini');
      }

      if (r.password.length < 6 || r.password.length > 128) {
        errors.push('Password minimal 6 karakter');
      }

      if (!USER_ROLES.includes(r.role)) {
        errors.push('Role tidak valid');
      }

      if (cleanPhone.length > 30) {
        errors.push('No HP maks 30 karakter');
      }

      if (cleanSpec.length > 100) {
        errors.push('Sertifikasi maks 100 karakter');
      }

      if (r.serverError) {
        errors.push(r.serverError);
      }

      return { isBlank: false, errors };
    });
  }, [rows, existingEmailSet, existingNipSet]);

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

  const updateRow = <K extends keyof BulkAccountDraftRow>(
    rowKey: string,
    field: K,
    value: BulkAccountDraftRow[K]
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.rowKey === rowKey ? { ...r, [field]: value, serverError: undefined } : r
      )
    );
  };

  const addRows = (count: number) => {
    const created = Array.from({ length: count }, () =>
      createEmptyRow({
        role: defaultRole,
        specialization: defaultSpecialization,
      })
    );
    setRows((prev) => [...prev, ...created]);
  };

  const removeRow = (rowKey: string) => {
    setRows((prev) => {
      if (prev.length <= 1) {
        return [createEmptyRow({ role: defaultRole, specialization: defaultSpecialization })];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
  };

  const clearBlankRows = () => {
    setRows((prev) => {
      const nonEmpty = prev.filter(
        (r) => r.fullName.trim() || r.nip.trim() || r.email.trim() || r.password
      );
      if (nonEmpty.length === 0) {
        return [createEmptyRow({ role: defaultRole, specialization: defaultSpecialization })];
      }
      return nonEmpty;
    });
  };

  const applyDefaultsToAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        role: defaultRole,
        specialization: defaultSpecialization,
        serverError: undefined,
      }))
    );
  };

  const handleDownloadTemplate = () => {
    exportToCsv(
      'template-akun-staf-hd.csv',
      [
        'NO',
        'NAMA LENGKAP & GELAR',
        'NIP',
        'EMAIL LOGIN',
        'PASSWORD',
        'HAK AKSES (ROLE)',
        'NO HP',
        'SERTIFIKASI/KOMPETENSI',
      ],
      [
        [
          1,
          'TWIS FERTILIANTI PW',
          'PR-0001',
          'twis@hdhl.com',
          'twis12345',
          'Kepala Ruang',
          '082221481548',
          'Perawat Hemodialisa',
        ],
        [
          2,
          'M HAIKAL MALILANG',
          'PR-0002',
          'haikal@hdhl.com',
          'haikal12345',
          'PJ Shift',
          '089530066262',
          'Perawat Hemodialisa',
        ],
        [
          3,
          'Y BRILLISANTO',
          'PR-0008',
          'brilli@hdhl.com',
          'brilli12345',
          'Perawat Pelaksana',
          '085122604654',
          'Perawat Hemodialisa',
        ],
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
    setSubmitInfo(null);

    const mappedRows = parseSpreadsheetTextToRows(rawImportText, {
      role: defaultRole,
      specialization: defaultSpecialization,
    });

    if (mappedRows.length === 0) {
      setImportFeedback('Tidak ada baris data akun yang valid untuk diproses.');
      return;
    }

    setRows((prev) => {
      const existingNonEmpty = prev.filter(
        (r) => r.fullName.trim() || r.nip.trim() || r.email.trim() || r.password
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
      role: defaultRole,
      specialization: defaultSpecialization,
    });
    if (parsedRows.length === 0) return;

    e.preventDefault();
    setSubmitError(null);
    setSubmitInfo(null);
    setRows((prev) => {
      const before = prev.slice(0, targetRowIdx);
      const remainingAfter = prev
        .slice(targetRowIdx + parsedRows.length)
        .filter((r) => r.fullName.trim() || r.nip.trim() || r.email.trim() || r.password);
      return [...before, ...parsedRows, ...remainingAfter];
    });
  };

  const handleSaveAll = async () => {
    setSubmitError(null);
    setSubmitInfo(null);

    if (summary.invalidCount > 0) {
      setSubmitError('Masih ada baris yang belum valid. Perbaiki kolom bertanda merah terlebih dahulu.');
      return;
    }

    const validEntries = rows
      .map((row, idx) => ({ row, idx, evalResult: rowEvaluations[idx] }))
      .filter(
        ({ evalResult }) => evalResult && !evalResult.isBlank && evalResult.errors.length === 0
      );

    if (validEntries.length === 0) {
      setSubmitError('Isi minimal satu data akun sebelum membuat akun.');
      return;
    }

    if (validEntries.length > 100) {
      setSubmitError('Maksimal 100 akun dalam satu kali proses pembuatan massal.');
      return;
    }

    setSaving(true);
    try {
      const payload = validEntries.map(({ row, idx }) => ({
        rowIndex: idx,
        fullName: clampString(row.fullName, 120),
        nip: clampString(row.nip, 40),
        email: clampString(row.email.toLowerCase(), 200),
        password: row.password,
        role: row.role,
        phone: clampString(row.phone, 30),
        specialization: clampString(row.specialization || defaultSpecialization, 100),
      }));

      const response = await adminBulkCreateAccounts(payload);

      if (response.failedCount === 0) {
        onSuccess(response.createdCount);
        return;
      }

      const failedMap = new Map<number, string>();
      response.results.forEach((res) => {
        if (!res.ok) {
          failedMap.set(res.rowIndex, res.error || 'Gagal membuat akun.');
        }
      });

      setRows((prev) =>
        prev.flatMap((row, idx): BulkAccountDraftRow[] => {
          const err = failedMap.get(idx);
          if (!err) return [];
          return [{ ...row, serverError: err }];
        })
      );

      if (response.createdCount > 0) {
        setSubmitInfo(
          `${response.createdCount} akun berhasil dibuat di Supabase Authentication & Database.`
        );
      }
      setSubmitError(
        `${response.failedCount} akun gagal dibuat. Periksa pesan error pada baris tersisa lalu coba lagi.`
      );
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal membuat banyak akun staf.');
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
                Buat Banyak Akun Staf (Supabase Auth + Data Akun)
              </h3>
              <p className="text-xs text-slate-500">
                Format kolom mengikuti spreadsheet: NO, NAMA LENGKAP &amp; GELAR, NIP, EMAIL LOGIN,
                PASSWORD, HAK AKSES (ROLE), NO HP, dan SERTIFIKASI/KOMPETENSI.
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end text-xs">
            <div>
              <label className="block font-medium text-slate-600 mb-1">
                Default Hak Akses (Role)
              </label>
              <select
                value={defaultRole}
                onChange={(e) => setDefaultRole(e.target.value as UserRole)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">
                Default Sertifikasi / Kompetensi
              </label>
              <input
                type="text"
                value={defaultSpecialization}
                onChange={(e) => setDefaultSpecialization(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
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
                  NO | NAMA LENGKAP &amp; GELAR | NIP | EMAIL LOGIN | PASSWORD | HAK AKSES (ROLE) | NO HP | SERTIFIKASI/KOMPETENSI
                </p>
                <p className="text-[11px] text-slate-500">
                  Penulisan role seperti <code className="font-mono">PJ Shif</code> atau{' '}
                  <code className="font-mono">PJ Shift</code>,{' '}
                  <code className="font-mono">Kepala Ruang</code>, dan{' '}
                  <code className="font-mono">Perawat Pelaksana</code> akan otomatis disesuaikan
                  dengan hak akses sistem.
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
                    '1\tTWIS FERTILIANTI PW\tPR-0001\ttwis@hdhl.com\ttwis12345\tKepala Ruang\t082221481548\tPerawat Hemodialisa\n2\tM HAIKAL MALILANG\tPR-0002\thaikal@hdhl.com\thaikal12345\tPJ Shift\t089530066262\tPerawat Hemodialisa'
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
                Sheets atau Excel ke kolom <strong>NAMA LENGKAP &amp; GELAR</strong>. Setiap baris
                otomatis dibuatkan akun di <strong>Supabase Authentication</strong> &amp;{' '}
                <strong>Data Akun</strong>.
              </p>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1060px] text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2.5 font-semibold w-10 text-center">NO</th>
                      <th className="px-2 py-2.5 font-semibold w-52">NAMA LENGKAP &amp; GELAR *</th>
                      <th className="px-2 py-2.5 font-semibold w-28">NIP *</th>
                      <th className="px-2 py-2.5 font-semibold w-44">EMAIL LOGIN *</th>
                      <th className="px-2 py-2.5 font-semibold w-32">PASSWORD *</th>
                      <th className="px-2 py-2.5 font-semibold w-40">HAK AKSES (ROLE) *</th>
                      <th className="px-2 py-2.5 font-semibold w-32">NO HP</th>
                      <th className="px-2 py-2.5 font-semibold w-44">SERTIFIKASI/KOMPETENSI</th>
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
                                placeholder="TWIS FERTILIANTI PW"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.nip}
                                onChange={(e) => updateRow(row.rowKey, 'nip', e.target.value)}
                                placeholder="PR-0001"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="email"
                                value={row.email}
                                onChange={(e) => updateRow(row.rowKey, 'email', e.target.value)}
                                placeholder="twis@hdhl.com"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.password}
                                onChange={(e) => updateRow(row.rowKey, 'password', e.target.value)}
                                placeholder="Min. 6 karakter"
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <select
                                value={row.role}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'role', e.target.value as UserRole)
                                }
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                              >
                                {USER_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.phone}
                                onChange={(e) => updateRow(row.rowKey, 'phone', e.target.value)}
                                placeholder="0822..."
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none"
                              />
                            </td>
                            <td className="px-1.5 py-2">
                              <input
                                type="text"
                                value={row.specialization}
                                onChange={(e) =>
                                  updateRow(row.rowKey, 'specialization', e.target.value)
                                }
                                placeholder="Perawat Hemodialisa"
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
                              <td colSpan={8} className="px-2 pb-2 pt-0.5 text-[11px] text-rose-700 font-medium">
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
          {submitInfo && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-medium text-teal-800">
              {submitInfo}
            </div>
          )}
          {submitError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700">
              {submitError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">
              Akun yang dibuat otomatis aktif dan terdaftar di Supabase Authentication.
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
                  <Users className="h-3.5 w-3.5" />
                  {saving
                    ? `Membuat ${summary.validCount} Akun...`
                    : `Buat ${summary.validCount} Akun Staf`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

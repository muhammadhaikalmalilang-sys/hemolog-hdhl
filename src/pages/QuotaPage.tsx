import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { extractDbErrorCode, extractDbErrorMessage, requireSupabase } from '../lib/supabase';

type QuotaPlanId = 'free_500mb' | 'pro_8gb' | 'custom';

interface TableStorageRow {
  tableName: string;
  label: string;
  rowCount: number;
  dataBytes: number;
  indexBytes: number;
  totalBytes: number;
}

interface QuotaSnapshot {
  mode: 'rpc' | 'fallback';
  databaseBytes: number;
  tables: TableStorageRow[];
  measuredAt: string;
  sampledLogbookBytes: number | null;
  sampledLogbookCount: number;
  recent30DaysLogbooks: number;
  recent7DaysLogbooks: number;
}

interface StoredQuotaPrefs {
  planId: QuotaPlanId;
  customQuotaMb: number;
}

const PREFS_STORAGE_KEY = 'hemolog_quota_prefs_v1';
const SAFE_UTILIZATION_RATIO = 0.9; // Sisakan 10% headroom untuk WAL/vacuum/index PostgreSQL
const DEFAULT_LOGBOOK_BYTES_PER_ROW = 4800; // Estimasi realistis 1 baris logbook + JSONB wizard + 6 index
const FALLBACK_PG_BASE_OVERHEAD_BYTES = 28 * 1024 * 1024; // ~28 MB skema sistem, auth, pg_catalog Supabase

const TABLE_METADATA: ReadonlyArray<{
  tableName: string;
  label: string;
  fallbackAvgBytesPerRow: number;
}> = [
  { tableName: 'logbook', label: 'Logbook Tindakan HD/HL', fallbackAvgBytesPerRow: DEFAULT_LOGBOOK_BYTES_PER_ROW },
  { tableName: 'reports', label: 'Laporan PJ Shift & Bulanan', fallbackAvgBytesPerRow: 2800 },
  { tableName: 'patients', label: 'Data Pasien', fallbackAvgBytesPerRow: 1100 },
  { tableName: 'schedules', label: 'Jadwal Dinas Perawat', fallbackAvgBytesPerRow: 750 },
  { tableName: 'doctor_schedules', label: 'Jadwal Dokter DPJP & Jaga', fallbackAvgBytesPerRow: 650 },
  { tableName: 'pj_shift_assignments', label: 'Penunjukan PJ Shift', fallbackAvgBytesPerRow: 550 },
  { tableName: 'doctors', label: 'Data Dokter', fallbackAvgBytesPerRow: 600 },
  { tableName: 'machines', label: 'Data Mesin HD', fallbackAvgBytesPerRow: 600 },
  { tableName: 'users', label: 'Akun Pengguna', fallbackAvgBytesPerRow: 850 },
  { tableName: 'staff_directory', label: 'Direktori Staf Unit', fallbackAvgBytesPerRow: 650 },
  { tableName: 'logbook_locks', label: 'Kunci Harian Logbook', fallbackAvgBytesPerRow: 500 },
  { tableName: 'machine_locks', label: 'Kunci Mesin per Shift', fallbackAvgBytesPerRow: 500 },
  { tableName: 'action_categories', label: 'Kategori Tindakan', fallbackAvgBytesPerRow: 550 },
  { tableName: 'form_templates', label: 'Template Formulir', fallbackAvgBytesPerRow: 3500 },
];

const RPC_INSTALL_SQL = `-- Jalankan di Supabase SQL Editor (hanya sekali) untuk pengukuran byte database secara presisi
CREATE OR REPLACE FUNCTION public.app_get_storage_quota()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_db_bytes bigint;
  v_tables jsonb;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Hanya Administrator yang berhak mengakses statistik kuota database.'
      USING ERRCODE = '42501';
  END IF;

  v_db_bytes := pg_database_size(current_database());

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.total_bytes DESC), '[]'::jsonb)
  INTO v_tables
  FROM (
    SELECT
      'logbook'::text AS table_name,
      (SELECT count(*) FROM public.logbook)::bigint AS row_count,
      pg_table_size('public.logbook'::regclass)::bigint AS data_bytes,
      pg_indexes_size('public.logbook'::regclass)::bigint AS index_bytes,
      pg_total_relation_size('public.logbook'::regclass)::bigint AS total_bytes
    UNION ALL SELECT 'reports', (SELECT count(*) FROM public.reports), pg_table_size('public.reports'::regclass), pg_indexes_size('public.reports'::regclass), pg_total_relation_size('public.reports'::regclass)
    UNION ALL SELECT 'patients', (SELECT count(*) FROM public.patients), pg_table_size('public.patients'::regclass), pg_indexes_size('public.patients'::regclass), pg_total_relation_size('public.patients'::regclass)
    UNION ALL SELECT 'schedules', (SELECT count(*) FROM public.schedules), pg_table_size('public.schedules'::regclass), pg_indexes_size('public.schedules'::regclass), pg_total_relation_size('public.schedules'::regclass)
    UNION ALL SELECT 'doctor_schedules', (SELECT count(*) FROM public.doctor_schedules), pg_table_size('public.doctor_schedules'::regclass), pg_indexes_size('public.doctor_schedules'::regclass), pg_total_relation_size('public.doctor_schedules'::regclass)
    UNION ALL SELECT 'pj_shift_assignments', (SELECT count(*) FROM public.pj_shift_assignments), pg_table_size('public.pj_shift_assignments'::regclass), pg_indexes_size('public.pj_shift_assignments'::regclass), pg_total_relation_size('public.pj_shift_assignments'::regclass)
    UNION ALL SELECT 'doctors', (SELECT count(*) FROM public.doctors), pg_table_size('public.doctors'::regclass), pg_indexes_size('public.doctors'::regclass), pg_total_relation_size('public.doctors'::regclass)
    UNION ALL SELECT 'machines', (SELECT count(*) FROM public.machines), pg_table_size('public.machines'::regclass), pg_indexes_size('public.machines'::regclass), pg_total_relation_size('public.machines'::regclass)
    UNION ALL SELECT 'users', (SELECT count(*) FROM public.users), pg_table_size('public.users'::regclass), pg_indexes_size('public.users'::regclass), pg_total_relation_size('public.users'::regclass)
    UNION ALL SELECT 'staff_directory', (SELECT count(*) FROM public.staff_directory), pg_table_size('public.staff_directory'::regclass), pg_indexes_size('public.staff_directory'::regclass), pg_total_relation_size('public.staff_directory'::regclass)
    UNION ALL SELECT 'logbook_locks', (SELECT count(*) FROM public.logbook_locks), pg_table_size('public.logbook_locks'::regclass), pg_indexes_size('public.logbook_locks'::regclass), pg_total_relation_size('public.logbook_locks'::regclass)
    UNION ALL SELECT 'machine_locks', (SELECT count(*) FROM public.machine_locks), pg_table_size('public.machine_locks'::regclass), pg_indexes_size('public.machine_locks'::regclass), pg_total_relation_size('public.machine_locks'::regclass)
    UNION ALL SELECT 'action_categories', (SELECT count(*) FROM public.action_categories), pg_table_size('public.action_categories'::regclass), pg_indexes_size('public.action_categories'::regclass), pg_total_relation_size('public.action_categories'::regclass)
    UNION ALL SELECT 'form_templates', (SELECT count(*) FROM public.form_templates), pg_table_size('public.form_templates'::regclass), pg_indexes_size('public.form_templates'::regclass), pg_total_relation_size('public.form_templates'::regclass)
  ) t;

  RETURN jsonb_build_object(
    'databaseBytes', v_db_bytes,
    'tables', v_tables,
    'measuredAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_storage_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_storage_quota() TO authenticated, service_role;`;

function loadPrefs(): StoredQuotaPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { planId: 'free_500mb', customQuotaMb: 500 };
    const parsed = JSON.parse(raw) as Partial<StoredQuotaPrefs>;
    const planId: QuotaPlanId =
      parsed.planId === 'pro_8gb' || parsed.planId === 'custom' ? parsed.planId : 'free_500mb';
    const customQuotaMb =
      typeof parsed.customQuotaMb === 'number' && Number.isFinite(parsed.customQuotaMb)
        ? Math.max(50, Math.min(102400, Math.round(parsed.customQuotaMb)))
        : 500;
    return { planId, customQuotaMb };
  } catch {
    return { planId: 'free_500mb', customQuotaMb: 500 };
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString('id-ID', { maximumFractionDigits: 1 })} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;
  const gb = mb / 1024;
  return `${gb.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  return Math.floor(n).toLocaleString('id-ID');
}

function formatDurationProjection(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '0 hari';
  if (days >= 3650) return '> 10 tahun';
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return months > 0 ? `± ${years} thn ${months} bln` : `± ${years} tahun`;
  }
  if (days >= 60) {
    const months = Math.floor(days / 30);
    const remDays = Math.round(days % 30);
    return remDays > 0 ? `± ${months} bln ${remDays} hr` : `± ${months} bulan`;
  }
  return `± ${Math.round(days)} hari`;
}

function toIsoDateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isMissingRpcError(error: unknown): boolean {
  const code = extractDbErrorCode(error);
  const msg = extractDbErrorMessage(error).toLowerCase();
  return (
    code === 'pgrst202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('app_get_storage_quota')
  );
}

export const QuotaPage: React.FC = () => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();

  const initialPrefs = useMemo(() => loadPrefs(), []);
  const [planId, setPlanId] = useState<QuotaPlanId>(initialPrefs.planId);
  const [customQuotaMb, setCustomQuotaMb] = useState<number>(initialPrefs.customQuotaMb);

  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [simDailyInput, setSimDailyInput] = useState<string>('');
  const [simKbPerLogbook, setSimKbPerLogbook] = useState<string>('');
  const [showRpcGuide, setShowRpcGuide] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const isAdmin = userProfile?.role === 'Administrator';

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({ planId, customQuotaMb })
      );
    } catch {
      // Ignore storage quota issues
    }
  }, [planId, customQuotaMb]);

  const fetchQuotaSnapshot = useCallback(async (isManualRefresh = false) => {
    if (!isAdmin) return;
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage('');

    try {
      const supabase = requireSupabase();
      const date30DaysAgo = toIsoDateOffset(29);
      const date7DaysAgo = toIsoDateOffset(6);

      const [rpcRes, count30Res, count7Res, sampleRes] = await Promise.all([
        supabase.rpc('app_get_storage_quota'),
        supabase
          .from('logbook')
          .select('id', { count: 'exact', head: true })
          .gte('date', date30DaysAgo),
        supabase
          .from('logbook')
          .select('id', { count: 'exact', head: true })
          .gte('date', date7DaysAgo),
        supabase
          .from('logbook')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const recent30DaysLogbooks = count30Res.count ?? 0;
      const recent7DaysLogbooks = count7Res.count ?? 0;

      let sampledLogbookBytes: number | null = null;
      let sampledLogbookCount = 0;
      if (!sampleRes.error && Array.isArray(sampleRes.data) && sampleRes.data.length > 0) {
        const encoder = new TextEncoder();
        const totalPayloadBytes = sampleRes.data.reduce((sum, row) => {
          return sum + encoder.encode(JSON.stringify(row)).length;
        }, 0);
        sampledLogbookCount = sampleRes.data.length;
        sampledLogbookBytes = Math.round(totalPayloadBytes / sampledLogbookCount);
      }

      if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
        const payload = rpcRes.data as {
          databaseBytes?: number;
          tables?: Array<{
            table_name: string;
            row_count: number;
            data_bytes: number;
            index_bytes: number;
            total_bytes: number;
          }>;
          measuredAt?: string;
        };

        const rawTables = Array.isArray(payload.tables) ? payload.tables : [];
        const labelMap = new Map(TABLE_METADATA.map((t) => [t.tableName, t.label]));
        const tables: TableStorageRow[] = rawTables
          .map((t) => ({
            tableName: t.table_name,
            label: labelMap.get(t.table_name) || t.table_name,
            rowCount: Number(t.row_count) || 0,
            dataBytes: Number(t.data_bytes) || 0,
            indexBytes: Number(t.index_bytes) || 0,
            totalBytes: Number(t.total_bytes) || 0,
          }))
          .sort((a, b) => b.totalBytes - a.totalBytes);

        setSnapshot({
          mode: 'rpc',
          databaseBytes: Number(payload.databaseBytes) || 0,
          tables,
          measuredAt: payload.measuredAt || new Date().toISOString(),
          sampledLogbookBytes,
          sampledLogbookCount,
          recent30DaysLogbooks,
          recent7DaysLogbooks,
        });
        return;
      }

      // If RPC fails for a non-missing reason (e.g. network), surface error unless missing RPC
      if (rpcRes.error && !isMissingRpcError(rpcRes.error)) {
        throw rpcRes.error;
      }

      // Tier-2 Graceful Fallback: exact row counts per table + measured sample payload size
      const countResults = await Promise.all(
        TABLE_METADATA.map(async (meta) => {
          const res = await supabase
            .from(meta.tableName)
            .select('*', { count: 'exact', head: true });
          return {
            meta,
            count: res.error ? 0 : res.count ?? 0,
          };
        })
      );

      // PostgreSQL row header + TOAST + 6 indexes overhead factor ~1.75x JSON payload
      const estimatedLogbookPerRow = sampledLogbookBytes
        ? Math.max(2400, Math.round(sampledLogbookBytes * 1.75))
        : DEFAULT_LOGBOOK_BYTES_PER_ROW;

      const tables: TableStorageRow[] = countResults
        .map(({ meta, count }) => {
          const avgRowBytes =
            meta.tableName === 'logbook' ? estimatedLogbookPerRow : meta.fallbackAvgBytesPerRow;
          const totalBytes = count * avgRowBytes;
          const dataBytes = Math.round(totalBytes * 0.68);
          const indexBytes = totalBytes - dataBytes;
          return {
            tableName: meta.tableName,
            label: meta.label,
            rowCount: count,
            dataBytes,
            indexBytes,
            totalBytes,
          };
        })
        .sort((a, b) => b.totalBytes - a.totalBytes);

      const sumTableBytes = tables.reduce((acc, row) => acc + row.totalBytes, 0);
      setSnapshot({
        mode: 'fallback',
        databaseBytes: FALLBACK_PG_BASE_OVERHEAD_BYTES + sumTableBytes,
        tables,
        measuredAt: new Date().toISOString(),
        sampledLogbookBytes,
        sampledLogbookCount,
        recent30DaysLogbooks,
        recent7DaysLogbooks,
      });
    } catch (err) {
      setErrorMessage(
        extractDbErrorMessage(err) || 'Gagal mengambil statistik penyimpanan Supabase.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void fetchQuotaSnapshot(false);
  }, [fetchQuotaSnapshot]);

  const quotaLimitMb = useMemo(() => {
    if (planId === 'pro_8gb') return 8192;
    if (planId === 'custom') return Math.max(50, customQuotaMb);
    return 500;
  }, [planId, customQuotaMb]);

  const quotaLimitBytes = quotaLimitMb * 1024 * 1024;
  const safeQuotaBytes = Math.floor(quotaLimitBytes * SAFE_UTILIZATION_RATIO);

  const metrics = useMemo(() => {
    if (!snapshot) return null;

    const logbookTable = snapshot.tables.find((t) => t.tableName === 'logbook');
    const logbookRows = logbookTable?.rowCount ?? 0;
    const logbookTableBytes = logbookTable?.totalBytes ?? 0;

    const publicTablesBytes = snapshot.tables.reduce((acc, t) => acc + t.totalBytes, 0);
    const systemOverheadBytes = Math.max(0, snapshot.databaseBytes - publicTablesBytes);

    // Hitung ukuran efektif per 1 baris logbook:
    // Prioritaskan rata-rata aktual PostgreSQL jika tabel logbook sudah >= 25 baris di mode RPC,
    // karena pada tabel kecil pg_table_size + index minimum block allocation (8KB pages) terlihat lebih besar.
    const rawAvgTableBytesPerRow =
      logbookRows > 0 ? Math.round(logbookTableBytes / logbookRows) : DEFAULT_LOGBOOK_BYTES_PER_ROW;
    const measuredPayloadFactorBytes = snapshot.sampledLogbookBytes
      ? Math.max(2400, Math.round(snapshot.sampledLogbookBytes * 1.75))
      : DEFAULT_LOGBOOK_BYTES_PER_ROW;

    let actualBytesPerLogbook = DEFAULT_LOGBOOK_BYTES_PER_ROW;
    if (snapshot.mode === 'rpc' && logbookRows >= 25) {
      actualBytesPerLogbook = Math.max(2200, rawAvgTableBytesPerRow);
    } else if (snapshot.sampledLogbookBytes) {
      actualBytesPerLogbook = measuredPayloadFactorBytes;
    } else if (logbookRows > 0) {
      actualBytesPerLogbook = Math.min(12288, Math.max(2800, rawAvgTableBytesPerRow));
    }

    const parsedOverrideKb = Number(simKbPerLogbook);
    const effectiveBytesPerLogbook =
      simKbPerLogbook.trim() !== '' && Number.isFinite(parsedOverrideKb) && parsedOverrideKb >= 0.5
        ? Math.round(parsedOverrideKb * 1024)
        : actualBytesPerLogbook;

    const remainingBytesHard = Math.max(0, quotaLimitBytes - snapshot.databaseBytes);
    const remainingBytesSafe = Math.max(0, safeQuotaBytes - snapshot.databaseBytes);

    const remainingLogbooksHard = Math.floor(remainingBytesHard / effectiveBytesPerLogbook);
    const remainingLogbooksSafe = Math.floor(remainingBytesSafe / effectiveBytesPerLogbook);

    const usedPercent = Math.min(100, (snapshot.databaseBytes / quotaLimitBytes) * 100);
    const rawAvgDaily = snapshot.recent30DaysLogbooks > 0 ? snapshot.recent30DaysLogbooks / 30 : 0;
    const parsedSimDaily = Number(simDailyInput);
    const effectiveDailyRate =
      simDailyInput.trim() !== '' && Number.isFinite(parsedSimDaily) && parsedSimDaily > 0
        ? parsedSimDaily
        : rawAvgDaily > 0
          ? rawAvgDaily
          : 20;

    const daysRemainingSafe =
      effectiveDailyRate > 0 ? remainingLogbooksSafe / effectiveDailyRate : 0;
    const daysRemainingHard =
      effectiveDailyRate > 0 ? remainingLogbooksHard / effectiveDailyRate : 0;

    return {
      logbookRows,
      logbookTable,
      publicTablesBytes,
      systemOverheadBytes,
      actualBytesPerLogbook,
      effectiveBytesPerLogbook,
      remainingBytesHard,
      remainingBytesSafe,
      remainingLogbooksHard,
      remainingLogbooksSafe,
      usedPercent,
      rawAvgDaily,
      effectiveDailyRate,
      daysRemainingSafe,
      daysRemainingHard,
    };
  }, [snapshot, quotaLimitBytes, safeQuotaBytes, simDailyInput, simKbPerLogbook]);

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(RPC_INSTALL_SQL);
      setCopiedSql(true);
      showToast('Skrip SQL RPC pengukuran kuota berhasil disalin.', 'success');
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      showToast('Gagal menyalin ke clipboard.', 'error');
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white p-6 text-center">
        <p className="text-sm font-semibold text-slate-900">Akses Terbatas</p>
        <p className="mt-1 text-xs text-slate-500">
          Menu Kuota hanya tersedia untuk akun Administrator.
        </p>
      </div>
    );
  }

  const barColorClass =
    (metrics?.usedPercent ?? 0) >= 90
      ? 'bg-rose-600'
      : (metrics?.usedPercent ?? 0) >= 70
        ? 'bg-amber-500'
        : 'bg-[#0B5A8E]';

  const statusText =
    (metrics?.usedPercent ?? 0) >= 90
      ? 'Kritis — Segera perluas paket atau arsipkan data lama'
      : (metrics?.usedPercent ?? 0) >= 70
        ? 'Perhatian — Pemakaian mendekati batas kapasitas'
        : 'Normal — Kapasitas penyimpanan masih lega';

  return (
    <div className="space-y-5">
      {/* Header & Plan Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0B5A8E]/10 text-[#0B5A8E]">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-display text-lg font-bold text-slate-900">
                  Kuota Penyimpanan Supabase
                </h1>
                <p className="text-xs text-slate-500">
                  Pantau pemakaian database PostgreSQL &amp; estimasi sisa logbook yang masih dapat disimpan
                </p>
              </div>
            </div>
            {snapshot && (
              <p className="mt-2.5 text-xs text-slate-500">
                Metode ukur:{' '}
                <span className="font-medium text-slate-700">
                  {snapshot.mode === 'rpc'
                    ? 'Presisi Server PostgreSQL (pg_database_size)'
                    : 'Estimasi Hitung Baris Langsung + Sampel JSON'}
                </span>
                {' · '}
                Terakhir diperbarui:{' '}
                <span className="font-mono tabular-nums text-slate-700">
                  {new Date(snapshot.measuredAt).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2">
              <label htmlFor="quota-plan-select" className="text-xs font-medium text-slate-600">
                Paket Supabase:
              </label>
              <select
                id="quota-plan-select"
                value={planId}
                onChange={(e) => setPlanId(e.target.value as QuotaPlanId)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#0B5A8E] focus:outline-none"
              >
                <option value="free_500mb">Free Tier (500 MB)</option>
                <option value="pro_8gb">Pro Plan (8 GB / 8.192 MB)</option>
                <option value="custom">Kustom (MB)</option>
              </select>
            </div>

            {planId === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={50}
                  max={102400}
                  step={50}
                  value={customQuotaMb}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setCustomQuotaMb(Math.max(50, Math.min(102400, Math.round(v))));
                    }
                  }}
                  aria-label="Batas kuota kustom dalam MB"
                  className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-xs tabular-nums text-slate-800 focus:border-[#0B5A8E] focus:outline-none"
                />
                <span className="text-xs font-medium text-slate-500">MB</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => void fetchQuotaSnapshot(true)}
              disabled={refreshing || loading}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Menghitung...' : 'Hitung Ulang'}</span>
            </button>
          </div>
        </div>

        {/* Fallback Mode Notice */}
        {snapshot?.mode === 'fallback' && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-xs text-amber-900">
                  <p className="font-semibold">
                    Mode Estimasi Aktif — Fungsi SQL presisi belum terpasang di Supabase Anda
                  </p>
                  <p className="mt-0.5 text-amber-800">
                    Jumlah baris saat ini dihitung akurat langsung dari database, sedangkan ukuran byte diestimasi dari sampel data logbook aktual. Jalankan fungsi{' '}
                    <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                      app_get_storage_quota()
                    </code>{' '}
                    di Supabase SQL Editor agar ukuran database &amp; indeks terbaca hingga satuan byte.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRpcGuide((prev) => !prev)}
                className="shrink-0 whitespace-nowrap rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100/60"
              >
                {showRpcGuide ? 'Tutup SQL RPC' : 'Lihat SQL Presisi'}
              </button>
            </div>

            {showRpcGuide && (
              <div className="mt-3 border-t border-amber-200 pt-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[11px] font-medium text-amber-900">
                    Salin &amp; jalankan sekali di menu SQL Editor pada Dashboard Supabase:
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopySql()}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-800"
                  >
                    {copiedSql ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedSql ? 'Tersalin' : 'Salin SQL RPC'}</span>
                  </button>
                </div>
                <pre className="max-h-52 overflow-auto rounded-lg border border-amber-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                  {RPC_INSTALL_SQL}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-white p-4 text-xs text-rose-700 flex items-center justify-between gap-3">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => void fetchQuotaSnapshot(true)}
            className="shrink-0 whitespace-nowrap rounded-lg border border-rose-300 px-3 py-1.5 font-semibold hover:bg-rose-50"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {loading && !snapshot ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : snapshot && metrics ? (
        <>
          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* 1. Primary Focal KPI: Remaining Logbooks */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">
                Estimasi Sisa Logbook (Aman 90%)
              </p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-tight tabular-nums text-[#0B5A8E]">
                ± {formatInt(metrics.remainingLogbooksSafe)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                entri logbook lagi dapat tersimpan
              </p>
              <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500 font-mono tabular-nums">
                Maks 100%: ± {formatInt(metrics.remainingLogbooksHard)} · Basis:{' '}
                {formatBytes(metrics.effectiveBytesPerLogbook)}/entri
              </p>
            </div>

            {/* 2. Database Storage Usage */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">Pemakaian Database</p>
                <span className="font-mono text-xs font-semibold tabular-nums text-slate-700">
                  {metrics.usedPercent.toLocaleString('id-ID', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  %
                </span>
              </div>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
                {formatBytes(snapshot.databaseBytes)}
              </p>
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full transition-all duration-300 ${barColorClass}`}
                  style={{ width: `${Math.min(100, Math.max(1.5, metrics.usedPercent))}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500 font-mono tabular-nums">
                Dari kuota {quotaLimitMb.toLocaleString('id-ID')} MB · Sisa aman{' '}
                {formatBytes(metrics.remainingBytesSafe)}
              </p>
            </div>

            {/* 3. Stored Logbooks Count */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Total Logbook Tersimpan</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
                {formatInt(metrics.logbookRows)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                seluruh riwayat sejak awal di Supabase
              </p>
              <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500 font-mono tabular-nums">
                Ukuran tabel: {formatBytes(metrics.logbookTable?.totalBytes ?? 0)} · 30 hr terakhir:{' '}
                {formatInt(snapshot.recent30DaysLogbooks)}
              </p>
            </div>

            {/* 4. Capacity Longevity Projection */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Proyeksi Ketahanan Kuota</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
                {formatDurationProjection(metrics.daysRemainingSafe)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                pada laju{' '}
                <span className="font-mono font-semibold tabular-nums text-slate-800">
                  {metrics.effectiveDailyRate.toLocaleString('id-ID', {
                    maximumFractionDigits: 1,
                  })}
                </span>{' '}
                logbook/hari
              </p>
              <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500 font-mono tabular-nums">
                Rata-rata 30 hr:{' '}
                {metrics.rawAvgDaily.toLocaleString('id-ID', { maximumFractionDigits: 1 })}/hr · 7 hr:{' '}
                {formatInt(snapshot.recent7DaysLogbooks)} entri
              </p>
            </div>
          </div>

          {/* Status Strip + Interactive Simulator */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Simulator Kapasitas */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Simulasi Beban Input &amp; Ukuran Logbook
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Uji proyeksi umur database saat volume pasien atau kompleksitas isian form bertambah
                  </p>
                </div>
                {(simDailyInput !== '' || simKbPerLogbook !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSimDailyInput('');
                      setSimKbPerLogbook('');
                    }}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Aktual</span>
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sim-daily-rate"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Simulasi Input Logbook per Hari
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      id="sim-daily-rate"
                      type="number"
                      min={1}
                      max={1000}
                      placeholder={
                        metrics.rawAvgDaily > 0
                          ? metrics.rawAvgDaily.toFixed(1)
                          : '20 (default)'
                      }
                      value={simDailyInput}
                      onChange={(e) => setSimDailyInput(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                    />
                    <span className="shrink-0 text-xs text-slate-500">entri/hr</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Aktual 30 hari terakhir:{' '}
                    <span className="font-mono tabular-nums text-slate-700">
                      {metrics.rawAvgDaily.toLocaleString('id-ID', { maximumFractionDigits: 1 })} entri/hr
                    </span>
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="sim-kb-per-row"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Ukuran Rata-Rata per Logbook
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      id="sim-kb-per-row"
                      type="number"
                      min={0.5}
                      max={200}
                      step={0.5}
                      placeholder={(metrics.actualBytesPerLogbook / 1024).toFixed(2)}
                      value={simKbPerLogbook}
                      onChange={(e) => setSimKbPerLogbook(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs tabular-nums text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                    />
                    <span className="shrink-0 text-xs text-slate-500">KB/entri</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Terukur saat ini:{' '}
                    <span className="font-mono tabular-nums text-slate-700">
                      {formatBytes(metrics.actualBytesPerLogbook)}/entri
                    </span>
                    {snapshot.sampledLogbookCount > 0
                      ? ` (sampel ${snapshot.sampledLogbookCount} baris)`
                      : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Ringkasan Kebijakan & Batas Aman */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#0B5A8E]" />
                  <h2 className="text-sm font-bold text-slate-900">Status &amp; Cadangan Aman</h2>
                </div>
                <p className="mt-2 text-xs font-medium text-slate-800">{statusText}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Perhitungan batas aman menyisakan cadangan{' '}
                  <span className="font-mono font-semibold tabular-nums text-slate-700">10%</span>{' '}
                  ({formatBytes(quotaLimitBytes - safeQuotaBytes)}) agar indeks PostgreSQL, log
                  transaksi, dan data jadwal/laporan PJ shift tetap berjalan lancar tanpa error kuota penuh.
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                <div>
                  <span className="text-[11px] text-slate-500">Batas Aman (90%)</span>
                  <p className="font-mono font-semibold tabular-nums text-slate-900">
                    {formatBytes(safeQuotaBytes)}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500">Batas Penuh (100%)</span>
                  <p className="font-mono font-semibold tabular-nums text-slate-900">
                    {formatBytes(quotaLimitBytes)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Table Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">
                  Rincian Penggunaan Penyimpanan per Tabel
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                Mencakup seluruh 14 tabel operasional HemoLog beserta indeks &amp; overhead sistem
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold text-slate-600">Tabel</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Jumlah Baris</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Data &amp; TOAST</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Indeks</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">Total Ukuran</th>
                    <th className="px-5 py-3 text-right font-semibold text-slate-600">Porsi DB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {snapshot.tables.map((row) => {
                    const sharePct =
                      snapshot.databaseBytes > 0
                        ? (row.totalBytes / snapshot.databaseBytes) * 100
                        : 0;
                    const isLogbook = row.tableName === 'logbook';

                    return (
                      <tr
                        key={row.tableName}
                        className={isLogbook ? 'bg-[#0B5A8E]/[0.03]' : 'hover:bg-slate-50/70'}
                      >
                        <td className="px-5 py-2.5">
                          <div className="font-medium text-slate-900">{row.label}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            public.{row.tableName}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                          {formatInt(row.rowCount)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {formatBytes(row.dataBytes)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {formatBytes(row.indexBytes)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                          {formatBytes(row.totalBytes)}
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono tabular-nums text-slate-600">
                          {sharePct.toLocaleString('id-ID', {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}
                          %
                        </td>
                      </tr>
                    );
                  })}

                  {metrics.systemOverheadBytes > 0 && (
                    <tr className="bg-slate-50/40">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-slate-700">
                          Sistem PostgreSQL, Auth &amp; Ekstensi Supabase
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          auth · storage · pg_catalog · realtime
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-400">
                        —
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-400">
                        —
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-400">
                        —
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-800">
                        {formatBytes(metrics.systemOverheadBytes)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {(snapshot.databaseBytes > 0
                          ? (metrics.systemOverheadBytes / snapshot.databaseBytes) * 100
                          : 0
                        ).toLocaleString('id-ID', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        %
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <td className="px-5 py-3 font-bold text-slate-900">Total Database Supabase</td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-800">
                      {formatInt(snapshot.tables.reduce((sum, t) => sum + t.rowCount, 0))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">—</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">—</td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900">
                      {formatBytes(snapshot.databaseBytes)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-bold tabular-nums text-slate-900">
                      100,0%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

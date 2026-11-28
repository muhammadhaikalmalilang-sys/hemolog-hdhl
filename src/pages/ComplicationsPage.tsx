import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  Filter,
  Search,
  Users,
} from 'lucide-react';
import {
  formatDateId,
  formatMonthLabel,
} from '../lib/formatters';
import { exportComplicationsExcel } from '../lib/excelExport';
import { useLiveClock } from '../hooks/useLiveClock';
import { useToast } from '../context/ToastContext';
import { LogbookDetailModal } from '../components/logbook/LogbookDetailModal';
import { VerificationBadge } from '../components/ui/StatusBadge';
import type {
  LogbookEntry,
  LogbookFormTemplate,
  Machine,
  Patient,
  ShiftType,
  StaffDirectoryEntry,
} from '../types';

interface ComplicationsPageProps {
  logbooks: LogbookEntry[];
  patients: Patient[];
  machines?: Machine[];
  staffDirectory?: StaffDirectoryEntry[];
  formTemplate?: LogbookFormTemplate;
  archiveLoading?: boolean;
  onEnsureMonthLoaded?: (monthKey: string) => Promise<void> | void;
  onEnsureAllArchivesLoaded?: () => Promise<void> | void;
  onEnsureMonthDetailsLoaded?: (monthKey: string) => Promise<void> | void;
  onEnsureAllArchiveDetailsLoaded?: () => Promise<void> | void;
  onEnsureLogbookDetailsByIds?: (ids: string[]) => Promise<void> | void;
}

interface ComplicationEpisodeRow {
  id: string;
  entry: LogbookEntry;
  bedMachine: string;
  category: string;
  detailText: string;
  time: string;
  advice: string;
}

function hasEntryComplication(entry: LogbookEntry): boolean {
  if ((entry.wizardDetails?.section4?.complicationIncidents?.length || 0) > 0) {
    return true;
  }
  const raw = (entry.complications || '').trim();
  return Boolean(raw) && !/^tidak ada\b/i.test(raw) && raw !== '-';
}

function normalizeCategoryName(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return 'Komplikasi Lainnya';
  const beforeParen = trimmed.split('(')[0].trim();
  const base = beforeParen || trimmed;
  if (/hipotensi/i.test(base)) return 'Hipotensi';
  if (/hipertensi/i.test(base)) return 'Hipertensi';
  if (/kram\s*otot|kram/i.test(base)) return 'Kram Otot';
  if (/mual|muntah/i.test(base)) return 'Mual / Muntah';
  if (/menggigil|demam/i.test(base)) return 'Menggigil / Demam';
  if (/sakit\s*kepala|nyeri\s*kepala|pusing/i.test(base)) return 'Sakit Kepala / Pusing';
  if (/sesak/i.test(base)) return 'Sesak Napas';
  if (/nyeri\s*dada/i.test(base)) return 'Nyeri Dada';
  if (/clotting|bekuan/i.test(base)) return 'Clotting / Bekuan Darah';
  if (/komplikasi\s*lainnya/i.test(base)) return 'Komplikasi Lainnya';
  return base;
}

function extractEntryEpisodes(
  entry: LogbookEntry,
  machineMap: Map<string, Machine>
): ComplicationEpisodeRow[] {
  if (!hasEntryComplication(entry)) return [];

  const mach = machineMap.get(entry.machineId);
  const bedMachine = entry.machineNumber || mach?.machineNumber || '-';
  const sec4 = entry.wizardDetails?.section4;
  const incidents = sec4?.complicationIncidents || [];

  if (incidents.length > 0) {
    return incidents.map((inc, idx) => {
      const typeName = inc.type?.trim() || 'Komplikasi Lainnya';
      const bpVal = inc.bp?.trim();
      const detailVal = inc.clinicalDetail?.trim();
      let detailText = typeName;
      if (bpVal && detailVal) {
        detailText = `${typeName} (TD ${bpVal}; ${detailVal})`;
      } else if (bpVal) {
        detailText = `${typeName} (TD ${bpVal})`;
      } else if (detailVal) {
        detailText = `${typeName} (${detailVal})`;
      }
      const advice =
        inc.doctorAdvice?.trim() ||
        sec4?.effectiveCommunicationNotes?.trim() ||
        entry.nursingNotes?.trim() ||
        '-';
      return {
        id: `${entry.id}-inc-${idx}`,
        entry,
        bedMachine,
        category: normalizeCategoryName(typeName),
        detailText,
        time: inc.time?.trim() || entry.endTime || '-',
        advice,
      };
    });
  }

  const raw = (entry.complications || '').trim();
  const semiSplit = raw
    .split(/\s*[;\n]+\s*/)
    .map((item) => item.trim())
    .filter((item) => item && !/^tidak ada\b/i.test(item) && item !== '-');
  const splitItems =
    semiSplit.length > 1
      ? semiSplit
      : raw
          .split(/,\s*(?![^(]*\))/)
          .map((item) => item.trim())
          .filter((item) => item && !/^tidak ada\b/i.test(item) && item !== '-');
  const items = splitItems.length > 0 ? splitItems : [raw];

  const rawAdvice = sec4?.effectiveCommunicationNotes?.trim() || entry.nursingNotes?.trim() || '-';
  const adviceSplit = rawAdvice
    .split(/\s*[;\n]+\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.map((item, idx) => {
    const advice =
      idx === items.length - 1 && adviceSplit.length > items.length
        ? adviceSplit.slice(idx).join('; ')
        : adviceSplit[idx] || (adviceSplit.length === 1 ? adviceSplit[0] : '-');
    return {
      id: `${entry.id}-raw-${idx}`,
      entry,
      bedMachine,
      category: normalizeCategoryName(item),
      detailText: item,
      time: entry.endTime || '-',
      advice,
    };
  });
}

type PeriodMode = 'month' | 'date' | 'all';
type StatusFilterMode = 'ALL' | 'Approved' | 'Pending' | 'RevisionOrDraft';

export function ComplicationsPage({
  logbooks,
  patients,
  machines = [],
  staffDirectory = [],
  formTemplate,
  archiveLoading = false,
  onEnsureMonthLoaded,
  onEnsureAllArchivesLoaded,
  onEnsureMonthDetailsLoaded,
  onEnsureAllArchiveDetailsLoaded,
  onEnsureLogbookDetailsByIds,
}: ComplicationsPageProps) {
  const { showToast } = useToast();
  const { todayDate: liveTodayDate } = useLiveClock();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [monthFilter, setMonthFilter] = useState(liveTodayDate.slice(0, 7));
  const [dateFilter, setDateFilter] = useState(liveTodayDate);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | ShiftType>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilterMode>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);

  const machineMap = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);

  const detailEntry = useMemo(
    () => (detailEntryId ? logbooks.find((lb) => lb.id === detailEntryId) || null : null),
    [logbooks, detailEntryId]
  );

  // Load archive months & hydrate complication detail sections automatically
  useEffect(() => {
    if (periodMode === 'date' && dateFilter) {
      void (onEnsureMonthDetailsLoaded || onEnsureMonthLoaded)?.(dateFilter.slice(0, 7));
    } else if (periodMode === 'month' && monthFilter) {
      void (onEnsureMonthDetailsLoaded || onEnsureMonthLoaded)?.(monthFilter);
    } else if (periodMode === 'all') {
      void (onEnsureAllArchiveDetailsLoaded || onEnsureAllArchivesLoaded)?.();
    }
  }, [
    periodMode,
    monthFilter,
    dateFilter,
    onEnsureMonthLoaded,
    onEnsureAllArchivesLoaded,
    onEnsureMonthDetailsLoaded,
    onEnsureAllArchiveDetailsLoaded,
  ]);

  useEffect(() => {
    if (!onEnsureLogbookDetailsByIds) return;
    const missingIds = logbooks
      .filter((lb) => {
        if (lb.wizardDetails !== undefined) return false;
        if (periodMode === 'date' && dateFilter && lb.date !== dateFilter) return false;
        if (periodMode === 'month' && monthFilter && lb.monthKey !== monthFilter) return false;
        return hasEntryComplication(lb);
      })
      .map((lb) => lb.id);
    if (missingIds.length > 0) {
      void onEnsureLogbookDetailsByIds(missingIds);
    }
  }, [logbooks, periodMode, dateFilter, monthFilter, onEnsureLogbookDetailsByIds]);

  // All logbooks matching Period and Shift filters (used as denominator for rates & status breakdown)
  const scopedLogbooks = useMemo(() => {
    return logbooks.filter((lb) => {
      if (periodMode === 'date' && dateFilter && lb.date !== dateFilter) return false;
      if (periodMode === 'month' && monthFilter && lb.monthKey !== monthFilter) return false;
      if (shiftFilter !== 'ALL' && lb.shift !== shiftFilter) return false;
      return true;
    });
  }, [logbooks, periodMode, dateFilter, monthFilter, shiftFilter]);

  // Apply Verification Status filter
  const statusScopedLogbooks = useMemo(() => {
    if (statusFilter === 'ALL') return scopedLogbooks;
    if (statusFilter === 'Approved') {
      return scopedLogbooks.filter((lb) => lb.verificationStatus === 'Approved');
    }
    if (statusFilter === 'Pending') {
      return scopedLogbooks.filter((lb) => lb.verificationStatus === 'Pending');
    }
    return scopedLogbooks.filter(
      (lb) => lb.verificationStatus === 'Revision' || lb.verificationStatus === 'Draft'
    );
  }, [scopedLogbooks, statusFilter]);

  // All episodes from status-scoped logbooks (sorted newest first)
  const allScopedEpisodes = useMemo(() => {
    const list: ComplicationEpisodeRow[] = [];
    const sorted = [...statusScopedLogbooks].sort((a, b) => {
      const dCmp = b.date.localeCompare(a.date);
      if (dCmp !== 0) return dCmp;
      const sOrder: Record<ShiftType, number> = { Pagi: 1, Siang: 2, Malam: 3 };
      const sCmp = (sOrder[a.shift] || 9) - (sOrder[b.shift] || 9);
      if (sCmp !== 0) return sCmp;
      return a.patientName.localeCompare(b.patientName);
    });
    for (const lb of sorted) {
      list.push(...extractEntryEpisodes(lb, machineMap));
    }
    return list;
  }, [statusScopedLogbooks, machineMap]);

  // Also compute Approved vs Pending totals across scopedLogbooks (regardless of statusFilter) for clear transparency
  const verificationComparison = useMemo(() => {
    let approvedEpisodes = 0;
    let pendingOrOtherEpisodes = 0;
    let approvedActions = 0;
    let pendingActions = 0;
    for (const lb of scopedLogbooks) {
      const eps = extractEntryEpisodes(lb, machineMap).length;
      if (lb.verificationStatus === 'Approved') {
        approvedActions += 1;
        approvedEpisodes += eps;
      } else {
        pendingActions += 1;
        pendingOrOtherEpisodes += eps;
      }
    }
    return {
      approvedEpisodes,
      pendingOrOtherEpisodes,
      totalAllStatusEpisodes: approvedEpisodes + pendingOrOtherEpisodes,
      approvedActions,
      pendingActions,
    };
  }, [scopedLogbooks, machineMap]);

  // Breakdown per complication category (before categoryFilter & searchTerm so user can click categories)
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; patientIds: Set<string>; approvedCount: number }>();
    for (const ep of allScopedEpisodes) {
      const cur = map.get(ep.category) || {
        count: 0,
        patientIds: new Set<string>(),
        approvedCount: 0,
      };
      cur.count += 1;
      cur.patientIds.add(ep.entry.patientId);
      if (ep.entry.verificationStatus === 'Approved') cur.approvedCount += 1;
      map.set(ep.category, cur);
    }
    const total = allScopedEpisodes.length;
    return Array.from(map.entries())
      .map(([category, info]) => ({
        category,
        count: info.count,
        approvedCount: info.approvedCount,
        patientCount: info.patientIds.size,
        pct: total > 0 ? Math.round((info.count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }, [allScopedEpisodes]);

  const availableCategories = useMemo(
    () => categoryBreakdown.map((c) => c.category),
    [categoryBreakdown]
  );

  // Final filtered episodes for the detail table
  const filteredEpisodes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allScopedEpisodes.filter((ep) => {
      if (categoryFilter !== 'ALL' && ep.category !== categoryFilter) return false;
      if (q) {
        const hit =
          ep.entry.patientName.toLowerCase().includes(q) ||
          (ep.entry.patientRm || '').toLowerCase().includes(q) ||
          ep.bedMachine.toLowerCase().includes(q) ||
          ep.category.toLowerCase().includes(q) ||
          ep.detailText.toLowerCase().includes(q) ||
          ep.advice.toLowerCase().includes(q) ||
          ep.entry.nurseName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [allScopedEpisodes, categoryFilter, searchTerm]);

  const summaryStats = useMemo(() => {
    const uniquePatientIds = new Set(filteredEpisodes.map((ep) => ep.entry.patientId));
    const uniqueActionIds = new Set(filteredEpisodes.map((ep) => ep.entry.id));
    const totalActionsInScope = statusScopedLogbooks.length;
    const ratePct =
      totalActionsInScope > 0
        ? Math.round((uniqueActionIds.size / totalActionsInScope) * 1000) / 10
        : 0;
    const topCategory = categoryBreakdown[0] || null;

    return {
      totalEpisodes: filteredEpisodes.length,
      affectedPatients: uniquePatientIds.size,
      affectedActions: uniqueActionIds.size,
      totalActionsInScope,
      ratePct,
      topCategory,
    };
  }, [filteredEpisodes, statusScopedLogbooks.length, categoryBreakdown]);

  const hasHistoricalMalam = useMemo(
    () => logbooks.some((item) => item.shift === 'Malam'),
    [logbooks]
  );

  const periodLabel =
    periodMode === 'date'
      ? formatDateId(dateFilter)
      : periodMode === 'month'
      ? formatMonthLabel(monthFilter)
      : 'Semua Periode Arsip';

  const handleExportExcel = async () => {
    if (exportingExcel || filteredEpisodes.length === 0) return;
    setExportingExcel(true);
    try {
      const suffix =
        periodMode === 'date' ? dateFilter : periodMode === 'month' ? monthFilter : 'semua-periode';
      const shiftLabel = shiftFilter === 'ALL' ? 'Semua Shift' : `Shift ${shiftFilter}`;
      const statusLabel =
        statusFilter === 'ALL'
          ? 'Semua Status'
          : statusFilter === 'Approved'
          ? 'Khusus Approved'
          : statusFilter === 'Pending'
          ? 'Menunggu Verifikasi'
          : 'Revisi / Draft';
      const categoryLabel = categoryFilter === 'ALL' ? 'Semua Jenis' : categoryFilter;

      await exportComplicationsExcel({
        filename: `DATA-KOMPLIKASI-HD-${suffix}`,
        periodLabel,
        shiftLabel,
        statusLabel,
        categoryLabel,
        episodes: filteredEpisodes,
        categoryBreakdown,
        summary: {
          totalEpisodes: summaryStats.totalEpisodes,
          affectedPatients: summaryStats.affectedPatients,
          affectedActions: summaryStats.affectedActions,
          totalActionsInScope: summaryStats.totalActionsInScope,
          ratePct: summaryStats.ratePct,
          topCategoryLabel: summaryStats.topCategory ? summaryStats.topCategory.category : '-',
          topCategorySub: summaryStats.topCategory
            ? `${summaryStats.topCategory.count} kejadian (${summaryStats.topCategory.pct}%)`
            : 'Belum ada komplikasi',
          approvedEpisodes: verificationComparison.approvedEpisodes,
          totalAllStatusEpisodes: verificationComparison.totalAllStatusEpisodes,
          pendingOrOtherEpisodes: verificationComparison.pendingOrOtherEpisodes,
        },
      });
      showToast(
        `Data Komplikasi (${filteredEpisodes.length} kejadian) berhasil diekspor ke Excel.`,
        'success'
      );
    } catch {
      showToast('Gagal mengekspor Data Komplikasi ke Excel.', 'error');
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Data Komplikasi Intra-HD Unit Hemodialisis
          </h2>
          <p className="text-xs text-slate-500">
            Rekapitulasi total komplikasi pasien seluruh unit HD berdasarkan status verifikasi logbook dan periode dinas.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleExportExcel()}
          disabled={exportingExcel || filteredEpisodes.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap w-fit"
        >
          <FileSpreadsheet className="h-4 w-4" />
          {exportingExcel ? 'Membuat Excel...' : 'Ekspor Excel'}
        </button>
      </div>

      {archiveLoading && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-[#0B5A8E]">
          Memuat data komplikasi dan rincian logbook dari arsip Supabase...
        </div>
      )}

      {/* Filter Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Filter className="h-3.5 w-3.5 text-[#0B5A8E]" />
            <span>Filter Data Komplikasi ({periodLabel})</span>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'date', label: 'Harian' },
                { id: 'month', label: 'Bulanan' },
                { id: 'all', label: 'Semua Arsip' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPeriodMode(m.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  periodMode === m.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {/* Period Input */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              {periodMode === 'date'
                ? 'Tanggal Dinas'
                : periodMode === 'month'
                ? 'Bulan'
                : 'Cakupan Arsip'}
            </label>
            {periodMode === 'date' ? (
              <input
                type="date"
                aria-label="Filter Tanggal Komplikasi"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
              />
            ) : periodMode === 'month' ? (
              <input
                type="month"
                aria-label="Filter Bulan Komplikasi"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
              />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                Seluruh Riwayat Tersimpan
              </div>
            )}
          </div>

          {/* Shift */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Shift</label>
            <select
              aria-label="Filter Shift Komplikasi"
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value as 'ALL' | ShiftType)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
            >
              <option value="ALL">Semua Shift</option>
              <option value="Pagi">Shift Pagi</option>
              <option value="Siang">Shift Siang</option>
              {hasHistoricalMalam && <option value="Malam">Shift Malam</option>}
            </select>
          </div>

          {/* Verification Status */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Status Logbook
            </label>
            <select
              aria-label="Filter Status Logbook Komplikasi"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilterMode)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
            >
              <option value="ALL">
                Semua Status ({verificationComparison.totalAllStatusEpisodes})
              </option>
              <option value="Approved">
                Khusus Approved ({verificationComparison.approvedEpisodes})
              </option>
              <option value="Pending">
                Menunggu Verifikasi ({verificationComparison.pendingOrOtherEpisodes})
              </option>
              <option value="RevisionOrDraft">Revisi / Draft</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Jenis Komplikasi
            </label>
            <select
              aria-label="Filter Jenis Komplikasi"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
            >
              <option value="ALL">Semua Jenis ({allScopedEpisodes.length})</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Pencarian
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Pasien, RM, advis, perawat..."
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Total Kejadian Komplikasi
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {summaryStats.totalEpisodes}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Dari {summaryStats.affectedActions} tindakan ber-komplikasi ({statusFilter === 'ALL' ? 'semua status' : statusFilter})
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Pasien Terdampak &amp; Rasio
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-[#0B5A8E]">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {summaryStats.affectedPatients}{' '}
            <span className="text-sm font-semibold text-slate-500">pasien</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Rasio {summaryStats.ratePct}% dari {summaryStats.totalActionsInScope} tindakan HD
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Komplikasi Terbanyak
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Activity className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 truncate font-display text-lg font-bold text-slate-900">
            {summaryStats.topCategory ? summaryStats.topCategory.category : '-'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {summaryStats.topCategory
              ? `${summaryStats.topCategory.count} kejadian (${summaryStats.topCategory.pct}% dari total)`
              : 'Belum ada komplikasi pada filter ini'}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Komplikasi Approved vs Lainnya
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {verificationComparison.approvedEpisodes}{' '}
            <span className="text-xs font-semibold text-slate-500">
              / {verificationComparison.totalAllStatusEpisodes} total
            </span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Approved: {verificationComparison.approvedEpisodes} · Menunggu/Lain:{' '}
            {verificationComparison.pendingOrOtherEpisodes}
          </p>
        </div>
      </div>

      {/* Category Breakdown Card */}
      {categoryBreakdown.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Rekapitulasi per Jenis Komplikasi
              </h3>
              <p className="text-[11px] text-slate-500">
                Klik baris jenis komplikasi untuk menyaring daftar kejadian di bawah.
              </p>
            </div>
            {categoryFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => setCategoryFilter('ALL')}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Tampilkan Semua Jenis
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categoryBreakdown.map((item) => {
              const active = categoryFilter === item.category;
              return (
                <button
                  key={item.category}
                  type="button"
                  onClick={() =>
                    setCategoryFilter((prev) => (prev === item.category ? 'ALL' : item.category))
                  }
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    active
                      ? 'border-rose-400 bg-rose-50/70'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {item.category}
                    </span>
                    <span className="font-mono text-xs font-bold text-rose-700 tabular-nums shrink-0">
                      {item.count} ({item.pct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-rose-600"
                      style={{ width: `${Math.min(100, Math.max(4, item.pct))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-500">
                    <span>{item.patientCount} pasien terdampak</span>
                    <span>Approved: {item.approvedCount}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail Table */}
      <div className="rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden">
        <div className="bg-[#0e3a53] px-4 py-3 text-white flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-xs sm:text-sm font-bold uppercase tracking-wide">
              Daftar Kejadian Komplikasi, Tatalaksana &amp; Advis DPJP
            </h3>
            <p className="mt-0.5 text-[11px] text-sky-100">
              Periode: {periodLabel} &nbsp;|&nbsp; Total ditampilkan: {filteredEpisodes.length}{' '}
              kejadian
            </p>
          </div>
        </div>

        {filteredEpisodes.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Tidak ada data komplikasi intra-HD yang sesuai dengan filter yang dipilih.
          </div>
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full border-collapse text-xs text-slate-800">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#1b4f6e] text-white text-[10px] uppercase tracking-wider">
                  <th className="border border-[#2d6687] px-2.5 py-2 text-center w-10">No</th>
                  <th className="border border-[#2d6687] px-2.5 py-2 text-left whitespace-nowrap">
                    Tanggal / Shift
                  </th>
                  <th className="border border-[#2d6687] px-2 py-2 text-center whitespace-nowrap">
                    Bed
                  </th>
                  <th className="border border-[#2d6687] px-3 py-2 text-left min-w-[175px]">
                    Nama Pasien / No. RM
                  </th>
                  <th className="border border-[#2d6687] px-3 py-2 text-left min-w-[210px]">
                    Komplikasi Intra-HD
                  </th>
                  <th className="border border-[#2d6687] px-2 py-2 text-center whitespace-nowrap">
                    Jam
                  </th>
                  <th className="border border-[#2d6687] px-3 py-2 text-left min-w-[230px]">
                    Tindakan &amp; Advis Medis DPJP
                  </th>
                  <th className="border border-[#2d6687] px-2.5 py-2 text-left whitespace-nowrap">
                    Perawat Pelaksana
                  </th>
                  <th className="border border-[#2d6687] px-2.5 py-2 text-center whitespace-nowrap">
                    Status
                  </th>
                  <th className="border border-[#2d6687] px-2.5 py-2 text-center whitespace-nowrap">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEpisodes.map((ep, idx) => (
                  <tr
                    key={ep.id}
                    className={`${
                      idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                    } hover:bg-sky-50/60 transition-colors`}
                  >
                    <td className="border border-slate-200 px-2.5 py-2 text-center font-mono font-semibold text-slate-700">
                      {idx + 1}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900">
                        {formatDateId(ep.entry.date)}
                      </div>
                      <div className="text-[10.5px] text-slate-500">Shift {ep.entry.shift}</div>
                    </td>
                    <td className="border border-slate-200 px-2 py-2 text-center font-mono font-semibold whitespace-nowrap">
                      {ep.bedMachine}
                    </td>
                    <td className="border border-slate-200 px-3 py-2">
                      <div className="font-semibold text-slate-900">{ep.entry.patientName}</div>
                      <div className="font-mono text-[10.5px] text-slate-500">
                        {ep.entry.patientRm || '-'}
                      </div>
                    </td>
                    <td className="border border-slate-200 px-3 py-2 font-semibold text-rose-700">
                      {ep.detailText}
                    </td>
                    <td className="border border-slate-200 px-2 py-2 text-center font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {ep.time}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-800">
                      {ep.advice}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 whitespace-nowrap">
                      <div className="font-medium text-slate-900">{ep.entry.nurseName}</div>
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 text-center whitespace-nowrap">
                      <VerificationBadge status={ep.entry.verificationStatus} />
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setDetailEntryId(ep.entry.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3 w-3" />
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailEntry && (
        <LogbookDetailModal
          entry={detailEntry}
          logbooks={logbooks}
          patients={patients}
          machines={machines}
          staffDirectory={staffDirectory}
          formTemplate={formTemplate}
          onClose={() => setDetailEntryId(null)}
        />
      )}
    </div>
  );
}

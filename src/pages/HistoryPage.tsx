import { useEffect, useMemo, useState } from 'react';
import { Eye, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { formatDateId, formatFullDayDateId } from '../lib/formatters';
import { ShiftBadge, VerificationBadge } from '../components/ui/StatusBadge';
import { LogbookDetailModal } from '../components/logbook/LogbookDetailModal';
import type {
  ActionCategory,
  Doctor,
  LogbookEntry,
  LogbookFormTemplate,
  Machine,
  MachineLock,
  Patient,
  ReportEntry,
  StaffDirectoryEntry,
} from '../types';

interface HistoryPageProps {
  logbooks: LogbookEntry[];
  reports: ReportEntry[];
  patients?: Patient[];
  doctors?: Doctor[];
  machines?: Machine[];
  actionCategories?: ActionCategory[];
  staffDirectory?: StaffDirectoryEntry[];
  machineLocks?: MachineLock[];
  formTemplate?: LogbookFormTemplate;
}

export function HistoryPage({
  logbooks,
  reports,
  patients = [],
  doctors = [],
  machines = [],
  actionCategories = [],
  staffDirectory = [],
  machineLocks = [],
  formTemplate,
}: HistoryPageProps) {
  const { userProfile } = useAuth();
  const { todayDate: liveTodayDate } = useLiveClock();
  const [todayDate, setTodayDate] = useState(liveTodayDate);
  const [dateFilter, setDateFilter] = useState(liveTodayDate);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tab, setTab] = useState<'logbook' | 'shift_reports'>('logbook');
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);

  useEffect(() => {
    if (liveTodayDate !== todayDate) {
      setTodayDate(liveTodayDate);
      setDateFilter((prev) => (prev === todayDate ? liveTodayDate : prev));
    }
  }, [liveTodayDate, todayDate]);

  const uid = userProfile?.uid || '';
  const isPjShift = userProfile?.role === 'PJ Shift';

  const ownManagedLogbooks = useMemo(() => {
    if (!uid) return [];
    return logbooks.filter((item) => item.nurseId === uid);
  }, [logbooks, uid]);

  const detailEntry = useMemo(
    () =>
      detailEntryId
        ? ownManagedLogbooks.find((item) => item.id === detailEntryId) || null
        : null,
    [ownManagedLogbooks, detailEntryId]
  );

  const filteredLogbooks = useMemo(() => {
    return ownManagedLogbooks.filter((item) => {
      if (dateFilter && item.date !== dateFilter) return false;
      if (statusFilter !== 'ALL' && item.verificationStatus !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hit =
          item.patientName.toLowerCase().includes(q) ||
          item.nurseName.toLowerCase().includes(q) ||
          item.machineNumber.toLowerCase().includes(q) ||
          item.actionCategory.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [ownManagedLogbooks, dateFilter, statusFilter, searchTerm]);

  const pjShiftReports = useMemo(() => {
    if (!uid) return [];
    return reports.filter((r) => r.reportType === 'pj_shift' && r.authorId === uid);
  }, [reports, uid]);

  if (!userProfile) return null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold text-slate-900">
          {isPjShift
            ? 'Riwayat Logbook Pribadi & Laporan Shift'
            : 'Riwayat Pengajuan Logbook Pribadi'}
        </h2>
        <p className="text-xs text-slate-500">
          {isPjShift
            ? 'Riwayat logbook tindakan kelolaan Anda serta laporan PJ Shift yang telah dibuat.'
            : 'Pantau status verifikasi dan catatan verifikator untuk logbook kelolaan Anda.'}
        </p>
      </div>

      {isPjShift && (
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            type="button"
            onClick={() => setTab('logbook')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'logbook' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Riwayat Logbook Saya ({filteredLogbooks.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('shift_reports')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'shift_reports' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Laporan Shift Saya ({pjShiftReports.length})
          </button>
        </div>
      )}

      {tab === 'logbook' ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cari pasien, mesin, tindakan..."
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Filter Tanggal Riwayat"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
                />
                {dateFilter ? (
                  <button
                    type="button"
                    onClick={() => setDateFilter('')}
                    className="rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 shrink-0"
                    title="Tampilkan semua tanggal"
                  >
                    Semua
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDateFilter(todayDate)}
                    className="rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-teal-700 hover:bg-teal-50 shrink-0"
                    title="Kembali ke hari aktif"
                  >
                    Hari Ini
                  </button>
                )}
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
              >
                <option value="ALL">Semua Status Verifikasi</option>
                <option value="Draft">Draft (Sementara)</option>
                <option value="Pending">Menunggu Verifikasi</option>
                <option value="Approved">Approved</option>
                <option value="Revision">Revisi</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                Periode tampil:{' '}
                <strong className="text-slate-700">
                  {dateFilter ? formatFullDayDateId(dateFilter) : 'Semua Tanggal'}
                </strong>
              </span>
              {dateFilter && dateFilter !== todayDate && (
                <button
                  type="button"
                  onClick={() => setDateFilter(todayDate)}
                  className="font-semibold text-teal-700 hover:underline"
                >
                  Kembali ke Hari Ini ({formatDateId(todayDate)})
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {filteredLogbooks.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                Belum ada riwayat logbook yang sesuai filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Tanggal</th>
                      <th className="px-4 py-3 font-semibold">Pasien</th>
                      <th className="px-4 py-3 font-semibold">Tindakan & Mesin</th>
                      <th className="px-4 py-3 font-semibold">Perawat</th>
                      <th className="px-4 py-3 font-semibold">Status & Verifikator</th>
                      <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLogbooks.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDateId(item.date)}
                          </div>
                          <div className="mt-1">
                            <ShiftBadge shift={item.shift} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{item.patientName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {item.patientRm} · UF {item.ufAchieved} ml
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{item.actionCategory}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {item.machineNumber} · {item.startTime}–{item.endTime}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{item.nurseName}</td>
                        <td className="px-4 py-3">
                          <VerificationBadge status={item.verificationStatus} />
                          {item.verifiedByName && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Oleh: {item.verifiedByName}
                            </p>
                          )}
                          {item.verificationNote && (
                            <p className="mt-0.5 text-[11px] text-slate-600 italic">
                              “{item.verificationNote}”
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailEntryId(item.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                            title="Lihat Detail Logbook Lengkap (Bagian 1–8)"
                          >
                            <Eye className="h-3.5 w-3.5" />
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
        </>
      ) : (
        <div className="space-y-3">
          {pjShiftReports.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
              Anda belum pernah mengirimkan Laporan PJ Shift.
            </div>
          ) : (
            pjShiftReports.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {formatDateId(r.date)}
                    </span>
                    {r.shift && <ShiftBadge shift={r.shift} />}
                  </div>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                      r.reviewStatus === 'Reviewed'
                        ? 'border-teal-200 bg-teal-50 text-teal-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {r.reviewStatus === 'Reviewed' ? 'Sudah Direview' : 'Terkirim'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
                  <div>Pasien Dilayani: <strong className="font-mono text-slate-900">{r.totalPatients}</strong></div>
                  <div>Mesin Aktif: <strong className="font-mono text-slate-900">{r.activeMachines}</strong></div>
                  <div>Tim Bertugas: <strong className="text-slate-900">{r.nursesOnDuty}</strong></div>
                </div>
                <p className="mt-3 text-xs text-slate-700">
                  <strong>Serah Terima:</strong> {r.handoverNotes}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {detailEntry && (
        <LogbookDetailModal
          entry={detailEntry}
          logbooks={ownManagedLogbooks}
          patients={patients}
          doctors={doctors}
          machines={machines}
          actionCategories={actionCategories}
          staffDirectory={staffDirectory}
          machineLocks={machineLocks}
          formTemplate={formTemplate}
          onClose={() => setDetailEntryId(null)}
        />
      )}
    </div>
  );
}

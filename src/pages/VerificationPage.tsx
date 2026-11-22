import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, Clock, Search, Eye, Pencil, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  clampString,
  formatDateId,
  formatFullDayDateId,
  getLogbookVerificationAccess,
  isLogbookAssignedToVerifier,
  VERIFICATION_WINDOW_WIB,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { DEFAULT_LOGBOOK_TEMPLATE, mergeWithDefaultTemplate } from '../lib/logbookTemplate';
import { ShiftBadge, VerificationBadge } from '../components/ui/StatusBadge';

const LazyLogbookWizardModal = lazy(() =>
  import('../components/logbook/LogbookWizardModal').then((m) => ({
    default: m.LogbookWizardModal,
  }))
);
import type {
  ActionCategory,
  Doctor,
  LogbookEntry,
  LogbookFormTemplate,
  LogbookLock,
  Machine,
  MachineLock,
  Patient,
  StaffDirectoryEntry,
  VerificationStatus,
} from '../types';

interface VerificationPageProps {
  logbooks: LogbookEntry[];
  logbookLocks: LogbookLock[];
  machineLocks: MachineLock[];
  patients: Patient[];
  doctors: Doctor[];
  machines: Machine[];
  actionCategories: ActionCategory[];
  staffDirectory: StaffDirectoryEntry[];
  formTemplate?: LogbookFormTemplate;
}

export function VerificationPage({
  logbooks,
  logbookLocks,
  machineLocks,
  patients,
  doctors,
  machines,
  actionCategories,
  staffDirectory,
  formTemplate,
}: VerificationPageProps) {
  const { firebaseUser, userProfile } = useAuth();
  const { showToast } = useToast();
  const { todayDate: liveTodayDate, nowMs, wibTimeLabel } = useLiveClock();
  const [todayDate, setTodayDate] = useState(liveTodayDate);
  const [dateFilter, setDateFilter] = useState(liveTodayDate);
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'Pending' | 'Revision' | 'Approved' | 'ALL'>('Pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [editingWizardEntryId, setEditingWizardEntryId] = useState<string | null>(null);
  const [reopenReviewEntryId, setReopenReviewEntryId] = useState<string | null>(null);
  const [editSuccessMsg, setEditSuccessMsg] = useState<string | null>(null);
  const [verificationNote, setVerificationNote] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);

  const visibleSpoIds = useMemo(() => {
    const tpl = mergeWithDefaultTemplate(formTemplate || DEFAULT_LOGBOOK_TEMPLATE);
    return tpl.points
      .filter((p) => p.step >= 1 && p.step <= 6 && p.visible !== false)
      .map((p) => p.id);
  }, [formTemplate]);

  const hasHistoricalMalam = useMemo(
    () => logbooks.some((l) => l.shift === 'Malam') || shiftFilter === 'Malam',
    [logbooks, shiftFilter]
  );

  useEffect(() => {
    if (liveTodayDate !== todayDate) {
      setTodayDate(liveTodayDate);
      setDateFilter((prev) => (prev === todayDate ? liveTodayDate : prev));
    }
  }, [liveTodayDate, todayDate]);

  const selectedEntry = useMemo(
    () => (selectedEntryId ? logbooks.find((item) => item.id === selectedEntryId) || null : null),
    [logbooks, selectedEntryId]
  );

  const editingWizardEntry = useMemo(
    () =>
      editingWizardEntryId ? logbooks.find((item) => item.id === editingWizardEntryId) || null : null,
    [logbooks, editingWizardEntryId]
  );

  const isAdminUser = userProfile?.role === 'Administrator';
  const canEditBeforeVerify =
    userProfile?.role === 'PJ Shift' ||
    userProfile?.role === 'Kepala Ruang';

  const totalAssignedPendingCount = useMemo(
    () =>
      logbooks.filter(
        (item) =>
          isLogbookAssignedToVerifier(item, userProfile) &&
          item.verificationStatus === 'Pending'
      ).length,
    [logbooks, userProfile]
  );

  const queueItems = useMemo(() => {
    return logbooks.filter((item) => {
      if (!isLogbookAssignedToVerifier(item, userProfile)) return false;
      if (dateFilter && item.date !== dateFilter) return false;
      if (statusFilter === 'ALL') {
        if (item.verificationStatus === 'Approved' || item.verificationStatus === 'Draft') {
          return false;
        }
      } else if (item.verificationStatus !== statusFilter) {
        return false;
      }
      if (shiftFilter !== 'ALL' && item.shift !== shiftFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hit =
          item.nurseName.toLowerCase().includes(q) ||
          item.patientName.toLowerCase().includes(q) ||
          item.machineNumber.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [logbooks, userProfile, dateFilter, statusFilter, shiftFilter, searchTerm]);

  const approvableQueueItems = useMemo(
    () =>
      queueItems.filter(
        (item) =>
          item.verificationStatus !== 'Approved' &&
          getLogbookVerificationAccess(item, userProfile, nowMs).allowed
      ),
    [queueItems, userProfile, nowMs]
  );

  useEffect(() => {
    const validIds = new Set(approvableQueueItems.map((i) => i.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [approvableQueueItems]);

  const handleOpenEditWizard = (entry: LogbookEntry, fromReviewModal: boolean) => {
    setEditSuccessMsg(null);
    if (fromReviewModal) {
      setReopenReviewEntryId(entry.id);
      setSelectedEntryId(null);
    } else {
      setReopenReviewEntryId(null);
    }
    setEditingWizardEntryId(entry.id);
  };

  const handleVerify = async (entry: LogbookEntry, nextStatus: VerificationStatus, note?: string) => {
    if (!firebaseUser || !userProfile || !entry.id) return;
    const access = getLogbookVerificationAccess(entry, userProfile, Date.now());
    if (!access.allowed) {
      showToast(access.reason || 'Tidak dapat memverifikasi di luar jam operasional WIB.', 'error');
      return;
    }
    const targetStatus: VerificationStatus = nextStatus === 'Approved' ? 'Approved' : 'Revision';
    const verifierName =
      clampString(
        userProfile.fullName || firebaseUser.displayName || firebaseUser.email || 'Verifikator',
        120
      ) || 'Verifikator';
    setProcessingId(entry.id);
    try {
      await updateDoc(doc(db, 'logbook', entry.id), {
        verificationStatus: targetStatus,
        verifiedBy: firebaseUser.uid,
        verifiedByName: verifierName,
        verificationNote: clampString(note || '', 500),
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSelectedEntryId(null);
      setVerificationNote('');
      setEditSuccessMsg(null);
      showToast(
        targetStatus === 'Approved'
          ? `Logbook ${entry.patientName} berhasil disetujui.`
          : `Permintaan revisi untuk ${entry.patientName} berhasil dikirim.`,
        'success'
      );
    } catch (err) {
      showToast('Gagal menyimpan status verifikasi logbook.', 'error');
      handleFirestoreError(err, OperationType.UPDATE, `logbook/${entry.id}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleBatchApprove = async () => {
    if (!firebaseUser || !userProfile || selectedIds.size === 0 || batchApproving) return;
    if (userProfile.role === 'Administrator') {
      showToast('Administrator tidak diperbolehkan memberikan verifikasi.', 'error');
      return;
    }
    const now = Date.now();
    const targets = approvableQueueItems.filter(
      (item) =>
        selectedIds.has(item.id) &&
        getLogbookVerificationAccess(item, userProfile, now).allowed
    );
    if (targets.length === 0) {
      showToast('Tidak ada logbook terpilih yang masih berada dalam jam verifikasi WIB.', 'error');
      return;
    }

    const verifierName =
      clampString(
        userProfile.fullName || firebaseUser.displayName || firebaseUser.email || 'Verifikator',
        120
      ) || 'Verifikator';

    setBatchApproving(true);
    try {
      const batch = writeBatch(db);
      for (const entry of targets) {
        batch.update(doc(db, 'logbook', entry.id), {
          verificationStatus: 'Approved',
          verifiedBy: firebaseUser.uid,
          verifiedByName: verifierName,
          verificationNote: 'Sesuai standar asuhan HD',
          verifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setSelectedIds(new Set());
      showToast(`${targets.length} logbook berhasil disetujui sekaligus.`, 'success');
    } catch (err) {
      showToast('Gagal menyetujui beberapa logbook terpilih.', 'error');
      handleFirestoreError(err, OperationType.UPDATE, 'logbook');
    } finally {
      setBatchApproving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold text-slate-900">
          Verifikasi Logbook Tindakan Hemodialisa
        </h2>
        <p className="text-xs text-slate-500">
          Validasi kelengkapan tindakan perawat sebelum data masuk ke rekapitulasi terverifikasi unit.
        </p>
        <div className="mt-2 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-[11px] text-slate-700">
          <Clock className="h-3.5 w-3.5 text-[#0e4e78] shrink-0" />
          <span>
            <strong>Jam Verifikasi WIB:</strong> Shift Pagi{' '}
            <strong className="font-mono">{VERIFICATION_WINDOW_WIB.Pagi.label}</strong> · Shift Siang{' '}
            <strong className="font-mono">{VERIFICATION_WINDOW_WIB.Siang.label}</strong>{' '}
            (tutup tepat saat jam berakhir) · Sekarang{' '}
            <strong className="font-mono text-[#0e4e78]">{wibTimeLabel}</strong>
          </span>
        </div>
      </div>

      {isAdminUser && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>
            Akun Administrator tidak memiliki wewenang untuk memberikan verifikasi logbook.
          </span>
        </div>
      )}

      {editSuccessMsg && !selectedEntry && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            {editSuccessMsg}
          </span>
          <button
            type="button"
            onClick={() => setEditSuccessMsg(null)}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-100"
            aria-label="Tutup pemberitahuan"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari nama perawat, pasien, mesin..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="Filter Tanggal Verifikasi"
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
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
          >
            <option value="ALL">Semua Shift</option>
            <option value="Pagi">Shift Pagi</option>
            <option value="Siang">Shift Siang</option>
            {hasHistoricalMalam && <option value="Malam">Shift Malam</option>}
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'Pending' | 'Revision' | 'Approved' | 'ALL')
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
          >
            <option value="Pending">Menunggu Verifikasi (Pending)</option>
            <option value="Revision">Dalam Revisi</option>
            <option value="Approved">Terverifikasi (Sudah Diverifikasi)</option>
            <option value="ALL">Semua Belum Approved</option>
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

      {/* Batch Approval Bar */}
      {approvableQueueItems.length > 0 && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-2.5 text-xs">
          <span className="font-semibold text-teal-900">
            {selectedIds.size} logbook dipilih untuk disetujui
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal Pilih
            </button>
            <button
              type="button"
              disabled={batchApproving}
              onClick={handleBatchApprove}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-1.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {batchApproving ? 'Menyetujui...' : `Setujui Terpilih (${selectedIds.size})`}
            </button>
          </div>
        </div>
      )}

      {/* Queue Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {queueItems.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-teal-600" />
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {statusFilter === 'Approved'
                ? 'Belum ada logbook terverifikasi pada filter ini'
                : 'Tidak ada antrian logbook untuk diverifikasi'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {statusFilter === 'Approved'
                ? 'Ubah tanggal atau shift untuk melihat logbook yang sudah diverifikasi.'
                : 'Seluruh logbook pada filter ini telah divalidasi.'}
            </p>
            {totalAssignedPendingCount > 0 && (dateFilter || shiftFilter !== 'ALL' || statusFilter !== 'Pending') && (
              <button
                type="button"
                onClick={() => {
                  setDateFilter('');
                  setShiftFilter('ALL');
                  setStatusFilter('Pending');
                  setSearchTerm('');
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75]"
              >
                Tampilkan Semua Tanggal &amp; Shift ({totalAssignedPendingCount} Pending)
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  {approvableQueueItems.length > 0 && (
                    <th className="w-10 px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua logbook"
                        checked={
                          approvableQueueItems.length > 0 &&
                          approvableQueueItems.every((i) => selectedIds.has(i.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(approvableQueueItems.map((i) => i.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-semibold">Tanggal</th>
                  <th className="px-4 py-3 font-semibold">Perawat</th>
                  <th className="px-4 py-3 font-semibold">Pasien &amp; Tindakan</th>
                  <th className="px-4 py-3 font-semibold">Ringkasan Klinis</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi Verifikasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queueItems.map((item) => {
                  const verAccess = getLogbookVerificationAccess(item, userProfile, nowMs);
                  const canEditItem =
                    canEditBeforeVerify &&
                    verAccess.allowed &&
                    (item.verificationStatus === 'Pending' || item.verificationStatus === 'Revision');
                  const isApprovable =
                    item.verificationStatus !== 'Approved' && verAccess.allowed;
                  const hasComplication =
                    (item.wizardDetails?.section4?.complicationIncidents?.length || 0) > 0 ||
                    (Boolean(item.complications) &&
                      !/^tidak ada\b/i.test(item.complications.trim()) &&
                      item.complications.trim() !== '-');
                  const checklist = item.wizardDetails?.spoChecklist || {};
                  const spoDoneCount = visibleSpoIds.filter(
                    (id) => checklist[id] === 'DIKERJAKAN'
                  ).length;
                  const spoTotal = visibleSpoIds.length;
                  const hasSpoChecklist = Object.keys(checklist).length > 0;
                  const spoIncomplete = hasSpoChecklist && spoDoneCount < spoTotal;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      {approvableQueueItems.length > 0 && (
                        <td className="w-10 px-3 py-3 text-center">
                          {isApprovable && (
                            <input
                              type="checkbox"
                              aria-label={`Pilih ${item.patientName}`}
                              checked={selectedIds.has(item.id)}
                              onChange={(e) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                });
                              }}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatDateId(item.date)}
                        </div>
                        <div className="mt-1">
                          <ShiftBadge shift={item.shift} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{item.nurseName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{item.nurseNip}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{item.patientName}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.actionCategory} · {item.machineNumber}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          DPJP: {item.doctorName}
                          {item.dutyDoctorName ? ` · Jaga: ${item.dutyDoctorName}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-slate-700">
                        <div>
                          BB: {item.preWeight} &rarr; {item.postWeight} kg · UF:{' '}
                          <strong className="text-slate-900">{item.ufAchieved}</strong>/{item.ufGoal} ml
                        </div>
                        <div>
                          TD: {item.preBp || '-'} &rarr; {item.postBp || '-'}
                        </div>
                        {(hasComplication || spoIncomplete) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-sans text-[11px]">
                            {hasComplication && (
                              <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Ada Komplikasi ({item.complications || 'Intra-HD'})
                              </span>
                            )}
                            {spoIncomplete && (
                              <span className="font-semibold text-amber-700">
                                SPO {spoDoneCount}/{spoTotal}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <VerificationBadge status={item.verificationStatus} />
                        {item.verificationStatus === 'Approved' && item.verifiedByName && (
                          <p className="mt-1 text-[10px] text-emerald-700 font-medium">
                            Diverifikasi: {item.verifiedByName}
                          </p>
                        )}
                        {item.targetVerifierName && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            Tujuan: {item.targetVerifierName}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEntryId(item.id);
                              setVerificationNote(item.verificationNote || '');
                              setEditSuccessMsg(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Periksa
                          </button>
                          {canEditItem && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditWizard(item, false)}
                              className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Ubah
                            </button>
                          )}
                          {isApprovable && (
                            <button
                              type="button"
                              disabled={processingId === item.id || batchApproving}
                              onClick={() => handleVerify(item, 'Approved', 'Sesuai standar asuhan HD')}
                              className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Setujui
                            </button>
                          )}
                          {item.verificationStatus !== 'Approved' && !verAccess.allowed && (
                            <span
                              title={verAccess.reason || undefined}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500"
                            >
                              <Clock className="h-3 w-3 text-slate-400" />
                              Tutup ({verAccess.windowLabel})
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review & Verify Modal (Exact 7-Part Logbook Wizard Model) */}
      {selectedEntry && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-xs font-semibold text-slate-700 shadow-lg">
                Memuat formulir verifikasi...
              </div>
            </div>
          }
        >
          <LazyLogbookWizardModal
            editingEntry={selectedEntry}
            readOnly={true}
            initialPatientId={selectedEntry.patientId}
            initialMachineId={selectedEntry.machineId}
            initialDate={selectedEntry.date}
            initialShift={selectedEntry.shift}
            initialDoctorId={selectedEntry.doctorId}
            initialDutyDoctorId={selectedEntry.dutyDoctorId}
            initialDutyDoctorName={selectedEntry.dutyDoctorName}
            logbooks={logbooks}
            logbookLocks={logbookLocks}
            machineLocks={machineLocks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            formTemplate={formTemplate}
            verifierReview={{
              canEdit: Boolean(
                canEditBeforeVerify &&
                  getLogbookVerificationAccess(selectedEntry, userProfile, nowMs).allowed &&
                  (selectedEntry.verificationStatus === 'Pending' ||
                    selectedEntry.verificationStatus === 'Revision')
              ),
              note: verificationNote,
              onNoteChange: setVerificationNote,
              processing: processingId === selectedEntry.id,
              editSuccessMsg,
              onSwitchToEdit: () => handleOpenEditWizard(selectedEntry, true),
              onRequestRevision: () =>
                handleVerify(
                  selectedEntry,
                  'Revision',
                  verificationNote.trim() || 'Mohon lengkapi catatan tindakan.'
                ),
              onApprove: () =>
                handleVerify(
                  selectedEntry,
                  'Approved',
                  verificationNote.trim() || 'Terverifikasi sesuai standar HD'
                ),
            }}
            onClose={() => {
              setSelectedEntryId(null);
              setEditSuccessMsg(null);
            }}
          />
        </Suspense>
      )}

      {/* Verifier Logbook Edit Wizard Modal */}
      {editingWizardEntry && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-xs font-semibold text-slate-700 shadow-lg">
                Memuat formulir edit verifikator...
              </div>
            </div>
          }
        >
          <LazyLogbookWizardModal
            editingEntry={editingWizardEntry}
            verifierEditMode={true}
            initialPatientId={editingWizardEntry.patientId}
            initialMachineId={editingWizardEntry.machineId}
            initialDate={editingWizardEntry.date}
            initialShift={editingWizardEntry.shift}
            initialDoctorId={editingWizardEntry.doctorId}
            initialDutyDoctorId={editingWizardEntry.dutyDoctorId}
            initialDutyDoctorName={editingWizardEntry.dutyDoctorName}
            logbooks={logbooks}
            logbookLocks={logbookLocks}
            machineLocks={machineLocks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            formTemplate={formTemplate}
            onSaved={() => {
              const msg = `Perubahan logbook ${editingWizardEntry.patientName} berhasil disimpan.`;
              setEditSuccessMsg(msg);
              showToast(msg, 'success');
            }}
            onClose={() => {
              const toReopen = reopenReviewEntryId;
              setEditingWizardEntryId(null);
              setReopenReviewEntryId(null);
              if (toReopen) {
                setSelectedEntryId(toReopen);
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}


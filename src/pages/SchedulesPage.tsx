import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  CalendarPlus,
  FileSpreadsheet,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  clampString,
  formatDateId,
  formatMonthLabel,
  getCurrentMonthKey,
  getDayNameId,
  getDaysInMonth,
  getTodayDateStr,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { ShiftBadge, ValidationBadge } from '../components/ui/StatusBadge';
import { ImportScheduleSpreadsheetModal } from '../components/schedules/ImportScheduleSpreadsheetModal';
import {
  ROLE_SORT_ORDER,
  type Doctor,
  type DoctorScheduleEntry,
  type PjShiftAssignmentEntry,
  type ScheduleEntry,
  type ScheduleShiftType,
  type ShiftType,
  type StaffDirectoryEntry,
} from '../types';

interface SchedulesPageProps {
  schedules: ScheduleEntry[];
  pjShiftAssignments?: PjShiftAssignmentEntry[];
  doctorSchedules: DoctorScheduleEntry[];
  doctors: Doctor[];
  staffDirectory: StaffDirectoryEntry[];
}

export function SchedulesPage({
  schedules,
  pjShiftAssignments = [],
  doctorSchedules,
  doctors,
  staffDirectory,
}: SchedulesPageProps) {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<'nurses' | 'pj_shift' | 'doctors'>('nurses');
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());

  // Admin nurse quick assignment form
  const [targetNurseId, setTargetNurseId] = useState('');
  const [targetDate, setTargetDate] = useState(getTodayDateStr());
  const [targetShift, setTargetShift] = useState<ScheduleShiftType>('Pagi');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [validatingAll, setValidatingAll] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);

  // Admin doctor schedule assignment form
  const activeDoctors = useMemo(() => doctors.filter((d) => d.status === 'Aktif'), [doctors]);
  const [docDate, setDocDate] = useState(getTodayDateStr());
  const [docShift, setDocShift] = useState<ShiftType>('Pagi');
  const [docDpjpId, setDocDpjpId] = useState('');
  const [docDutyId, setDocDutyId] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [batchSavingDoc, setBatchSavingDoc] = useState(false);

  // PJ Shift single-assignee per shift/date form
  const pjStaffList = useMemo(
    () =>
      staffDirectory
        .filter((s) => s.isActive && s.role === 'PJ Shift')
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staffDirectory]
  );
  const [pjDate, setPjDate] = useState(getTodayDateStr());
  const [pjShift, setPjShift] = useState<ShiftType>('Pagi');
  const [pjNurseId, setPjNurseId] = useState('');
  const [pjNotes, setPjNotes] = useState('');
  const [savingPj, setSavingPj] = useState(false);
  const [batchSavingPj, setBatchSavingPj] = useState(false);
  const [deletingPjId, setDeletingPjId] = useState<string | null>(null);
  const [pjFeedback, setPjFeedback] = useState<string | null>(null);

  if (!userProfile) return null;

  const isAdmin = userProfile.role === 'Administrator';
  const isKepalaRuang = userProfile.role === 'Kepala Ruang';
  const canManagePjAssignment = isAdmin || isKepalaRuang;
  const isNurseOnly = userProfile.role === 'Perawat Pelaksana';

  const days = useMemo(() => getDaysInMonth(monthKey), [monthKey]);

  const sortedActiveStaff = useMemo(() => {
    return staffDirectory
      .filter((s) => s.isActive)
      .sort((a, b) => {
        const orderDiff = (ROLE_SORT_ORDER[a.role] ?? 99) - (ROLE_SORT_ORDER[b.role] ?? 99);
        if (orderDiff !== 0) return orderDiff;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [staffDirectory]);

  const clinicalStaff = useMemo(() => {
    if (isNurseOnly) {
      return sortedActiveStaff.filter((s) => s.uid === userProfile.uid);
    }
    return sortedActiveStaff;
  }, [sortedActiveStaff, isNurseOnly, userProfile.uid]);

  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    for (const s of schedules) {
      if (s.monthKey === monthKey) {
        map.set(`${s.nurseId}_${s.date}`, s);
      }
    }
    return map;
  }, [schedules, monthKey]);

  const allScheduleByNurseDateMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    for (const s of schedules) {
      map.set(`${s.nurseId}_${s.date}`, s);
    }
    return map;
  }, [schedules]);

  const pjAssignmentMap = useMemo(() => {
    const map = new Map<string, PjShiftAssignmentEntry>();
    for (const a of pjShiftAssignments) {
      if (a.monthKey === monthKey) {
        map.set(`${a.date}_${a.shift}`, a);
      }
    }
    return map;
  }, [pjShiftAssignments, monthKey]);

  const pjAssignmentByStaffDateMap = useMemo(() => {
    const map = new Map<string, ShiftType[]>();
    for (const a of pjShiftAssignments) {
      if (a.monthKey === monthKey) {
        const key = `${a.pjNurseId}_${a.date}`;
        const list = map.get(key) || [];
        list.push(a.shift);
        map.set(key, list);
      }
    }
    return map;
  }, [pjShiftAssignments, monthKey]);

  const doctorScheduleMap = useMemo(() => {
    const map = new Map<string, DoctorScheduleEntry>();
    for (const ds of doctorSchedules) {
      if (ds.monthKey === monthKey) {
        map.set(`${ds.date}_${ds.shift}`, ds);
      }
    }
    return map;
  }, [doctorSchedules, monthKey]);

  const monthSchedules = useMemo(
    () => schedules.filter((s) => s.monthKey === monthKey),
    [schedules, monthKey]
  );

  const resolvedPjNurseId = pjNurseId || pjStaffList[0]?.uid || '';

  const draftCount = monthSchedules.filter((s) => s.validationStatus === 'Draft').length;

  const defaultDpjp = useMemo(
    () =>
      activeDoctors.find((d) => /sp\.?pd|kgh|konsulen|nefro/i.test(d.specialization)) ||
      activeDoctors[0],
    [activeDoctors]
  );

  const defaultDuty = useMemo(
    () =>
      activeDoctors.find((d) => /umum|jaga|duty/i.test(d.specialization)) ||
      activeDoctors.find((d) => d.id !== defaultDpjp?.id) ||
      activeDoctors[0],
    [activeDoctors, defaultDpjp]
  );

  const resolvedDocDpjpId = docDpjpId || defaultDpjp?.id || '';
  const resolvedDocDutyId = docDutyId || defaultDuty?.id || '';

  const handleAssignShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const nurse = staffDirectory.find((s) => s.uid === targetNurseId);
    if (!nurse || !targetDate) return;

    setSaving(true);
    const docId = `${nurse.uid}_${targetDate}`;
    try {
      await setDoc(doc(db, 'schedules', docId), {
        nurseId: nurse.uid,
        nurseName: clampString(nurse.fullName, 120),
        date: targetDate,
        monthKey: targetDate.slice(0, 7),
        shift: targetShift,
        validationStatus: 'Draft',
        notes: clampString(notes || '', 300),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNotes('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `schedules/${docId}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAssignDoctorSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docDate) return;
    const dpjpObj = activeDoctors.find((d) => d.id === resolvedDocDpjpId);
    const dutyObj = activeDoctors.find((d) => d.id === resolvedDocDutyId);
    if (!dpjpObj || !dutyObj) return;

    setSavingDoc(true);
    const docId = `${docDate}_${docShift}`;
    const existing = doctorScheduleMap.get(docId);
    try {
      if (existing) {
        await updateDoc(doc(db, 'doctor_schedules', docId), {
          dpjpDoctorId: dpjpObj.id,
          dpjpDoctorName: clampString(dpjpObj.fullName, 120),
          dutyDoctorId: dutyObj.id,
          dutyDoctorName: clampString(dutyObj.fullName, 120),
          notes: clampString(docNotes || '', 300),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'doctor_schedules', docId), {
          date: docDate,
          monthKey: docDate.slice(0, 7),
          shift: docShift,
          dpjpDoctorId: dpjpObj.id,
          dpjpDoctorName: clampString(dpjpObj.fullName, 120),
          dutyDoctorId: dutyObj.id,
          dutyDoctorName: clampString(dutyObj.fullName, 120),
          notes: clampString(docNotes || '', 300),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setDocNotes('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `doctor_schedules/${docId}`);
    } finally {
      setSavingDoc(false);
    }
  };

  const handleApplyDoctorMonthTemplate = async () => {
    if (!isAdmin) return;
    const dpjpObj = activeDoctors.find((d) => d.id === resolvedDocDpjpId);
    const dutyObj = activeDoctors.find((d) => d.id === resolvedDocDutyId);
    if (!dpjpObj || !dutyObj || days.length === 0) return;

    setBatchSavingDoc(true);
    try {
      const batch = writeBatch(db);
      for (const d of days) {
        const docId = `${d}_${docShift}`;
        const existing = doctorScheduleMap.get(docId);
        if (existing) {
          batch.update(doc(db, 'doctor_schedules', docId), {
            dpjpDoctorId: dpjpObj.id,
            dpjpDoctorName: clampString(dpjpObj.fullName, 120),
            dutyDoctorId: dutyObj.id,
            dutyDoctorName: clampString(dutyObj.fullName, 120),
            notes: clampString(docNotes || '', 300),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'doctor_schedules', docId), {
            date: d,
            monthKey: d.slice(0, 7),
            shift: docShift,
            dpjpDoctorId: dpjpObj.id,
            dpjpDoctorName: clampString(dpjpObj.fullName, 120),
            dutyDoctorId: dutyObj.id,
            dutyDoctorName: clampString(dutyObj.fullName, 120),
            notes: clampString(docNotes || '', 300),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'doctor_schedules');
    } finally {
      setBatchSavingDoc(false);
    }
  };

  const handleAssignPjShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePjAssignment || !pjDate) return;
    const selectedPj = pjStaffList.find((s) => s.uid === resolvedPjNurseId);
    if (!selectedPj) return;

    setSavingPj(true);
    setPjFeedback(null);
    const docId = `${pjDate}_${pjShift}`;
    const existing = pjShiftAssignments.find((a) => a.id === docId);
    try {
      if (existing) {
        await updateDoc(doc(db, 'pj_shift_assignments', docId), {
          pjNurseId: selectedPj.uid,
          pjNurseName: clampString(selectedPj.fullName, 120),
          pjNurseRole: 'PJ Shift',
          notes: clampString(pjNotes || '', 300),
          assignedBy: userProfile.uid,
          assignedByName: clampString(userProfile.fullName, 120),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'pj_shift_assignments', docId), {
          date: pjDate,
          monthKey: pjDate.slice(0, 7),
          shift: pjShift,
          pjNurseId: selectedPj.uid,
          pjNurseName: clampString(selectedPj.fullName, 120),
          pjNurseRole: 'PJ Shift',
          notes: clampString(pjNotes || '', 300),
          assignedBy: userProfile.uid,
          assignedByName: clampString(userProfile.fullName, 120),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setPjFeedback(
        `Penugasan PJ Shift ${pjShift} tanggal ${formatDateId(pjDate)} ditetapkan kepada ${selectedPj.fullName}.`
      );
      setPjNotes('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `pj_shift_assignments/${docId}`);
    } finally {
      setSavingPj(false);
    }
  };

  const handleApplyPjMonthTemplate = async () => {
    if (!canManagePjAssignment || days.length === 0) return;
    const selectedPj = pjStaffList.find((s) => s.uid === resolvedPjNurseId);
    if (!selectedPj) return;

    setBatchSavingPj(true);
    setPjFeedback(null);
    try {
      const batch = writeBatch(db);
      for (const d of days) {
        const docId = `${d}_${pjShift}`;
        const existing = pjShiftAssignments.find((a) => a.id === docId);
        if (existing) {
          batch.update(doc(db, 'pj_shift_assignments', docId), {
            pjNurseId: selectedPj.uid,
            pjNurseName: clampString(selectedPj.fullName, 120),
            pjNurseRole: 'PJ Shift',
            notes: clampString(pjNotes || '', 300),
            assignedBy: userProfile.uid,
            assignedByName: clampString(userProfile.fullName, 120),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'pj_shift_assignments', docId), {
            date: d,
            monthKey: d.slice(0, 7),
            shift: pjShift,
            pjNurseId: selectedPj.uid,
            pjNurseName: clampString(selectedPj.fullName, 120),
            pjNurseRole: 'PJ Shift',
            notes: clampString(pjNotes || '', 300),
            assignedBy: userProfile.uid,
            assignedByName: clampString(userProfile.fullName, 120),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
      setPjFeedback(
        `Penugasan PJ Shift ${pjShift} untuk seluruh tanggal di ${formatMonthLabel(monthKey)} diterapkan kepada ${selectedPj.fullName}.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'pj_shift_assignments');
    } finally {
      setBatchSavingPj(false);
    }
  };

  const handleDeletePjAssignment = async (entry: PjShiftAssignmentEntry) => {
    if (!canManagePjAssignment) return;
    setDeletingPjId(entry.id);
    setPjFeedback(null);
    try {
      await deleteDoc(doc(db, 'pj_shift_assignments', entry.id));
      setPjFeedback(
        `Penugasan PJ Shift ${entry.shift} tanggal ${formatDateId(entry.date)} (${entry.pjNurseName}) dihapus.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `pj_shift_assignments/${entry.id}`);
    } finally {
      setDeletingPjId(null);
    }
  };

  const handleCycleCellShift = async (nurse: StaffDirectoryEntry, date: string) => {
    if (!isAdmin) return;
    const order: ScheduleShiftType[] = ['Pagi', 'Siang', 'Malam', 'Libur', 'Cuti'];
    const docId = `${nurse.uid}_${date}`;
    const current = scheduleMap.get(docId);
    const nextShift = current
      ? order[(order.indexOf(current.shift) + 1) % order.length]
      : 'Pagi';

    try {
      if (current) {
        await updateDoc(doc(db, 'schedules', docId), {
          shift: nextShift,
          validationStatus: 'Draft',
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'schedules', docId), {
          nurseId: nurse.uid,
          nurseName: clampString(nurse.fullName, 120),
          date,
          monthKey: date.slice(0, 7),
          shift: nextShift,
          validationStatus: 'Draft',
          notes: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `schedules/${docId}`);
    }
  };

  const handleValidateMonth = async () => {
    if (!isKepalaRuang || draftCount === 0) return;
    setValidatingAll(true);
    try {
      const drafts = monthSchedules.filter((s) => s.validationStatus === 'Draft');
      for (const d of drafts) {
        await updateDoc(doc(db, 'schedules', d.id), {
          validationStatus: 'Validated',
          validatedBy: userProfile.uid,
          validatedByName: clampString(userProfile.fullName, 120),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'schedules');
    } finally {
      setValidatingAll(false);
    }
  };

  const shiftChipLetter: Record<ScheduleShiftType, { code: string; cls: string }> = {
    Pagi: { code: 'P', cls: 'bg-sky-100 text-sky-800 border-sky-200' },
    Siang: { code: 'S', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    Malam: { code: 'M', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
    Libur: { code: 'L', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
    Cuti: { code: 'C', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            {isNurseOnly ? 'Jadwal Dinas Pribadi & Tim Dokter' : 'Jadwal Dinas Shift & Dokter Unit HD'}
          </h2>
          <p className="text-xs text-slate-500">
            {isAdmin
              ? 'Atur jadwal shift perawat dan matriks jadwal Dokter DPJP serta Dokter Jaga Ruangan per tanggal dan shift.'
              : isKepalaRuang
              ? 'Tinjau susunan jadwal dinas ruangan, lakukan validasi jadwal bulanan, dan pantau matriks jadwal dokter.'
              : 'Matrix jadwal dinas Pagi, Siang, Malam, dan jadwal Dokter DPJP / Dokter Jaga periode berjalan.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="month"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
          />
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setScheduleFeedback(null);
                setShowImportModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75]"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Input Jadwal dari Spreadsheet
            </button>
          )}
          {isKepalaRuang && activeTab === 'nurses' && draftCount > 0 && (
            <button
              type="button"
              disabled={validatingAll}
              onClick={handleValidateMonth}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              {validatingAll ? 'Memvalidasi...' : `Validasi Jadwal (${draftCount} Draft)`}
            </button>
          )}
        </div>
      </div>

      {scheduleFeedback && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-medium text-teal-800">
          {scheduleFeedback}
        </div>
      )}

      {/* Mode Switcher Tabs: Perawat & Staf, Penugasan PJ Shift (1 per Shift), dan Dokter */}
      <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('nurses')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
            activeTab === 'nurses'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Jadwal Shift Perawat &amp; Staf
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pj_shift')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
            activeTab === 'pj_shift'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" />
          Penugasan PJ Shift
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('doctors')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
            activeTab === 'doctors'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Stethoscope className="h-3.5 w-3.5" />
          Matriks Jadwal Dokter (DPJP &amp; Dokter Jaga)
        </button>
      </div>

      {activeTab === 'pj_shift' ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs text-teal-900 leading-relaxed">
            <strong>Aturan Penugasan PJ Shift (1 Orang per Shift):</strong> Karena terdapat beberapa akun dengan role{' '}
            <em>PJ Shift</em>, tetapkan tepat <strong>1 (satu) orang PJ Shift</strong> penanggung jawab utama untuk setiap shift (Pagi, Siang, Malam) per tanggal. Penetapan ini mengunci hak <strong>Pengesahan Digital</strong> pada Laporan PJ Shift (Bagian F) dan memprioritaskan tujuan verifikasi logbook.
          </div>

          {pjFeedback && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-medium text-teal-800">
              {pjFeedback}
            </div>
          )}

          {canManagePjAssignment && (
            <form
              onSubmit={handleAssignPjShift}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Atur Penugasan PJ Shift Bertugas
                </h3>
                <p className="text-xs text-slate-500">
                  Dapat dikelola oleh Kepala Ruang dan Administrator.
                </p>
              </div>

              {pjStaffList.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Belum ada akun staf aktif dengan role <strong>PJ Shift</strong> di menu Data Akun.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
                      <input
                        type="date"
                        required
                        value={pjDate}
                        onChange={(e) => setPjDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Shift</label>
                      <select
                        value={pjShift}
                        onChange={(e) => setPjShift(e.target.value as ShiftType)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                      >
                        <option value="Pagi">Shift Pagi (07.00–14.00)</option>
                        <option value="Siang">Shift Siang (12.00–19.00)</option>
                        <option value="Malam">Shift Malam (21.00–07.00)</option>
                      </select>
                    </div>
                    <div className="lg:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        PJ Shift Penanggung Jawab (1 Orang per Shift)
                      </label>
                      <select
                        required
                        value={resolvedPjNurseId}
                        onChange={(e) => setPjNurseId(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                      >
                        <option value="">-- Pilih Akun PJ Shift --</option>
                        {pjStaffList.map((pj) => {
                          const daySched = allScheduleByNurseDateMap.get(`${pj.uid}_${pjDate}`);
                          return (
                            <option key={pj.uid} value={pj.uid}>
                              {pj.fullName}
                              {daySched ? ` (Jadwal Dinas: ${daySched.shift})` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Catatan (Opsional)
                      </label>
                      <input
                        type="text"
                        value={pjNotes}
                        onChange={(e) => setPjNotes(e.target.value)}
                        placeholder="PJ Utama / Pengganti"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      disabled={batchSavingPj || !resolvedPjNurseId}
                      onClick={handleApplyPjMonthTemplate}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-teal-600 bg-white px-4 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-60"
                    >
                      {batchSavingPj
                        ? 'Menerapkan...'
                        : `Terapkan ke Semua Tanggal (${formatMonthLabel(monthKey)} · ${pjShift})`}
                    </button>
                    <button
                      type="submit"
                      disabled={savingPj || !resolvedPjNurseId}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                    >
                      <UserCheck className="h-4 w-4" />
                      {savingPj ? 'Menyimpan...' : 'Simpan Penugasan PJ'}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}

          {/* Monthly Matrix Table of PJ Shift Assignments */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Matriks Penugasan PJ Shift — {formatMonthLabel(monthKey)}
              </h3>
              <span className="text-xs text-slate-500">
                {canManagePjAssignment
                  ? 'Klik sel untuk memuat ke formulir di atas'
                  : 'Ditetapkan oleh Kepala Ruang / Administrator'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tanggal</th>
                    <th className="px-4 py-3 font-semibold">Shift Pagi (07.00–14.00)</th>
                    <th className="px-4 py-3 font-semibold">Shift Siang (12.00–19.00)</th>
                    <th className="px-4 py-3 font-semibold">Shift Malam (21.00–07.00)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {days.map((d) => {
                    const dayName = getDayNameId(d);
                    return (
                      <tr key={d} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDateId(d)}
                          </div>
                          <div className="text-[11px] text-slate-500">{dayName}</div>
                        </td>
                        {(['Pagi', 'Siang', 'Malam'] as ShiftType[]).map((sh) => {
                          const entry = pjAssignmentMap.get(`${d}_${sh}`);
                          return (
                            <td key={sh} className="px-4 py-2.5 align-top">
                              {entry ? (
                                <div className="flex items-stretch gap-1">
                                  <button
                                    type="button"
                                    disabled={!canManagePjAssignment}
                                    onClick={() => {
                                      if (!canManagePjAssignment) return;
                                      setPjDate(d);
                                      setPjShift(sh);
                                      setPjNurseId(entry.pjNurseId);
                                      setPjNotes(entry.notes || '');
                                    }}
                                    className={`flex-1 text-left rounded-lg border border-teal-200 bg-teal-50/70 p-2 text-[11px] ${
                                      canManagePjAssignment
                                        ? 'hover:border-teal-600 hover:bg-teal-50 cursor-pointer'
                                        : 'cursor-default'
                                    }`}
                                  >
                                    <div className="font-semibold text-slate-900 truncate">
                                      {entry.pjNurseName}
                                    </div>
                                    <div className="text-[10px] text-teal-800 truncate">
                                      {entry.notes ? entry.notes : 'PJ Shift Bertugas'}
                                    </div>
                                  </button>
                                  {canManagePjAssignment && (
                                    <button
                                      type="button"
                                      disabled={deletingPjId === entry.id}
                                      onClick={() => handleDeletePjAssignment(entry)}
                                      title={`Hapus penugasan ${entry.pjNurseName}`}
                                      className="rounded-lg border border-slate-200 bg-white px-2 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canManagePjAssignment}
                                  onClick={() => {
                                    if (!canManagePjAssignment) return;
                                    setPjDate(d);
                                    setPjShift(sh);
                                  }}
                                  className={`w-full text-left rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-[11px] text-slate-400 ${
                                    canManagePjAssignment
                                      ? 'hover:border-teal-600 hover:text-teal-700 cursor-pointer'
                                      : 'cursor-default'
                                  }`}
                                >
                                  {canManagePjAssignment ? '+ Tetapkan PJ Shift' : 'Belum ditetapkan'}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'doctors' ? (
        <div className="space-y-5">
          {isAdmin && (
            <form
              onSubmit={handleAssignDoctorSchedule}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Pengaturan Jadwal Dokter DPJP &amp; Dokter Jaga Ruangan
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pilihan di sini akan otomatis tampil pada panel Tim Medis Berdinas di halaman Logbook sesuai tanggal dan shift.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
                  <input
                    type="date"
                    required
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-[#0B5A8E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Shift</label>
                  <select
                    value={docShift}
                    onChange={(e) => setDocShift(e.target.value as ShiftType)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  >
                    <option value="Pagi">Shift Pagi</option>
                    <option value="Siang">Shift Siang</option>
                    <option value="Malam">Shift Malam</option>
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dokter DPJP Unit Hemodialisis
                  </label>
                  <select
                    required
                    value={resolvedDocDpjpId}
                    onChange={(e) => setDocDpjpId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  >
                    <option value="">-- Pilih Dokter DPJP --</option>
                    {activeDoctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({d.specialization})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dokter Jaga Ruangan (Duty Doctor)
                  </label>
                  <select
                    required
                    value={resolvedDocDutyId}
                    onChange={(e) => setDocDutyId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  >
                    <option value="">-- Pilih Dokter Jaga --</option>
                    {activeDoctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({d.specialization})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-slate-100">
                <input
                  type="text"
                  value={docNotes}
                  onChange={(e) => setDocNotes(e.target.value)}
                  placeholder="Catatan tambahan (opsional, misal: DPJP On-call / Konsulen Utama)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={batchSavingDoc || activeDoctors.length === 0}
                    onClick={handleApplyDoctorMonthTemplate}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#0B5A8E] bg-white px-4 py-2 text-xs font-semibold text-[#0B5A8E] hover:bg-sky-50 disabled:opacity-60"
                  >
                    {batchSavingDoc
                      ? 'Menerapkan...'
                      : `Terapkan ke Semua Tanggal (${formatMonthLabel(monthKey)} · ${docShift})`}
                  </button>
                  <button
                    type="submit"
                    disabled={savingDoc || activeDoctors.length === 0}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75] disabled:opacity-60"
                  >
                    <CalendarPlus className="h-4 w-4" />
                    {savingDoc ? 'Menyimpan...' : 'Simpan Tanggal Ini'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Monthly Matrix Table of Doctor Schedules */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Matriks Jadwal Dokter — {formatMonthLabel(monthKey)}
              </h3>
              <span className="text-xs text-slate-500">
                {isAdmin
                  ? 'Klik baris shift untuk memuat data ke formulir di atas'
                  : 'Ditetapkan oleh Administrator Unit Hemodialisa'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tanggal</th>
                    <th className="px-4 py-3 font-semibold">Shift Pagi (07.00–14.00)</th>
                    <th className="px-4 py-3 font-semibold">Shift Siang (12.00–19.00)</th>
                    <th className="px-4 py-3 font-semibold">Shift Malam (21.00–07.00)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {days.map((d) => {
                    const dayName = getDayNameId(d);
                    return (
                      <tr key={d} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatDateId(d)}
                          </div>
                          <div className="text-[11px] text-slate-500">{dayName}</div>
                        </td>
                        {(['Pagi', 'Siang', 'Malam'] as ShiftType[]).map((sh) => {
                          const entry = doctorScheduleMap.get(`${d}_${sh}`);
                          return (
                            <td key={sh} className="px-4 py-2.5 align-top">
                              {entry ? (
                                <button
                                  type="button"
                                  disabled={!isAdmin}
                                  onClick={() => {
                                    if (!isAdmin) return;
                                    setDocDate(d);
                                    setDocShift(sh);
                                    setDocDpjpId(entry.dpjpDoctorId);
                                    setDocDutyId(entry.dutyDoctorId);
                                    setDocNotes(entry.notes || '');
                                  }}
                                  className={`w-full text-left rounded-lg border border-slate-200 bg-slate-50/80 p-2 text-[11px] ${
                                    isAdmin ? 'hover:border-[#0B5A8E] hover:bg-sky-50/40 cursor-pointer' : 'cursor-default'
                                  }`}
                                >
                                  <div className="font-semibold text-slate-900 truncate">
                                    DPJP: {entry.dpjpDoctorName}
                                  </div>
                                  <div className="text-slate-600 truncate">
                                    Jaga: {entry.dutyDoctorName}
                                  </div>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!isAdmin}
                                  onClick={() => {
                                    if (!isAdmin) return;
                                    setDocDate(d);
                                    setDocShift(sh);
                                  }}
                                  className={`w-full text-left rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-[11px] text-slate-400 ${
                                    isAdmin ? 'hover:border-[#0B5A8E] hover:text-[#0B5A8E] cursor-pointer' : 'cursor-default'
                                  }`}
                                >
                                  {isAdmin ? '+ Atur Dokter' : 'Belum diatur'}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Admin Quick Nurse Input Form */}
          {isAdmin && (
            <form
              onSubmit={handleAssignShift}
              className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Perawat / Staf</label>
                <select
                  required
                  value={targetNurseId}
                  onChange={(e) => setTargetNurseId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                >
                  <option value="">-- Pilih Staf --</option>
                  {sortedActiveStaff.map((s) => (
                    <option key={s.uid} value={s.uid}>
                      {s.fullName} ({s.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
                <input
                  type="date"
                  required
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Shift</label>
                <select
                  value={targetShift}
                  onChange={(e) => setTargetShift(e.target.value as ScheduleShiftType)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                >
                  <option value="Pagi">Pagi</option>
                  <option value="Siang">Siang</option>
                  <option value="Malam">Malam</option>
                  <option value="Libur">Libur</option>
                  <option value="Cuti">Cuti</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Catatan (Opsional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="PJ Ruang A / On-call"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                <CalendarPlus className="h-4 w-4" />
                {saving ? 'Menyimpan...' : 'Simpan Shift'}
              </button>
            </form>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Keterangan Shift:</span>
            <ShiftBadge shift="Pagi" />
            <ShiftBadge shift="Siang" />
            <ShiftBadge shift="Malam" />
            <ShiftBadge shift="Libur" />
            <ShiftBadge shift="Cuti" />
          </div>

          {/* Personal Schedule List for Perawat Pelaksana */}
          {isNurseOnly ? (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5">
                <h3 className="text-sm font-semibold text-slate-900">
                  Jadwal Shift Saya — {formatMonthLabel(monthKey)}
                </h3>
              </div>
              {monthSchedules.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Belum ada jadwal dinas yang diinputkan Administrator untuk bulan {formatMonthLabel(monthKey)}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Tanggal</th>
                        <th className="px-4 py-3 font-semibold">Shift</th>
                        <th className="px-4 py-3 font-semibold">Catatan</th>
                        <th className="px-4 py-3 font-semibold text-right">Status Validasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthSchedules
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                              {formatDateId(s.date)}
                            </td>
                            <td className="px-4 py-3">
                              <ShiftBadge shift={s.shift} />
                            </td>
                            <td className="px-4 py-3 text-slate-600">{s.notes || '-'}</td>
                            <td className="px-4 py-3 text-right">
                              <ValidationBadge status={s.validationStatus} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* Matrix View for Admin, Kepala Ruang, PJ Shift */
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 font-semibold border-r border-slate-200 min-w-[160px]">
                        Perawat / Staf
                      </th>
                      {days.map((d) => (
                        <th
                          key={d}
                          className="px-1.5 py-2.5 text-center font-mono font-semibold tabular-nums min-w-[34px]"
                        >
                          {Number(d.slice(8, 10))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clinicalStaff.map((staff) => (
                      <tr key={staff.uid} className="hover:bg-slate-50/70">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-900 border-r border-slate-200">
                          <div className="truncate max-w-[150px]">{staff.fullName}</div>
                          <div className="text-[10px] text-slate-400">{staff.role}</div>
                        </td>
                        {days.map((d) => {
                          const entry = scheduleMap.get(`${staff.uid}_${d}`);
                          const meta = entry ? shiftChipLetter[entry.shift] : null;
                          const assignedPjShifts = pjAssignmentByStaffDateMap.get(`${staff.uid}_${d}`);
                          const pjHint = assignedPjShifts?.length
                            ? ` · PJ Shift Bertugas (${assignedPjShifts.join('/')})`
                            : '';
                          return (
                            <td key={d} className="p-1 text-center">
                              <button
                                type="button"
                                disabled={!isAdmin}
                                onClick={() => handleCycleCellShift(staff, d)}
                                title={
                                  entry
                                    ? `${staff.fullName} · ${d} · ${entry.shift} (${entry.validationStatus})${pjHint}`
                                    : isAdmin
                                    ? `Klik untuk tambah shift ${staff.fullName} (${d})${pjHint}`
                                    : `Belum terjadwal${pjHint}`
                                }
                                className={`relative h-7 w-7 rounded border font-mono text-[11px] font-bold transition-colors ${
                                  meta
                                    ? meta.cls
                                    : 'border-dashed border-slate-200 text-slate-300 hover:border-teal-400'
                                } ${
                                  assignedPjShifts?.length ? 'ring-1 ring-teal-600 ring-offset-1' : ''
                                } ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                {meta ? meta.code : '·'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showImportModal && isAdmin && (
        <ImportScheduleSpreadsheetModal
          defaultMonthKey={monthKey}
          staffDirectory={staffDirectory}
          existingSchedules={schedules}
          onClose={() => setShowImportModal(false)}
          onImported={({ monthKey: importedMonth, savedCount }) => {
            setShowImportModal(false);
            setMonthKey(importedMonth);
            setActiveTab('nurses');
            setScheduleFeedback(
              `${savedCount} jadwal shift untuk bulan ${formatMonthLabel(importedMonth)} berhasil diimpor dari spreadsheet.`
            );
          }}
        />
      )}
    </div>
  );
}

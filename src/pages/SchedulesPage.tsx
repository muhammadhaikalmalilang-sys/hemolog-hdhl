import React, { useEffect, useMemo, useState } from 'react';
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  CalendarPlus,
  FileSpreadsheet,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  db,
  formatFirestoreError,
  getUserFriendlyFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  clampString,
  formatDateId,
  formatMonthLabel,
  getDayNameId,
  getDaysInMonth,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ensureMinName(value: string | undefined, maxLen: number, fallback: string): string {
  const cleaned = clampString(value || '', maxLen);
  return cleaned.length >= 2 ? cleaned : fallback;
}

export function SchedulesPage({
  schedules,
  pjShiftAssignments = [],
  doctorSchedules,
  doctors,
  staffDirectory,
}: SchedulesPageProps) {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const { todayDate: liveTodayDate, currentMonthKey: liveMonthKey } = useLiveClock();
  const [trackedTodayDate, setTrackedTodayDate] = useState(liveTodayDate);
  const [activeTab, setActiveTab] = useState<'nurses' | 'pj_shift' | 'doctors'>('nurses');
  const [monthKey, setMonthKey] = useState(liveMonthKey);

  // Admin nurse quick assignment form
  const [targetNurseId, setTargetNurseId] = useState('');
  const [targetDate, setTargetDate] = useState(liveTodayDate);
  const [targetShift, setTargetShift] = useState<ScheduleShiftType>('Pagi');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [validatingAll, setValidatingAll] = useState(false);
  const [busyScheduleCell, setBusyScheduleCell] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Admin doctor schedule assignment form
  const activeDoctors = useMemo(() => doctors.filter((d) => d.status === 'Aktif'), [doctors]);
  const [docDate, setDocDate] = useState(liveTodayDate);
  const [docShift, setDocShift] = useState<ShiftType>('Pagi');
  const [docDpjpId, setDocDpjpId] = useState('');
  const [docDutyId, setDocDutyId] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [batchSavingDoc, setBatchSavingDoc] = useState(false);
  const [docFeedback, setDocFeedback] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  // PJ Shift single-assignee per shift/date form
  const pjStaffList = useMemo(
    () =>
      staffDirectory
        .filter((s) => s.isActive && s.role === 'PJ Shift')
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staffDirectory]
  );
  const [pjDate, setPjDate] = useState(liveTodayDate);
  const [pjShift, setPjShift] = useState<ShiftType>('Pagi');
  const [pjNurseId, setPjNurseId] = useState('');
  const [pjNotes, setPjNotes] = useState('');
  const [savingPj, setSavingPj] = useState(false);
  const [batchSavingPj, setBatchSavingPj] = useState(false);
  const [deletingPjId, setDeletingPjId] = useState<string | null>(null);
  const [pjFeedback, setPjFeedback] = useState<string | null>(null);
  const [pjError, setPjError] = useState<string | null>(null);

  useEffect(() => {
    if (liveTodayDate !== trackedTodayDate) {
      const prevMonth = trackedTodayDate.slice(0, 7);
      setTrackedTodayDate(liveTodayDate);
      setMonthKey((prev) => (prev === prevMonth ? liveMonthKey : prev));
      setTargetDate((prev) => (prev === trackedTodayDate ? liveTodayDate : prev));
      setDocDate((prev) => (prev === trackedTodayDate ? liveTodayDate : prev));
      setPjDate((prev) => (prev === trackedTodayDate ? liveTodayDate : prev));
    }
  }, [liveTodayDate, liveMonthKey, trackedTodayDate]);

  const userUid = userProfile?.uid || '';
  const isAdmin = userProfile?.role === 'Administrator';
  const isKepalaRuang = userProfile?.role === 'Kepala Ruang';
  const canManagePjAssignment = isAdmin || isKepalaRuang;
  const isNurseOnly = userProfile?.role === 'Perawat Pelaksana';

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
      return sortedActiveStaff.filter((s) => s.uid === userUid);
    }
    return sortedActiveStaff;
  }, [sortedActiveStaff, isNurseOnly, userUid]);

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

  if (!userProfile) return null;

  const handleAssignShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleError(null);
    setScheduleFeedback(null);

    const nurse = staffDirectory.find((s) => s.uid === targetNurseId);
    if (!nurse) {
      setScheduleError('Pilih perawat/staf terlebih dahulu sebelum menyimpan jadwal.');
      return;
    }
    if (!ISO_DATE_RE.test(targetDate)) {
      setScheduleError('Format tanggal jadwal tidak valid.');
      return;
    }

    setSaving(true);
    const docId = `${nurse.uid}_${targetDate}`;
    const scheduleRef = doc(db, 'schedules', docId);
    const targetMonthKey = targetDate.slice(0, 7);
    const safeNurseName = ensureMinName(nurse.fullName, 120, 'Staf HD');
    const cleanNotes = clampString(notes || '', 300);

    try {
      const existingSnap = await getDoc(scheduleRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data();
        const clearValidator =
          existingData?.validatedBy !== undefined || existingData?.validatedByName !== undefined
            ? {
                validatedBy: deleteField(),
                validatedByName: deleteField(),
              }
            : {};
        await updateDoc(scheduleRef, {
          nurseName: safeNurseName,
          date: targetDate,
          monthKey: targetMonthKey,
          shift: targetShift,
          validationStatus: 'Draft',
          ...clearValidator,
          notes: cleanNotes,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(scheduleRef, {
          nurseId: nurse.uid,
          nurseName: safeNurseName,
          date: targetDate,
          monthKey: targetMonthKey,
          shift: targetShift,
          validationStatus: 'Draft',
          notes: cleanNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (targetMonthKey !== monthKey) {
        setMonthKey(targetMonthKey);
      }
      setNotes('');
      const msg = `Jadwal ${nurse.fullName} tanggal ${formatDateId(targetDate)} disimpan sebagai Shift ${targetShift}.`;
      setScheduleFeedback(msg);
      showToast(msg, 'success');
    } catch (err) {
      formatFirestoreError(err, OperationType.WRITE, `schedules/${docId}`);
      const errMsg = getUserFriendlyFirestoreError(err, 'Gagal menyimpan jadwal shift perawat.');
      setScheduleError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAssignDoctorSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocError(null);
    setDocFeedback(null);

    if (!ISO_DATE_RE.test(docDate)) {
      setDocError('Format tanggal jadwal dokter tidak valid.');
      return;
    }
    const dpjpObj = activeDoctors.find((d) => d.id === resolvedDocDpjpId);
    const dutyObj = activeDoctors.find((d) => d.id === resolvedDocDutyId);
    if (!dpjpObj || !dutyObj) {
      setDocError('Pilih Dokter DPJP dan Dokter Jaga terlebih dahulu.');
      return;
    }

    setSavingDoc(true);
    const docId = `${docDate}_${docShift}`;
    const docRef = doc(db, 'doctor_schedules', docId);
    const targetMonthKey = docDate.slice(0, 7);
    const safeDpjpName = ensureMinName(dpjpObj.fullName, 120, 'Dokter DPJP');
    const safeDutyName = ensureMinName(dutyObj.fullName, 120, 'Dokter Jaga');
    const cleanDocNotes = clampString(docNotes || '', 300);

    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          dpjpDoctorId: dpjpObj.id,
          dpjpDoctorName: safeDpjpName,
          dutyDoctorId: dutyObj.id,
          dutyDoctorName: safeDutyName,
          notes: cleanDocNotes,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          date: docDate,
          monthKey: targetMonthKey,
          shift: docShift,
          dpjpDoctorId: dpjpObj.id,
          dpjpDoctorName: safeDpjpName,
          dutyDoctorId: dutyObj.id,
          dutyDoctorName: safeDutyName,
          notes: cleanDocNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (targetMonthKey !== monthKey) {
        setMonthKey(targetMonthKey);
      }
      setDocNotes('');
      const msg = `Jadwal dokter Shift ${docShift} tanggal ${formatDateId(docDate)} disimpan.`;
      setDocFeedback(
        `Jadwal dokter Shift ${docShift} tanggal ${formatDateId(docDate)} disimpan (${dpjpObj.fullName} · ${dutyObj.fullName}).`
      );
      showToast(msg, 'success');
    } catch (err) {
      formatFirestoreError(err, OperationType.WRITE, `doctor_schedules/${docId}`);
      const errMsg = getUserFriendlyFirestoreError(err, 'Gagal menyimpan jadwal dokter.');
      setDocError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setSavingDoc(false);
    }
  };

  const handleApplyDoctorMonthTemplate = async () => {
    if (!isAdmin) return;
    setDocError(null);
    setDocFeedback(null);

    const dpjpObj = activeDoctors.find((d) => d.id === resolvedDocDpjpId);
    const dutyObj = activeDoctors.find((d) => d.id === resolvedDocDutyId);
    if (!dpjpObj || !dutyObj || days.length === 0) {
      setDocError('Pilih bulan, Dokter DPJP, dan Dokter Jaga terlebih dahulu.');
      return;
    }

    setBatchSavingDoc(true);
    const safeDpjpName = ensureMinName(dpjpObj.fullName, 120, 'Dokter DPJP');
    const safeDutyName = ensureMinName(dutyObj.fullName, 120, 'Dokter Jaga');
    const cleanDocNotes = clampString(docNotes || '', 300);

    try {
      const snaps = await Promise.all(
        days.map((d) =>
          getDoc(doc(db, 'doctor_schedules', `${d}_${docShift}`)).catch(() => null)
        )
      );

      const batch = writeBatch(db);
      days.forEach((d, idx) => {
        const docId = `${d}_${docShift}`;
        const ref = doc(db, 'doctor_schedules', docId);
        const snap = snaps[idx];
        const exists = snap ? snap.exists() : doctorScheduleMap.has(docId);

        if (exists) {
          batch.update(ref, {
            dpjpDoctorId: dpjpObj.id,
            dpjpDoctorName: safeDpjpName,
            dutyDoctorId: dutyObj.id,
            dutyDoctorName: safeDutyName,
            notes: cleanDocNotes,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            date: d,
            monthKey: d.slice(0, 7),
            shift: docShift,
            dpjpDoctorId: dpjpObj.id,
            dpjpDoctorName: safeDpjpName,
            dutyDoctorId: dutyObj.id,
            dutyDoctorName: safeDutyName,
            notes: cleanDocNotes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
      const msg = `Jadwal dokter Shift ${docShift} untuk ${days.length} tanggal di ${formatMonthLabel(monthKey)} berhasil disimpan.`;
      setDocFeedback(msg);
      showToast(msg, 'success');
    } catch (err) {
      formatFirestoreError(err, OperationType.WRITE, 'doctor_schedules');
      const errMsg = getUserFriendlyFirestoreError(
        err,
        'Gagal menerapkan jadwal dokter untuk satu bulan.'
      );
      setDocError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setBatchSavingDoc(false);
    }
  };

  const handleAssignPjShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePjAssignment) return;
    setPjError(null);
    setPjFeedback(null);

    if (!ISO_DATE_RE.test(pjDate)) {
      setPjError('Format tanggal penugasan PJ Shift tidak valid.');
      return;
    }
    const selectedPj = pjStaffList.find((s) => s.uid === resolvedPjNurseId);
    if (!selectedPj) {
      setPjError('Pilih akun PJ Shift yang aktif terlebih dahulu.');
      return;
    }

    setSavingPj(true);
    const docId = `${pjDate}_${pjShift}`;
    const docRef = doc(db, 'pj_shift_assignments', docId);
    const targetMonthKey = pjDate.slice(0, 7);
    const safePjName = ensureMinName(selectedPj.fullName, 120, 'PJ Shift');
    const safeAssignedByName = ensureMinName(userProfile.fullName, 120, 'Supervisor');
    const cleanPjNotes = clampString(pjNotes || '', 300);

    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          pjNurseId: selectedPj.uid,
          pjNurseName: safePjName,
          pjNurseRole: 'PJ Shift',
          notes: cleanPjNotes,
          assignedBy: userProfile.uid,
          assignedByName: safeAssignedByName,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          date: pjDate,
          monthKey: targetMonthKey,
          shift: pjShift,
          pjNurseId: selectedPj.uid,
          pjNurseName: safePjName,
          pjNurseRole: 'PJ Shift',
          notes: cleanPjNotes,
          assignedBy: userProfile.uid,
          assignedByName: safeAssignedByName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (targetMonthKey !== monthKey) {
        setMonthKey(targetMonthKey);
      }
      const msg = `Penugasan PJ Shift ${pjShift} tanggal ${formatDateId(pjDate)} ditetapkan kepada ${selectedPj.fullName}.`;
      setPjFeedback(msg);
      showToast(msg, 'success');
      setPjNotes('');
    } catch (err) {
      formatFirestoreError(err, OperationType.WRITE, `pj_shift_assignments/${docId}`);
      const errMsg = getUserFriendlyFirestoreError(err, 'Gagal menyimpan penugasan PJ Shift.');
      setPjError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setSavingPj(false);
    }
  };

  const handleApplyPjMonthTemplate = async () => {
    if (!canManagePjAssignment || days.length === 0) return;
    setPjError(null);
    setPjFeedback(null);

    const selectedPj = pjStaffList.find((s) => s.uid === resolvedPjNurseId);
    if (!selectedPj) {
      setPjError('Pilih akun PJ Shift yang aktif terlebih dahulu.');
      return;
    }

    setBatchSavingPj(true);
    const safePjName = ensureMinName(selectedPj.fullName, 120, 'PJ Shift');
    const safeAssignedByName = ensureMinName(userProfile.fullName, 120, 'Supervisor');
    const cleanPjNotes = clampString(pjNotes || '', 300);

    try {
      const snaps = await Promise.all(
        days.map((d) =>
          getDoc(doc(db, 'pj_shift_assignments', `${d}_${pjShift}`)).catch(() => null)
        )
      );

      const batch = writeBatch(db);
      days.forEach((d, idx) => {
        const docId = `${d}_${pjShift}`;
        const ref = doc(db, 'pj_shift_assignments', docId);
        const snap = snaps[idx];
        const exists = snap
          ? snap.exists()
          : pjShiftAssignments.some((a) => a.id === docId);

        if (exists) {
          batch.update(ref, {
            pjNurseId: selectedPj.uid,
            pjNurseName: safePjName,
            pjNurseRole: 'PJ Shift',
            notes: cleanPjNotes,
            assignedBy: userProfile.uid,
            assignedByName: safeAssignedByName,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(ref, {
            date: d,
            monthKey: d.slice(0, 7),
            shift: pjShift,
            pjNurseId: selectedPj.uid,
            pjNurseName: safePjName,
            pjNurseRole: 'PJ Shift',
            notes: cleanPjNotes,
            assignedBy: userProfile.uid,
            assignedByName: safeAssignedByName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
      const msg = `Penugasan PJ Shift ${pjShift} bulan ${formatMonthLabel(monthKey)} diterapkan kepada ${selectedPj.fullName}.`;
      setPjFeedback(msg);
      showToast(msg, 'success');
    } catch (err) {
      formatFirestoreError(err, OperationType.WRITE, 'pj_shift_assignments');
      const errMsg = getUserFriendlyFirestoreError(
        err,
        'Gagal menerapkan penugasan PJ Shift satu bulan.'
      );
      setPjError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setBatchSavingPj(false);
    }
  };

  const handleDeletePjAssignment = async (entry: PjShiftAssignmentEntry) => {
    if (!canManagePjAssignment) return;
    setDeletingPjId(entry.id);
    setPjFeedback(null);
    setPjError(null);
    try {
      await deleteDoc(doc(db, 'pj_shift_assignments', entry.id));
      const msg = `Penugasan PJ Shift ${entry.shift} tanggal ${formatDateId(entry.date)} (${entry.pjNurseName}) dihapus.`;
      setPjFeedback(msg);
      showToast(msg, 'info');
    } catch (err) {
      formatFirestoreError(err, OperationType.DELETE, `pj_shift_assignments/${entry.id}`);
      const errMsg = getUserFriendlyFirestoreError(err, 'Gagal menghapus penugasan PJ Shift.');
      setPjError(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setDeletingPjId(null);
    }
  };

  const handleCycleCellShift = async (nurse: StaffDirectoryEntry, date: string) => {
    if (!isAdmin) return;
    const order: ScheduleShiftType[] = ['Pagi', 'Siang', 'Malam', 'Libur', 'Cuti'];
    const docId = `${nurse.uid}_${date}`;
    if (busyScheduleCell === docId) return;

    setBusyScheduleCell(docId);
    setScheduleError(null);

    const scheduleRef = doc(db, 'schedules', docId);
    const safeNurseName = ensureMinName(nurse.fullName, 120, 'Staf HD');

    try {
      const existingSnap = await getDoc(scheduleRef);
      const currentShift = existingSnap.exists()
        ? (existingSnap.data()?.shift as ScheduleShiftType | undefined)
        : scheduleMap.get(docId)?.shift;
      const nextShift =
        currentShift && order.includes(currentShift)
          ? order[(order.indexOf(currentShift) + 1) % order.length]
          : 'Pagi';

      if (existingSnap.exists()) {
        const existingData = existingSnap.data();
        const clearValidator =
          existingData?.validatedBy !== undefined || existingData?.validatedByName !== undefined
            ? {
                validatedBy: deleteField(),
                validatedByName: deleteField(),
              }
            : {};
        await updateDoc(scheduleRef, {
          nurseName: safeNurseName,
          shift: nextShift,
          validationStatus: 'Draft',
          ...clearValidator,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(scheduleRef, {
          nurseId: nurse.uid,
          nurseName: safeNurseName,
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
      formatFirestoreError(err, OperationType.WRITE, `schedules/${docId}`);
      setScheduleError(
        getUserFriendlyFirestoreError(err, 'Gagal memperbarui sel jadwal perawat.')
      );
    } finally {
      setBusyScheduleCell((prev) => (prev === docId ? null : prev));
    }
  };

  const handleValidateMonth = async () => {
    if (!isKepalaRuang || draftCount === 0) return;
    setValidatingAll(true);
    setScheduleError(null);
    setScheduleFeedback(null);

    try {
      const drafts = monthSchedules.filter((s) => s.validationStatus === 'Draft');
      const safeValidatorName = ensureMinName(userProfile.fullName, 120, 'Kepala Ruang');
      const CHUNK_SIZE = 400;

      for (let i = 0; i < drafts.length; i += CHUNK_SIZE) {
        const chunk = drafts.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.update(doc(db, 'schedules', d.id), {
            validationStatus: 'Validated',
            validatedBy: userProfile.uid,
            validatedByName: safeValidatorName,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      const msg = `${drafts.length} jadwal dinas bulan ${formatMonthLabel(monthKey)} berhasil divalidasi.`;
      setScheduleFeedback(msg);
      showToast(msg, 'success');
    } catch (err) {
      formatFirestoreError(err, OperationType.UPDATE, 'schedules');
      const errMsg = getUserFriendlyFirestoreError(err, 'Gagal memvalidasi jadwal bulan ini.');
      setScheduleError(errMsg);
      showToast(errMsg, 'error');
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
              ? 'Kelola jadwal shift perawat, penugasan PJ Shift, dan matriks Dokter DPJP serta Dokter Jaga.'
              : isKepalaRuang
              ? 'Tinjau dan validasi jadwal dinas ruangan serta pantau penugasan PJ Shift dan dokter.'
              : 'Matriks jadwal dinas shift, PJ Shift, dan Dokter DPJP / Dokter Jaga periode berjalan.'}
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

      {scheduleError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {scheduleError}
        </div>
      )}

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

          {pjError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
              {pjError}
            </div>
          )}

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
          {docError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
              {docError}
            </div>
          )}

          {docFeedback && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-medium text-teal-800">
              {docFeedback}
            </div>
          )}

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
                          const cellDocId = `${staff.uid}_${d}`;
                          const isBusyCell = busyScheduleCell === cellDocId;
                          const pjHint = assignedPjShifts?.length
                            ? ` · PJ Shift Bertugas (${assignedPjShifts.join('/')})`
                            : '';
                          return (
                            <td key={d} className="p-1 text-center">
                              <button
                                type="button"
                                disabled={!isAdmin || isBusyCell}
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
                                } ${isAdmin ? 'cursor-pointer' : 'cursor-default'} ${
                                  isBusyCell ? 'opacity-50' : ''
                                }`}
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

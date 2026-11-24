import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Eye,
  FolderPlus,
  Lock,
  Pencil,
  RotateCcw,
  Search,
  Stethoscope,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  handleDbError,
  isDuplicateKeyError,
  isPermissionDeniedError,
  OperationType,
} from '../lib/supabase';
import {
  deleteRowByColumn,
  deleteRowsByColumnValues,
  generateRecordId,
  getRowByColumn,
  insertRow,
  mapLogbookRow,
  mapMachineLockRow,
  toActionCategoryRow,
  toLogbookRow,
  toMachineLockRow,
  updateRowByColumn,
  upsertRow,
} from '../lib/db';
import {
  clampString,
  formatDateId,
  formatVerificationStatusLabel,
  getCurrentMonthKey,
  getDayNameId,
  getLogbookSubmissionAccess,
  isPatientScheduledOnDay,
  isRegularPatient,
  SUBMISSION_WINDOW_WIB,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { ShiftBadge, VerificationBadge } from '../components/ui/StatusBadge';
import { LogbookDetailModal } from '../components/logbook/LogbookDetailModal';
import { QuickAddPatientModal } from '../components/logbook/QuickAddPatientModal';
import { DEFAULT_LOGBOOK_TEMPLATE } from '../lib/logbookTemplate';

const loadWizardModal = () =>
  import('../components/logbook/LogbookWizardModal').then((m) => ({
    default: m.LogbookWizardModal,
  }));
const LazyLogbookWizardModal = lazy(loadWizardModal);

const LazyLogbookTemplateEditorModal = lazy(() =>
  import('../components/logbook/LogbookTemplateEditorModal').then((m) => ({
    default: m.LogbookTemplateEditorModal,
  }))
);
import type {
  ActionCategory,
  Doctor,
  DoctorScheduleEntry,
  LogbookEntry,
  LogbookFormTemplate,
  LogbookLock,
  Machine,
  MachineLock,
  Patient,
  PjShiftAssignmentEntry,
  ScheduleEntry,
  ShiftType,
  StaffDirectoryEntry,
  UserRole,
} from '../types';

interface LogbookPageProps {
  mode: 'nurse' | 'master';
  logbooks: LogbookEntry[];
  logbookLocks: LogbookLock[];
  machineLocks?: MachineLock[];
  patients: Patient[];
  doctors: Doctor[];
  machines: Machine[];
  actionCategories: ActionCategory[];
  staffDirectory: StaffDirectoryEntry[];
  schedules: ScheduleEntry[];
  doctorSchedules: DoctorScheduleEntry[];
  pjShiftAssignments?: PjShiftAssignmentEntry[];
  formTemplate?: LogbookFormTemplate;
  archiveLoading?: boolean;
  onEnsureMonthLoaded?: (monthKey: string) => Promise<void> | void;
  onEnsureAllArchivesLoaded?: () => Promise<void> | void;
  onEnsureLogbookDetailsByIds?: (ids: string[]) => Promise<void> | void;
}

interface QueuedPatientSlot {
  patientId: string;
  machineId: string;
  confirmedInLocks?: boolean;
}

const SHIFT_TIME_LABEL: Record<ShiftType, string> = {
  Pagi: '07.00–14.00 WIB',
  Siang: '12.00–19.00 WIB',
  Malam: '21.00–07.00 WIB',
};

const ROLE_SHORT_CODE: Record<UserRole, string> = {
  Administrator: 'ADM',
  Managerial: 'MG',
  'Kepala Ruang': 'KR',
  'PJ Shift': 'PJ',
  'Perawat Pelaksana': 'PP',
};

const SHIFT_SHORT_CODE: Record<ShiftType, string> = {
  Pagi: 'P',
  Siang: 'S',
  Malam: 'M',
};

export function LogbookPage({
  mode,
  logbooks,
  logbookLocks,
  machineLocks = [],
  patients,
  doctors,
  machines,
  actionCategories,
  staffDirectory,
  schedules,
  doctorSchedules,
  pjShiftAssignments = [],
  formTemplate,
  archiveLoading = false,
  onEnsureMonthLoaded,
  onEnsureAllArchivesLoaded,
  onEnsureLogbookDetailsByIds,
}: LogbookPageProps) {
  const { userProfile } = useAuth();
  const isAdminMaster = mode === 'master' && userProfile?.role === 'Administrator';
  const canQuickAddPatient =
    !isAdminMaster &&
    (userProfile?.role === 'Kepala Ruang' ||
      userProfile?.role === 'PJ Shift' ||
      userProfile?.role === 'Perawat Pelaksana');

  // Admin Master states
  const [activeTab, setActiveTab] = useState<'all' | 'verified' | 'categories'>('all');
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [editingCat, setEditingCat] = useState<ActionCategory | null>(null);
  const [catSaving, setCatSaving] = useState(false);

  // Active Date & Shift (automatically follows calendar day rollover + Administrator schedule matrix)
  const {
    todayDate: liveTodayDate,
    currentShift: systemShiftFallback,
    nowMs,
    wibTimeLabel,
  } = useLiveClock();
  const [todayDate, setTodayDate] = useState(liveTodayDate);
  const [inputDate, setInputDate] = useState(liveTodayDate);
  const [manualShiftOverride, setManualShiftOverride] = useState<ShiftType | null>(null);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);

  // Table history filters (Master Logbook defaults to active date)
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState(liveTodayDate);
  const [monthFilter, setMonthFilter] = useState(liveTodayDate.slice(0, 7));
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals (resolved live from logbooks so open modals update in real time without refresh)
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [showAddPatientModal, setShowAddPatientModal] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [wizardPatientId, setWizardPatientId] = useState<string | null>(null);
  const [wizardMachineId, setWizardMachineId] = useState<string | undefined>(undefined);

  const editingEntry = useMemo(
    () => (editingEntryId ? logbooks.find((lb) => lb.id === editingEntryId) || null : null),
    [logbooks, editingEntryId]
  );
  const detailEntry = useMemo(
    () => (detailEntryId ? logbooks.find((lb) => lb.id === detailEntryId) || null : null),
    [logbooks, detailEntryId]
  );
  const deleteTarget = useMemo(
    () => (deleteTargetId ? logbooks.find((lb) => lb.id === deleteTargetId) || null : null),
    [logbooks, deleteTargetId]
  );

  // Doctor overrides (automatically seeded from Administrator doctor_schedules per date+shift)
  const [showMedicalTeamEditor, setShowMedicalTeamEditor] = useState(false);
  const [dpjpOverride, setDpjpOverride] = useState<string>('');
  const [dutyDoctorOverride, setDutyDoctorOverride] = useState<string>('');
  const [manualDutyDoctorName, setManualDutyDoctorName] = useState('');

  // Patient selector & input form
  const { showToast } = useToast();
  const [includeOutsideShift, setIncludeOutsideShift] = useState(false);
  const [selectedDropdownPatientId, setSelectedDropdownPatientId] = useState('');
  const [draftPatientName, setDraftPatientName] = useState('');
  const [draftPatientRm, setDraftPatientRm] = useState('');
  const [draftMachineId, setDraftMachineId] = useState('');
  const [pickerFeedback, setPickerFeedback] = useState<string | null>(null);
  const [listFeedback, setListFeedback] = useState<string | null>(null);
  const [claimingSlot, setClaimingSlot] = useState(false);
  const [changingMachinePatientId, setChangingMachinePatientId] = useState<string | null>(null);
  const [queuedSlots, setQueuedSlots] = useState<QueuedPatientSlot[]>([]);

  // Automatically reset Logbook workspace to an empty slate whenever the calendar day changes
  useEffect(() => {
    if (liveTodayDate !== todayDate) {
      setTodayDate(liveTodayDate);
      setInputDate(liveTodayDate);
      setDateFilter((prev) => (prev === todayDate ? liveTodayDate : prev));
      setMonthFilter(liveTodayDate.slice(0, 7));
      setManualShiftOverride(null);
      setQueuedSlots([]);
      setShowScheduleEditor(false);
      setDpjpOverride('');
      setDutyDoctorOverride('');
      setManualDutyDoctorName('');
      setIncludeOutsideShift(false);
      setSelectedDropdownPatientId('');
      setDraftPatientName('');
      setDraftPatientRm('');
      setDraftMachineId('');
      setPickerFeedback(null);
      setListFeedback(null);
    }
  }, [liveTodayDate, todayDate]);

  useEffect(() => {
    const mk = inputDate.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mk)) {
      void onEnsureMonthLoaded?.(mk);
    }
  }, [inputDate, onEnsureMonthLoaded]);

  useEffect(() => {
    if (dateFilter) {
      void onEnsureMonthLoaded?.(dateFilter.slice(0, 7));
    } else if (monthFilter) {
      void onEnsureMonthLoaded?.(monthFilter);
    } else {
      void onEnsureAllArchivesLoaded?.();
    }
  }, [dateFilter, monthFilter, onEnsureMonthLoaded, onEnsureAllArchivesLoaded]);

  useEffect(() => {
    if (!onEnsureLogbookDetailsByIds) return;
    const missingIds = logbooks
      .filter(
        (lb) =>
          lb.wizardDetails === undefined &&
          (lb.date === inputDate || (dateFilter !== '' && lb.date === dateFilter))
      )
      .map((lb) => lb.id);
    if (missingIds.length > 0) {
      void onEnsureLogbookDetailsByIds(missingIds);
    }
  }, [inputDate, dateFilter, logbooks, onEnsureLogbookDetailsByIds]);

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(
        () => {
          void loadWizardModal().catch(() => undefined);
        },
        { timeout: 1500 }
      );
      return () => {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleId);
        }
      };
    }
    const timer = globalThis.setTimeout(() => {
      void loadWizardModal().catch(() => undefined);
    }, 600);
    return () => globalThis.clearTimeout(timer);
  }, []);

  const inputDayName = useMemo(() => getDayNameId(inputDate), [inputDate]);

  // 1. Resolve User Shift from Administrator's Jadwal Dinas matrix
  const userScheduleForDate = useMemo(() => {
    if (!userProfile) return null;
    return schedules.find((s) => s.nurseId === userProfile.uid && s.date === inputDate) || null;
  }, [schedules, userProfile, inputDate]);

  const scheduledNurseShift: ShiftType | null = useMemo(() => {
    if (
      userScheduleForDate &&
      (userScheduleForDate.shift === 'Pagi' ||
        userScheduleForDate.shift === 'Siang' ||
        userScheduleForDate.shift === 'Malam')
    ) {
      return userScheduleForDate.shift;
    }
    return null;
  }, [userScheduleForDate]);

  const activeShift: ShiftType = manualShiftOverride || scheduledNurseShift || systemShiftFallback;

  // Reset doctor overrides when date or shift changes so Administrator matrix auto-populates cleanly
  useEffect(() => {
    setDpjpOverride('');
    setDutyDoctorOverride('');
    setManualDutyDoctorName('');
    setSelectedDropdownPatientId('');
    setDraftPatientName('');
    setDraftPatientRm('');
    setPickerFeedback(null);
    setListFeedback(null);
  }, [inputDate, activeShift]);

  const matrixStatusText = useMemo(() => {
    if (manualShiftOverride) {
      return `Mode Rubah Jadwal Manual (Shift ${manualShiftOverride})`;
    }
    if (scheduledNurseShift && userProfile) {
      const rCode = ROLE_SHORT_CODE[userProfile.role] || 'STF';
      const sCode = SHIFT_SHORT_CODE[scheduledNurseShift];
      return `${userProfile.role} ${scheduledNurseShift} [${rCode}-${sCode}] (Otomatis Sesuai)`;
    }
    if (userScheduleForDate) {
      return `${userScheduleForDate.shift} · Penyesuaian Shift ${activeShift}`;
    }
    return `Belum Diatur Administrator (Otomatis Jam Sistem: Shift ${activeShift})`;
  }, [manualShiftOverride, scheduledNurseShift, userProfile, userScheduleForDate, activeShift]);

  // 2. Resolve Doctors from Administrator's Matriks Jadwal Dokter for (inputDate, activeShift)
  const activeDoctors = useMemo(
    () => doctors.filter((d) => d.status === 'Aktif'),
    [doctors]
  );

  const dpjpDoctors = useMemo(
    () =>
      activeDoctors.filter(
        (d) =>
          /dpjp|sp\.?pd|kgh|konsulen|konsultan|nefro|penyakit dalam|spesialis/i.test(
            d.specialization
          ) && !/umum|jaga|duty/i.test(d.specialization)
      ),
    [activeDoctors]
  );

  const dutyDoctors = useMemo(
    () =>
      activeDoctors.filter(
        (d) => d.specialization.trim().toUpperCase() === 'DOKTER UMUM'
      ),
    [activeDoctors]
  );

  const doctorScheduleForSlot = useMemo(
    () =>
      doctorSchedules.find(
        (ds) => ds.date === inputDate && ds.shift === activeShift
      ) || null,
    [doctorSchedules, inputDate, activeShift]
  );

  const fallbackDpjp = useMemo(
    () => dpjpDoctors[0] || null,
    [dpjpDoctors]
  );

  const fallbackDutyDoctor = useMemo(
    () => dutyDoctors[0] || null,
    [dutyDoctors]
  );

  const resolvedDpjpId = useMemo(() => {
    if (dpjpOverride && dpjpDoctors.some((d) => d.id === dpjpOverride)) {
      return dpjpOverride;
    }
    if (
      doctorScheduleForSlot?.dpjpDoctorId &&
      dpjpDoctors.some((d) => d.id === doctorScheduleForSlot.dpjpDoctorId)
    ) {
      return doctorScheduleForSlot.dpjpDoctorId;
    }
    return fallbackDpjp?.id || '';
  }, [dpjpOverride, dpjpDoctors, doctorScheduleForSlot, fallbackDpjp]);

  const resolvedDutyDoctorId = useMemo(() => {
    if (dutyDoctorOverride === '__manual__') return '__manual__';
    if (dutyDoctorOverride && dutyDoctors.some((d) => d.id === dutyDoctorOverride)) {
      return dutyDoctorOverride;
    }
    if (
      doctorScheduleForSlot?.dutyDoctorId &&
      dutyDoctors.some((d) => d.id === doctorScheduleForSlot.dutyDoctorId)
    ) {
      return doctorScheduleForSlot.dutyDoctorId;
    }
    return fallbackDutyDoctor?.id || '';
  }, [dutyDoctorOverride, dutyDoctors, doctorScheduleForSlot, fallbackDutyDoctor]);

  const resolvedDpjpName = useMemo(
    () => dpjpDoctors.find((d) => d.id === resolvedDpjpId)?.fullName || 'Belum diatur',
    [dpjpDoctors, resolvedDpjpId]
  );

  const resolvedDutyDoctorName = useMemo(() => {
    if (resolvedDutyDoctorId === '__manual__') {
      return manualDutyDoctorName.trim();
    }
    return dutyDoctors.find((d) => d.id === resolvedDutyDoctorId)?.fullName || '';
  }, [resolvedDutyDoctorId, manualDutyDoctorName, dutyDoctors]);

  // 3. Active Patients, Locks, and Dropdown Pool for (inputDayName, activeShift)
  const activePatients = useMemo(
    () => patients.filter((p) => p.status === 'Aktif'),
    [patients]
  );

  const activeRegularPatients = useMemo(
    () => activePatients.filter((p) => isRegularPatient(p)),
    [activePatients]
  );

  const lockedPatientsForInputDate = useMemo(() => {
    const map = new Map<
      string,
      { nurseId: string; nurseName: string; status: string; logbookId: string }
    >();
    const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));
    for (const lk of logbookLocks) {
      if (lk.date === inputDate) {
        if (lk.nurseId === userProfile?.uid && !existingLogbookIds.has(lk.logbookId)) {
          continue;
        }
        map.set(lk.patientId, {
          nurseId: lk.nurseId,
          nurseName: lk.nurseName,
          status: 'Sudah Diinput',
          logbookId: lk.logbookId,
        });
      }
    }
    for (const lb of logbooks) {
      if (lb.date === inputDate && !map.has(lb.patientId)) {
        map.set(lb.patientId, {
          nurseId: lb.nurseId,
          nurseName: lb.nurseName,
          status: lb.verificationStatus,
          logbookId: lb.id,
        });
      }
    }
    return map;
  }, [logbookLocks, logbooks, inputDate, userProfile?.uid]);

  const scheduledPatientsForSlot = useMemo(
    () =>
      activeRegularPatients.filter((p) =>
        isPatientScheduledOnDay(p.routineSchedule, inputDayName, activeShift)
      ),
    [activeRegularPatients, inputDayName, activeShift]
  );

  const dropdownPatientPool = useMemo(() => {
    const base = includeOutsideShift ? activePatients : scheduledPatientsForSlot;
    const nameQ = draftPatientName.trim().toLowerCase();
    const rmQ = draftPatientRm.trim().toLowerCase();
    if (selectedDropdownPatientId || (!nameQ && !rmQ)) return base;
    return base.filter(
      (p) =>
        (!nameQ || p.fullName.toLowerCase().includes(nameQ)) &&
        (!rmQ || p.mrn.toLowerCase().includes(rmQ))
    );
  }, [
    includeOutsideShift,
    activePatients,
    scheduledPatientsForSlot,
    draftPatientName,
    draftPatientRm,
    selectedDropdownPatientId,
  ]);

  // 4. Machines & Bed HD dropdown default & per-shift cross-staff locks
  const availableMachineOptions = useMemo(() => {
    const readyFirst = [...machines].sort((a, b) => {
      const aReady = a.status === 'Ready' ? 0 : 1;
      const bReady = b.status === 'Ready' ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return a.machineNumber.localeCompare(b.machineNumber);
    });
    return readyFirst;
  }, [machines]);

  const lockedMachinesForSlot = useMemo(() => {
    const map = new Map<
      string,
      {
        nurseId: string;
        nurseName: string;
        patientId: string;
        patientName: string;
        logbookId: string;
      }
    >();
    const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));

    for (const lk of machineLocks) {
      if (lk.date === inputDate && lk.shift === activeShift) {
        if (lk.logbookId && lk.nurseId === userProfile?.uid && !existingLogbookIds.has(lk.logbookId)) {
          continue;
        }
        map.set(lk.machineId, {
          nurseId: lk.nurseId,
          nurseName: lk.nurseName,
          patientId: lk.patientId,
          patientName: lk.patientName,
          logbookId: lk.logbookId,
        });
      }
    }

    for (const lb of logbooks) {
      if (lb.date === inputDate && lb.shift === activeShift && !map.has(lb.machineId)) {
        map.set(lb.machineId, {
          nurseId: lb.nurseId,
          nurseName: lb.nurseName,
          patientId: lb.patientId,
          patientName: lb.patientName,
          logbookId: lb.id,
        });
      }
    }

    for (const slot of queuedSlots) {
      if (slot.machineId && !map.has(slot.machineId) && userProfile) {
        const pat = patients.find((p) => p.id === slot.patientId);
        map.set(slot.machineId, {
          nurseId: userProfile.uid,
          nurseName: userProfile.fullName,
          patientId: slot.patientId,
          patientName: pat?.fullName || 'Pasien',
          logbookId: '',
        });
      }
    }

    return map;
  }, [machineLocks, logbooks, queuedSlots, patients, inputDate, activeShift, userProfile]);

  const resolvedDraftMachineId = useMemo(() => {
    if (
      draftMachineId &&
      machines.some((m) => m.id === draftMachineId) &&
      !lockedMachinesForSlot.has(draftMachineId)
    ) {
      return draftMachineId;
    }
    const firstUnused = availableMachineOptions.find((m) => !lockedMachinesForSlot.has(m.id));
    return firstUnused?.id || '';
  }, [draftMachineId, machines, lockedMachinesForSlot, availableMachineOptions]);

  // 5. Combined Daftar Pasien Shift Ini (queued patients + already inputted entries by this nurse for this date & shift)
  const ownShiftLogbooks = useMemo(
    () =>
      logbooks.filter(
        (lb) =>
          lb.date === inputDate &&
          lb.shift === activeShift &&
          lb.nurseId === userProfile?.uid
      ),
    [logbooks, inputDate, activeShift, userProfile?.uid]
  );

  // Reconcile optimistic queuedSlots across tabs with real-time machineLocks and saved ownShiftLogbooks
  useEffect(() => {
    if (!userProfile || queuedSlots.length === 0) return;
    setQueuedSlots((prev) => {
      let changed = false;
      const next: QueuedPatientSlot[] = [];
      for (const slot of prev) {
        if (ownShiftLogbooks.some((lb) => lb.patientId === slot.patientId)) {
          changed = true;
          continue;
        }
        const matchingLock = machineLocks.find(
          (lk) =>
            lk.date === inputDate &&
            lk.shift === activeShift &&
            lk.nurseId === userProfile.uid &&
            lk.patientId === slot.patientId &&
            !lk.logbookId
        );
        if (matchingLock) {
          if (!slot.confirmedInLocks || matchingLock.machineId !== slot.machineId) {
            changed = true;
            next.push({
              patientId: slot.patientId,
              machineId: matchingLock.machineId,
              confirmedInLocks: true,
            });
          } else {
            next.push(slot);
          }
        } else if (slot.confirmedInLocks) {
          // Lock was removed in another tab/window; drop stale local slot
          changed = true;
        } else {
          next.push(slot);
        }
      }
      return changed ? next : prev;
    });
  }, [queuedSlots.length, machineLocks, ownShiftLogbooks, inputDate, activeShift, userProfile?.uid]);

  const shiftSlotLogs = useMemo(
    () => logbooks.filter((lb) => lb.date === inputDate && lb.shift === activeShift),
    [logbooks, inputDate, activeShift]
  );

  const totalShiftSubmittedCount = shiftSlotLogs.length;

  const hasHistoricalMalam = useMemo(
    () => activeShift === 'Malam' || shiftFilter === 'Malam' || logbooks.some((lb) => lb.shift === 'Malam'),
    [activeShift, shiftFilter, logbooks]
  );

  const nurseShiftProgress = useMemo(() => {
    const scheduledTotal = scheduledPatientsForSlot.length;
    const shiftPatientIds = new Set(shiftSlotLogs.map((lb) => lb.patientId));
    const scheduledCoveredCount = scheduledPatientsForSlot.filter((p) =>
      shiftPatientIds.has(p.id)
    ).length;
    const remainingScheduledCount = Math.max(0, scheduledTotal - scheduledCoveredCount);

    let approved = 0;
    let pending = 0;
    let draftOrRevision = 0;
    for (const lb of shiftSlotLogs) {
      if (lb.verificationStatus === 'Approved') approved += 1;
      else if (lb.verificationStatus === 'Pending') pending += 1;
      else draftOrRevision += 1;
    }

    const pct =
      scheduledTotal > 0
        ? Math.min(100, Math.round((scheduledCoveredCount / scheduledTotal) * 100))
        : shiftSlotLogs.length > 0
        ? 100
        : 0;

    return {
      scheduledTotal,
      scheduledCoveredCount,
      remainingScheduledCount,
      totalSubmitted: shiftSlotLogs.length,
      approved,
      pending,
      draftOrRevision,
      pct,
    };
  }, [scheduledPatientsForSlot, shiftSlotLogs]);

  const shiftPatientList = useMemo(() => {
    const byPatientId = new Map(patients.map((p) => [p.id, p]));
    const byMachineId = new Map(machines.map((m) => [m.id, m]));
    const seenPatientIds = new Set<string>();

    const list: {
      patient: Patient;
      machineId: string;
      machineNumber: string;
      ownEntry: LogbookEntry | null;
      lockInfo: { nurseId: string; nurseName: string; status: string; logbookId: string } | null;
      fromSavedLogbook: boolean;
    }[] = [];

    for (const lb of ownShiftLogbooks) {
      const pat = byPatientId.get(lb.patientId);
      if (!pat || seenPatientIds.has(pat.id)) continue;
      seenPatientIds.add(pat.id);
      list.push({
        patient: pat,
        machineId: lb.machineId,
        machineNumber: lb.machineNumber,
        ownEntry: lb,
        lockInfo: lockedPatientsForInputDate.get(pat.id) || null,
        fromSavedLogbook: true,
      });
    }

    for (const slot of queuedSlots) {
      if (seenPatientIds.has(slot.patientId)) continue;
      const pat = byPatientId.get(slot.patientId);
      if (!pat) continue;
      const lockInfo = lockedPatientsForInputDate.get(pat.id) || null;
      if (lockInfo && lockInfo.nurseId !== userProfile?.uid) {
        continue;
      }
      seenPatientIds.add(pat.id);
      const mac = byMachineId.get(slot.machineId);
      list.push({
        patient: pat,
        machineId: slot.machineId,
        machineNumber: mac?.machineNumber || machines[0]?.machineNumber || '-',
        ownEntry: null,
        lockInfo,
        fromSavedLogbook: false,
      });
    }

    for (const lk of machineLocks) {
      if (
        lk.date !== inputDate ||
        lk.shift !== activeShift ||
        lk.nurseId !== userProfile?.uid ||
        lk.logbookId
      ) {
        continue;
      }
      if (seenPatientIds.has(lk.patientId)) continue;
      const pat = byPatientId.get(lk.patientId);
      if (!pat) continue;
      const lockInfo = lockedPatientsForInputDate.get(pat.id) || null;
      if (lockInfo && lockInfo.nurseId !== userProfile?.uid) {
        continue;
      }
      seenPatientIds.add(pat.id);
      const mac = byMachineId.get(lk.machineId);
      list.push({
        patient: pat,
        machineId: lk.machineId,
        machineNumber: mac?.machineNumber || lk.machineNumber || '-',
        ownEntry: null,
        lockInfo,
        fromSavedLogbook: false,
      });
    }

    return list;
  }, [
    patients,
    machines,
    ownShiftLogbooks,
    queuedSlots,
    machineLocks,
    inputDate,
    activeShift,
    lockedPatientsForInputDate,
    userProfile?.uid,
  ]);

  const queuedPatientIdSet = useMemo(
    () => new Set(shiftPatientList.map((item) => item.patient.id)),
    [shiftPatientList]
  );

  const filteredLogbooks = useMemo(() => {
    return logbooks.filter((item) => {
      if (isAdminMaster && activeTab === 'verified' && item.verificationStatus !== 'Approved') {
        return false;
      }
      if (dateFilter) {
        if (item.date !== dateFilter) return false;
      } else if (monthFilter && item.monthKey !== monthFilter) {
        return false;
      }
      if (shiftFilter !== 'ALL' && item.shift !== shiftFilter) return false;
      if (statusFilter !== 'ALL' && item.verificationStatus !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hit =
          item.patientName.toLowerCase().includes(q) ||
          item.patientRm.toLowerCase().includes(q) ||
          item.nurseName.toLowerCase().includes(q) ||
          item.machineNumber.toLowerCase().includes(q) ||
          item.actionCategory.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [logbooks, isAdminMaster, activeTab, dateFilter, monthFilter, shiftFilter, statusFilter, searchTerm]);

  // Handlers
  const handleSelectPatientDropdown = (patId: string) => {
    setSelectedDropdownPatientId(patId);
    setPickerFeedback(null);
    if (!patId) {
      setDraftPatientName('');
      setDraftPatientRm('');
      return;
    }
    const found = patients.find((p) => p.id === patId);
    if (found) {
      setDraftPatientName(found.fullName);
      setDraftPatientRm(found.mrn);
    }
  };

  const claimMachineSlotAndQueue = async (
    pat: Pick<Patient, 'id' | 'fullName'>,
    targetMachineId: string
  ) => {
    if (!userProfile) return false;
    if (!targetMachineId) {
      setPickerFeedback(
        `Semua Mesin / Bed HD pada Shift ${activeShift} sudah dipilih atau sedang digunakan. Kosongkan slot mesin atau pilih shift lain.`
      );
      return false;
    }

    const mach = machines.find((m) => m.id === targetMachineId);
    if (!mach) {
      setPickerFeedback('Mesin / Bed HD tidak ditemukan di master data.');
      return false;
    }

    const existingSlotLock = lockedMachinesForSlot.get(targetMachineId);
    if (existingSlotLock) {
      const lockerLabel =
        existingSlotLock.nurseId !== userProfile.uid
          ? `oleh ${existingSlotLock.nurseName}`
          : `untuk pasien ${existingSlotLock.patientName}`;
      setPickerFeedback(
        `Mesin / Bed HD ${mach.machineNumber} pada Shift ${activeShift} sudah dipilih ${lockerLabel}. Silakan pilih mesin/bed lain.`
      );
      return false;
    }

    const lockId = `${inputDate}_${activeShift}_${mach.id}`;
    setClaimingSlot(true);
    try {
      const existingRow = await getRowByColumn('machine_locks', 'id', lockId);
      if (existingRow) {
        const existingData = mapMachineLockRow(existingRow);
        if (
          !(
            existingData.nurseId === userProfile.uid &&
            !existingData.logbookId &&
            existingData.patientId === pat.id
          )
        ) {
          throw new Error(`MACHINE_LOCKED:${existingData.nurseName || 'staf lain'}`);
        }
      } else {
        try {
          await insertRow(
            'machine_locks',
            toMachineLockRow({
              id: lockId,
              date: inputDate,
              monthKey: inputDate.slice(0, 7),
              shift: activeShift,
              machineId: mach.id,
              machineNumber: clampString(mach.machineNumber, 40) || 'HD',
              patientId: pat.id,
              patientName: clampString(pat.fullName, 120) || 'Pasien HD',
              nurseId: userProfile.uid,
              nurseName: clampString(userProfile.fullName, 120) || 'Perawat',
              logbookId: '',
            })
          );
        } catch (insertErr) {
          if (isDuplicateKeyError(insertErr)) {
            const racedRow = await getRowByColumn('machine_locks', 'id', lockId).catch(() => null);
            const lockerName =
              typeof racedRow?.nurse_name === 'string' && racedRow.nurse_name.trim()
                ? racedRow.nurse_name
                : 'staf lain';
            throw new Error(`MACHINE_LOCKED:${lockerName}`);
          }
          throw insertErr;
        }
      }

      setQueuedSlots((prev) =>
        prev.some((item) => item.patientId === pat.id)
          ? prev
          : [
              ...prev,
              {
                patientId: pat.id,
                machineId: mach.id,
              },
            ]
      );
      setSelectedDropdownPatientId('');
      setDraftPatientName('');
      setDraftPatientRm('');
      setDraftMachineId('');
      showToast(`${pat.fullName} ditambahkan ke daftar Shift ${activeShift} (${mach.machineNumber}).`, 'success');
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '';
      if (errMsg.startsWith('MACHINE_LOCKED:') || isPermissionDeniedError(err)) {
        const lockerName = errMsg.startsWith('MACHINE_LOCKED:')
          ? errMsg.replace('MACHINE_LOCKED:', '').trim() || 'staf lain'
          : 'staf lain';
        setPickerFeedback(
          `Mesin / Bed HD ${mach.machineNumber} pada Shift ${activeShift} baru saja dipilih oleh ${lockerName}. Silakan pilih mesin/bed lain yang masih tersedia.`
        );
        setDraftMachineId('');
        return false;
      }
      handleDbError(err, OperationType.WRITE, `machine_locks/${lockId}`);
      return false;
    } finally {
      setClaimingSlot(false);
    }
  };

  const handleAddPatientToShiftList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (claimingSlot) return;
    setPickerFeedback(null);

    let matched: Patient | undefined;
    if (selectedDropdownPatientId) {
      matched = activePatients.find((p) => p.id === selectedDropdownPatientId);
    }
    if (!matched && draftPatientRm.trim()) {
      const rmNorm = draftPatientRm.trim().toLowerCase();
      matched = activePatients.find((p) => p.mrn.trim().toLowerCase() === rmNorm);
    }
    if (!matched && draftPatientName.trim()) {
      const nameNorm = draftPatientName.trim().toLowerCase();
      matched =
        activePatients.find((p) => p.fullName.trim().toLowerCase() === nameNorm) ||
        activePatients.find((p) => p.fullName.toLowerCase().includes(nameNorm));
    }

    if (!matched) {
      setPickerFeedback(
        'Pasien belum ditemukan di master data. Pilih pasien dari dropdown di atas atau klik "+ PASIEN BARU" untuk mendaftarkan pasien terlebih dahulu.'
      );
      return;
    }

    const lockInfo = lockedPatientsForInputDate.get(matched.id);
    if (lockInfo && lockInfo.nurseId !== userProfile?.uid) {
      setPickerFeedback(
        `Pasien ${matched.fullName} sudah diinput hari ini oleh ${lockInfo.nurseName}.`
      );
      return;
    }

    if (queuedPatientIdSet.has(matched.id)) {
      setPickerFeedback(
        `Pasien ${matched.fullName} sudah berada di Daftar Pasien Shift ${activeShift}.`
      );
      return;
    }

    await claimMachineSlotAndQueue(matched, resolvedDraftMachineId);
  };

  const handleRemoveFromQueue = async (patientId: string, machineId: string) => {
    setQueuedSlots((prev) => prev.filter((item) => item.patientId !== patientId));
    if (!userProfile) return;
    const lockId = `${inputDate}_${activeShift}_${machineId}`;
    const matchingLock = machineLocks.find(
      (lk) =>
        (lk.id === lockId ||
          (lk.date === inputDate &&
            lk.shift === activeShift &&
            lk.patientId === patientId &&
            lk.machineId === machineId)) &&
        lk.nurseId === userProfile.uid &&
        !lk.logbookId
    );
    if (matchingLock) {
      try {
        await deleteRowByColumn('machine_locks', 'id', matchingLock.id);
      } catch (err) {
        handleDbError(err, OperationType.DELETE, `machine_locks/${matchingLock.id}`);
      }
    }
  };

  const handleChangeSlotMachine = async (
    item: {
      patient: Patient;
      machineId: string;
      machineNumber: string;
      ownEntry: LogbookEntry | null;
    },
    newMachineId: string
  ) => {
    if (!userProfile || !newMachineId || newMachineId === item.machineId) return;
    if (changingMachinePatientId) return;

    const own = item.ownEntry;
    if (own && own.verificationStatus !== 'Draft' && own.verificationStatus !== 'Revision') {
      setListFeedback(
        `Logbook ${item.patient.fullName} sudah berstatus ${formatVerificationStatusLabel(own.verificationStatus)} sehingga Bed/Mesin tidak dapat diubah lagi.`
      );
      return;
    }
    if (own && own.verificationStatus === 'Revision') {
      const revAccess = getLogbookSubmissionAccess(own.date, own.shift, own, Date.now());
      if (!revAccess.canEditRevision) {
        setListFeedback(
          revAccess.reason ||
            'Batas waktu perbaikan revisi (1 jam) telah berakhir.'
        );
        return;
      }
    }

    const newMach = machines.find((m) => m.id === newMachineId);
    if (!newMach) {
      setListFeedback('Mesin / Bed HD tujuan tidak ditemukan di master data.');
      return;
    }

    const targetDate = own?.date || inputDate;
    const targetShift = own?.shift || activeShift;
    const existingLock = lockedMachinesForSlot.get(newMach.id);
    if (existingLock) {
      const sameOwnSlot =
        (own && existingLock.logbookId === own.id) ||
        (!own &&
          existingLock.nurseId === userProfile.uid &&
          !existingLock.logbookId &&
          existingLock.patientId === item.patient.id);
      if (!sameOwnSlot) {
        const lockerLabel =
          existingLock.nurseId !== userProfile.uid
            ? `oleh ${existingLock.nurseName}`
            : `untuk pasien ${existingLock.patientName}`;
        setListFeedback(
          `Mesin / Bed HD ${newMach.machineNumber} pada Shift ${targetShift} sudah dipilih ${lockerLabel}. Silakan pilih Bed/Mesin lain.`
        );
        return;
      }
    }

    setListFeedback(null);
    setChangingMachinePatientId(item.patient.id);
    const oldLockId = `${targetDate}_${targetShift}_${item.machineId}`;
    const newLockId = `${targetDate}_${targetShift}_${newMach.id}`;
    const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));
    const safeMachineNumber = clampString(newMach.machineNumber, 40) || 'HD';
    const safePatientName = clampString(item.patient.fullName, 120) || 'Pasien HD';
    const safeNurseName = clampString(userProfile.fullName, 120) || 'Perawat';
    const isAdminRole = userProfile.role === 'Administrator';

    let txOp: OperationType = OperationType.WRITE;
    let txPath = `machine_locks/${newLockId}`;

    try {
      const [logRow, newLockRow, oldLockRow] = await Promise.all([
        own ? getRowByColumn('logbook', 'id', own.id) : Promise.resolve(null),
        getRowByColumn('machine_locks', 'id', newLockId),
        oldLockId !== newLockId ? getRowByColumn('machine_locks', 'id', oldLockId) : Promise.resolve(null),
      ]);

      if (own) {
        txOp = OperationType.GET;
        txPath = `logbook/${own.id}`;
        if (!logRow) {
          throw new Error('LOGBOOK_MISSING');
        }
        const logData = mapLogbookRow(logRow);
        if (!isAdminRole && logData.nurseId !== userProfile.uid) {
          throw new Error('LOGBOOK_NOT_OWNER');
        }
        if (
          !isAdminRole &&
          logData.verificationStatus !== 'Draft' &&
          logData.verificationStatus !== 'Revision'
        ) {
          throw new Error(`LOGBOOK_LOCKED:${logData.verificationStatus || 'Pending'}`);
        }
      }

      let existingML: MachineLock | null = null;
      let shouldDeleteOrphanFirst = false;
      if (newLockRow) {
        const ld = mapMachineLockRow(newLockRow);
        existingML = ld;
        const ownedByCurrent = ld.nurseId === userProfile.uid;
        const matchesThisSlot =
          (own && ld.logbookId === own.id) ||
          (!own && !ld.logbookId && ld.patientId === item.patient.id);
        const knownOrphan = Boolean(
          (isAdminRole || ownedByCurrent) &&
            ld.logbookId &&
            !existingLogbookIds.has(ld.logbookId)
        );
        if (!(ownedByCurrent && matchesThisSlot) && !knownOrphan) {
          throw new Error(`MACHINE_LOCKED:${ld.nurseName || 'staf lain'}`);
        }
        shouldDeleteOrphanFirst = knownOrphan && !ownedByCurrent && !isAdminRole;
      }

      if (own) {
        txOp = OperationType.UPDATE;
        txPath = `logbook/${own.id}`;
        await updateRowByColumn(
          'logbook',
          'id',
          own.id,
          toLogbookRow({
            machineId: newMach.id,
            machineNumber: safeMachineNumber,
          })
        );
      }

      if (oldLockRow && oldLockId !== newLockId) {
        const oldML = mapMachineLockRow(oldLockRow);
        const canDeleteOld =
          isAdminRole ||
          (oldML.nurseId === userProfile.uid && (own ? true : !oldML.logbookId));
        if (canDeleteOld) {
          txOp = OperationType.DELETE;
          txPath = `machine_locks/${oldLockId}`;
          await deleteRowByColumn('machine_locks', 'id', oldLockId);
        }
      }

      const nextLockRow = toMachineLockRow({
        id: newLockId,
        date: targetDate,
        monthKey: targetDate.slice(0, 7),
        shift: targetShift,
        machineId: newMach.id,
        machineNumber: safeMachineNumber,
        patientId: item.patient.id,
        patientName: safePatientName,
        nurseId: userProfile.uid,
        nurseName: safeNurseName,
        logbookId: own ? own.id : '',
      });

      if (shouldDeleteOrphanFirst) {
        await deleteRowByColumn('machine_locks', 'id', newLockId);
      }

      txOp = existingML && !shouldDeleteOrphanFirst ? OperationType.UPDATE : OperationType.CREATE;
      txPath = `machine_locks/${newLockId}`;
      if (existingML && !shouldDeleteOrphanFirst) {
        await upsertRow('machine_locks', nextLockRow, 'id');
      } else {
        try {
          await insertRow('machine_locks', nextLockRow);
        } catch (insertErr) {
          if (isDuplicateKeyError(insertErr)) {
            const raced = await getRowByColumn('machine_locks', 'id', newLockId).catch(() => null);
            const lockerName =
              typeof raced?.nurse_name === 'string' && raced.nurse_name.trim()
                ? raced.nurse_name
                : 'staf lain';
            throw new Error(`MACHINE_LOCKED:${lockerName}`);
          }
          throw insertErr;
        }
      }

      if (!own) {
        setQueuedSlots((prev) =>
          prev.map((slot) =>
            slot.patientId === item.patient.id ? { ...slot, machineId: newMach.id } : slot
          )
        );
      }
      showToast(`Bed/Mesin ${item.patient.fullName} diubah ke ${newMach.machineNumber}.`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('MACHINE_LOCKED:') || isPermissionDeniedError(err)) {
        const lockerName = msg.startsWith('MACHINE_LOCKED:')
          ? msg.replace('MACHINE_LOCKED:', '').trim() || 'staf lain'
          : 'staf lain';
        setListFeedback(
          `Mesin / Bed HD ${newMach.machineNumber} pada Shift ${targetShift} baru saja dipilih oleh ${lockerName}. Silakan pilih Bed/Mesin lain.`
        );
      } else if (msg === 'LOGBOOK_MISSING') {
        setListFeedback('Entri logbook tidak ditemukan atau sudah dihapus.');
      } else if (msg === 'LOGBOOK_NOT_OWNER') {
        setListFeedback('Anda tidak memiliki izin mengubah Bed/Mesin pada logbook milik perawat lain.');
      } else if (msg.startsWith('LOGBOOK_LOCKED:')) {
        const st = msg.replace('LOGBOOK_LOCKED:', '').trim();
        setListFeedback(
          `Logbook sudah berstatus ${st} sehingga Bed/Mesin tidak dapat diubah.`
        );
      } else {
        handleDbError(err, txOp, txPath);
      }
    } finally {
      setChangingMachinePatientId(null);
    }
  };

  const openWizardForPatient = (
    pat: Patient,
    machineIdForSlot?: string,
    existing?: LogbookEntry | null
  ) => {
    setEditingEntryId(existing?.id || null);
    setWizardPatientId(pat.id);
    setWizardMachineId(machineIdForSlot);
    setShowWizardModal(true);
  };

  const openEditModal = (entry: LogbookEntry) => {
    setEditingEntryId(entry.id);
    setWizardPatientId(entry.patientId);
    setWizardMachineId(entry.machineId);
    setShowWizardModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const lockId = `${deleteTarget.date}_${deleteTarget.patientId}`;
      const locksToDelete = new Set<string>();
      if (isAdminMaster) {
        locksToDelete.add(lockId);
        for (const lk of logbookLocks) {
          if (lk.logbookId === deleteTarget.id || lk.id === lockId) {
            locksToDelete.add(lk.id);
          }
        }
      } else {
        for (const lk of logbookLocks) {
          if (
            (lk.id === lockId || lk.logbookId === deleteTarget.id) &&
            lk.nurseId === userProfile?.uid
          ) {
            locksToDelete.add(lk.id);
          }
        }
      }

      const machineLockId = `${deleteTarget.date}_${deleteTarget.shift}_${deleteTarget.machineId}`;
      const machineLocksToDelete = new Set<string>();
      if (isAdminMaster) {
        for (const lk of machineLocks) {
          if (lk.logbookId === deleteTarget.id || lk.id === machineLockId) {
            machineLocksToDelete.add(lk.id);
          }
        }
      } else {
        for (const lk of machineLocks) {
          if (
            (lk.id === machineLockId || lk.logbookId === deleteTarget.id) &&
            lk.nurseId === userProfile?.uid
          ) {
            machineLocksToDelete.add(lk.id);
          }
        }
      }

      await deleteRowByColumn('logbook', 'id', deleteTarget.id);
      await Promise.all([
        locksToDelete.size > 0
          ? deleteRowsByColumnValues('logbook_locks', 'id', Array.from(locksToDelete))
          : Promise.resolve(),
        machineLocksToDelete.size > 0
          ? deleteRowsByColumnValues('machine_locks', 'id', Array.from(machineLocksToDelete))
          : Promise.resolve(),
      ]);

      const deletedName = deleteTarget.patientName;
      setDeleteTargetId(null);
      showToast(`Logbook ${deletedName} berhasil dihapus.`, 'success');
    } catch (err) {
      showToast('Gagal menghapus logbook.', 'error');
      handleDbError(err, OperationType.DELETE, `logbook/${deleteTarget.id}`);
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim() || !catCode.trim()) return;
    setCatSaving(true);
    const wasEditing = Boolean(editingCat);
    try {
      const categoryData = {
        name: clampString(catName, 80),
        code: clampString(catCode.toUpperCase(), 20),
        description: clampString(catDesc, 300),
        isActive: true,
      };
      if (editingCat) {
        await updateRowByColumn(
          'action_categories',
          'id',
          editingCat.id,
          toActionCategoryRow(categoryData)
        );
      } else {
        await insertRow(
          'action_categories',
          toActionCategoryRow({
            id: generateRecordId(),
            ...categoryData,
          })
        );
      }
      setCatName('');
      setCatCode('');
      setCatDesc('');
      setEditingCat(null);
      showToast(
        wasEditing ? 'Kategori tindakan HD diperbarui.' : 'Kategori tindakan HD ditambahkan.',
        'success'
      );
    } catch (err) {
      showToast('Gagal menyimpan kategori tindakan HD.', 'error');
      handleDbError(err, OperationType.WRITE, 'action_categories');
    } finally {
      setCatSaving(false);
    }
  };

  const toggleCategoryActive = async (cat: ActionCategory) => {
    try {
      await updateRowByColumn(
        'action_categories',
        'id',
        cat.id,
        toActionCategoryRow({
          isActive: !cat.isActive,
        })
      );
      showToast(
        `Kategori "${cat.name}" ${!cat.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`,
        'info'
      );
    } catch (err) {
      showToast('Gagal memperbarui status kategori.', 'error');
      handleDbError(err, OperationType.UPDATE, `action_categories/${cat.id}`);
    }
  };

  const deleteCategory = async (catId: string) => {
    try {
      await deleteRowByColumn('action_categories', 'id', catId);
      showToast('Kategori tindakan HD dihapus.', 'info');
    } catch (err) {
      showToast('Gagal menghapus kategori tindakan.', 'error');
      handleDbError(err, OperationType.DELETE, `action_categories/${catId}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Workspace Header Matching Screenshot */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900 uppercase">
            {isAdminMaster ? 'MASTER LOGBOOK & KATEGORI TINDAKAN' : 'LOGBOOK'}
          </h2>
          {isAdminMaster ? (
            <p className="text-xs text-slate-600">
              Kelola seluruh arsip logbook unit, kategori tindakan HD, dan template formulir.
            </p>
          ) : (
            <p className="text-xs text-slate-700 leading-relaxed">
              <span>
                Hari {inputDayName},{' '}
                <strong className="font-semibold text-slate-900">{formatDateId(inputDate)}</strong>
              </span>
              <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
              <span className="font-medium">
                Shift {activeShift} ({SHIFT_TIME_LABEL[activeShift]})
              </span>
              <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
              <span>
                Jadwal Matriks:{' '}
                <strong className="font-semibold text-[#0B5A8E]">{matrixStatusText}</strong>
              </span>
              <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
              <span className="tabular-nums">
                Pasien Terinput Shift Ini:{' '}
                <strong className="font-bold text-slate-900">
                  {totalShiftSubmittedCount} Pasien
                </strong>
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                <Clock className="h-3.5 w-3.5 text-[#0B5A8E] shrink-0" />
                <span>
                  Batas Ajukan Verifikasi WIB: Shift Pagi{' '}
                  <strong className="font-mono">{SUBMISSION_WINDOW_WIB.Pagi.label}</strong> · Shift Siang{' '}
                  <strong className="font-mono">{SUBMISSION_WINDOW_WIB.Siang.label}</strong> · Sekarang{' '}
                  <strong className="font-mono text-[#0B5A8E]">{wibTimeLabel}</strong>
                </span>
              </span>
            </p>
          )}
        </div>

        {isAdminMaster ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowTemplateEditor(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-bold tracking-wide uppercase text-white shadow-xs hover:bg-[#094a75] transition-colors whitespace-nowrap shrink-0"
            >
              <Pencil className="h-3.5 w-3.5" />
              EDIT LOGBOOK
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {inputDate !== todayDate && (
              <button
                type="button"
                onClick={() => {
                  setInputDate(todayDate);
                  setManualShiftOverride(null);
                  setQueuedSlots([]);
                  setShowScheduleEditor(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Kembali ke Hari Ini ({formatDateId(todayDate)})
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowScheduleEditor((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold tracking-wide uppercase transition-colors whitespace-nowrap shrink-0 ${
                showScheduleEditor
                  ? 'border-[#0B5A8E] bg-[#0B5A8E] text-white'
                  : 'border-slate-300 bg-white text-[#0e3a53] hover:bg-slate-50'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              RUBAH JADWAL
            </button>
          </div>
        )}
      </div>

      {/* Inline Date & Shift Adjuster Bar when RUBAH JADWAL clicked */}
      {!isAdminMaster && showScheduleEditor && (
        <div className="rounded-xl border border-sky-200 bg-white/95 p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 flex-1 max-w-lg">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600 mb-1">
                Tanggal Dinas ({inputDayName})
              </label>
              <input
                type="date"
                value={inputDate}
                onChange={(e) => {
                  setInputDate(e.target.value);
                  setQueuedSlots([]);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600 mb-1">
                Shift Aktif
              </label>
              <select
                value={activeShift}
                onChange={(e) => {
                  setManualShiftOverride(e.target.value as ShiftType);
                  setQueuedSlots([]);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
              >
                <option value="Pagi">Shift Pagi (07.00–14.00 WIB)</option>
                <option value="Siang">Shift Siang (12.00–19.00 WIB)</option>
                {hasHistoricalMalam && (
                  <option value="Malam">Shift Malam (21.00–07.00 WIB)</option>
                )}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {manualShiftOverride && (
              <button
                type="button"
                onClick={() => {
                  setManualShiftOverride(null);
                  setQueuedSlots([]);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Ikuti Jadwal Matriks
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowScheduleEditor(false)}
              className="rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75] whitespace-nowrap"
            >
              Terapkan
            </button>
          </div>
        </div>
      )}

      {/* Admin Master Tabs */}
      {isAdminMaster && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Semua Logbook ({logbooks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('verified')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'verified' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Rekap Terverifikasi ({logbooks.filter((l) => l.verificationStatus === 'Approved').length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'categories' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Kategori Tindakan HD ({actionCategories.length})
          </button>
        </div>
      )}

      {isAdminMaster && activeTab === 'categories' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 h-fit">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FolderPlus className="h-4 w-4 text-teal-600" />
              {editingCat ? 'Edit Kategori Tindakan' : 'Tambah Kategori Tindakan'}
            </h3>
            <form onSubmit={handleSaveCategory} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kode Kategori</label>
                <input
                  type="text"
                  required
                  value={catCode}
                  onChange={(e) => setCatCode(e.target.value)}
                  placeholder="HDR-01"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Tindakan HD</label>
                <input
                  type="text"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="HD Reguler"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi</label>
                <textarea
                  rows={3}
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  placeholder="Keterangan indikasi atau prosedur..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={catSaving}
                  className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {catSaving ? 'Menyimpan...' : editingCat ? 'Simpan Perubahan' : 'Tambah Kategori'}
                </button>
                {editingCat && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCat(null);
                      setCatName('');
                      setCatCode('');
                      setCatDesc('');
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8">
            <h3 className="text-sm font-semibold text-slate-900">Daftar Kategori Tindakan Hemodialisa</h3>
            {actionCategories.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">Belum ada kategori tindakan terdaftar.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="pb-2.5 font-semibold">Kode</th>
                      <th className="pb-2.5 font-semibold">Nama Kategori</th>
                      <th className="pb-2.5 font-semibold">Deskripsi</th>
                      <th className="pb-2.5 font-semibold">Status</th>
                      <th className="pb-2.5 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {actionCategories.map((cat) => (
                      <tr key={cat.id} className="hover:bg-slate-50">
                        <td className="py-3 font-mono font-semibold text-slate-800">{cat.code}</td>
                        <td className="py-3 font-medium text-slate-900">{cat.name}</td>
                        <td className="py-3 text-slate-600 max-w-xs">{cat.description || '-'}</td>
                        <td className="py-3">
                          <button
                            type="button"
                            onClick={() => toggleCategoryActive(cat)}
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                              cat.isActive
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-600'
                            }`}
                          >
                            {cat.isActive ? 'Aktif' : 'Nonaktif'}
                          </button>
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCat(cat);
                                setCatName(cat.name);
                                setCatCode(cat.code);
                                setCatDesc(cat.description || '');
                              }}
                              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCategory(cat.id)}
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                              title="Hapus"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {!isAdminMaster && (
            <>
              {/* Real-Time Shift Progress Strip */}
              <section className="rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-bold text-slate-900">
                      Progres Shift {activeShift}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-teal-700 tabular-nums">
                      {nurseShiftProgress.scheduledTotal > 0
                        ? `${nurseShiftProgress.scheduledCoveredCount}/${nurseShiftProgress.scheduledTotal} Pasien Terjadwal Terinput`
                        : `${nurseShiftProgress.totalSubmitted} Pasien Terinput`}
                    </span>
                    {nurseShiftProgress.remainingScheduledCount > 0 && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono text-amber-700 tabular-nums">
                          Sisa {nurseShiftProgress.remainingScheduledCount} belum diinput
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                    <span className="text-emerald-700">
                      Approved: <strong>{nurseShiftProgress.approved}</strong>
                    </span>
                    <span className="text-amber-700">
                      Menunggu Verifikasi: <strong>{nurseShiftProgress.pending}</strong>
                    </span>
                    {nurseShiftProgress.draftOrRevision > 0 && (
                      <span className="text-slate-600">
                        Draft/Revisi: <strong>{nurseShiftProgress.draftOrRevision}</strong>
                      </span>
                    )}
                    <strong className="text-slate-900">{nurseShiftProgress.pct}%</strong>
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-600 transition-all duration-300"
                    style={{ width: `${nurseShiftProgress.pct}%` }}
                  />
                </div>
              </section>

              {/* CARD 1: Tim Medis Berdinas Shift {activeShift} (Collapsible) */}
              <section className="rounded-xl border border-slate-200/90 bg-white/95 p-4 shadow-sm space-y-3.5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 border border-sky-100 text-[#0B5A8E]">
                      <Stethoscope className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <h3 className="font-display text-xs sm:text-sm font-bold text-slate-900">
                          Tim Medis Shift {activeShift}
                        </h3>
                        <span className="text-[11px] font-medium text-[#0B5A8E]">
                          ·{' '}
                          {doctorScheduleForSlot
                            ? 'Otomatis dari Jadwal Dokter'
                            : 'Default Dokter Unit'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 truncate">
                        DPJP:{' '}
                        <strong className="font-semibold text-slate-900">
                          {resolvedDpjpName}
                        </strong>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                        Dokter Jaga:{' '}
                        <strong className="font-semibold text-slate-900">
                          {resolvedDutyDoctorName || 'Belum diatur'}
                        </strong>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMedicalTeamEditor((v) => !v)}
                    className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Pencil className="h-3 w-3" />
                    {showMedicalTeamEditor ? 'Tutup Pengaturan' : 'Ubah Tim Medis'}
                  </button>
                </div>

                {showMedicalTeamEditor && (
                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-3.5 md:grid-cols-2">
                    {/* Left Doctor Box: DPJP */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          Dokter DPJP Unit Hemodialisis
                        </span>
                        <span className="text-[10px] font-bold tracking-wider text-[#0B5A8E] uppercase whitespace-nowrap">
                          KONSULEN NEFROLOGI
                        </span>
                      </div>
                      <select
                        value={resolvedDpjpId}
                        onChange={(e) => setDpjpOverride(e.target.value)}
                        aria-label="Dokter DPJP Unit Hemodialisis"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                      >
                        {dpjpDoctors.length === 0 ? (
                          <option value="">-- Belum ada data Dokter DPJP aktif --</option>
                        ) : (
                          dpjpDoctors.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.fullName}
                            </option>
                          ))
                        )}
                      </select>
                      <p className="text-[11px] text-slate-500">
                        Penanggung jawab medis resep HD, target UF Goal, dan advis klinis.
                      </p>
                    </div>

                    {/* Right Doctor Box: Duty Doctor */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          Dokter Jaga Ruangan (Duty Doctor)
                        </span>
                        <span className="text-[10px] font-bold tracking-wider text-emerald-700 uppercase whitespace-nowrap">
                          STANDBY SHIFT {activeShift.toUpperCase()}
                        </span>
                      </div>
                      <select
                        value={resolvedDutyDoctorId}
                        onChange={(e) => setDutyDoctorOverride(e.target.value)}
                        aria-label="Dokter Jaga Ruangan"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                      >
                        {dutyDoctors.length === 0 ? (
                          <option value="">-- Belum ada data Dokter Umum aktif --</option>
                        ) : (
                          dutyDoctors.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.fullName}
                            </option>
                          ))
                        )}
                        <option value="__manual__">Input Manual Nama Dokter Jaga...</option>
                      </select>
                      {resolvedDutyDoctorId === '__manual__' && (
                        <input
                          type="text"
                          value={manualDutyDoctorName}
                          onChange={(e) => setManualDutyDoctorName(e.target.value)}
                          placeholder="Ketik nama Dokter Jaga..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                        />
                      )}
                      <p className="text-[11px] text-slate-500">
                        Dokter siaga onsite untuk kegawatdaruratan dan komunikasi TBAK intra-HD.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {/* CARD 2: Input Pasien ke Logbook Shift {activeShift} */}
              <section className="rounded-xl border border-slate-200/90 bg-white/95 p-5 shadow-sm space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-bold text-[#0B5A8E]">Langkah 1 dari 2</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-slate-600 tabular-nums">
                        Terjadwal Hari {inputDayName} Shift {activeShift}:{' '}
                        <strong className="text-slate-900">
                          {scheduledPatientsForSlot.length} Pasien
                        </strong>
                      </span>
                    </div>
                    <h3 className="mt-0.5 font-display text-base font-bold text-slate-900">
                      Input Pasien ke Logbook Shift {activeShift}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {canQuickAddPatient && (
                      <button
                        type="button"
                        onClick={() => setShowAddPatientModal(true)}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#0e3a53] px-4 py-2 text-xs font-bold text-white hover:bg-[#09293b] whitespace-nowrap shrink-0"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        + PASIEN BARU
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeOutsideShift((v) => !v);
                        setSelectedDropdownPatientId('');
                        setPickerFeedback(null);
                      }}
                      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                        includeOutsideShift
                          ? 'bg-teal-700 text-white ring-2 ring-teal-500/30'
                          : 'bg-teal-600 text-white hover:bg-teal-700'
                      }`}
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      {includeOutsideShift
                        ? 'Tampilkan Jadwal Shift Ini Saja'
                        : 'Tambah Pasien Reschedule (Di Luar Shift)'}
                    </button>
                  </div>
                </div>

                <form onSubmit={handleAddPatientToShiftList} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {includeOutsideShift
                        ? `Data Pasien Terdaftar — Semua Pasien Aktif (Mode Reschedule / Di Luar Shift)`
                        : `Data Pasien Terdaftar — Daftar Pasien Hari ${inputDayName} Shift ${activeShift}`}
                    </label>
                    <select
                      value={selectedDropdownPatientId}
                      onChange={(e) => handleSelectPatientDropdown(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:border-[#0B5A8E] focus:outline-none"
                    >
                      <option value="">
                        {dropdownPatientPool.length === 0
                          ? `-- Belum ada pasien terjadwal pada Hari ${inputDayName} Shift ${activeShift} --`
                          : `-- Pilih pasien ${
                              includeOutsideShift
                                ? 'aktif'
                                : `Hari ${inputDayName} Shift ${activeShift}`
                            } (${
                              dropdownPatientPool.filter(
                                (p) =>
                                  !lockedPatientsForInputDate.has(p.id) &&
                                  !queuedPatientIdSet.has(p.id)
                              ).length
                            } tersedia) --`}
                      </option>
                      {dropdownPatientPool.map((pat) => {
                        const lockInfo = lockedPatientsForInputDate.get(pat.id);
                        const isLockedByOther = Boolean(
                          lockInfo && lockInfo.nurseId !== userProfile?.uid
                        );
                        const isAlreadyQueued = queuedPatientIdSet.has(pat.id);
                        const suffix = isLockedByOther
                          ? ` [Sudah diinput: ${lockInfo?.nurseName}]`
                          : isAlreadyQueued
                          ? ' [Sudah di daftar]'
                          : lockInfo
                          ? ' [Sudah diinput]'
                          : '';
                        return (
                          <option
                            key={pat.id}
                            value={pat.id}
                            disabled={isLockedByOther || isAlreadyQueued}
                          >
                            {pat.fullName} — RM {pat.mrn} · {pat.vascularAccess} ·{' '}
                            {!isRegularPatient(pat) ? '[Non-Reguler] ' : ''}
                            {pat.routineSchedule}
                            {suffix}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                    <div className="md:col-span-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nama Pasien Shift {activeShift} <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={draftPatientName}
                        onChange={(e) => {
                          setDraftPatientName(e.target.value);
                          setSelectedDropdownPatientId('');
                          setPickerFeedback(null);
                        }}
                        placeholder={`Pilih dari daftar Shift ${activeShift} atau ketik nama...`}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        No. Rekam Medis (RM)
                      </label>
                      <input
                        type="text"
                        value={draftPatientRm}
                        onChange={(e) => {
                          setDraftPatientRm(e.target.value);
                          setSelectedDropdownPatientId('');
                          setPickerFeedback(null);
                        }}
                        placeholder="Contoh: 00-12-34"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Mesin / Bed HD
                      </label>
                      <select
                        value={resolvedDraftMachineId}
                        onChange={(e) => {
                          setDraftMachineId(e.target.value);
                          setPickerFeedback(null);
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                      >
                        {availableMachineOptions.length === 0 ? (
                          <option value="">-- Belum ada mesin --</option>
                        ) : (
                          <>
                            {!resolvedDraftMachineId && (
                              <option value="">-- Semua mesin/bed terpakai --</option>
                            )}
                            {availableMachineOptions.map((m) => {
                              const lock = lockedMachinesForSlot.get(m.id);
                              const isLockedByOther = Boolean(
                                lock && lock.nurseId !== userProfile?.uid
                              );
                              const isUsedInSlot = Boolean(lock);
                              const suffix = isLockedByOther
                                ? ` [Dipakai: ${lock?.nurseName}]`
                                : isUsedInSlot
                                ? ` [Dipilih: ${lock?.patientName}]`
                                : '';
                              return (
                                <option key={m.id} value={m.id} disabled={isUsedInSlot}>
                                  {m.machineNumber}
                                  {suffix}
                                </option>
                              );
                            })}
                          </>
                        )}
                      </select>
                    </div>

                    <div className="md:col-span-3">
                      <button
                        type="submit"
                        disabled={claimingSlot}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#156599] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#0e4e78] disabled:opacity-60 transition-colors whitespace-nowrap"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {claimingSlot ? 'Menyimpan Slot...' : `Input Pasien Shift ${activeShift}`}
                      </button>
                    </div>
                  </div>

                  {pickerFeedback && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                      <span className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                        {pickerFeedback}
                      </span>
                      {canQuickAddPatient && (
                        <button
                          type="button"
                          onClick={() => setShowAddPatientModal(true)}
                          className="rounded-md bg-[#0e3a53] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#09293b] whitespace-nowrap"
                        >
                          Daftarkan Pasien Baru
                        </button>
                      )}
                    </div>
                  )}
                </form>
              </section>

              {/* CARD 3: Daftar Pasien Shift {activeShift} */}
              <section className="rounded-xl border border-slate-200/90 bg-white/95 p-5 shadow-sm space-y-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3.5">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Daftar Pasien Tanggal {formatDateId(inputDate)} · Shift {activeShift}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Klik nama pasien untuk mengisi atau meninjau Logbook Bagian I–VIII.
                    </p>
                  </div>
                  <span className="text-xs font-medium text-slate-600 tabular-nums shrink-0">
                    Total: <strong className="font-bold text-slate-900">{shiftPatientList.length} Pasien</strong>
                  </span>
                </div>

                {listFeedback && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                    <span className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                      {listFeedback}
                    </span>
                    <button
                      type="button"
                      onClick={() => setListFeedback(null)}
                      className="rounded p-1 text-amber-700 hover:bg-amber-100"
                      aria-label="Tutup pesan"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {shiftPatientList.length === 0 ? (
                  <div className="py-10 px-4 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 border border-sky-100 text-[#0B5A8E]">
                      <Users className="h-5 w-5" />
                    </div>
                    <h4 className="mt-3 text-sm font-bold text-slate-900">
                      Daftar Pasien Shift {activeShift} Masih Kosong ({formatDateId(inputDate)})
                    </h4>
                    <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 leading-relaxed">
                      Tambahkan pasien melalui formulir di atas untuk mulai mengisi Logbook Bagian I–VIII.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {shiftPatientList.map((item, idx) => {
                      const pat = item.patient;
                      const own = item.ownEntry;
                      const ownSubAccess = own
                        ? getLogbookSubmissionAccess(own.date, own.shift, own, nowMs)
                        : null;
                      const revisionExpired =
                        own?.verificationStatus === 'Revision' &&
                        Boolean(ownSubAccess?.revisionExpired);
                      const canContinueOwn =
                        own &&
                        (own.verificationStatus === 'Draft' ||
                          (own.verificationStatus === 'Revision' && !revisionExpired));
                      const isPendingOrApproved =
                        own &&
                        (own.verificationStatus === 'Pending' ||
                          own.verificationStatus === 'Approved' ||
                          revisionExpired);
                      const isChangingMachine = changingMachinePatientId === pat.id;
                      const hasCurrentInOptions = availableMachineOptions.some(
                        (m) => m.id === item.machineId
                      );

                      return (
                        <div
                          key={pat.id}
                          className={`flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors ${
                            own?.verificationStatus === 'Approved'
                              ? 'border-emerald-200 bg-emerald-50/30'
                              : own
                              ? 'border-sky-200 bg-sky-50/30'
                              : 'border-slate-200 bg-white hover:border-[#0B5A8E]/50'
                          }`}
                        >
                          <div
                            onClick={() => {
                              if (isPendingOrApproved && own) {
                                setDetailEntryId(own.id);
                              } else {
                                openWizardForPatient(pat, item.machineId, own || null);
                              }
                            }}
                            className="flex flex-1 items-start gap-3 text-left min-w-0 cursor-pointer"
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold tabular-nums ${
                                own?.verificationStatus === 'Approved'
                                  ? 'bg-emerald-600 text-white'
                                  : own
                                  ? 'bg-[#0B5A8E] text-white'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {own?.verificationStatus === 'Approved' ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                idx + 1
                              )}
                            </span>
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isPendingOrApproved && own) {
                                      setDetailEntryId(own.id);
                                    } else {
                                      openWizardForPatient(pat, item.machineId, own || null);
                                    }
                                  }}
                                  className="text-sm font-bold text-[#0B5A8E] hover:underline text-left"
                                >
                                  {pat.fullName}
                                </button>
                                <span className="font-mono text-xs text-slate-500">
                                  ({pat.mrn})
                                </span>
                                {!isRegularPatient(pat) && (
                                  <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                    Non-Reguler
                                  </span>
                                )}
                                {own ? (
                                  <VerificationBadge status={own.verificationStatus} />
                                ) : (
                                  <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                    Siap Diinput (Bagian I–VIII)
                                  </span>
                                )}
                                {own?.verificationStatus === 'Revision' &&
                                  ownSubAccess?.isRevisionGrace && (
                                    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800">
                                      <Clock className="h-3 w-3 shrink-0" />
                                      Sisa Revisi {ownSubAccess.remainingRevisionMinutes} mnt (s.d.{' '}
                                      {ownSubAccess.deadlineWibLabel})
                                    </span>
                                  )}
                                {revisionExpired && (
                                  <span className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
                                    <Lock className="h-3 w-3 shrink-0" />
                                    Batas Revisi 1 Jam Berakhir
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-y-1 text-xs text-slate-500">
                                {!isPendingOrApproved ? (
                                  <span
                                    className="inline-flex items-center gap-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <label
                                      htmlFor={`slot-machine-${pat.id}`}
                                      className="text-slate-500"
                                    >
                                      Bed/Mesin:
                                    </label>
                                    <select
                                      id={`slot-machine-${pat.id}`}
                                      value={item.machineId}
                                      disabled={isChangingMachine}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        void handleChangeSlotMachine(item, e.target.value);
                                      }}
                                      aria-label={`Pilih Bed/Mesin untuk ${pat.fullName}`}
                                      className="rounded-md border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs font-bold text-slate-800 focus:border-[#0B5A8E] focus:outline-none disabled:opacity-60"
                                    >
                                      {!hasCurrentInOptions && item.machineId && (
                                        <option value={item.machineId}>{item.machineNumber}</option>
                                      )}
                                      {availableMachineOptions.map((m) => {
                                        const lock = lockedMachinesForSlot.get(m.id);
                                        const isCurrent = m.id === item.machineId;
                                        const isLockedByOther = Boolean(
                                          lock && lock.nurseId !== userProfile?.uid
                                        );
                                        const isUsedByOtherSlot = Boolean(lock && !isCurrent);
                                        const suffix = isCurrent
                                          ? ''
                                          : isLockedByOther
                                          ? ` [Dipakai: ${lock?.nurseName}]`
                                          : isUsedByOtherSlot
                                          ? ` [Dipilih: ${lock?.patientName}]`
                                          : '';
                                        return (
                                          <option
                                            key={m.id}
                                            value={m.id}
                                            disabled={!isCurrent && isUsedByOtherSlot}
                                          >
                                            {m.machineNumber}
                                            {suffix}
                                          </option>
                                        );
                                      })}
                                    </select>
                                    {isChangingMachine && (
                                      <span className="text-[10px] font-medium text-[#0B5A8E]">
                                        Menyimpan...
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span>
                                    Bed/Mesin:{' '}
                                    <strong className="font-mono text-slate-700">
                                      {item.machineNumber}
                                    </strong>
                                  </span>
                                )}
                                <span className="mx-1.5" aria-hidden="true">·</span>
                                <span>
                                  {(() => {
                                    if (!own) return pat.vascularAccess;
                                    const spo36 = own.wizardDetails?.spoChecklist?.['3.6'];
                                    if (spo36 === 'TIDAK DIKERJAKAN') {
                                      return 'Akses Poin 3.6 belum diceklis';
                                    }
                                    const sec3 = own.wizardDetails?.section3;
                                    const accessLabel =
                                      own.vascularAccess === 'CDL' || own.vascularAccess === 'CVC'
                                        ? 'CDL'
                                        : own.vascularAccess === 'Femoral'
                                        ? 'FEMORAL'
                                        : own.vascularAccess === 'AV Fistula' ||
                                          own.vascularAccess === 'AV Shunt'
                                        ? 'CIMINO'
                                        : own.vascularAccess || pat.vascularAccess;
                                    const accessNote =
                                      accessLabel === 'CDL'
                                        ? sec3?.cdlNote?.trim() || sec3?.accessDetailNote?.trim() || ''
                                        : accessLabel === 'FEMORAL'
                                        ? sec3?.femoralNote?.trim() || sec3?.accessDetailNote?.trim() || ''
                                        : accessLabel === 'CIMINO'
                                        ? sec3?.ciminoNote?.trim() || sec3?.accessDetailNote?.trim() || ''
                                        : sec3?.accessDetailNote?.trim() || '';
                                    return accessNote ? `${accessLabel} (${accessNote})` : accessLabel;
                                  })()}
                                </span>
                                <span className="mx-1.5" aria-hidden="true">·</span>
                                <span>{pat.routineSchedule}</span>
                                <span className="mx-1.5" aria-hidden="true">·</span>
                                <span>
                                  DPJP: {doctors.find((d) => d.id === resolvedDpjpId)?.fullName || 'Sesuai Jadwal Shift'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!own && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openWizardForPatient(pat, item.machineId)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#094a75] whitespace-nowrap"
                                >
                                  Isi Logbook (Bagian I–VIII)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFromQueue(pat.id, item.machineId)}
                                  className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  title="Keluarkan dari daftar"
                                  aria-label={`Hapus ${pat.fullName} dari daftar`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            {canContinueOwn && own && (
                              <button
                                type="button"
                                onClick={() => openWizardForPatient(pat, own.machineId, own)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 whitespace-nowrap"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {own.verificationStatus === 'Draft' ? 'Lanjutkan Draft' : 'Perbaiki Revisi'}
                              </button>
                            )}
                            {isPendingOrApproved && own && (
                              <button
                                type="button"
                                onClick={() => setDetailEntryId(own.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Lihat Detail
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {isAdminMaster && (
            <>
              {/* Filter Bar for Logbook Records Table */}
              <div className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Arsip &amp; Daftar Logbook Tersimpan
                    </h3>
                    {dateFilter && (
                      <span className="rounded-md bg-sky-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#0B5A8E]">
                        {dateFilter === todayDate
                          ? `Tanggal Aktif: ${formatDateId(dateFilter)}`
                          : `Tanggal: ${formatDateId(dateFilter)}`}
                      </span>
                    )}
                    {archiveLoading && (
                      <span className="text-[11px] font-medium text-[#0B5A8E]">
                        Memuat arsip...
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {filteredLogbooks.length} Entri
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Cari pasien, RM, mesin, perawat..."
                      className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-[#0B5A8E] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      aria-label="Filter Tanggal Logbook"
                      value={dateFilter}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDateFilter(val);
                        if (val) setMonthFilter(val.slice(0, 7));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
                    />
                    {dateFilter ? (
                      <button
                        type="button"
                        onClick={() => setDateFilter('')}
                        className="rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 shrink-0"
                        title="Tampilkan seluruh bulan"
                      >
                        Sebulan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDateFilter(todayDate);
                          setMonthFilter(todayDate.slice(0, 7));
                        }}
                        className="rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-[#0B5A8E] hover:bg-sky-50 shrink-0"
                        title="Kembali ke tanggal aktif"
                      >
                        Hari Ini
                      </button>
                    )}
                  </div>
                  <input
                    type="month"
                    aria-label="Filter Bulan Logbook"
                    value={monthFilter}
                    onChange={(e) => {
                      setMonthFilter(e.target.value);
                      setDateFilter('');
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
                  />
                  <select
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
                  >
                    <option value="ALL">Semua Shift</option>
                    <option value="Pagi">Shift Pagi</option>
                    <option value="Siang">Shift Siang</option>
                    {hasHistoricalMalam && <option value="Malam">Shift Malam</option>}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
                  >
                    <option value="ALL">Semua Status Verifikasi</option>
                    <option value="Draft">Draft (Sementara)</option>
                    <option value="Pending">Menunggu Verifikasi</option>
                    <option value="Approved">Approved</option>
                    <option value="Revision">Revisi</option>
                  </select>
                </div>
              </div>

              {/* Logbook Table */}
              <div className="rounded-xl border border-slate-200 bg-white/95 shadow-sm overflow-hidden">
                {filteredLogbooks.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    {dateFilter
                      ? `Belum ada logbook yang diinputkan pada tanggal ${formatDateId(dateFilter)}.`
                      : 'Belum ada catatan logbook tersimpan pada periode / filter ini.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Tanggal / Jam</th>
                          <th className="px-4 py-3 font-semibold">Pasien (RM)</th>
                          <th className="px-4 py-3 font-semibold">Tindakan &amp; Mesin</th>
                          <th className="px-4 py-3 font-semibold">Pre / Post HD</th>
                          <th className="px-4 py-3 font-semibold">Perawat &amp; Shift</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredLogbooks.map((item) => {
                          const isOwner = item.nurseId === userProfile?.uid;
                          const itemRevExpired =
                            item.verificationStatus === 'Revision' &&
                            getLogbookSubmissionAccess(item.date, item.shift, item, nowMs)
                              .revisionExpired;
                          const canNurseEdit =
                            isOwner &&
                            (item.verificationStatus === 'Draft' ||
                              (item.verificationStatus === 'Revision' && !itemRevExpired));
                          const isLocked =
                            isOwner &&
                            (item.verificationStatus === 'Pending' ||
                              item.verificationStatus === 'Approved' ||
                              itemRevExpired);
                          const canDelete =
                            isAdminMaster ||
                            (isOwner && item.verificationStatus === 'Draft');

                          return (
                            <tr key={item.id} className="hover:bg-slate-50/80">
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div className="font-mono font-semibold text-slate-900 tabular-nums">
                                  {formatDateId(item.date)}
                                </div>
                                <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  {item.startTime} – {item.endTime}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900">{item.patientName}</div>
                                <div className="font-mono text-[11px] text-slate-500">
                                  {item.patientRm} · {item.vascularAccess}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">{item.actionCategory}</div>
                                <div className="font-mono text-[11px] text-slate-500">
                                  {item.machineNumber} · DPJP: {item.doctorName}
                                </div>
                                {item.dutyDoctorName && (
                                  <div className="font-mono text-[11px] text-slate-500">
                                    Jaga: {item.dutyDoctorName}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-slate-700 whitespace-nowrap">
                                <div>
                                  BB: {item.preWeight} &rarr; {item.postWeight} kg
                                </div>
                                <div>
                                  TD: {item.preBp || '-'} &rarr; {item.postBp || '-'} · UF: {item.ufAchieved} ml
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">{item.nurseName}</div>
                                <div className="mt-1">
                                  <ShiftBadge shift={item.shift} />
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <VerificationBadge status={item.verificationStatus} />
                                {item.targetVerifierName && item.verificationStatus === 'Pending' && (
                                  <div className="mt-1 text-[10px] text-slate-500">
                                    Ke: {item.targetVerifierName}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setDetailEntryId(item.id)}
                                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                    title="Detail Lengkap 8 Bagian"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                  {canNurseEdit && (
                                    <button
                                      type="button"
                                      onClick={() => openEditModal(item)}
                                      className="rounded-md p-1.5 text-sky-600 hover:bg-sky-50"
                                      title={
                                        item.verificationStatus === 'Draft'
                                          ? 'Lanjutkan Draft'
                                          : 'Perbaiki Revisi'
                                      }
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                  )}
                                  {isLocked && !isAdminMaster && (
                                    <span
                                      className="inline-flex rounded-md p-1.5 text-slate-300"
                                      title="Terkunci setelah diajukan verifikasi"
                                    >
                                      <Lock className="h-3.5 w-3.5" />
                                    </span>
                                  )}
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => setDeleteTargetId(item.id)}
                                      className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                      title="Hapus Logbook"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
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
            </>
          )}
        </>
      )}

      {/* 7-Part Interactive Wizard Modal */}
      {showWizardModal && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-xs font-semibold text-slate-700 shadow-lg">
                Memuat formulir asuhan keperawatan...
              </div>
            </div>
          }
        >
          <LazyLogbookWizardModal
            editingEntry={editingEntry}
            initialPatientId={wizardPatientId || editingEntry?.patientId || undefined}
            initialMachineId={editingEntry?.machineId || wizardMachineId}
            initialDate={editingEntry?.date || inputDate}
            initialShift={editingEntry?.shift || activeShift}
            initialDoctorId={editingEntry?.doctorId || resolvedDpjpId || undefined}
            initialDutyDoctorId={editingEntry?.dutyDoctorId || resolvedDutyDoctorId || undefined}
            initialDutyDoctorName={editingEntry?.dutyDoctorName || resolvedDutyDoctorName || undefined}
            logbooks={logbooks}
            logbookLocks={logbookLocks}
            machineLocks={machineLocks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            pjShiftAssignments={pjShiftAssignments}
            formTemplate={formTemplate}
            onClose={() => {
              setShowWizardModal(false);
              setEditingEntryId(null);
              setWizardPatientId(null);
              setWizardMachineId(undefined);
            }}
          />
        </Suspense>
      )}

      {/* Quick Add Patient Modal */}
      {showAddPatientModal && (
        <QuickAddPatientModal
          patients={patients}
          defaultDayName={inputDayName}
          defaultShift={activeShift}
          defaultName={draftPatientName.trim() || undefined}
          defaultMrn={draftPatientRm.trim() || undefined}
          onClose={() => setShowAddPatientModal(false)}
          onCreated={(created) => {
            setPickerFeedback(null);
            void claimMachineSlotAndQueue(created, resolvedDraftMachineId);
          }}
        />
      )}

      {/* Detail Modal */}
      {detailEntry && (
        <LogbookDetailModal
          entry={detailEntry}
          logbooks={logbooks}
          logbookLocks={logbookLocks}
          machineLocks={machineLocks}
          patients={patients}
          doctors={doctors}
          machines={machines}
          actionCategories={actionCategories}
          staffDirectory={staffDirectory}
          formTemplate={formTemplate}
          onClose={() => setDetailEntryId(null)}
        />
      )}

      {/* Master Logbook Template Editor Modal */}
      {isAdminMaster && showTemplateEditor && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-xs font-semibold text-slate-700 shadow-lg">
                Memuat editor template logbook...
              </div>
            </div>
          }
        >
          <LazyLogbookTemplateEditorModal
            currentTemplate={formTemplate || DEFAULT_LOGBOOK_TEMPLATE}
            onClose={() => setShowTemplateEditor(false)}
          />
        </Suspense>
      )}

      {/* Confirm Delete Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900">
              Hapus Entri Logbook?
            </h3>
            <p className="mt-2 text-xs text-slate-600">
              Anda akan menghapus logbook tindakan pasien{' '}
              <span className="font-semibold text-slate-900">{deleteTarget.patientName}</span> oleh{' '}
              <span className="font-semibold text-slate-900">{deleteTarget.nurseName}</span> tanggal{' '}
              {formatDateId(deleteTarget.date)}. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTargetId(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Ya, Hapus Logbook
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

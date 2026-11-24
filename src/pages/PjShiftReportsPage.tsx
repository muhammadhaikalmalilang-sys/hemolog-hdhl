import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Lock,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import { handleDbError, OperationType } from '../lib/supabase';
import { generateRecordId, insertRow, toReportRow, updateRowByColumn } from '../lib/db';
import {
  clampString,
  exportToCsv,
  formatDateId,
  formatFullDayDateId,
  getDayNameId,
  isPatientScheduledOnDay,
  isRegularPatient,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { useF4OnePagePrint } from '../hooks/useF4OnePagePrint';
import type {
  DoctorScheduleEntry,
  LogbookEntry,
  Machine,
  Patient,
  PjShiftAssignmentEntry,
  ReportEntry,
  ReportSectionDItem,
  ScheduleEntry,
  ShiftType,
  StaffDirectoryEntry,
} from '../types';

interface PjShiftReportsPageProps {
  reports: ReportEntry[];
  logbooks: LogbookEntry[];
  patients: Patient[];
  machines: Machine[];
  schedules: ScheduleEntry[];
  doctorSchedules: DoctorScheduleEntry[];
  staffDirectory: StaffDirectoryEntry[];
  pjShiftAssignments?: PjShiftAssignmentEntry[];
  archiveLoading?: boolean;
  onEnsureMonthLoaded?: (monthKey: string) => Promise<void> | void;
}

function calcDurationHours(startTime: string, endTime: string): number | null {
  const m1 = /^(\d{1,2}):(\d{2})$/.exec(startTime?.trim() || '');
  const m2 = /^(\d{1,2}):(\d{2})$/.exec(endTime?.trim() || '');
  if (!m1 || !m2) return null;
  const startMin = Number(m1[1]) * 60 + Number(m1[2]);
  let endMin = Number(m2[1]) * 60 + Number(m2[2]);
  if (endMin < startMin) endMin += 24 * 60;
  const diff = (endMin - startMin) / 60;
  return diff > 0 ? Number(diff.toFixed(1)) : null;
}

function getEntryDurationHours(entry: LogbookEntry): number | null {
  const sec3Dur = entry.wizardDetails?.section3?.dialysisDurationHours;
  if (sec3Dur) {
    const parsed = Number(String(sec3Dur).replace(',', '.'));
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return calcDurationHours(entry.startTime, entry.endTime);
}

function getShiftTimeLabel(shift: 'ALL' | ShiftType): string {
  if (shift === 'Pagi') return 'Pagi, jam 07.00 - 14.00 WIB';
  if (shift === 'Siang') return 'Siang, jam 12.00 - 19.00 WIB';
  if (shift === 'Malam') return 'Malam, jam 21.00 - 07.00 WIB';
  return 'Semua Shift (Pagi / Siang)';
}

function formatPct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function isCitoLogbookEntry(entry: LogbookEntry, patient?: Patient): boolean {
  const sec3 = entry.wizardDetails?.section3;
  if (sec3?.citoStatus === 'Ya') return true;
  if (/cito|emergen|icu|igd/i.test(entry.actionCategory || '')) return true;
  if (sec3?.citoStatus !== 'Tidak' && /cito/i.test(patient?.routineSchedule || '')) {
    return true;
  }
  return false;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  const d = new Date(utc);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function formatSignatureTimestamp(ts: unknown): string {
  if (!ts) return '';
  let dateObj: Date | null = null;
  if (ts instanceof Date) {
    dateObj = ts;
  } else if (typeof ts === 'string' || typeof ts === 'number') {
    dateObj = new Date(ts);
  } else if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    dateObj = (ts as { toDate: () => Date }).toDate();
  } else if (typeof ts === 'object' && ts !== null && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    dateObj = new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (!dateObj || Number.isNaN(dateObj.getTime())) return '';
  return dateObj.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' WIB';
}

function collectIncidents(entries: LogbookEntry[]) {
  return entries.flatMap((entry) => {
    const list = entry.wizardDetails?.section4?.complicationIncidents || [];
    if (list.length > 0) {
      return list.map((inc) => ({
        entry,
        type: inc.type || entry.complications || 'Komplikasi Lainnya',
        time: inc.time || entry.endTime || '-',
        bp: inc.bp || '-',
        detail: inc.clinicalDetail || '',
        advice: inc.doctorAdvice || '',
      }));
    }
    const comp = entry.complications?.trim() || '';
    if (comp && comp.toLowerCase() !== 'tidak ada' && comp !== '-') {
      const parts = comp
        .split(/\s*,\s*/)
        .map((p) => p.trim())
        .filter((p) => p && p.toLowerCase() !== 'tidak ada' && p !== '-');
      const items = parts.length > 0 ? parts : [comp];
      return items.map((itemType) => ({
        entry,
        type: itemType,
        time: entry.endTime || '-',
        bp: entry.postBp || entry.preBp || '-',
        detail: '',
        advice: entry.wizardDetails?.section4?.effectiveCommunicationNotes || '',
      }));
    }
    return [];
  });
}

function parseSbarLines(text?: string): {
  s?: string;
  b?: string;
  a?: string;
  r?: string;
} | null {
  if (!text || !text.trim()) return null;
  const lines = text.split('\n');
  let s = '';
  let b = '';
  let a = '';
  let r = '';
  let current: 's' | 'b' | 'a' | 'r' | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^S\s*[:\-]/i.test(trimmed)) {
      current = 's';
      s = trimmed.replace(/^S\s*[:\-]\s*/i, '');
    } else if (/^B\s*[:\-]/i.test(trimmed)) {
      current = 'b';
      b = trimmed.replace(/^B\s*[:\-]\s*/i, '');
    } else if (/^A\s*[:\-]/i.test(trimmed)) {
      current = 'a';
      a = trimmed.replace(/^A\s*[:\-]\s*/i, '');
    } else if (/^R\s*[:\-]/i.test(trimmed)) {
      current = 'r';
      r = trimmed.replace(/^R\s*[:\-]\s*/i, '');
    } else if (current && trimmed) {
      if (current === 's') s = s ? `${s} ${trimmed}` : trimmed;
      if (current === 'b') b = b ? `${b} ${trimmed}` : trimmed;
      if (current === 'a') a = a ? `${a} ${trimmed}` : trimmed;
      if (current === 'r') r = r ? `${r}\n${trimmed}` : trimmed;
    }
  }
  if (!s && !b && !a && !r) return null;
  return { s, b, a, r };
}

export function PjShiftReportsPage({
  reports,
  logbooks,
  patients,
  machines,
  schedules,
  doctorSchedules,
  staffDirectory,
  pjShiftAssignments = [],
  archiveLoading = false,
  onEnsureMonthLoaded,
}: PjShiftReportsPageProps) {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { handlePrint } = useF4OnePagePrint({
    orientation: 'portrait',
    sheetRef,
  });

  // Verified logbooks only (Approved by PJ Shift or Kepala Ruang)
  const allApprovedLogbooks = useMemo(
    () => logbooks.filter((item) => item.verificationStatus === 'Approved'),
    [logbooks]
  );

  const { todayDate: liveTodayDate, currentShift: liveCurrentShift } = useLiveClock();
  const [trackedTodayDate, setTrackedTodayDate] = useState(liveTodayDate);
  const [selectedDate, setSelectedDate] = useState(liveTodayDate);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | ShiftType>(
    liveCurrentShift === 'Siang' ? 'Siang' : 'Pagi'
  );
  const [verifierFilter, setVerifierFilter] = useState<'ALL' | 'PJ Shift' | 'Kepala Ruang'>('ALL');

  useEffect(() => {
    if (liveTodayDate !== trackedTodayDate) {
      setTrackedTodayDate(liveTodayDate);
      setSelectedDate((prev) => (prev === trackedTodayDate ? liveTodayDate : prev));
    }
  }, [liveTodayDate, trackedTodayDate]);

  useEffect(() => {
    if (!selectedDate) return;
    const primaryMonth = selectedDate.slice(0, 7);
    void onEnsureMonthLoaded?.(primaryMonth);
    if (shiftFilter === 'Malam') {
      const nextMonth = addDaysToDateStr(selectedDate, 1).slice(0, 7);
      if (nextMonth !== primaryMonth) {
        void onEnsureMonthLoaded?.(nextMonth);
      }
    }
  }, [selectedDate, shiftFilter, onEnsureMonthLoaded]);

  // Create/Save PJ Shift report modal
  const [showModal, setShowModal] = useState(false);
  const [modalNursesOnDuty, setModalNursesOnDuty] = useState('');
  const [modalIncidents, setModalIncidents] = useState('');
  const [modalHandoverNotes, setModalHandoverNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline Edit Section D
  const [editingSectionDIndex, setEditingSectionDIndex] = useState<number | null>(null);
  const [draftSectionDRow, setDraftSectionDRow] = useState<ReportSectionDItem | null>(null);
  const [savingSectionD, setSavingSectionD] = useState(false);

  // Inline Edit Section E (SBAR)
  const [editingSbarKey, setEditingSbarKey] = useState<
    'situation' | 'background' | 'assessment' | 'recommendation' | null
  >(null);
  const [draftSbarText, setDraftSbarText] = useState('');
  const [savingSbar, setSavingSbar] = useState(false);

  // Digital Signature Action State (Section F)
  const [signingSlot, setSigningSlot] = useState<'handover' | 'received' | null>(null);
  const [signFeedback, setSignFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Review modal (Kepala Ruang Digital Approval) resolved live from reports
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null);
  const [newReviewDraft, setNewReviewDraft] = useState<ReportEntry | null>(null);
  const reviewTarget = useMemo(() => {
    if (!reviewTargetId) return null;
    if (reviewTargetId === '__NEW__') return newReviewDraft;
    return reports.find((r) => r.id === reviewTargetId) || null;
  }, [reviewTargetId, newReviewDraft, reports]);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [resettingApprovals, setResettingApprovals] = useState(false);

  const canCreate =
    userProfile?.role === 'PJ Shift' ||
    userProfile?.role === 'Kepala Ruang' ||
    userProfile?.role === 'Administrator';
  const canReview = userProfile?.role === 'Kepala Ruang';

  const staffMap = useMemo(() => new Map(staffDirectory.map((s) => [s.uid, s])), [staffDirectory]);
  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const getActualVerifierRole = (entry: LogbookEntry): 'PJ Shift' | 'Kepala Ruang' | null => {
    if (entry.verifiedBy) {
      const staffRole = staffMap.get(entry.verifiedBy)?.role;
      if (staffRole === 'PJ Shift' || staffRole === 'Kepala Ruang') return staffRole;
    }
    if (entry.targetVerifierRole) return entry.targetVerifierRole;
    return null;
  };

  // Verified logbooks matching selected date, shift, and verifier filter
  const verifiedEntries = useMemo(() => {
    return allApprovedLogbooks
      .filter((item) => {
        if (item.date !== selectedDate) return false;
        if (shiftFilter !== 'ALL' && item.shift !== shiftFilter) return false;
        if (verifierFilter !== 'ALL') {
          const vRole = getActualVerifierRole(item);
          if (vRole !== verifierFilter) return false;
        }
        return true;
      })
      .sort((a, b) => a.machineNumber.localeCompare(b.machineNumber));
  }, [allApprovedLogbooks, selectedDate, shiftFilter, verifierFilter, staffMap]);

  // Unverified logbooks on selected date & shift that contain complications (for visibility notice)
  const unverifiedComplicationEntries = useMemo(() => {
    return logbooks.filter((item) => {
      if (item.verificationStatus === 'Approved') return false;
      if (item.date !== selectedDate) return false;
      if (shiftFilter !== 'ALL' && item.shift !== shiftFilter) return false;
      return collectIncidents([item]).length > 0;
    });
  }, [logbooks, selectedDate, shiftFilter]);

  // Saved PJ Shift report matching selected date & shift
  const pjShiftReports = useMemo(() => {
    return reports.filter((r) => r.reportType === 'pj_shift');
  }, [reports]);

  const hasHistoricalMalam = useMemo(
    () =>
      allApprovedLogbooks.some((l) => l.shift === 'Malam') ||
      pjShiftReports.some((r) => r.shift === 'Malam') ||
      shiftFilter === 'Malam',
    [allApprovedLogbooks, pjShiftReports, shiftFilter]
  );

  const activeSavedReport = useMemo(() => {
    return (
      pjShiftReports.find(
        (r) =>
          r.date === selectedDate && (shiftFilter === 'ALL' || r.shift === shiftFilter)
      ) || null
    );
  }, [pjShiftReports, selectedDate, shiftFilter]);

  const hasAnyApproval = Boolean(
    activeSavedReport &&
      (activeSavedReport.handoverSignedBy ||
        activeSavedReport.receivedSignedBy ||
        activeSavedReport.reviewedBy ||
        activeSavedReport.reviewStatus === 'Reviewed')
  );
  const canResetApprovals =
    userProfile?.role === 'Administrator' &&
    shiftFilter !== 'ALL' &&
    Boolean(activeSavedReport) &&
    hasAnyApproval;

  const nextShiftOrder: Record<ShiftType, ShiftType> = {
    Pagi: 'Siang',
    Siang: 'Malam',
    Malam: 'Pagi',
  };
  const nextShiftName: ShiftType = shiftFilter === 'ALL' ? 'Siang' : nextShiftOrder[shiftFilter];
  const handoverTargetDate =
    shiftFilter === 'Malam' ? addDaysToDateStr(selectedDate, 1) : selectedDate;

  const assignedPjCurrent = useMemo(() => {
    if (shiftFilter === 'ALL') return null;
    return (
      pjShiftAssignments.find((a) => a.date === selectedDate && a.shift === shiftFilter) || null
    );
  }, [pjShiftAssignments, selectedDate, shiftFilter]);

  const assignedPjListForDate = useMemo(() => {
    const order: Record<ShiftType, number> = { Pagi: 1, Siang: 2, Malam: 3 };
    return pjShiftAssignments
      .filter((a) => a.date === selectedDate)
      .sort((a, b) => order[a.shift] - order[b.shift]);
  }, [pjShiftAssignments, selectedDate]);

  const assignedPjNext = useMemo(() => {
    if (shiftFilter === 'ALL') return null;
    return (
      pjShiftAssignments.find((a) => a.date === handoverTargetDate && a.shift === nextShiftName) ||
      null
    );
  }, [pjShiftAssignments, handoverTargetDate, nextShiftName, shiftFilter]);

  const scheduledPjCurrentList = useMemo(() => {
    if (shiftFilter === 'ALL') return [];
    const seen = new Set<string>();
    const list: StaffDirectoryEntry[] = [];
    for (const s of schedules) {
      if (s.date !== selectedDate || s.shift !== shiftFilter) continue;
      const st = staffMap.get(s.nurseId);
      if (st && st.isActive && st.role === 'PJ Shift' && !seen.has(st.uid)) {
        seen.add(st.uid);
        list.push(st);
      }
    }
    return list;
  }, [schedules, selectedDate, shiftFilter, staffMap]);

  const scheduledPjNextList = useMemo(() => {
    if (shiftFilter === 'ALL' || shiftFilter === 'Siang') return [];
    const seen = new Set<string>();
    const list: StaffDirectoryEntry[] = [];
    for (const s of schedules) {
      if (s.date !== handoverTargetDate || s.shift !== nextShiftName) continue;
      const st = staffMap.get(s.nurseId);
      if (st && st.isActive && st.role === 'PJ Shift' && !seen.has(st.uid)) {
        seen.add(st.uid);
        list.push(st);
      }
    }
    return list;
  }, [schedules, handoverTargetDate, nextShiftName, shiftFilter, staffMap]);

  const activeKaruList = useMemo(
    () => staffDirectory.filter((st) => st.isActive && st.role === 'Kepala Ruang'),
    [staffDirectory]
  );

  // Core shift report analytics computed strictly from verified logbooks + unit master data
  const shiftStats = useMemo(() => {
    const totalVerified = verifiedEntries.length;
    const dayName = getDayNameId(selectedDate);

    // Scheduled regular patients for this date & shift
    const activeRegularPatients = patients.filter(
      (p) => p.status === 'Aktif' && isRegularPatient(p)
    );
    const scheduledPatientsCount = activeRegularPatients.filter((p) =>
      isPatientScheduledOnDay(p.routineSchedule, dayName, shiftFilter)
    ).length;

    // Classification & Service Status
    let regulerCount = 0;
    let hepBCount = 0;
    let hepCHivCount = 0;
    let rajalCount = 0;
    let ranapCount = 0;
    let citoCount = 0;

    // Vascular Access distribution
    let avfCount = 0;
    let avgCount = 0;
    let cdlNonTunnelCount = 0;
    let cdlTunnelCount = 0;

    // UF & Duration
    let ufMetCount = 0;
    const underUfDetails: string[] = [];
    const durationGroups = new Map<string, number>();
    let durationSum = 0;
    let durationValidCount = 0;

    // Disinfection & K3 / RO
    let heatDisinfectionCount = 0;
    let chemDisinfectionCount = 0;
    let wasteOkCount = 0;
    let roOkCount = 0;
    let emergencyOkCount = 0;
    let zonasiOkCount = 0;
    const roSamples: string[] = [];
    const emergencyNotesList: string[] = [];
    const dialysateTypes = new Set<string>();
    const dialyzerTypes = new Set<string>();
    const primingVolumes: number[] = [];

    // Staff & Doctors
    const pjVerifierNames = new Set<string>();
    const karuVerifierNames = new Set<string>();
    const nurseNames = new Set<string>();
    const dpjpNames = new Set<string>();
    const dutyDoctorNames = new Set<string>();

    for (const entry of verifiedEntries) {
      const pat = patientMap.get(entry.patientId);
      const sec1 = entry.wizardDetails?.section1;
      const sec2 = entry.wizardDetails?.section2;
      const sec3 = entry.wizardDetails?.section3;
      const sec6 = entry.wizardDetails?.section6;

      // Staff & Verifiers
      if (entry.nurseName) nurseNames.add(entry.nurseName);
      if (entry.doctorName) dpjpNames.add(entry.doctorName);
      if (entry.dutyDoctorName) dutyDoctorNames.add(entry.dutyDoctorName);

      const vRole = getActualVerifierRole(entry);
      if (vRole === 'PJ Shift' && entry.verifiedByName) {
        pjVerifierNames.add(entry.verifiedByName);
      } else if (vRole === 'Kepala Ruang' && entry.verifiedByName) {
        karuVerifierNames.add(entry.verifiedByName);
      }

      // Service Status
      const isRanap =
        sec3?.serviceStatus === 'Rawat Inap' ||
        (sec3?.serviceStatus !== 'Rawat Jalan' &&
          (/icu|bangsal|ranap|rawat inap/i.test(entry.patientName) ||
            /rawat inap|cito/i.test(entry.actionCategory) ||
            /rawat inap/i.test(pat?.notes || '')));
      if (isRanap) ranapCount += 1;
      else rajalCount += 1;

      if (isCitoLogbookEntry(entry, pat)) {
        citoCount += 1;
      }

      // Patient Category
      const cat =
        sec3?.patientCategory ||
        (/hep\s*b/i.test(entry.actionCategory)
          ? 'Isolasi Hepatitis B'
          : /hep\s*c|hiv/i.test(entry.actionCategory)
          ? 'Isolasi Hepatitis C/HIV'
          : 'Reguler');
      if (cat === 'Isolasi Hepatitis B') hepBCount += 1;
      else if (cat === 'Isolasi Hepatitis C/HIV') hepCHivCount += 1;
      else regulerCount += 1;

      // Vascular access
      if (entry.vascularAccess === 'AVG') {
        avgCount += 1;
      } else if (entry.vascularAccess === 'CDL' || entry.vascularAccess === 'CVC') {
        const cdlText = `${sec3?.cdlNote || ''} ${sec3?.accessDetailNote || ''} ${entry.nursingNotes || ''}`;
        if (/tunnel|permcath/i.test(cdlText)) {
          cdlTunnelCount += 1;
        } else {
          cdlNonTunnelCount += 1;
        }
      } else {
        avfCount += 1;
      }

      // UF Goal evaluation
      if (entry.ufGoal <= 0 || entry.ufAchieved >= entry.ufGoal) {
        ufMetCount += 1;
      } else {
        const diff = entry.ufGoal - entry.ufAchieved;
        underUfDetails.push(
          `${entry.machineNumber} (${entry.patientName}) under-UF ${diff.toLocaleString('id-ID')} mL`
        );
      }

      // Duration
      const dur = getEntryDurationHours(entry);
      if (dur !== null) {
        durationSum += dur;
        durationValidCount += 1;
        const key = dur.toFixed(1);
        durationGroups.set(key, (durationGroups.get(key) || 0) + 1);
      }

      // Operational & K3
      if (sec6) {
        if (sec6.machineDisinfectionType === 'Chemical Disinfection') {
          chemDisinfectionCount += 1;
        } else {
          heatDisinfectionCount += 1;
        }
        if (sec6.wasteDecontaminated !== false) wasteOkCount += 1;
      } else {
        heatDisinfectionCount += 1;
        wasteOkCount += 1;
      }

      if (sec1) {
        if (sec1.roAdequate && sec1.roStatus === 'Baik') roOkCount += 1;
        if (sec1.roTds || sec1.roConductivity) {
          roSamples.push(
            `TDS ${sec1.roTds || '-'} ppm / Cond ${sec1.roConductivity || '-'} µS/cm`
          );
        }
        if (sec1.emergencyStatus === 'Lengkap' && sec1.aedReady && sec1.oxygenReady && sec1.emergencyDrugsReady) {
          emergencyOkCount += 1;
        }
        if (sec1.emergencyNotes?.trim()) emergencyNotesList.push(sec1.emergencyNotes.trim());
        if (sec1.infectionZoneChecked && sec1.infectionZoneStatus === 'Sesuai') {
          zonasiOkCount += 1;
        }
      } else {
        roOkCount += 1;
        emergencyOkCount += 1;
        zonasiOkCount += 1;
      }

      if (sec2?.dialysateType) dialysateTypes.add(sec2.dialysateType);
      if (sec3?.dialyzerType) dialyzerTypes.add(sec3.dialyzerType);
      if (sec2?.primingVolume) {
        const pv = Number(sec2.primingVolume);
        if (!Number.isNaN(pv) && pv > 0) primingVolumes.push(pv);
      }
    }

    // Schedules for manpower & doctors on selectedDate & shiftFilter
    const activeNurseSchedules = schedules.filter(
      (s) =>
        s.date === selectedDate &&
        (shiftFilter === 'ALL' ? ['Pagi', 'Siang', 'Malam'].includes(s.shift) : s.shift === shiftFilter)
    );
    const scheduledNurseNames = Array.from(new Set(activeNurseSchedules.map((s) => s.nurseName)));
    const assignedPjRosterNames =
      shiftFilter === 'ALL'
        ? assignedPjListForDate.map((a) => a.pjNurseName)
        : assignedPjCurrent?.pjNurseName
        ? [assignedPjCurrent.pjNurseName]
        : [];
    const allNurseRoster = Array.from(
      new Set([...assignedPjRosterNames, ...scheduledNurseNames, ...nurseNames])
    );

    const pjInRoster = allNurseRoster.filter((name) => {
      const match = staffDirectory.find((st) => st.fullName === name);
      return match?.role === 'PJ Shift';
    });
    const pelaksanaCount = Math.max(0, allNurseRoster.length - pjInRoster.length);
    const totalNursesDinas = allNurseRoster.length;
    const ratioNum =
      totalNursesDinas > 0 && totalVerified > 0
        ? (totalVerified / totalNursesDinas).toFixed(1).replace(/\.0$/, '')
        : '0';

    // Doctors fallback from doctor_schedules
    const docScheds = doctorSchedules.filter(
      (d) => d.date === selectedDate && (shiftFilter === 'ALL' || d.shift === shiftFilter)
    );
    if (dpjpNames.size === 0) {
      docScheds.forEach((d) => d.dpjpDoctorName && dpjpNames.add(d.dpjpDoctorName));
    }
    if (dutyDoctorNames.size === 0) {
      docScheds.forEach((d) => d.dutyDoctorName && dutyDoctorNames.add(d.dutyDoctorName));
    }

    // PJ Shift & Ka Ruang names (prioritize Penugasan PJ Shift assignment)
    const assignedPjNameForBanner =
      shiftFilter === 'ALL'
        ? assignedPjListForDate.map((a) => `${a.shift}: ${a.pjNurseName}`).join(', ')
        : assignedPjCurrent?.pjNurseName || '';

    const pjShiftName =
      activeSavedReport?.handoverSignedByName ||
      assignedPjNameForBanner ||
      (scheduledPjCurrentList.length === 1 ? scheduledPjCurrentList[0].fullName : '') ||
      (activeSavedReport?.authorRole === 'PJ Shift' ? activeSavedReport.authorName : '') ||
      Array.from(pjVerifierNames)[0] ||
      'Belum ditetapkan PJ Shift';

    const nextPjShiftName =
      activeSavedReport?.receivedSignedByName ||
      assignedPjNext?.pjNurseName ||
      (scheduledPjNextList.length === 1 ? scheduledPjNextList[0].fullName : '') ||
      'Belum ditetapkan PJ Shift';

    const kaRuangName =
      activeSavedReport?.reviewedByName ||
      (userProfile?.role === 'Kepala Ruang' ? userProfile.fullName : '') ||
      Array.from(karuVerifierNames)[0] ||
      activeKaruList[0]?.fullName ||
      'Kepala Ruang HD';

    // Machines metrics
    const totalMachines = machines.length;
    const operationalMachines = machines.filter(
      (m) => m.status === 'Ready' || m.status === 'In Use'
    ).length;
    const maintenanceMachines = machines.filter((m) => m.status === 'Maintenance').length;
    const hepBMachines = machines.filter(
      (m) => /hep\s*b/i.test(m.roomZone || '') || /hep\s*b/i.test(m.notes || '')
    ).length;
    const hepCMachines = machines.filter(
      (m) => /hep\s*c/i.test(m.roomZone || '') || /hep\s*c/i.test(m.notes || '')
    ).length;

    // Incidents categorization (covers all 12 complication categories + catch-all)
    const allIncidents = collectIncidents(verifiedEntries);
    const reHipertensi = /hipertensi/i;
    const reHipotensi = /hipotensi/i;
    const reHipoglikemi = /hipoglikem/i;
    const reHipertermi = /hiperterm|demam|febris/i;
    const reKram = /kram/i;
    const reMual = /\bmual\b/i;
    const reMuntah = /muntah/i;
    const reClotting = /clotting|beku/i;
    const reBleeding = /perdarahan|bleeding|hematom/i;
    const reAllergy = /alergi|first[- ]?use|pirogenik/i;
    const reKesadaran = /kesadaran|pingsan|sinkop|syncope/i;

    const hipertensiIncidents = allIncidents.filter((i) => reHipertensi.test(i.type));
    const hipotensiIncidents = allIncidents.filter((i) => reHipotensi.test(i.type));
    const hipoglikemiIncidents = allIncidents.filter((i) => reHipoglikemi.test(i.type));
    const hipertermiIncidents = allIncidents.filter((i) => reHipertermi.test(i.type));
    const kramIncidents = allIncidents.filter((i) => reKram.test(i.type));
    const mualIncidents = allIncidents.filter((i) => reMual.test(i.type));
    const muntahIncidents = allIncidents.filter((i) => reMuntah.test(i.type));
    const clottingIncidents = allIncidents.filter((i) => reClotting.test(i.type));
    const bleedingIncidents = allIncidents.filter((i) => reBleeding.test(i.type));
    const allergyIncidents = allIncidents.filter((i) => reAllergy.test(i.type));
    const kesadaranIncidents = allIncidents.filter((i) => reKesadaran.test(i.type));
    const otherIncidents = allIncidents.filter(
      (i) =>
        !reHipertensi.test(i.type) &&
        !reHipotensi.test(i.type) &&
        !reHipoglikemi.test(i.type) &&
        !reHipertermi.test(i.type) &&
        !reKram.test(i.type) &&
        !reMual.test(i.type) &&
        !reMuntah.test(i.type) &&
        !reClotting.test(i.type) &&
        !reBleeding.test(i.type) &&
        !reAllergy.test(i.type) &&
        !reKesadaran.test(i.type)
    );
    const consultIncidents = allIncidents.filter((i) => Boolean(i.advice.trim()));

    const avgDuration =
      durationValidCount > 0 ? (durationSum / durationValidCount).toFixed(1) : '0.0';
    const durationBreakdown = Array.from(durationGroups.entries())
      .map(([durKey, cnt]) => `${cnt} pasien @${durKey} jam`)
      .join(', ');

    const avgPriming =
      primingVolumes.length > 0
        ? Math.round(primingVolumes.reduce((a, b) => a + b, 0) / primingVolumes.length)
        : 1000;

    // Auto SBAR generation from verified entries
    const shiftWord = shiftFilter === 'ALL' ? 'Shift' : `Shift ${shiftFilter}`;
    const autoSituation =
      totalVerified === 0
        ? `Belum ada logbook pasien berstatus Terverifikasi (Approved) pada ${formatFullDayDateId(selectedDate)} (${shiftWord}).`
        : `Pelayanan ${shiftWord} selesai melayani ${totalVerified} pasien terverifikasi (${rajalCount} rawat jalan, ${ranapCount} rawat inap). ${operationalMachines} mesin HD siap beroperasi optimal.${
            allIncidents.length > 0
              ? ` Tercatat ${allIncidents.length} kejadian klinis intra-HD (${allIncidents
                  .map((i) => `${i.entry.machineNumber} ${i.entry.patientName}: ${i.type}`)
                  .slice(0, 3)
                  .join('; ')}).`
              : ' Seluruh tindakan HD berlangsung stabil tanpa komplikasi bermakna.'
          }`;

    const autoBackground =
      totalVerified === 0
        ? '-'
        : allIncidents.length > 0
        ? allIncidents
            .map(
              (i) =>
                `${i.entry.patientName} (${i.entry.machineNumber}, No. RM ${i.entry.patientRm}) HD via ${i.entry.vascularAccess}, UF Target ${i.entry.ufGoal} mL — Pukul ${i.time} mengalami ${i.type}${
                  i.bp && i.bp !== '-'
                    ? ` (TD ${i.bp} mmHg)`
                    : i.detail
                    ? ` (${i.detail})`
                    : ''
                }.`
            )
            .join(' ')
        : `Seluruh ${totalVerified} pasien terverifikasi menjalani tindakan HD sesuai resep DPJP dengan akses vaskular (${avfCount} AVF, ${avgCount} AVG, ${
            cdlNonTunnelCount + cdlTunnelCount
          } CDL) dalam kondisi paten.`;

    const autoAssessment =
      totalVerified === 0
        ? '-'
        : `${ufMetCount}/${totalVerified} pasien (${formatPct(
            ufMetCount,
            totalVerified
          )}) mencapai target UF.${
            underUfDetails.length > 0 ? ` Catatan under-UF: ${underUfDetails.join('; ')}.` : ''
          }${
            consultIncidents.length > 0
              ? ` Tindak lanjut medis: ${consultIncidents
                  .map((c) => `${c.entry.patientName}: ${c.advice}`)
                  .join('; ')}.`
              : ' Kondisi pasca dialisis seluruh pasien stabil dan hemostasis tercapai.'
          }`;

    const autoRecommendation =
      totalVerified === 0
        ? '1. Pastikan seluruh logbook tindakan perawat pelaksana telah diverifikasi oleh PJ Shift / Kepala Ruang.'
        : shiftFilter === 'Siang'
        ? [
            `1. Akhir Pelayanan Harian (Tidak Ada Shift Malam): Pastikan desinfeksi tuntas seluruh mesin HD serta kesiapan unit untuk pelayanan Shift Pagi hari berikutnya.`,
            allIncidents.length > 0
              ? `2. Monitoring ketat hemodinamik & akses vaskular pada pasien dengan riwayat komplikasi shift ini pada jadwal HD berikutnya.`
              : `2. Pertahankan kepatuhan checklist SPO (Bagian I–VI) serta ketersediaan dialiser & cairan dialisat.`,
            `3. Lakukan pengecekan rutin parameter mutu air RO dan kelengkapan troli emergensi sebelum memulai pelayanan Shift Pagi berikutnya.`,
          ].join('\n')
        : [
            `1. Shift ${nextShiftName}: Lanjutkan persiapan priming dan desinfeksi mesin sesuai jadwal pasien shift berikutnya.`,
            allIncidents.length > 0
              ? `2. Monitoring ketat hemodinamik & akses vaskular pada pasien dengan riwayat komplikasi shift ini pada jadwal HD berikutnya.`
              : `2. Pertahankan kepatuhan checklist SPO (Bagian I–VI) serta ketersediaan dialiser & cairan dialisat.`,
            `3. Lakukan pengecekan rutin parameter mutu air RO dan kelengkapan troli emergensi sebelum memulai pelayanan shift berikutnya.`,
          ].join('\n');

    return {
      scheduledPatientsCount,
      totalVerified,
      citoCount,
      rescheduledCount: Math.max(0, scheduledPatientsCount - totalVerified),
      regulerCount,
      hepBCount,
      hepCHivCount,
      rajalCount,
      ranapCount,
      totalMachines,
      operationalMachines,
      maintenanceMachines,
      hepBMachines,
      hepCMachines,
      avfCount,
      avgCount,
      cdlNonTunnelCount,
      cdlTunnelCount,
      pjShiftName,
      nextPjShiftName,
      nextShiftName,
      kaRuangName,
      dpjpLabel: Array.from(dpjpNames).join(', ') || '-',
      dutyDoctorLabel: Array.from(dutyDoctorNames).join(', ') || '-',
      allNurseRoster,
      totalNursesDinas,
      pjCount: pjInRoster.length || (totalNursesDinas > 0 ? 1 : 0),
      pelaksanaCount: pjInRoster.length > 0 ? pelaksanaCount : Math.max(0, totalNursesDinas - 1),
      ratioNum,
      ufMetCount,
      underUfDetails,
      avgDuration,
      durationBreakdown,
      hipertensiIncidents,
      hipotensiIncidents,
      hipoglikemiIncidents,
      hipertermiIncidents,
      kramIncidents,
      mualIncidents,
      muntahIncidents,
      clottingIncidents,
      bleedingIncidents,
      allergyIncidents,
      kesadaranIncidents,
      otherIncidents,
      consultIncidents,
      allIncidents,
      avgPriming,
      roOkCount,
      roSamples,
      emergencyOkCount,
      emergencyNotesList,
      heatDisinfectionCount,
      chemDisinfectionCount,
      wasteOkCount,
      zonasiOkCount,
      dialysateTypes: Array.from(dialysateTypes),
      dialyzerTypes: Array.from(dialyzerTypes),
      autoSituation,
      autoBackground,
      autoAssessment,
      autoRecommendation,
    };
  }, [
    verifiedEntries,
    selectedDate,
    handoverTargetDate,
    nextShiftName,
    shiftFilter,
    patients,
    patientMap,
    machines,
    schedules,
    doctorSchedules,
    staffDirectory,
    staffMap,
    activeSavedReport,
    assignedPjCurrent,
    assignedPjListForDate,
    assignedPjNext,
    scheduledPjCurrentList,
    scheduledPjNextList,
    activeKaruList,
    userProfile,
  ]);

  const savedSbar = useMemo(
    () => parseSbarLines(activeSavedReport?.handoverNotes),
    [activeSavedReport]
  );

  const sbarView = {
    situation: activeSavedReport?.sbarSituation?.trim() || savedSbar?.s || shiftStats.autoSituation,
    background: activeSavedReport?.sbarBackground?.trim() || savedSbar?.b || shiftStats.autoBackground,
    assessment: activeSavedReport?.sbarAssessment?.trim() || savedSbar?.a || shiftStats.autoAssessment,
    recommendation:
      activeSavedReport?.sbarRecommendation?.trim() ||
      savedSbar?.r ||
      (activeSavedReport?.handoverNotes && !savedSbar
        ? `${shiftStats.autoRecommendation}\nCatatan Tambahan PJ Shift: ${activeSavedReport.handoverNotes}`
        : shiftStats.autoRecommendation),
  };

  // Helper to ensure a pj_shift report doc exists or update existing one
  const getBaseNewReportPayload = (shiftVal: ShiftType) => {
    if (!userProfile) return null;
    const nursesDefault =
      shiftStats.allNurseRoster.length > 0 ? shiftStats.allNurseRoster.join(', ') : userProfile.fullName;
    const incidentsDefault =
      shiftStats.allIncidents.length > 0
        ? shiftStats.allIncidents
            .map(
              (i) =>
                `${i.entry.machineNumber} (${i.entry.patientName}): ${i.type}${
                  i.advice ? ` -> ${i.advice}` : ''
                }`
            )
            .join('; ')
        : 'Tidak ada insiden klinis / teknis';
    const handoverDefault = `S: ${sbarView.situation}\nB: ${sbarView.background}\nA: ${sbarView.assessment}\nR: ${sbarView.recommendation.replace(/\n/g, ' ')}`;
    return {
      reportType: 'pj_shift' as const,
      date: selectedDate,
      monthKey: selectedDate.slice(0, 7),
      authorId: userProfile.uid,
      authorName: clampString(userProfile.fullName, 120),
      authorRole: userProfile.role,
      shift: shiftVal,
      totalPatients: shiftStats.totalVerified,
      activeMachines: shiftStats.operationalMachines,
      nursesOnDuty: clampString(nursesDefault, 500),
      incidents: clampString(incidentsDefault, 1000),
      handoverNotes: clampString(handoverDefault, 2500),
      reviewStatus: 'Submitted' as const,
    };
  };

  const canEditContent =
    shiftFilter !== 'ALL' &&
    canCreate &&
    (!activeSavedReport ||
      activeSavedReport.reviewStatus !== 'Reviewed' ||
      userProfile?.role === 'Administrator');

  // Permission evaluation for Section F Digital Signature columns
  const userScheduleCurrentDate = useMemo(() => {
    if (!userProfile) return null;
    return schedules.find((s) => s.nurseId === userProfile.uid && s.date === selectedDate) || null;
  }, [schedules, userProfile, selectedDate]);

  const userScheduleHandoverDate = useMemo(() => {
    if (!userProfile) return null;
    return (
      schedules.find((s) => s.nurseId === userProfile.uid && s.date === handoverTargetDate) || null
    );
  }, [schedules, userProfile, handoverTargetDate]);

  const kolom1Auth = useMemo(() => {
    if (shiftFilter === 'ALL') {
      return {
        allowed: false,
        reason: 'Pilih Shift Pagi atau Siang untuk pengesahan digital.',
      };
    }
    if (activeSavedReport?.handoverSignedBy) {
      return {
        allowed: false,
        reason: `Sudah disahkan secara digital oleh ${activeSavedReport.handoverSignedByName || 'PJ Shift'}.`,
      };
    }
    if (!userProfile || userProfile.role !== 'PJ Shift') {
      return {
        allowed: false,
        reason:
          'Dilarang: Pengesahan digital ini hanya dapat dilakukan oleh pemilik akun PJ Shift bertugas.',
      };
    }
    if (assignedPjCurrent) {
      if (assignedPjCurrent.pjNurseId !== userProfile.uid) {
        return {
          allowed: false,
          reason: `Dilarang: Hanya pemilik akun ${assignedPjCurrent.pjNurseName} yang dapat mengesahkan slot ini. Perawat lain dilarang mengesahkan.`,
        };
      }
      return { allowed: true, reason: '' };
    }
    if (scheduledPjCurrentList.length > 1) {
      return {
        allowed: false,
        reason:
          'Terdapat lebih dari 1 PJ Shift terjadwal pada shift ini. Tetapkan tepat 1 pemilik akun di Penugasan PJ Shift terlebih dahulu.',
      };
    }
    if (!userScheduleCurrentDate || userScheduleCurrentDate.shift !== shiftFilter) {
      const targetName = scheduledPjCurrentList[0]?.fullName;
      return {
        allowed: false,
        reason: targetName
          ? `Dilarang: Hanya pemilik akun ${targetName} yang terjadwal Shift ${shiftFilter} tgl ${formatDateId(selectedDate)}. Perawat lain dilarang mengesahkan.`
          : `Dilarang: Akun Anda tidak terjadwal sebagai PJ Shift ${shiftFilter} pada ${formatDateId(selectedDate)}.`,
      };
    }
    if (
      activeSavedReport &&
      activeSavedReport.authorRole === 'PJ Shift' &&
      activeSavedReport.authorId !== userProfile.uid
    ) {
      return {
        allowed: false,
        reason: `Dilarang: Laporan shift ini dibuat oleh akun ${activeSavedReport.authorName}. Perawat lain dilarang memberikan pengesahan digital.`,
      };
    }
    return { allowed: true, reason: '' };
  }, [
    shiftFilter,
    activeSavedReport,
    userProfile,
    assignedPjCurrent,
    scheduledPjCurrentList,
    userScheduleCurrentDate,
    selectedDate,
  ]);

  const kolom2Auth = useMemo(() => {
    if (shiftFilter === 'ALL') {
      return {
        allowed: false,
        reason: 'Pilih Shift Pagi atau Siang untuk pengesahan digital.',
      };
    }
    if (shiftFilter === 'Siang') {
      return {
        allowed: false,
        reason: 'Tidak ada Shift Malam berikutnya.',
      };
    }
    if (activeSavedReport?.receivedSignedBy) {
      return {
        allowed: false,
        reason: `Sudah disahkan secara digital oleh ${activeSavedReport.receivedSignedByName || 'PJ Shift Berikutnya'}.`,
      };
    }
    if (!userProfile || userProfile.role !== 'PJ Shift') {
      return {
        allowed: false,
        reason: `Dilarang: Pengesahan digital penerima hanya dapat dilakukan oleh pemilik akun PJ Shift ${nextShiftName}.`,
      };
    }
    if (assignedPjNext) {
      if (assignedPjNext.pjNurseId !== userProfile.uid) {
        return {
          allowed: false,
          reason: `Dilarang: Hanya pemilik akun ${assignedPjNext.pjNurseName} yang dapat mengesahkan penerima shift. Perawat lain dilarang mengesahkan.`,
        };
      }
      return { allowed: true, reason: '' };
    }
    if (scheduledPjNextList.length > 1) {
      return {
        allowed: false,
        reason:
          'Terdapat lebih dari 1 PJ Shift terjadwal pada shift berikutnya. Tetapkan tepat 1 pemilik akun di Penugasan PJ Shift terlebih dahulu.',
      };
    }
    if (!userScheduleHandoverDate || userScheduleHandoverDate.shift !== nextShiftName) {
      const targetName = scheduledPjNextList[0]?.fullName;
      return {
        allowed: false,
        reason: targetName
          ? `Dilarang: Hanya pemilik akun ${targetName} yang terjadwal PJ Shift ${nextShiftName} tgl ${formatDateId(handoverTargetDate)}. Perawat lain dilarang mengesahkan.`
          : `Dilarang: Akun Anda tidak terjadwal sebagai PJ Shift ${nextShiftName} pada ${formatDateId(handoverTargetDate)}.`,
      };
    }
    return { allowed: true, reason: '' };
  }, [
    shiftFilter,
    activeSavedReport,
    userProfile,
    assignedPjNext,
    scheduledPjNextList,
    userScheduleHandoverDate,
    handoverTargetDate,
    nextShiftName,
  ]);

  const kolom3Auth = useMemo(() => {
    if (shiftFilter === 'ALL') {
      return {
        allowed: false,
        reason: 'Pilih Shift Pagi atau Siang untuk pengesahan digital.',
      };
    }
    if (activeSavedReport?.reviewStatus === 'Reviewed' || activeSavedReport?.reviewedBy) {
      return {
        allowed: false,
        reason: `Sudah disahkan secara digital oleh ${activeSavedReport.reviewedByName || 'Kepala Ruang'}.`,
      };
    }
    if (!userProfile || userProfile.role !== 'Kepala Ruang') {
      return {
        allowed: false,
        reason:
          'Dilarang: Pengesahan digital ini hanya dapat dilakukan oleh pemilik akun Kepala Ruang. Perawat lain dilarang mengesahkan.',
      };
    }
    if (activeKaruList.length === 1 && activeKaruList[0].uid !== userProfile.uid) {
      return {
        allowed: false,
        reason: `Dilarang: Hanya pemilik akun ${activeKaruList[0].fullName} (Kepala Ruang) yang dapat memberikan pengesahan digital.`,
      };
    }
    return { allowed: true, reason: '' };
  }, [shiftFilter, activeSavedReport, userProfile, activeKaruList]);

  const handleOpenCreateModal = () => {
    setModalNursesOnDuty(
      activeSavedReport?.nursesOnDuty ||
        (shiftStats.allNurseRoster.length > 0
          ? shiftStats.allNurseRoster.join(', ')
          : userProfile?.fullName || '')
    );
    setModalIncidents(
      activeSavedReport?.incidents ||
        (shiftStats.allIncidents.length > 0
          ? shiftStats.allIncidents
              .map(
                (i) =>
                  `${i.entry.machineNumber} (${i.entry.patientName}): ${i.type}${
                    i.advice ? ` -> ${i.advice}` : ''
                  }`
              )
              .join('; ')
          : 'Tidak ada insiden klinis / teknis')
    );
    setModalHandoverNotes(
      activeSavedReport?.handoverNotes ||
        `S: ${sbarView.situation}\nB: ${sbarView.background}\nA: ${sbarView.assessment}\nR: ${sbarView.recommendation.replace(/\n/g, ' ')}`
    );
    setShowModal(true);
  };

  const handleCreateOrUpdateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setSaving(true);
    const effectiveShift: ShiftType = shiftFilter === 'ALL' ? 'Pagi' : shiftFilter;
    const parsedModalSbar = parseSbarLines(modalHandoverNotes);
    const sbarFields = {
      ...(parsedModalSbar?.s ? { sbarSituation: clampString(parsedModalSbar.s, 2000) } : {}),
      ...(parsedModalSbar?.b ? { sbarBackground: clampString(parsedModalSbar.b, 3000) } : {}),
      ...(parsedModalSbar?.a ? { sbarAssessment: clampString(parsedModalSbar.a, 2000) } : {}),
      ...(parsedModalSbar?.r ? { sbarRecommendation: clampString(parsedModalSbar.r, 2000) } : {}),
    };
    try {
      if (activeSavedReport && activeSavedReport.reviewStatus !== 'Reviewed') {
        await updateRowByColumn(
          'reports',
          'id',
          activeSavedReport.id,
          toReportRow({
            shift: effectiveShift,
            totalPatients: shiftStats.totalVerified,
            activeMachines: shiftStats.operationalMachines,
            nursesOnDuty: clampString(modalNursesOnDuty || userProfile.fullName, 500),
            incidents: clampString(modalIncidents || 'Tidak ada', 1000),
            handoverNotes: clampString(modalHandoverNotes || '-', 2500),
            ...sbarFields,
          })
        );
      } else {
        await insertRow(
          'reports',
          toReportRow({
            id: generateRecordId(),
            reportType: 'pj_shift',
            date: selectedDate,
            monthKey: selectedDate.slice(0, 7),
            authorId: userProfile.uid,
            authorName: clampString(userProfile.fullName, 120),
            authorRole: userProfile.role,
            shift: effectiveShift,
            totalPatients: shiftStats.totalVerified,
            activeMachines: shiftStats.operationalMachines,
            nursesOnDuty: clampString(modalNursesOnDuty || userProfile.fullName, 500),
            incidents: clampString(modalIncidents || 'Tidak ada', 1000),
            handoverNotes: clampString(modalHandoverNotes || '-', 2500),
            ...sbarFields,
            reviewStatus: 'Submitted',
          })
        );
      }
      setShowModal(false);
      showToast(
        activeSavedReport && activeSavedReport.reviewStatus !== 'Reviewed'
          ? `Laporan PJ Shift ${effectiveShift} diperbarui.`
          : `Laporan PJ Shift ${effectiveShift} berhasil disimpan.`,
        'success'
      );
    } catch (err) {
      showToast('Gagal menyimpan laporan PJ Shift.', 'error');
      handleDbError(err, OperationType.CREATE, 'reports');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !reviewTarget || !kolom3Auth.allowed) return;
    setReviewing(true);
    try {
      const noteText = clampString(
        reviewNote || 'Laporan shift telah direview dan disahkan secara digital.',
        500
      );
      const nowIso = new Date().toISOString();
      if (reviewTarget.id === '__NEW__') {
        const effectiveShift: ShiftType = shiftFilter === 'ALL' ? 'Pagi' : shiftFilter;
        const base = getBaseNewReportPayload(effectiveShift);
        if (base) {
          await insertRow(
            'reports',
            toReportRow({
              id: generateRecordId(),
              ...base,
              reviewStatus: 'Reviewed',
              reviewedBy: userProfile.uid,
              reviewedByName: clampString(userProfile.fullName, 120),
              reviewNote: noteText,
              reviewedAt: nowIso,
            })
          );
        }
      } else {
        await updateRowByColumn(
          'reports',
          'id',
          reviewTarget.id,
          toReportRow({
            reviewStatus: 'Reviewed',
            reviewedBy: userProfile.uid,
            reviewedByName: clampString(userProfile.fullName, 120),
            reviewNote: noteText,
            reviewedAt: nowIso,
          })
        );
      }
      setSignFeedback({
        type: 'success',
        message: `Pengesahan Digital Kepala Ruang oleh ${userProfile.fullName} berhasil disimpan.`,
      });
      showToast(
        `Pengesahan Digital Kepala Ruang oleh ${userProfile.fullName} disimpan.`,
        'success'
      );
      setReviewTargetId(null);
      setNewReviewDraft(null);
      setReviewNote('');
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message: 'Gagal menyimpan pengesahan digital Kepala Ruang. Pastikan hak akses akun sesuai.',
      });
      showToast('Gagal menyimpan pengesahan digital Kepala Ruang.', 'error');
      handleDbError(err, OperationType.UPDATE, `reports/${reviewTarget.id}`);
    } finally {
      setReviewing(false);
    }
  };

  const handleSignHandover = async () => {
    if (!userProfile || !kolom1Auth.allowed || shiftFilter === 'ALL') return;
    setSigningSlot('handover');
    setSignFeedback(null);
    const nowIso = new Date().toISOString();
    try {
      if (activeSavedReport) {
        await updateRowByColumn(
          'reports',
          'id',
          activeSavedReport.id,
          toReportRow({
            handoverSignedBy: userProfile.uid,
            handoverSignedByName: clampString(userProfile.fullName, 120),
            handoverSignedShift: shiftFilter,
            handoverSignedAt: nowIso,
          })
        );
      } else {
        const base = getBaseNewReportPayload(shiftFilter);
        if (base) {
          await insertRow(
            'reports',
            toReportRow({
              id: generateRecordId(),
              ...base,
              handoverSignedBy: userProfile.uid,
              handoverSignedByName: clampString(userProfile.fullName, 120),
              handoverSignedShift: shiftFilter,
              handoverSignedAt: nowIso,
            })
          );
        }
      }
      setSignFeedback({
        type: 'success',
        message: `Pengesahan Digital PJ Shift ${shiftFilter} oleh ${userProfile.fullName} berhasil tercatat.`,
      });
      showToast(`Pengesahan PJ Shift ${shiftFilter} berhasil dicatat.`, 'success');
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message:
          'Pengesahan ditolak oleh sistem keamanan. Pastikan akun Anda terjadwal pada shift ini di Jadwal Dinas.',
      });
      showToast('Pengesahan PJ Shift gagal dicatat.', 'error');
      handleDbError(err, OperationType.UPDATE, 'reports');
    } finally {
      setSigningSlot(null);
    }
  };

  const handleSignReceived = async () => {
    if (!userProfile || !kolom2Auth.allowed || shiftFilter === 'ALL') return;
    setSigningSlot('received');
    setSignFeedback(null);
    const nowIso = new Date().toISOString();
    try {
      if (activeSavedReport) {
        await updateRowByColumn(
          'reports',
          'id',
          activeSavedReport.id,
          toReportRow({
            receivedSignedBy: userProfile.uid,
            receivedSignedByName: clampString(userProfile.fullName, 120),
            receivedSignedShift: nextShiftName,
            receivedSignedDate: handoverTargetDate,
            receivedSignedAt: nowIso,
          })
        );
      } else {
        const base = getBaseNewReportPayload(shiftFilter);
        if (base) {
          await insertRow(
            'reports',
            toReportRow({
              id: generateRecordId(),
              ...base,
              receivedSignedBy: userProfile.uid,
              receivedSignedByName: clampString(userProfile.fullName, 120),
              receivedSignedShift: nextShiftName,
              receivedSignedDate: handoverTargetDate,
              receivedSignedAt: nowIso,
            })
          );
        }
      }
      setSignFeedback({
        type: 'success',
        message: `Pengesahan Digital Penerima (PJ Shift ${nextShiftName}) oleh ${userProfile.fullName} berhasil tercatat.`,
      });
      showToast(`Pengesahan penerima PJ Shift ${nextShiftName} dicatat.`, 'success');
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message:
          'Pengesahan penerima ditolak. Pastikan akun Anda terjadwal sebagai PJ Shift berikutnya di Jadwal Dinas.',
      });
      showToast('Pengesahan penerima PJ Shift gagal dicatat.', 'error');
      handleDbError(err, OperationType.UPDATE, 'reports');
    } finally {
      setSigningSlot(null);
    }
  };

  const handleOpenKaruSign = () => {
    if (!kolom3Auth.allowed || shiftFilter === 'ALL') return;
    if (activeSavedReport) {
      setNewReviewDraft(null);
      setReviewTargetId(activeSavedReport.id);
    } else {
      setNewReviewDraft({
        id: '__NEW__',
        reportType: 'pj_shift',
        date: selectedDate,
        monthKey: selectedDate.slice(0, 7),
        authorId: userProfile?.uid || '',
        authorName: shiftStats.pjShiftName,
        authorRole: 'PJ Shift',
        shift: shiftFilter,
      });
      setReviewTargetId('__NEW__');
    }
    setReviewNote(activeSavedReport?.reviewNote || '');
  };

  const handleResetApprovals = async () => {
    if (!canResetApprovals || !activeSavedReport) return;
    setResettingApprovals(true);
    setSignFeedback(null);
    try {
      await updateRowByColumn(
        'reports',
        'id',
        activeSavedReport.id,
        toReportRow({
          handoverSignedBy: undefined,
          handoverSignedByName: undefined,
          handoverSignedShift: undefined,
          handoverSignedAt: undefined,
          receivedSignedBy: undefined,
          receivedSignedByName: undefined,
          receivedSignedShift: undefined,
          receivedSignedDate: undefined,
          receivedSignedAt: undefined,
          reviewedBy: undefined,
          reviewedByName: undefined,
          reviewNote: undefined,
          reviewedAt: undefined,
          reviewStatus: 'Submitted',
        })
      );
      setShowResetConfirmModal(false);
      setSignFeedback({
        type: 'success',
        message: `Pengesahan digital Laporan PJ Shift ${shiftFilter} (${formatDateId(selectedDate)}) berhasil direset. Pemilik akun berwenang dapat mengesahkan ulang.`,
      });
      showToast(
        `Pengesahan digital Shift ${shiftFilter} (${formatDateId(selectedDate)}) berhasil direset.`,
        'success'
      );
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message: 'Gagal mereset pengesahan digital laporan PJ Shift.',
      });
      showToast('Gagal mereset pengesahan digital laporan PJ Shift.', 'error');
      handleDbError(err, OperationType.UPDATE, `reports/${activeSavedReport.id}`);
    } finally {
      setResettingApprovals(false);
    }
  };

  const formatIncidentLines = (
    items: ReturnType<typeof collectIncidents>,
    emptyText: string
  ): string[] => {
    if (items.length === 0) return [emptyText];
    const byPatient = new Map<string, { header: string; details: string[] }>();
    for (const i of items) {
      const meta: string[] = [];
      if (i.time && i.time !== '-') meta.push(`Pkl ${i.time}`);
      if (i.bp && i.bp !== '-') meta.push(`TD ${i.bp}`);
      if (i.detail) meta.push(i.detail);
      const detailStr = `[${i.type}]${
        meta.length > 0 ? ` (${meta.join(', ')})` : ''
      }${i.advice ? `: ${i.advice}` : ''}`;

      const existing = byPatient.get(i.entry.id);
      if (existing) {
        existing.details.push(detailStr);
      } else {
        byPatient.set(i.entry.id, {
          header: `${i.entry.machineNumber} (${i.entry.patientName})`,
          details: [detailStr],
        });
      }
    }
    return Array.from(byPatient.values()).map(
      (p) => `${p.header} ${p.details.join(' | ')}`
    );
  };

  // Computed Section D rows from verified logbooks (or saved overrides)
  const autoSectionDRows = useMemo<ReportSectionDItem[]>(() => {
    const total = shiftStats.totalVerified;
    const roAllOk = total > 0 && shiftStats.roOkCount === total;
    const roObs =
      total === 0
        ? 'Menunggu verifikasi logbook shift'
        : shiftStats.roSamples.length > 0
        ? `Air RO Tersedia (${shiftStats.roSamples[0]})`
        : 'Air RO Tersedia & Sesuai Baku Mutu';

    const logistikObs =
      total === 0
        ? 'Menunggu data shift'
        : `Dialiser (${shiftStats.dialyzerTypes.join(', ') || 'High-Flux'}) & Dialisat ${
            shiftStats.dialysateTypes.join('/') || 'Bikarbonat'
          } tersedia`;

    const emergencyAllOk = total > 0 && shiftStats.emergencyOkCount === total;
    const emergencyObs =
      total === 0
        ? 'Menunggu verifikasi logbook shift'
        : shiftStats.emergencyNotesList[0] ||
          `${shiftStats.emergencyOkCount}/${total} pengecekan troli emergensi & DC shock lengkap`;

    const disinfectedCount = shiftStats.heatDisinfectionCount + shiftStats.chemDisinfectionCount;
    const disinfectedPct = total > 0 ? Math.round((disinfectedCount / total) * 100) : 0;

    const ikpCount = shiftStats.allIncidents.length;
    const wasteAllOk = total > 0 && shiftStats.wasteOkCount === total;
    const zonasiAllOk = total > 0 && shiftStats.zonasiOkCount === total;

    return [
      {
        item: 'Sistem Water Treatment (RO)',
        parameter: 'Air Baku, Air Distribusi, Pompa air dan Filter',
        result: roObs,
        status: total === 0 ? 'BELUM ADA DATA' : roAllOk ? 'MEMENUHI SYARAT' : 'PERLU PERHATIAN',
      },
      {
        item: 'Kesiapan Logistik & BMHP',
        parameter: 'Cairan Acid & Bikarbonat, Dialiser, Tubing',
        result: logistikObs,
        status: total === 0 ? 'BELUM ADA DATA' : 'TERSEDIA LENGKAP',
      },
      {
        item: 'Emergency Trolley & DC Shock',
        parameter: 'Pemeriksaan fungsi alat & integritas segel',
        result: emergencyObs,
        status: total === 0 ? 'BELUM ADA DATA' : emergencyAllOk ? 'SIAP PAKAI' : 'PERLU PERHATIAN',
      },
      {
        item: 'Desinfeksi Mesin Pasca Shift',
        parameter: `Chemical / Heat Disinfection ${total} Mesin`,
        result:
          total === 0
            ? 'Belum ada mesin terverifikasi'
            : `${disinfectedPct}% Mesin telah didesinfeksi tuntas (${shiftStats.heatDisinfectionCount} Heat, ${shiftStats.chemDisinfectionCount} Chemical)`,
        status: total === 0 ? 'BELUM ADA DATA' : `SELESAI ${disinfectedPct}%`,
      },
      {
        item: 'Insiden Keselamatan Pasien (IKP)',
        parameter: 'KTD / KNC / KTC / Sentinel Event',
        result:
          ikpCount === 0
            ? 'Nihil Kejadian Insiden Shift Ini'
            : `${ikpCount} Insiden tercatat & ditindaklanjuti`,
        status: ikpCount === 0 ? 'NIHIL INCIDENT' : `${ikpCount} INSIDEN`,
      },
      {
        item: 'Pengelolaan Limbah Medis B3',
        parameter: 'Safety box needle & kantong plastik kuning',
        result:
          total === 0
            ? 'Menunggu verifikasi logbook shift'
            : `${shiftStats.wasteOkCount}/${total} tindakan dekontaminasi limbah B3 patuh`,
        status: total === 0 ? 'BELUM ADA DATA' : wasteAllOk ? 'TERKONTROL' : 'PERLU PERHATIAN',
      },
      {
        item: 'Kebersihan & Suhu Ruangan',
        parameter: 'Suhu 20–24°C, Kelembaban 40–60%, Lantai Steril & Zonasi',
        result:
          total === 0
            ? 'Menunggu verifikasi logbook shift'
            : `${shiftStats.zonasiOkCount}/${total} pengecekan zonasi & kebersihan ruangan sesuai`,
        status: total === 0 ? 'BELUM ADA DATA' : zonasiAllOk ? 'SESUAI STANDAR' : 'PERLU PERHATIAN',
      },
    ];
  }, [shiftStats]);

  const sectionDRows = useMemo<ReportSectionDItem[]>(() => {
    const saved = activeSavedReport?.sectionDItems;
    if (!saved || saved.length === 0) return autoSectionDRows;
    return autoSectionDRows.map((autoRow, idx) => {
      const matched = saved.find((s) => s.item === autoRow.item) || saved[idx];
      if (!matched) return autoRow;
      return {
        item: autoRow.item,
        parameter: matched.parameter || autoRow.parameter,
        result: matched.result || autoRow.result,
        status: matched.status || autoRow.status,
      };
    });
  }, [activeSavedReport, autoSectionDRows]);

  const handleSaveSectionDRow = async (idx: number) => {
    if (!userProfile || !draftSectionDRow || shiftFilter === 'ALL') return;
    setSavingSectionD(true);
    setSignFeedback(null);
    const nextItems = sectionDRows.map((r, i) =>
      i === idx
        ? {
            item: r.item,
            parameter: clampString(draftSectionDRow.parameter.trim() || r.parameter, 250),
            result: clampString(draftSectionDRow.result.trim() || r.result, 500),
            status: clampString(draftSectionDRow.status.trim() || r.status, 100),
          }
        : r
    );
    try {
      if (activeSavedReport) {
        await updateRowByColumn(
          'reports',
          'id',
          activeSavedReport.id,
          toReportRow({
            sectionDItems: nextItems,
          })
        );
      } else {
        const base = getBaseNewReportPayload(shiftFilter);
        if (base) {
          await insertRow(
            'reports',
            toReportRow({
              id: generateRecordId(),
              ...base,
              sectionDItems: nextItems,
            })
          );
        }
      }
      setEditingSectionDIndex(null);
      setDraftSectionDRow(null);
      setSignFeedback({
        type: 'success',
        message: `Perubahan baris "${sectionDRows[idx].item}" pada Bagian D berhasil disimpan.`,
      });
      showToast(`Baris "${sectionDRows[idx].item}" Bagian D disimpan.`, 'success');
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message: 'Gagal menyimpan perubahan Bagian D.',
      });
      showToast('Gagal menyimpan perubahan Bagian D.', 'error');
      handleDbError(err, OperationType.UPDATE, 'reports');
    } finally {
      setSavingSectionD(false);
    }
  };

  const handleResetSectionD = async () => {
    if (!activeSavedReport || !canEditContent) return;
    setSavingSectionD(true);
    try {
      await updateRowByColumn(
        'reports',
        'id',
        activeSavedReport.id,
        toReportRow({
          sectionDItems: [],
        })
      );
      setEditingSectionDIndex(null);
      setDraftSectionDRow(null);
      setSignFeedback({
        type: 'success',
        message: 'Bagian D berhasil dikembalikan ke sinkronisasi otomatis logbook.',
      });
      showToast('Bagian D dikembalikan ke sinkronisasi otomatis logbook.', 'info');
    } catch (err) {
      showToast('Gagal mereset Bagian D.', 'error');
      handleDbError(err, OperationType.UPDATE, `reports/${activeSavedReport.id}`);
    } finally {
      setSavingSectionD(false);
    }
  };

  const handleSaveSbarRow = async (
    key: 'situation' | 'background' | 'assessment' | 'recommendation'
  ) => {
    if (!userProfile || shiftFilter === 'ALL') return;
    setSavingSbar(true);
    setSignFeedback(null);
    const updatedSbar = {
      ...sbarView,
      [key]: draftSbarText.trim() || '-',
    };
    const combinedHandoverNotes = clampString(
      `S: ${updatedSbar.situation}\nB: ${updatedSbar.background}\nA: ${updatedSbar.assessment}\nR: ${updatedSbar.recommendation.replace(/\n/g, ' ')}`,
      2500
    );
    const sbarUpdatePayload = {
      sbarSituation: clampString(updatedSbar.situation, 2000),
      sbarBackground: clampString(updatedSbar.background, 3000),
      sbarAssessment: clampString(updatedSbar.assessment, 2000),
      sbarRecommendation: clampString(updatedSbar.recommendation, 2000),
      handoverNotes: combinedHandoverNotes,
    };
    try {
      if (activeSavedReport) {
        await updateRowByColumn(
          'reports',
          'id',
          activeSavedReport.id,
          toReportRow(sbarUpdatePayload)
        );
      } else {
        const base = getBaseNewReportPayload(shiftFilter);
        if (base) {
          await insertRow(
            'reports',
            toReportRow({
              id: generateRecordId(),
              ...base,
              ...sbarUpdatePayload,
            })
          );
        }
      }
      setEditingSbarKey(null);
      setDraftSbarText('');
      setSignFeedback({
        type: 'success',
        message: `Bagian E (${key.toUpperCase()}) berhasil diperbarui.`,
      });
      showToast(`SBAR Bagian E (${key.toUpperCase()}) diperbarui.`, 'success');
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message: 'Gagal menyimpan perubahan SBAR.',
      });
      showToast('Gagal menyimpan perubahan SBAR.', 'error');
      handleDbError(err, OperationType.UPDATE, 'reports');
    } finally {
      setSavingSbar(false);
    }
  };

  // All Section C rows (all 12 complication categories + UF + Duration + Consult)
  const sectionCRows = useMemo(() => {
    const countUniquePatients = (items: ReturnType<typeof collectIncidents>): number =>
      new Set(items.map((i) => i.entry.patientId || i.entry.id)).size;

    const formatPatientIncidentResult = (items: ReturnType<typeof collectIncidents>): string => {
      const patientCount = countUniquePatients(items);
      return patientCount > 0
        ? `${patientCount} Pasien (${formatPct(patientCount, shiftStats.totalVerified)})`
        : '0 Pasien (Nihil)';
    };

    const buildRow = (
      indicator: string,
      result: string,
      target: string,
      analysisLines: string[],
      hasCases: boolean
    ) => ({
      indicator,
      result,
      target,
      analysisLines,
      analysis: analysisLines.join('\n'),
      hasCases,
    });

    return [
      buildRow(
        'Pencapaian Target UF (Dry Weight)',
        shiftStats.totalVerified > 0
          ? `${shiftStats.ufMetCount} Pasien (${formatPct(
              shiftStats.ufMetCount,
              shiftStats.totalVerified
            )})`
          : '0 Pasien (0%)',
        '>= 85%',
        shiftStats.totalVerified === 0
          ? ['Belum ada logbook terverifikasi']
          : shiftStats.underUfDetails.length > 0
          ? shiftStats.underUfDetails
          : ['Seluruh pasien mencapai target UF sesuai resep DPJP'],
        false
      ),
      buildRow(
        'Rata-rata Durasi Hemodialisis',
        `${shiftStats.avgDuration} Jam`,
        '4.0 - 5.0 Jam',
        [
          shiftStats.durationBreakdown
            ? `Rata-rata tercapai sesuai resep DPJP (${shiftStats.durationBreakdown})`
            : 'Belum ada data durasi tindakan terverifikasi',
        ],
        false
      ),
      buildRow(
        'Insiden Hipertensi Intradialitik',
        formatPatientIncidentResult(shiftStats.hipertensiIncidents),
        'Terkendali',
        formatIncidentLines(
          shiftStats.hipertensiIncidents,
          'Tidak ada kejadian hipertensi intradialitik pada shift ini'
        ),
        shiftStats.hipertensiIncidents.length > 0
      ),
      buildRow(
        'Insiden Hipotensi Intradialitik',
        formatPatientIncidentResult(shiftStats.hipotensiIncidents),
        '< 15%',
        formatIncidentLines(
          shiftStats.hipotensiIncidents,
          'Tidak ada kejadian hipotensi intradialitik pada shift ini'
        ),
        shiftStats.hipotensiIncidents.length > 0
      ),
      buildRow(
        'Insiden Hipoglikemi Intra-HD',
        formatPatientIncidentResult(shiftStats.hipoglikemiIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.hipoglikemiIncidents,
          'Tidak ada kejadian hipoglikemi intra-HD pada shift ini'
        ),
        shiftStats.hipoglikemiIncidents.length > 0
      ),
      buildRow(
        'Insiden Hipertermi Intra-HD',
        formatPatientIncidentResult(shiftStats.hipertermiIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.hipertermiIncidents,
          'Tidak ada kejadian hipertermi/demam intra-HD pada shift ini'
        ),
        shiftStats.hipertermiIncidents.length > 0
      ),
      buildRow(
        'Insiden Kram Otot Intra-HD',
        formatPatientIncidentResult(shiftStats.kramIncidents),
        '< 10%',
        formatIncidentLines(
          shiftStats.kramIncidents,
          'Tidak ada kejadian kram otot intra-HD pada shift ini'
        ),
        shiftStats.kramIncidents.length > 0
      ),
      buildRow(
        'Insiden Mual Intra-HD',
        formatPatientIncidentResult(shiftStats.mualIncidents),
        '< 10%',
        formatIncidentLines(
          shiftStats.mualIncidents,
          'Tidak ada keluhan mual intra-HD pada shift ini'
        ),
        shiftStats.mualIncidents.length > 0
      ),
      buildRow(
        'Insiden Muntah Intra-HD',
        formatPatientIncidentResult(shiftStats.muntahIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.muntahIncidents,
          'Tidak ada kejadian muntah intra-HD pada shift ini'
        ),
        shiftStats.muntahIncidents.length > 0
      ),
      buildRow(
        'Insiden Clotting Sirkit / Dialiser',
        formatPatientIncidentResult(shiftStats.clottingIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.clottingIncidents,
          'Heparinisasi adekuat, flushing NaCl berkala berjalan lancar'
        ),
        shiftStats.clottingIncidents.length > 0
      ),
      buildRow(
        'Akses Bleeding / Hematom Post-HD',
        formatPatientIncidentResult(shiftStats.bleedingIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.bleedingIncidents,
          'Penekanan kanulasi AVF 10-15 menit sesuai SOP dan hemostasis baik'
        ),
        shiftStats.bleedingIncidents.length > 0
      ),
      buildRow(
        'Insiden First-Use Syndrome / Alergi',
        formatPatientIncidentResult(shiftStats.allergyIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.allergyIncidents,
          `Priming dialiser sesuai SOP ${shiftStats.avgPriming} mL NaCl 0.9%`
        ),
        shiftStats.allergyIncidents.length > 0
      ),
      buildRow(
        'Insiden Penurunan Kesadaran Intra-HD',
        formatPatientIncidentResult(shiftStats.kesadaranIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.kesadaranIncidents,
          'Tidak ada kejadian penurunan kesadaran pada shift ini'
        ),
        shiftStats.kesadaranIncidents.length > 0
      ),
      buildRow(
        'Komplikasi Intra-HD Lainnya',
        formatPatientIncidentResult(shiftStats.otherIncidents),
        '0 Kasus',
        formatIncidentLines(
          shiftStats.otherIncidents,
          'Tidak ada komplikasi lain yang tercatat pada shift ini'
        ),
        shiftStats.otherIncidents.length > 0
      ),
      buildRow(
        'Konsultasi Cito ke DPJP',
        shiftStats.consultIncidents.length > 0
          ? `${shiftStats.consultIncidents.length} Kali${
              shiftStats.dutyDoctorLabel !== '-' ? ` (${shiftStats.dutyDoctorLabel})` : ''
            }`
          : '0 Kali (Nihil)',
        'Sesuai Indikasi',
        formatIncidentLines(
          shiftStats.consultIncidents,
          'Kondisi pasien stabil, tidak ada konsultasi cito emergensi'
        ),
        false
      ),
    ];
  }, [shiftStats]);

  const handleExportCsv = () => {
    const rows: (string | number)[][] = [
      ['BAGIAN A', 'INFORMASI UMUM SHIFT & KETENAGAAN', '', ''],
      ['Hari / Tanggal', formatFullDayDateId(selectedDate), 'Shift Dinas', getShiftTimeLabel(shiftFilter)],
      ['Penanggung Jawab (PJ) Shift', shiftStats.pjShiftName, 'Dokter DPJP Unit HD', shiftStats.dpjpLabel],
      ['Kepala Ruangan HD', shiftStats.kaRuangName, 'Dokter Jaga Ruangan', shiftStats.dutyDoctorLabel],
      [
        'Jumlah Perawat Dinas',
        `${shiftStats.totalNursesDinas} Orang (${shiftStats.pjCount} PJ Shift + ${shiftStats.pelaksanaCount} Perawat Pelaksana)`,
        'Rasio Perawat : Pasien',
        shiftStats.totalNursesDinas > 0 ? `1 : ${shiftStats.ratioNum}` : '-',
      ],
      [
        'Tenaga Pendukung Dinas',
        '1 Teknisi Elektromedis/RO 1 dan HK Ruangan',
        'Total Pasien Dilayani',
        `${shiftStats.totalVerified} Pasien Selesai HD (${shiftStats.rajalCount} Rajal, ${shiftStats.ranapCount} Ranap)`,
      ],
      ['BAGIAN B', 'SENSUS PASIEN, AKSES VASKULAR & UTILISASI MESIN', '', ''],
      ['Pasien Terjadwal (Target Shift)', shiftStats.scheduledPatientsCount, 'Total Kapasitas Mesin HD', shiftStats.totalMachines],
      ['Pasien Hadir & Selesai HD', shiftStats.totalVerified, 'Mesin Beroperasi Siap Pakai', shiftStats.operationalMachines],
      ['Pasien HD Cito / Emergency', shiftStats.citoCount, 'Mesin Maintenance / Perbaikan', shiftStats.maintenanceMachines],
      ['Pasien Batal / Tunda', shiftStats.rescheduledCount, 'Mesin Khusus Hepatitis B', shiftStats.hepBMachines],
      ['Kategori: Pasien Reguler', shiftStats.regulerCount, 'Mesin Khusus Hepatitis C', shiftStats.hepCMachines],
      ['Kategori: Isolasi Hepatitis B', shiftStats.hepBCount, 'Akses: AV Fistula (Cimino)', shiftStats.avfCount],
      ['Kategori: Isolasi Hepatitis C / HIV', shiftStats.hepCHivCount, 'Akses: AV Graft', shiftStats.avgCount],
      ['Status: Rawat Jalan', shiftStats.rajalCount, 'Akses: CDL Non-Tunnel', shiftStats.cdlNonTunnelCount],
      ['Status: Rawat Inap', shiftStats.ranapCount, 'Akses: CDL Tunneling (Permcath)', shiftStats.cdlTunnelCount],
      ['BAGIAN C', 'MONITORING ASUHAN KEPERAWATAN & PELAYANAN MEDIS', '', ''],
      ...sectionCRows.map((r) => [r.indicator, r.result, r.target, r.analysis]),
      ['BAGIAN D', 'AKUNTABILITAS NON-MEDIS, OPERASIONAL, WATER TREATMENT & K3', '', ''],
      ...sectionDRows.map((r) => [r.item, r.result, r.parameter, r.status]),
      ['BAGIAN E', 'SERAH TERIMA SHIFT MODEL SBAR', '', ''],
      ['SITUATION (S)', sbarView.situation, '', ''],
      ['BACKGROUND (B)', sbarView.background, '', ''],
      ['ASSESSMENT (A)', sbarView.assessment, '', ''],
      ['RECOMMENDATION (R)', sbarView.recommendation, '', ''],
    ];

    exportToCsv(
      `laporan-pj-shift-${selectedDate}-${shiftFilter}.csv`,
      ['Keterangan / Indikator', 'Nilai / Hasil Shift', 'Parameter / Target', 'Analisis / Rincian'],
      rows
    );
    showToast(`Laporan PJ Shift (${selectedDate} · ${shiftFilter}) diekspor ke CSV.`, 'success');
  };

  return (
    <div className="space-y-4 print:space-y-0">
      {/* Top Toolbar */}
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Laporan Penanggung Jawab (PJ) Shift
          </h2>
          <p className="text-xs text-slate-500">
            Laporan pertanggungjawaban shift yang disinkronkan otomatis dari logbook pasien berstatus Approved.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            title="Cetak / Simpan PDF (F4 Portrait - 1 Halaman Penuh)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Printer className="h-4 w-4" />
            Cetak / PDF
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-4 w-4" />
            Ekspor CSV
          </button>
          {canReview && kolom3Auth.allowed && (
            <button
              type="button"
              onClick={handleOpenKaruSign}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" />
              Sahkan Digital Ka. Ruang
            </button>
          )}
          {canResetApprovals && (
            <button
              type="button"
              onClick={() => setShowResetConfirmModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 whitespace-nowrap"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Pengesahan
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              {activeSavedReport ? 'Perbarui SBAR / Pengesahan' : 'Simpan Laporan Shift'}
            </button>
          )}
        </div>
      </div>

      {archiveLoading && (
        <div className="no-print rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-[#0B5A8E]">
          Memuat arsip laporan PJ Shift...
        </div>
      )}

      {/* Filters & Quick Verified Period Selector */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Tanggal Dinas
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 focus:border-[#0B5A8E] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Shift Dinas
            </label>
            <select
              value={shiftFilter}
              onChange={(e) => {
                setShiftFilter(e.target.value as 'ALL' | ShiftType);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#0B5A8E] focus:outline-none"
            >
              <option value="Pagi">Shift Pagi (07.00 - 14.00 WIB)</option>
              <option value="Siang">Shift Siang (12.00 - 19.00 WIB)</option>
              {hasHistoricalMalam && (
                <option value="Malam">Shift Malam (21.00 - 07.00 WIB)</option>
              )}
              <option value="ALL">Semua Shift (Rekap Harian)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Sumber Verifikasi Logbook
            </label>
            <select
              value={verifierFilter}
              onChange={(e) =>
                setVerifierFilter(e.target.value as 'ALL' | 'PJ Shift' | 'Kepala Ruang')
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#0B5A8E] focus:outline-none"
            >
              <option value="ALL">Semua Terverifikasi (PJ Shift &amp; Kepala Ruang)</option>
              <option value="PJ Shift">Diverifikasi oleh PJ Shift</option>
              <option value="Kepala Ruang">Diverifikasi oleh Kepala Ruang</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Institutional Report Sheet Matching PDF */}
      <div
        ref={sheetRef}
        className="f4-print-sheet f4-pj-portrait rounded-xl border border-slate-300 bg-white p-4 sm:p-6 shadow-sm space-y-4"
      >
        {/* Institutional Header */}
        <div className="pj-doc-header text-center border-b border-slate-300 pb-3">
          <p className="text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
            INSTALASI DIALISIS RS HAPPY LAND MEDICAL CENTRE
          </p>
          <h1 className="font-display text-sm sm:text-base font-extrabold tracking-wide text-slate-900 uppercase mt-0.5">
            LOGBOOK &amp; PERTANGGUNGJAWABAN PERAWAT PENANGGUNG JAWAB (PJ) SHIFT
          </h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
            Laporan Komprehensif Asuhan Medis, Keperawatan, Mutu Air RO, Pemeliharaan Mesin &amp; Operasional Non-Medis | Standar Akreditasi KARS &amp; PERNEFRI
          </p>
        </div>

        {/* Status notice if zero verified logbooks */}
        {verifiedEntries.length === 0 && (
          <div className="no-print rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Belum ada logbook pasien berstatus <strong>Approved (Terverifikasi)</strong> pada{' '}
            <strong>{formatFullDayDateId(selectedDate)}</strong> ({getShiftTimeLabel(shiftFilter)}). Data akan otomatis terisi setelah PJ Shift atau Kepala Ruang memverifikasi logbook pasien di menu Verifikasi.
          </div>
        )}

        {/* SECTION A: INFORMASI UMUM SHIFT & KETENAGAAN (MANPOWER) */}
        <div className="f4-scroll-wrap overflow-x-auto">
          <table className="w-full border-collapse text-[11px] text-slate-900">
            <thead>
              <tr className="bg-[#1b4670] text-white">
                <th
                  colSpan={4}
                  className="border border-[#1b4670] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide"
                >
                  A. INFORMASI UMUM SHIFT &amp; KETENAGAAN (MANPOWER)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="w-[21%] border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Hari / Tanggal
                </td>
                <td className="w-[29%] border border-slate-300 px-3 py-1.5 font-bold">
                  {formatFullDayDateId(selectedDate)}
                </td>
                <td className="w-[21%] border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Shift Dinas
                </td>
                <td className="w-[29%] border border-slate-300 px-3 py-1.5 font-bold">
                  {getShiftTimeLabel(shiftFilter)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Penanggung Jawab (PJ) Shift
                </td>
                <td className="border border-slate-300 px-3 py-1.5 font-bold">
                  {shiftStats.pjShiftName}
                </td>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Dokter DPJP Unit HD
                </td>
                <td className="border border-slate-300 px-3 py-1.5 font-bold">
                  {shiftStats.dpjpLabel}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Kepala Ruangan HD
                </td>
                <td className="border border-slate-300 px-3 py-1.5">
                  {shiftStats.kaRuangName}
                </td>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Dokter Jaga Ruangan
                </td>
                <td className="border border-slate-300 px-3 py-1.5">
                  {shiftStats.dutyDoctorLabel}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Jumlah Perawat Dinas
                </td>
                <td className="border border-slate-300 px-3 py-1.5 font-bold tabular-nums">
                  {shiftStats.totalNursesDinas > 0
                    ? `${shiftStats.totalNursesDinas} Orang (${shiftStats.pjCount} PJ Shift + ${shiftStats.pelaksanaCount} Perawat Pelaksana)`
                    : activeSavedReport?.nursesOnDuty || '-'}
                </td>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Rasio Perawat : Pasien
                </td>
                <td className="border border-slate-300 px-3 py-1.5 font-bold tabular-nums">
                  {shiftStats.totalNursesDinas > 0 && shiftStats.totalVerified > 0
                    ? `1 : ${shiftStats.ratioNum} (Standar PERNEFRI 1 : 3-4 Pasien)`
                    : '- (Standar PERNEFRI 1 : 3-4 Pasien)'}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Tenaga Pendukung Dinas
                </td>
                <td className="border border-slate-300 px-3 py-1.5">
                  1 Teknisi Elektromedis/RO 1 dan HK Ruangan
                </td>
                <td className="border border-slate-300 bg-[#edf3f8] px-3 py-1.5 font-semibold text-slate-800">
                  Total Pasien Dilayani
                </td>
                <td className="border border-slate-300 px-3 py-1.5 font-bold tabular-nums">
                  {shiftStats.totalVerified} Pasien Selesai HD ({shiftStats.rajalCount} Rajal,{' '}
                  {shiftStats.ranapCount} Ranap)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* SECTION B: SENSUS PASIEN, AKSES VASKULAR & UTILISASI MESIN HEMODIALISIS */}
        <div className="f4-scroll-wrap overflow-x-auto">
          <table className="w-full border-collapse text-[11px] text-slate-900">
            <thead>
              <tr className="bg-[#1b4670] text-white">
                <th
                  colSpan={4}
                  className="border border-[#1b4670] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide"
                >
                  B. SENSUS PASIEN, AKSES VASKULAR &amp; UTILISASI MESIN HEMODIALISIS
                </th>
              </tr>
              <tr className="bg-[#2c5e8f] text-white text-[10px] uppercase">
                <th
                  colSpan={2}
                  className="w-1/2 border border-[#3b6e9e] px-3 py-1.5 text-center font-bold"
                >
                  SENSUS &amp; KLASIFIKASI PASIEN SHIFT INI
                </th>
                <th
                  colSpan={2}
                  className="w-1/2 border border-[#3b6e9e] px-3 py-1.5 text-center font-bold"
                >
                  KAPASITAS MESIN &amp; DISTRIBUSI AKSES VASKULAR
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  lLabel: 'Pasien Terjadwal (Target Shift)',
                  lVal: shiftStats.scheduledPatientsCount,
                  rLabel: 'Total Kapasitas Mesin HD',
                  rVal: shiftStats.totalMachines,
                },
                {
                  lLabel: 'Pasien Hadir & Selesai HD',
                  lVal: shiftStats.totalVerified,
                  rLabel: 'Mesin Beroperasi Siap Pakai',
                  rVal: shiftStats.operationalMachines,
                },
                {
                  lLabel: 'Pasien HD Cito / Emergency (ICU/IGD)',
                  lVal: shiftStats.citoCount,
                  rLabel: 'Mesin Maintenance / Perbaikan',
                  rVal: shiftStats.maintenanceMachines,
                },
                {
                  lLabel: 'Pasien Batal / Tunda (Reschedule)',
                  lVal: shiftStats.rescheduledCount,
                  rLabel: 'Mesin Khusus Hepatitis B (Isolasi)',
                  rVal: shiftStats.hepBMachines,
                },
                {
                  lLabel: 'Kategori: Pasien Reguler (Non-Hepatitis)',
                  lVal: shiftStats.regulerCount,
                  rLabel: 'Mesin Khusus Hepatitis C',
                  rVal: shiftStats.hepCMachines,
                },
                {
                  lLabel: 'Kategori: Pasien Isolasi Hepatitis B',
                  lVal: shiftStats.hepBCount,
                  rLabel: 'Akses: AV Fistula (Cimino)',
                  rVal: shiftStats.avfCount,
                },
                {
                  lLabel: 'Kategori: Pasien Isolasi Hepatitis C / HIV',
                  lVal: shiftStats.hepCHivCount,
                  rLabel: 'Akses: AV Graft',
                  rVal: shiftStats.avgCount,
                },
                {
                  lLabel: 'Status: Pasien Rawat Jalan',
                  lVal: shiftStats.rajalCount,
                  rLabel: 'Akses: Double Lumen (CDL) Non-Tunnel',
                  rVal: shiftStats.cdlNonTunnelCount,
                },
                {
                  lLabel: 'Status: Pasien Rawat Inap (Bangsal/ICU)',
                  lVal: shiftStats.ranapCount,
                  rLabel: 'Akses: Double Lumen Tunneling (Permcath)',
                  rVal: shiftStats.cdlTunnelCount,
                },
              ].map((row, i) => (
                <tr key={row.lLabel} className={i % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                  <td className="w-[38%] border border-slate-300 px-3 py-1.5 text-slate-800">
                    {row.lLabel}
                  </td>
                  <td className="w-[12%] border border-slate-300 px-3 py-1.5 text-center font-mono font-bold tabular-nums">
                    {row.lVal}
                  </td>
                  <td className="w-[38%] border border-slate-300 px-3 py-1.5 text-slate-800">
                    {row.rLabel}
                  </td>
                  <td className="w-[12%] border border-slate-300 px-3 py-1.5 text-center font-mono font-bold tabular-nums">
                    {row.rVal}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Feedback Banner for Save / Edit / Digital Sign */}
        {signFeedback && (
          <div
            className={`no-print flex items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-xs ${
              signFeedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            <span>{signFeedback.message}</span>
            <button
              type="button"
              onClick={() => setSignFeedback(null)}
              className="rounded p-0.5 hover:bg-black/5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* SECTION C: MONITORING ASUHAN KEPERAWATAN & PELAYANAN MEDIS SHIFT */}
        <div className="space-y-1.5">
          {unverifiedComplicationEntries.length > 0 && (
            <div className="no-print rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[11px] text-amber-900">
              <strong>Info Verifikasi Komplikasi:</strong> Terdapat{' '}
              <strong>{unverifiedComplicationEntries.length}</strong> logbook berstatus{' '}
              <em>Menunggu Verifikasi/Revisi</em> pada shift ini yang mencatat komplikasi intra-HD (
              {unverifiedComplicationEntries.map((u) => u.patientName).join(', ')}). Verifikasi di
              menu <strong>Verifikasi</strong> agar otomatis terakumulasi ke tabel Section C.
            </div>
          )}
          <div className="f4-scroll-wrap overflow-x-auto">
            <table className="w-full border-collapse text-[11px] text-slate-900">
              <thead>
                <tr className="bg-[#1b4670] text-white">
                  <th
                    colSpan={4}
                    className="border border-[#1b4670] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide"
                  >
                    C. MONITORING ASUHAN KEPERAWATAN &amp; PELAYANAN MEDIS SHIFT
                  </th>
                </tr>
                <tr className="bg-[#2c5e8f] text-white text-[10.5px]">
                  <th className="w-[24%] border border-[#3b6e9e] px-3 py-1.5 text-left font-bold">
                    Indikator Asuhan Keperawatan &amp; Medis
                  </th>
                  <th className="w-[18%] border border-[#3b6e9e] px-3 py-1.5 text-center font-bold">
                    Hasil / Capaian Shift
                  </th>
                  <th className="w-[13%] border border-[#3b6e9e] px-3 py-1.5 text-center font-bold">
                    Standar Target
                  </th>
                  <th className="w-[45%] border border-[#3b6e9e] px-3 py-1.5 text-left font-bold">
                    Analisis &amp; Tindak Lanjut
                  </th>
                </tr>
              </thead>
              <tbody>
                {sectionCRows.map((row, idx) => (
                  <tr
                    key={row.indicator}
                    className={
                      row.hasCases
                        ? 'bg-rose-50/50'
                        : idx % 2 === 1
                        ? 'bg-slate-50/70'
                        : 'bg-white'
                    }
                  >
                    <td className="border border-slate-300 px-3 py-1.5 font-medium text-slate-900">
                      {row.indicator}
                    </td>
                    <td
                      className={`border border-slate-300 px-3 py-1.5 text-center font-bold tabular-nums ${
                        row.hasCases ? 'text-rose-700' : ''
                      }`}
                    >
                      {row.result}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-center font-mono tabular-nums text-slate-700">
                      {row.target}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-slate-700 align-top">
                      {row.analysisLines.length > 1 ? (
                        <div className="space-y-1">
                          {row.analysisLines.map((line, lineIdx) => (
                            <div
                              key={`${row.indicator}-${lineIdx}`}
                              className={
                                lineIdx > 0
                                  ? 'border-t border-slate-200/80 pt-1'
                                  : undefined
                              }
                            >
                              {lineIdx + 1}. {line}
                            </div>
                          ))}
                        </div>
                      ) : (
                        row.analysisLines[0]
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION D: AKUNTABILITAS NON-MEDIS, OPERASIONAL, WATER TREATMENT & K3 */}
        <div className="f4-scroll-wrap overflow-x-auto">
          <table className="w-full border-collapse text-[11px] text-slate-900">
            <thead>
              <tr className="bg-[#1b4670] text-white">
                <th
                  colSpan={5}
                  className="border border-[#1b4670] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      D. AKUNTABILITAS NON-MEDIS, OPERASIONAL, WATER TREATMENT &amp; K3
                    </span>
                    {canEditContent &&
                      activeSavedReport?.sectionDItems &&
                      activeSavedReport.sectionDItems.length > 0 && (
                        <button
                          type="button"
                          onClick={handleResetSectionD}
                          disabled={savingSectionD}
                          className="no-print inline-flex items-center gap-1 rounded border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset Otomatis
                        </button>
                      )}
                  </div>
                </th>
              </tr>
              <tr className="bg-[#2c5e8f] text-white text-[10.5px]">
                <th className="w-[21%] border border-[#3b6e9e] px-3 py-1.5 text-left font-bold">
                  Item Fasilitas / Operasional
                </th>
                <th className="w-[24%] border border-[#3b6e9e] px-3 py-1.5 text-left font-bold">
                  Parameter Uji / Pengawasan
                </th>
                <th className="w-[30%] border border-[#3b6e9e] px-3 py-1.5 text-left font-bold">
                  Hasil Observasi Shift
                </th>
                <th className="w-[15%] border border-[#3b6e9e] px-3 py-1.5 text-center font-bold">
                  Status Kepatuhan
                </th>
                <th className="no-print w-[10%] border border-[#3b6e9e] px-2 py-1.5 text-center font-bold">
                  Edit
                </th>
              </tr>
            </thead>
            <tbody>
              {sectionDRows.map((row, idx) => {
                const isEditingRow = editingSectionDIndex === idx && draftSectionDRow;
                return (
                  <tr key={row.item} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                    <td className="border border-slate-300 px-3 py-1.5 font-bold text-slate-900">
                      {row.item}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-slate-700">
                      {isEditingRow ? (
                        <input
                          type="text"
                          value={draftSectionDRow.parameter}
                          onChange={(e) =>
                            setDraftSectionDRow({ ...draftSectionDRow, parameter: e.target.value })
                          }
                          className="w-full rounded border border-[#0e4e78] bg-white px-2 py-1 text-[11px] text-slate-900 focus:outline-none"
                        />
                      ) : (
                        row.parameter
                      )}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-slate-700">
                      {isEditingRow ? (
                        <textarea
                          rows={2}
                          value={draftSectionDRow.result}
                          onChange={(e) =>
                            setDraftSectionDRow({ ...draftSectionDRow, result: e.target.value })
                          }
                          className="w-full rounded border border-[#0e4e78] bg-white px-2 py-1 text-[11px] text-slate-900 focus:outline-none"
                        />
                      ) : (
                        row.result
                      )}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-center font-bold tracking-wide text-slate-900">
                      {isEditingRow ? (
                        <input
                          type="text"
                          value={draftSectionDRow.status}
                          onChange={(e) =>
                            setDraftSectionDRow({ ...draftSectionDRow, status: e.target.value })
                          }
                          className="w-full rounded border border-[#0e4e78] bg-white px-2 py-1 text-center text-[11px] font-bold uppercase text-slate-900 focus:outline-none"
                        />
                      ) : (
                        row.status
                      )}
                    </td>
                    <td className="no-print border border-slate-300 px-2 py-1.5 text-center">
                      {isEditingRow ? (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            disabled={savingSectionD}
                            onClick={() => handleSaveSectionDRow(idx)}
                            className="inline-flex w-full items-center justify-center gap-1 rounded bg-[#0e4e78] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#093b5c] disabled:opacity-60"
                          >
                            <Save className="h-3 w-3" />
                            {savingSectionD ? '...' : 'Simpan'}
                          </button>
                          <button
                            type="button"
                            disabled={savingSectionD}
                            onClick={() => {
                              setEditingSectionDIndex(null);
                              setDraftSectionDRow(null);
                            }}
                            className="inline-flex w-full items-center justify-center rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      ) : canEditContent ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSectionDIndex(idx);
                            setDraftSectionDRow({ ...row });
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-slate-700 hover:border-[#0e4e78] hover:text-[#0e4e78]"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      ) : (
                        <span
                          title={
                            shiftFilter === 'ALL'
                              ? 'Pilih shift spesifik (Pagi/Siang) untuk mengedit'
                              : 'Terkunci'
                          }
                          className="inline-flex items-center gap-1 text-[10px] text-slate-400"
                        >
                          <Lock className="h-3 w-3" />
                          Kunci
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* SECTION E: SERAH TERIMA SHIFT MODEL SBAR */}
        <div className="f4-scroll-wrap overflow-x-auto">
          <table className="w-full border-collapse text-[11px] text-slate-900">
            <thead>
              <tr className="bg-[#1b4670] text-white">
                <th
                  colSpan={3}
                  className="border border-[#1b4670] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide"
                >
                  E. SERAH TERIMA SHIFT MODEL SBAR (SITUATION, BACKGROUND, ASSESSMENT, RECOMMENDATION)
                </th>
              </tr>
              <tr className="bg-[#2c5e8f] text-white text-[10.5px]">
                <th className="w-[20%] border border-[#3b6e9e] px-3 py-1 text-center font-bold">
                  Komponen SBAR
                </th>
                <th className="w-[70%] border border-[#3b6e9e] px-3 py-1 text-left font-bold">
                  Catatan Serah Terima Shift
                </th>
                <th className="no-print w-[10%] border border-[#3b6e9e] px-2 py-1 text-center font-bold">
                  Edit
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  { key: 'situation', label: 'SITUATION (S)', val: sbarView.situation },
                  { key: 'background', label: 'BACKGROUND (B)', val: sbarView.background },
                  { key: 'assessment', label: 'ASSESSMENT (A)', val: sbarView.assessment },
                  { key: 'recommendation', label: 'RECOMMENDATION (R)', val: sbarView.recommendation },
                ] as const
              ).map((row) => {
                const isEditingRow = editingSbarKey === row.key;
                return (
                  <tr key={row.key}>
                    <td className="border border-slate-300 bg-[#edf3f8] px-3 py-2 text-center font-bold text-[#1b4670]">
                      {row.label}
                    </td>
                    <td className="border border-slate-300 px-3 py-2 text-slate-800 whitespace-pre-line leading-relaxed">
                      {isEditingRow ? (
                        <textarea
                          rows={row.key === 'recommendation' || row.key === 'background' ? 4 : 3}
                          value={draftSbarText}
                          onChange={(e) => setDraftSbarText(e.target.value)}
                          className="w-full rounded border border-[#0e4e78] bg-white px-2.5 py-1.5 text-[11px] text-slate-900 leading-relaxed focus:outline-none"
                        />
                      ) : (
                        row.val
                      )}
                    </td>
                    <td className="no-print border border-slate-300 px-2 py-2 text-center align-middle">
                      {isEditingRow ? (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            disabled={savingSbar}
                            onClick={() => handleSaveSbarRow(row.key)}
                            className="inline-flex w-full items-center justify-center gap-1 rounded bg-[#0e4e78] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#093b5c] disabled:opacity-60"
                          >
                            <Save className="h-3 w-3" />
                            {savingSbar ? '...' : 'Simpan'}
                          </button>
                          <button
                            type="button"
                            disabled={savingSbar}
                            onClick={() => {
                              setEditingSbarKey(null);
                              setDraftSbarText('');
                            }}
                            className="inline-flex w-full items-center justify-center rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      ) : canEditContent ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSbarKey(row.key);
                            setDraftSbarText(row.val);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-slate-700 hover:border-[#0e4e78] hover:text-[#0e4e78]"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      ) : (
                        <span
                          title={
                            shiftFilter === 'ALL'
                              ? 'Pilih shift spesifik (Pagi/Siang) untuk mengedit'
                              : 'Terkunci'
                          }
                          className="inline-flex items-center gap-1 text-[10px] text-slate-400"
                        >
                          <Lock className="h-3 w-3" />
                          Kunci
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* SECTION F: PENGESAHAN & PERTANGGUNGJAWABAN SHIFT (PENGESAHAN DIGITAL TERKUNCI PER AKUN & SHIFT) */}
        {(() => {
          const showNextPjColumn = shiftFilter !== 'Siang';
          const colWidthClass = showNextPjColumn ? 'w-1/3' : 'w-1/2';
          return (
            <div className="f4-scroll-wrap overflow-x-auto">
              <table className="pj-sig-table w-full border-collapse text-[11px] text-slate-900">
                <thead>
                  <tr className="bg-[#1b4670] text-white">
                    <th
                      colSpan={showNextPjColumn ? 3 : 2}
                      className="border border-[#1b4670] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide"
                    >
                      F. PENGESAHAN &amp; PERTANGGUNGJAWABAN SHIFT (PENGESAHAN DIGITAL)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {/* Kolom 1: Yang Menyerahkan (PJ Shift Aktif) */}
                    <td
                      className={`${colWidthClass} border border-slate-300 px-4 py-3 text-center align-top`}
                    >
                      <p className="font-bold text-slate-900">Yang Menyerahkan,</p>
                      <p className="font-bold text-slate-800">
                        Perawat Penanggung Jawab (PJ) Shift{' '}
                        {shiftFilter !== 'ALL' ? shiftFilter : ''}
                      </p>
                      <div className="pj-sig-box my-2.5 min-h-[78px] flex flex-col items-center justify-center gap-1.5">
                        {activeSavedReport?.handoverSignedBy ? (
                          <div className="inline-flex flex-col items-center rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2 text-center">
                            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Pengesahan Digital Sah
                            </span>
                            <span className="text-[11px] font-bold text-slate-900 mt-0.5">
                              {activeSavedReport.handoverSignedByName}
                            </span>
                            <span className="font-mono text-[9.5px] text-emerald-800">
                              PJ Shift {activeSavedReport.handoverSignedShift || shiftFilter} ·{' '}
                              {formatSignatureTimestamp(
                                activeSavedReport.handoverSignedAt || activeSavedReport.updatedAt
                              ) || 'Tercatat Sistem'}
                            </span>
                            <span className="font-mono text-[9px] text-slate-500">
                              ID: SIG-{activeSavedReport.handoverSignedBy.slice(0, 8).toUpperCase()}
                            </span>
                          </div>
                        ) : (
                          <>
                            <span className="text-[10.5px] italic text-slate-400">
                              Belum disahkan secara digital
                            </span>
                            <div className="no-print mt-1">
                              {kolom1Auth.allowed ? (
                                <button
                                  type="button"
                                  disabled={signingSlot !== null}
                                  onClick={handleSignHandover}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#093b5c] disabled:opacity-60"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  {signingSlot === 'handover'
                                    ? 'Mengesahkan...'
                                    : `Sahkan Digital (PJ Shift ${shiftFilter})`}
                                </button>
                              ) : (
                                <div className="inline-flex items-start gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[10px] text-slate-500 max-w-[230px]">
                                  <Lock className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                                  <span>{kolom1Auth.reason}</span>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      <p className="font-bold text-slate-900">({shiftStats.pjShiftName})</p>
                    </td>

                    {/* Kolom 2: Yang Menerima (PJ Shift Berikutnya) - Tidak ditampilkan pada Shift Siang karena tidak ada Shift Malam */}
                    {showNextPjColumn && (
                      <td className="w-1/3 border border-slate-300 px-4 py-3 text-center align-top">
                        <p className="font-bold text-slate-900">Yang Menerima,</p>
                        <p className="font-bold text-slate-800">
                          Perawat PJ Shift Berikutnya ({shiftStats.nextShiftName})
                        </p>
                        <div className="pj-sig-box my-2.5 min-h-[78px] flex flex-col items-center justify-center gap-1.5">
                          {activeSavedReport?.receivedSignedBy ? (
                            <div className="inline-flex flex-col items-center rounded-lg border border-sky-300 bg-sky-50/90 px-3 py-2 text-center">
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[#0e4e78]">
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Pengesahan Digital Sah
                              </span>
                              <span className="text-[11px] font-bold text-slate-900 mt-0.5">
                                {activeSavedReport.receivedSignedByName}
                              </span>
                              <span className="font-mono text-[9.5px] text-[#0e4e78]">
                                PJ Shift{' '}
                                {activeSavedReport.receivedSignedShift || shiftStats.nextShiftName}{' '}
                                ·{' '}
                                {formatSignatureTimestamp(
                                  activeSavedReport.receivedSignedAt || activeSavedReport.updatedAt
                                ) || 'Tercatat Sistem'}
                              </span>
                              <span className="font-mono text-[9px] text-slate-500">
                                ID: SIG-{activeSavedReport.receivedSignedBy.slice(0, 8).toUpperCase()}
                              </span>
                            </div>
                          ) : (
                            <>
                              <span className="text-[10.5px] italic text-slate-400">
                                Belum disahkan secara digital
                              </span>
                              <div className="no-print mt-1">
                                {kolom2Auth.allowed ? (
                                  <button
                                    type="button"
                                    disabled={signingSlot !== null}
                                    onClick={handleSignReceived}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#093b5c] disabled:opacity-60"
                                  >
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    {signingSlot === 'received'
                                      ? 'Mengesahkan...'
                                      : `Sahkan Digital (PJ Shift ${shiftStats.nextShiftName})`}
                                  </button>
                                ) : (
                                  <div className="inline-flex items-start gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[10px] text-slate-500 max-w-[230px]">
                                    <Lock className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                                    <span>{kolom2Auth.reason}</span>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                        <p className="font-bold text-slate-900">({shiftStats.nextPjShiftName})</p>
                      </td>
                    )}

                    {/* Kolom 3: Mengetahui & Menyetujui (Kepala Ruangan Hemodialisis) */}
                    <td
                      className={`${colWidthClass} border border-slate-300 px-4 py-3 text-center align-top`}
                    >
                      <p className="font-bold text-slate-900">Mengetahui &amp; Menyetujui,</p>
                      <p className="font-bold text-slate-800">Kepala Ruangan Hemodialisis</p>
                      <div className="pj-sig-box my-2.5 min-h-[78px] flex flex-col items-center justify-center gap-1.5">
                        {activeSavedReport?.reviewStatus === 'Reviewed' ? (
                          <div className="inline-flex flex-col items-center rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2 text-center">
                            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Disetujui &amp; Disahkan Digital
                            </span>
                            <span className="text-[11px] font-bold text-slate-900 mt-0.5">
                              {activeSavedReport.reviewedByName}
                            </span>
                            <span className="font-mono text-[9.5px] text-emerald-800">
                              Kepala Ruang ·{' '}
                              {formatSignatureTimestamp(
                                activeSavedReport.reviewedAt || activeSavedReport.updatedAt
                              ) || 'Tercatat Sistem'}
                            </span>
                            {activeSavedReport.reviewedBy && (
                              <span className="font-mono text-[9px] text-slate-500">
                                ID: SIG-{activeSavedReport.reviewedBy.slice(0, 8).toUpperCase()}
                              </span>
                            )}
                          </div>
                        ) : (
                          <>
                            <span className="text-[10.5px] italic text-slate-400">
                              Belum disahkan secara digital
                            </span>
                            <div className="no-print mt-1">
                              {kolom3Auth.allowed ? (
                                <button
                                  type="button"
                                  onClick={handleOpenKaruSign}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  Sahkan Digital (Kepala Ruang)
                                </button>
                              ) : (
                                <div className="inline-flex items-start gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[10px] text-slate-500 max-w-[230px]">
                                  <Lock className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                                  <span>{kolom3Auth.reason}</span>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      <p className="font-bold text-slate-900">({shiftStats.kaRuangName})</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Review status banner if evaluated */}
        {activeSavedReport?.reviewStatus === 'Reviewed' && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs text-emerald-900">
            <strong>Evaluasi Kepala Ruang ({activeSavedReport.reviewedByName}): </strong>
            {activeSavedReport.reviewNote}
          </div>
        )}
      </div>

      {/* Create / Update PJ Shift Report Modal */}
      {showModal && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  {activeSavedReport ? 'Perbarui Laporan PJ Shift' : 'Simpan & Submit Laporan PJ Shift'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {formatFullDayDateId(selectedDate)} · {getShiftTimeLabel(shiftFilter)} ·{' '}
                  {shiftStats.totalVerified} Pasien Terverifikasi
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateOrUpdateReport} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Perawat Bertugas pada Shift Ini
                </label>
                <input
                  type="text"
                  required
                  value={modalNursesOnDuty}
                  onChange={(e) => setModalNursesOnDuty(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0e4e78] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Ringkasan Insiden Klinis / Teknis Shift
                </label>
                <textarea
                  rows={2}
                  required
                  value={modalIncidents}
                  onChange={(e) => setModalIncidents(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0e4e78] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Serah Terima SBAR (Gunakan awalan S:, B:, A:, R: pada tiap baris)
                </label>
                <textarea
                  rows={6}
                  required
                  value={modalHandoverNotes}
                  onChange={(e) => setModalHandoverNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-[11px] leading-relaxed focus:border-[#0e4e78] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0e4e78] px-5 py-2 font-semibold text-white hover:bg-[#093b5c] disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan & Submit Laporan Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                Evaluasi &amp; Pengesahan Kepala Ruang
              </h3>
              <button
                type="button"
                onClick={() => {
                  setReviewTargetId(null);
                  setNewReviewDraft(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmitReview} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600">
                Laporan <strong>{formatDateId(reviewTarget.date)}</strong> (Shift{' '}
                {reviewTarget.shift}) oleh <strong>{reviewTarget.authorName}</strong>.
              </p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Catatan Evaluasi / Tindak Lanjut (Opsional)
                </label>
                <textarea
                  rows={3}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Tuliskan tanggapan evaluasi untuk jalannya shift ini..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0e4e78] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setReviewTargetId(null);
                    setNewReviewDraft(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={reviewing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {reviewing ? 'Menyimpan...' : 'Sahkan Digital & Setujui'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Digital Approval Confirmation Modal (Administrator Only) */}
      {showResetConfirmModal && activeSavedReport && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                Reset Pengesahan Digital Shift
              </h3>
              <button
                type="button"
                disabled={resettingApprovals}
                onClick={() => setShowResetConfirmModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs text-slate-700">
              <p>
                Anda akan menghapus seluruh pengesahan digital (PJ Shift Penyerah, PJ Shift
                Penerima, dan Kepala Ruang) pada laporan:
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="font-bold text-slate-900">
                  {formatFullDayDateId(selectedDate)} · {getShiftTimeLabel(shiftFilter)}
                </p>
                {activeSavedReport.handoverSignedByName && (
                  <p className="text-[11px] text-slate-600">
                    • PJ Shift Penyerah: {activeSavedReport.handoverSignedByName}
                  </p>
                )}
                {activeSavedReport.receivedSignedByName && (
                  <p className="text-[11px] text-slate-600">
                    • PJ Shift Penerima: {activeSavedReport.receivedSignedByName}
                  </p>
                )}
                {activeSavedReport.reviewedByName && (
                  <p className="text-[11px] text-slate-600">
                    • Kepala Ruang: {activeSavedReport.reviewedByName}
                  </p>
                )}
              </div>
              <p className="text-[11px] text-rose-700">
                Setelah direset, status laporan kembali menjadi menunggu pengesahan dan harus
                ditandatangani ulang oleh pemilik akun masing-masing.
              </p>
              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={resettingApprovals}
                  onClick={() => setShowResetConfirmModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={resettingApprovals}
                  onClick={handleResetApprovals}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  <RotateCcw className="h-4 w-4" />
                  {resettingApprovals ? 'Mereset...' : 'Ya, Reset Pengesahan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

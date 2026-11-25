import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileDown, Plus, Printer, Search, X } from 'lucide-react';
import { handleDbError, OperationType } from '../lib/supabase';
import { generateRecordId, insertRow, toReportRow } from '../lib/db';
import {
  clampString,
  exportToCsv,
  formatDateId,
  formatFullDayDateId,
  formatMonthLabel,
  formatVerificationStatusLabel,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { useF4OnePagePrint } from '../hooks/useF4OnePagePrint';
import { exportPatientServicesPdf, exportPatientSoapPdf } from '../lib/patientReportPdf';
import { LogbookDetailModal } from '../components/logbook/LogbookDetailModal';
import { VerificationBadge } from '../components/ui/StatusBadge';
import type {
  LogbookEntry,
  LogbookFormTemplate,
  Machine,
  Patient,
  PjShiftAssignmentEntry,
  ReportEntry,
  ShiftType,
  StaffDirectoryEntry,
} from '../types';

interface PatientReportsPageProps {
  patients: Patient[];
  logbooks: LogbookEntry[];
  reports: ReportEntry[];
  machines?: Machine[];
  staffDirectory?: StaffDirectoryEntry[];
  pjShiftAssignments?: PjShiftAssignmentEntry[];
  formTemplate?: LogbookFormTemplate;
  archiveLoading?: boolean;
  onEnsureMonthLoaded?: (monthKey: string) => Promise<void> | void;
  onEnsureAllArchivesLoaded?: () => Promise<void> | void;
  onEnsureMonthDetailsLoaded?: (monthKey: string) => Promise<void> | void;
  onEnsureAllArchiveDetailsLoaded?: () => Promise<void> | void;
  onEnsureLogbookDetailsByIds?: (ids: string[]) => Promise<void> | void;
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

function formatNumId(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return val.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatIntId(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return Math.round(val).toLocaleString('id-ID');
}

function getShiftRangeLabel(shift: ShiftType): string {
  if (shift === 'Pagi') return 'Pagi (07.00 - 14.00 WIB)';
  if (shift === 'Siang') return 'Siang (12.00 - 19.00 WIB)';
  return 'Malam (21.00 - 07.00 WIB)';
}

const SHIFT_SORT_ORDER: Record<ShiftType, number> = {
  Pagi: 1,
  Siang: 2,
  Malam: 3,
};

export function PatientReportsPage({
  patients,
  logbooks,
  reports,
  machines = [],
  staffDirectory = [],
  pjShiftAssignments = [],
  formTemplate,
  archiveLoading = false,
  onEnsureMonthLoaded,
  onEnsureAllArchivesLoaded,
  onEnsureMonthDetailsLoaded,
  onEnsureAllArchiveDetailsLoaded,
  onEnsureLogbookDetailsByIds,
}: PatientReportsPageProps) {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { todayDate: liveTodayDate, currentShift: liveCurrentShift } = useLiveClock();
  const [todayDate, setTodayDate] = useState(liveTodayDate);
  const [selectedPatientId, setSelectedPatientId] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState(liveTodayDate.slice(0, 7));
  const [dateFilter, setDateFilter] = useState(liveTodayDate);
  const [shiftFilter, setShiftFilter] = useState<ShiftType>(liveCurrentShift);
  const [hasManualShift, setHasManualShift] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'services' | 'soap'>('services');

  const printShiftCode =
    shiftFilter === 'Pagi' ? 'P' : shiftFilter === 'Siang' ? 'S' : 'M';
  const printDateLabel = /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)
    ? `${dateFilter.slice(8, 10)}-${dateFilter.slice(5, 7)}-${dateFilter.slice(0, 4)}`
    : /^\d{4}-\d{2}$/.test(monthFilter)
    ? `${monthFilter.slice(5, 7)}-${monthFilter.slice(0, 4)}`
    : 'Semua';
  const printDocumentTitle = `Lap Pasien-Shift ${printShiftCode}-${printDateLabel}`;

  const { handlePrint } = useF4OnePagePrint({
    orientation: 'landscape',
    sheetRef,
    documentTitle: printDocumentTitle,
  });
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (liveTodayDate !== todayDate) {
      setTodayDate(liveTodayDate);
      setDateFilter((prev) => (prev === todayDate ? liveTodayDate : prev));
      setMonthFilter((prev) =>
        prev === todayDate.slice(0, 7) ? liveTodayDate.slice(0, 7) : prev
      );
      setSoapDate((prev) => (prev === todayDate ? liveTodayDate : prev));
    }
  }, [liveTodayDate, todayDate]);

  useEffect(() => {
    if (!hasManualShift) {
      setShiftFilter(liveCurrentShift);
    }
  }, [liveCurrentShift, hasManualShift]);

  useEffect(() => {
    if (dateFilter) {
      void onEnsureMonthLoaded?.(dateFilter.slice(0, 7));
    } else if (monthFilter) {
      void (onEnsureMonthDetailsLoaded || onEnsureMonthLoaded)?.(monthFilter);
    } else {
      void (onEnsureAllArchiveDetailsLoaded || onEnsureAllArchivesLoaded)?.();
    }
  }, [
    dateFilter,
    monthFilter,
    onEnsureMonthLoaded,
    onEnsureAllArchivesLoaded,
    onEnsureMonthDetailsLoaded,
    onEnsureAllArchiveDetailsLoaded,
  ]);

  useEffect(() => {
    if (!dateFilter || !onEnsureLogbookDetailsByIds) return;
    const missingIds = logbooks
      .filter((lb) => lb.date === dateFilter && lb.wizardDetails === undefined)
      .map((lb) => lb.id);
    if (missingIds.length > 0) {
      void onEnsureLogbookDetailsByIds(missingIds);
    }
  }, [dateFilter, logbooks, onEnsureLogbookDetailsByIds]);

  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const detailEntry = useMemo(
    () => (detailEntryId ? logbooks.find((item) => item.id === detailEntryId) || null : null),
    [logbooks, detailEntryId]
  );
  const [showSoapModal, setShowSoapModal] = useState(false);
  const [soapPatientId, setSoapPatientId] = useState('');
  const [soapDate, setSoapDate] = useState(liveTodayDate);
  const [soapS, setSoapS] = useState('');
  const [soapO, setSoapO] = useState('');
  const [soapA, setSoapA] = useState('');
  const [soapP, setSoapP] = useState('');
  const [medicalOrder, setMedicalOrder] = useState('');
  const [saving, setSaving] = useState(false);

  const isNurseView = userProfile?.role === 'Perawat Pelaksana';

  const machineMap = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  // All logbooks (including Draft, Pending, Revision, Approved) matching date/month, patient & search query
  const periodServices = useMemo(() => {
    return logbooks.filter((item) => {
      if (selectedPatientId !== 'ALL' && item.patientId !== selectedPatientId) return false;
      if (dateFilter) {
        if (item.date !== dateFilter) return false;
      } else if (monthFilter && item.monthKey !== monthFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hit =
          item.patientName.toLowerCase().includes(q) ||
          item.patientRm.toLowerCase().includes(q) ||
          item.doctorName.toLowerCase().includes(q) ||
          item.nurseName.toLowerCase().includes(q) ||
          item.machineNumber.toLowerCase().includes(q) ||
          item.nursingNotes.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [logbooks, selectedPatientId, dateFilter, monthFilter, searchTerm]);

  const shiftCounts = useMemo(() => {
    const counts = { Pagi: 0, Siang: 0, Malam: 0 };
    for (const item of periodServices) {
      if (item.shift === 'Pagi' || item.shift === 'Siang' || item.shift === 'Malam') {
        counts[item.shift] += 1;
      }
    }
    return counts;
  }, [periodServices]);

  const hasHistoricalMalam = useMemo(
    () => shiftCounts.Malam > 0 || shiftFilter === 'Malam' || liveCurrentShift === 'Malam',
    [shiftCounts.Malam, shiftFilter, liveCurrentShift]
  );

  const selectedPatientObj = useMemo(
    () => (selectedPatientId !== 'ALL' ? patientMap.get(selectedPatientId) || null : null),
    [selectedPatientId, patientMap]
  );

  const patientTrendSummary = useMemo(() => {
    if (selectedPatientId === 'ALL' || periodServices.length === 0) return null;

    const idwgValues: number[] = [];
    const ufGoals: number[] = [];
    const ufAchieveds: number[] = [];
    const durations: number[] = [];
    const ktvs: number[] = [];
    let complicationCount = 0;
    let lastComplication = '';
    let transfusionCount = 0;
    let epoCount = 0;

    const sortedPeriod = [...periodServices].sort((a, b) => a.date.localeCompare(b.date));
    for (const s of sortedPeriod) {
      const sec3 = s.wizardDetails?.section3;
      const sec4 = s.wizardDetails?.section4;
      const sec6 = s.wizardDetails?.section6;
      const sec7 = s.wizardDetails?.section7;

      if (sec3?.dryWeight && sec3.dryWeight > 0 && s.preWeight > 0) {
        idwgValues.push(s.preWeight - sec3.dryWeight);
      }
      if (s.ufGoal > 0) ufGoals.push(Number(s.ufGoal));
      if (s.ufAchieved >= 0) ufAchieveds.push(Number(s.ufAchieved));

      const parsedDur = sec3?.dialysisDurationHours
        ? Number(String(sec3.dialysisDurationHours).replace(',', '.'))
        : NaN;
      const dur =
        !Number.isNaN(parsedDur) && parsedDur > 0
          ? parsedDur
          : calcDurationHours(s.startTime, s.endTime);
      if (dur !== null) durations.push(dur);

      const parsedKtv = sec6?.ktv ? Number(String(sec6.ktv).replace(',', '.')) : NaN;
      if (!Number.isNaN(parsedKtv) && parsedKtv > 0) ktvs.push(parsedKtv);

      const hasComp =
        (sec4?.complicationIncidents?.length || 0) > 0 ||
        (Boolean(s.complications) &&
          !/^tidak ada\b/i.test(s.complications.trim()) &&
          s.complications.trim() !== '-');
      if (hasComp) {
        complicationCount += 1;
        lastComplication =
          sec4?.complicationIncidents?.[0]?.type || s.complications || 'Komplikasi Intra-HD';
      }
      if (sec7?.transfusionGiven) transfusionCount += 1;
      if (sec7?.epoGiven) epoCount += 1;
    }

    const avgOf = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    return {
      sessionsCount: sortedPeriod.length,
      avgIdwg: avgOf(idwgValues),
      avgUfGoal: avgOf(ufGoals),
      avgUfAchieved: avgOf(ufAchieveds),
      avgDuration: avgOf(durations),
      avgKtv: avgOf(ktvs),
      complicationCount,
      lastComplication,
      transfusionCount,
      epoCount,
    };
  }, [selectedPatientId, periodServices]);

  const shiftFilteredServices = useMemo(() => {
    return periodServices.filter((item) => item.shift === shiftFilter);
  }, [periodServices, shiftFilter]);

  const nurseBreakdown = useMemo(() => {
    const map = new Map<string, { nurseId: string; nurseName: string; count: number }>();
    for (const item of shiftFilteredServices) {
      const existing = map.get(item.nurseId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(item.nurseId, {
          nurseId: item.nurseId,
          nurseName: item.nurseName || 'Perawat HD',
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nurseName.localeCompare(b.nurseName));
  }, [shiftFilteredServices]);

  const filteredServices = useMemo(() => {
    const getBedLabel = (entry: LogbookEntry) =>
      (entry.machineNumber || machineMap.get(entry.machineId)?.machineNumber || '').trim();

    return [...shiftFilteredServices].sort((a, b) => {
      const dCmp = a.date.localeCompare(b.date);
      if (dCmp !== 0) return dCmp;
      const sCmp = (SHIFT_SORT_ORDER[a.shift] || 9) - (SHIFT_SORT_ORDER[b.shift] || 9);
      if (sCmp !== 0) return sCmp;
      const bedA = getBedLabel(a);
      const bedB = getBedLabel(b);
      if (bedA && !bedB) return -1;
      if (!bedA && bedB) return 1;
      const mCmp = bedA.localeCompare(bedB, 'id', { numeric: true, sensitivity: 'base' });
      if (mCmp !== 0) return mCmp;
      const tCmp = a.startTime.localeCompare(b.startTime);
      if (tCmp !== 0) return tCmp;
      return a.patientName.localeCompare(b.patientName);
    });
  }, [shiftFilteredServices, machineMap]);

  const statusBreakdown = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let revision = 0;
    let draft = 0;
    for (const item of filteredServices) {
      if (item.verificationStatus === 'Approved') approved += 1;
      else if (item.verificationStatus === 'Revision') revision += 1;
      else if (item.verificationStatus === 'Draft') draft += 1;
      else pending += 1;
    }
    return { approved, pending, revision, draft };
  }, [filteredServices]);

  const filteredSoap = useMemo(() => {
    return reports.filter((r) => {
      if (r.reportType !== 'patient_care') return false;
      if (selectedPatientId !== 'ALL' && r.patientId !== selectedPatientId) return false;
      if (dateFilter) {
        if (r.date !== dateFilter) return false;
      } else if (monthFilter && r.monthKey !== monthFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hit =
          (r.patientName || '').toLowerCase().includes(q) ||
          (r.soapAssessment || '').toLowerCase().includes(q) ||
          r.authorName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [reports, selectedPatientId, dateFilter, monthFilter, searchTerm]);

  // Build normalized table rows aligned to PDF layout
  const tableRows = useMemo(() => {
    return filteredServices.map((s) => {
      const pat = patientMap.get(s.patientId);
      const mach = machineMap.get(s.machineId);
      const sec2 = s.wizardDetails?.section2;
      const sec3 = s.wizardDetails?.section3;
      const sec4 = s.wizardDetails?.section4;
      const sec6 = s.wizardDetails?.section6;
      const sec7 = s.wizardDetails?.section7;

      const parsedSec3Duration = sec3?.dialysisDurationHours
        ? Number(String(sec3.dialysisDurationHours).replace(',', '.'))
        : NaN;
      const durationHours =
        !Number.isNaN(parsedSec3Duration) && parsedSec3Duration > 0
          ? parsedSec3Duration
          : calcDurationHours(s.startTime, s.endTime);
      const dryWeight = sec3?.dryWeight && sec3.dryWeight > 0 ? sec3.dryWeight : null;
      const qbVal = sec3?.bfr ? Number(sec3.bfr) : null;
      const qdVal = sec3?.dfr ? Number(sec3.dfr) : null;

      const isInpatient =
        sec3?.serviceStatus === 'Rawat Inap' ||
        (sec3?.serviceStatus !== 'Rawat Jalan' &&
          (/icu|bangsal|ranap|rawat inap/i.test(s.patientName) ||
            /rawat inap|cito/i.test(s.actionCategory) ||
            /rawat inap/i.test(pat?.notes || '')));
      const rawStatus = sec3?.serviceStatus || (isInpatient ? 'Rawat Inap' : 'Rawat Jalan');
      const statusRawat =
        rawStatus === 'Rawat Inap' ? 'RI' : rawStatus === 'Rawat Jalan' ? 'RJ' : rawStatus;

      const roomCategory =
        sec3?.patientCategory ||
        mach?.roomZone ||
        (/isolasi/i.test(s.actionCategory) ? s.actionCategory : 'Reguler');

      const bedMachine = s.machineNumber || mach?.machineNumber || '-';

      const accessLabel =
        s.vascularAccess === 'CDL' || s.vascularAccess === 'CVC'
          ? 'CDL'
          : s.vascularAccess === 'Femoral'
          ? 'FEMORAL'
          : s.vascularAccess === 'AV Fistula' || s.vascularAccess === 'AV Shunt'
          ? 'CIMINO'
          : s.vascularAccess || '-';
      const accessNote =
        accessLabel === 'CDL'
          ? sec3?.cdlNote?.trim() || sec3?.accessDetailNote?.trim() || ''
          : accessLabel === 'FEMORAL'
          ? sec3?.femoralNote?.trim() || sec3?.accessDetailNote?.trim() || ''
          : accessLabel === 'CIMINO'
          ? sec3?.ciminoNote?.trim() || sec3?.accessDetailNote?.trim() || ''
          : sec3?.accessDetailNote?.trim() || '';
      const isAccessChecked = s.wizardDetails?.spoChecklist?.['3.6']
        ? s.wizardDetails.spoChecklist['3.6'] === 'DIKERJAKAN'
        : Boolean(s.vascularAccess);
      const vascularAccessLabel = isAccessChecked ? accessLabel : '-';
      const vascularAccessNote = isAccessChecked ? accessNote : '';
      const vascularAccessDisplay = vascularAccessNote
        ? `${vascularAccessLabel} (${vascularAccessNote})`
        : vascularAccessLabel;

      const heparinDisplay =
        sec2?.loadingDose && s.heparinType !== 'Bebas Heparin'
          ? `${s.heparinType} (${sec2.loadingDose})`
          : s.heparinType;

      const hasComplication =
        Boolean(s.complications) &&
        !/^tidak ada\b/i.test(s.complications.trim()) &&
        s.complications.trim() !== '-';

      const structuredIncidents = sec4?.complicationIncidents || [];
      let complicationLines: string[] = [];
      let compTimeLines: string[] = [];
      let dpjpAdviceLines: string[] = [];

      if (structuredIncidents.length > 0) {
        complicationLines = structuredIncidents.map((inc) => {
          const bpVal = inc.bp?.trim();
          const detailVal = inc.clinicalDetail?.trim();
          if (bpVal) return `${inc.type} (TD ${bpVal})`;
          if (detailVal) return `${inc.type} (${detailVal})`;
          return inc.type;
        });
        compTimeLines = structuredIncidents.map((inc) => inc.time?.trim() || s.endTime || '-');
        const hasAnyAdvice = structuredIncidents.some((inc) => Boolean(inc.doctorAdvice?.trim()));
        dpjpAdviceLines = hasAnyAdvice
          ? structuredIncidents.map((inc) => inc.doctorAdvice?.trim() || '-')
          : [s.nursingNotes?.trim() || '-'];
      } else if (hasComplication) {
        const raw = s.complications.trim();
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

        complicationLines = splitItems.length > 0 ? splitItems : [raw];
        compTimeLines = [s.endTime || '-'];
        const rawAdvice = (sec4?.effectiveCommunicationNotes?.trim() || s.nursingNotes?.trim() || '-');
        const adviceSplit = rawAdvice
          .split(/\s*[;\n]+\s*/)
          .map((item) => item.trim())
          .filter(Boolean);
        dpjpAdviceLines = adviceSplit.length > 1 ? adviceSplit : [rawAdvice];
      } else {
        complicationLines = ['Tidak ada'];
        compTimeLines = ['-'];
        dpjpAdviceLines = ['-'];
      }

      const compTime = compTimeLines.join(', ');
      const dpjpAdviceDisplay = dpjpAdviceLines.join('; ');

      const transfusionGiven = sec7 ? sec7.transfusionGiven : null;
      const transfusionParts: string[] = [];
      if (sec7?.transfusionGiven) {
        if (sec7.transfusionComponent?.trim()) {
          const countPart = sec7.transfusionBagCount?.trim() ? ` ${sec7.transfusionBagCount.trim()} kolf` : '';
          transfusionParts.push(`${sec7.transfusionComponent.trim()}${countPart}`);
        } else if (sec7.transfusionBagCount?.trim()) {
          transfusionParts.push(`${sec7.transfusionBagCount.trim()} kolf`);
        }
        if (sec7.transfusionBloodGroup?.trim()) {
          transfusionParts.push(`Gol. ${sec7.transfusionBloodGroup.trim()}`);
        }
        if (sec7.transfusionVolumeMl?.trim()) {
          transfusionParts.push(sec7.transfusionVolumeMl.trim());
        }
        if (sec7.transfusionBagNumber?.trim()) {
          transfusionParts.push(`No. ${sec7.transfusionBagNumber.trim()}`);
        }
        if (sec7.transfusionReaction?.trim() && sec7.transfusionReaction.trim() !== 'Tidak Ada Reaksi') {
          transfusionParts.push(`Reaksi: ${sec7.transfusionReaction.trim()}`);
        }
        if (sec7.transfusionNote?.trim()) {
          transfusionParts.push(sec7.transfusionNote.trim());
        }
      }
      const transfusionNote = transfusionParts.join(' · ');
      const transfusionDisplay =
        transfusionGiven === null
          ? '-'
          : transfusionGiven
          ? transfusionNote
            ? `Ya (${transfusionNote})`
            : 'Ya'
          : 'Tidak';

      const epoGiven = sec7 ? sec7.epoGiven : null;
      const epoParts: string[] = [];
      if (sec7?.epoGiven) {
        const prepDose = [sec7.epoPreparation?.trim(), sec7.epoDose?.trim()].filter(Boolean).join(' ');
        if (prepDose) epoParts.push(prepDose);
        if (sec7.epoRoute?.trim()) epoParts.push(sec7.epoRoute.trim());
        if (sec7.epoNote?.trim()) epoParts.push(sec7.epoNote.trim());
      }
      const epoNote = epoParts.join(' · ');
      const epoDisplay =
        epoGiven === null ? '-' : epoGiven ? (epoNote ? `Ya (${epoNote})` : 'Ya') : 'Tidak';

      return {
        entry: s,
        statusRawat,
        roomCategory,
        bedMachine,
        vascularAccessLabel,
        vascularAccessNote,
        vascularAccessDisplay,
        durationHours,
        dryWeight,
        qbVal: qbVal && !Number.isNaN(qbVal) ? qbVal : null,
        qdVal: qdVal && !Number.isNaN(qdVal) ? qdVal : null,
        heparinDisplay,
        ktvDisplay: sec6?.ktv?.trim() || '-',
        hasComplication,
        complicationLines,
        compTimeLines,
        dpjpAdviceLines,
        compTime,
        dpjpAdviceDisplay,
        transfusionGiven,
        transfusionNote,
        transfusionDisplay,
        epoGiven,
        epoNote,
        epoDisplay,
      };
    });
  }, [filteredServices, patientMap, machineMap]);

  // Summary row ("TOTAL & RATA-RATA")
  const summaryStats = useMemo(() => {
    if (tableRows.length === 0) return null;
    const avg = (nums: (number | null)[]) => {
      const valid = nums.filter((n): n is number => n !== null && !Number.isNaN(n));
      if (valid.length === 0) return null;
      return valid.reduce((a, b) => a + b, 0) / valid.length;
    };

    const avgDurasi = avg(tableRows.map((r) => r.durationHours));
    const avgDry = avg(tableRows.map((r) => r.dryWeight));
    const avgPreW = avg(tableRows.map((r) => r.entry.preWeight));
    const avgPostW = avg(tableRows.map((r) => r.entry.postWeight));
    const avgQb = avg(tableRows.map((r) => r.qbVal));
    const avgQd = avg(tableRows.map((r) => r.qdVal));
    const totalTargetUf = tableRows.reduce((acc, r) => acc + (Number(r.entry.ufGoal) || 0), 0);
    const totalAchievedUf = tableRows.reduce(
      (acc, r) => acc + (Number(r.entry.ufAchieved) || 0),
      0
    );

    const transfusionCount = tableRows.filter((r) => r.transfusionGiven === true).length;
    const epoCount = tableRows.filter((r) => r.epoGiven === true).length;

    return {
      avgDurasi,
      avgDry,
      avgPreW,
      avgPostW,
      avgQb,
      avgQd,
      totalTargetUf,
      totalAchievedUf,
      transfusionCount,
      epoCount,
    };
  }, [tableRows]);

  // Dynamic Header Metadata (matching PDF banner)
  const bannerMeta = useMemo(() => {
    const kaRuang =
      staffDirectory.find((s) => s.isActive && s.role === 'Kepala Ruang')?.fullName ||
      'Kepala Ruang HD';
    const assignedPjBanner = dateFilter
      ? pjShiftAssignments.find((a) => a.date === dateFilter && a.shift === shiftFilter)
          ?.pjNurseName || ''
      : '';
    const pjFromEntries = filteredServices.find((s) => s.targetVerifierRole === 'PJ Shift')
      ?.targetVerifierName;
    const pjShift =
      assignedPjBanner ||
      pjFromEntries ||
      staffDirectory.find((s) => s.isActive && s.role === 'PJ Shift')?.fullName ||
      'PJ Shift HD';

    const uniqueDoctors = Array.from(
      new Set(filteredServices.map((s) => s.doctorName).filter(Boolean))
    );
    const dpjpLabel =
      uniqueDoctors.length === 0
        ? '-'
        : uniqueDoctors.length === 1
        ? uniqueDoctors[0]
        : `${uniqueDoctors[0]} (+${uniqueDoctors.length - 1} DPJP lainnya)`;

    const dateLabel = dateFilter
      ? formatFullDayDateId(dateFilter)
      : monthFilter
      ? `Periode ${formatMonthLabel(monthFilter)}`
      : 'Semua Periode';

    return {
      shiftLabel: getShiftRangeLabel(shiftFilter),
      dateLabel,
      pjShift,
      dpjpLabel,
      kaRuang,
    };
  }, [
    staffDirectory,
    pjShiftAssignments,
    filteredServices,
    dateFilter,
    monthFilter,
    shiftFilter,
  ]);

  const handleOpenSoapModal = () => {
    setSoapPatientId(selectedPatientId !== 'ALL' ? selectedPatientId : patients[0]?.id || '');
    setSoapDate(liveTodayDate);
    setSoapS('');
    setSoapO('');
    setSoapA('');
    setSoapP('');
    setMedicalOrder('');
    setShowSoapModal(true);
  };

  const handleSaveSoap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const pat = patients.find((p) => p.id === soapPatientId);
    if (!pat) return;

    setSaving(true);
    try {
      await insertRow(
        'reports',
        toReportRow({
          id: generateRecordId(),
          reportType: 'patient_care',
          date: soapDate,
          monthKey: soapDate.slice(0, 7),
          authorId: userProfile.uid,
          authorName: clampString(userProfile.fullName, 120),
          authorRole: userProfile.role,
          patientId: pat.id,
          patientName: clampString(pat.fullName, 120),
          patientRm: clampString(pat.mrn, 40),
          soapSubjective: clampString(soapS || '-', 800),
          soapObjective: clampString(soapO || '-', 800),
          soapAssessment: clampString(soapA || '-', 800),
          soapPlan: clampString(soapP || '-', 800),
          medicalOrder: clampString(medicalOrder || '-', 800),
        })
      );
      setShowSoapModal(false);
      showToast(`Catatan SOAP ${pat.fullName} berhasil disimpan.`, 'success');
    } catch (err) {
      showToast('Gagal menyimpan catatan SOAP pasien.', 'error');
      handleDbError(err, OperationType.CREATE, 'reports');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    exportToCsv(
      `logbook-detail-pasien-${dateFilter || monthFilter || 'semua'}.csv`,
      [
        'NO. BED / MESIN',
        'TANGGAL',
        'SHIFT',
        'NAMA LENGKAP PASIEN / NO. RM',
        'STATUS',
        'RUANG',
        'AKSES VASKULAR',
        'DURASI (JAM)',
        'BB PRE HD (KG)',
        'BB POST HD (KG)',
        'BB KERING (KG)',
        'QB (ML/M)',
        'QD (ML/M)',
        'HEPARIN',
        'TARGET UF (ML)',
        'KT/V',
        'CAPAIAN UF (ML)',
        'TD PRE (MMHG)',
        'TD POST (MMHG)',
        'KOMPLIKASI INTRA-HD',
        'JAM KOMPLIKASI',
        'TINDAKAN & ADVIS MEDIS DPJP',
        'TRANSFUSI',
        'EPO',
        'PERAWAT PELAKSANA',
        'DOKTER DPJP',
        'STATUS VERIFIKASI',
      ],
      tableRows.map((r) => [
        r.bedMachine,
        r.entry.date,
        r.entry.shift,
        `${r.entry.patientName} (${r.entry.patientRm})`,
        r.statusRawat,
        r.roomCategory,
        r.vascularAccessDisplay,
        r.durationHours !== null ? r.durationHours : '-',
        r.entry.preWeight,
        r.entry.postWeight,
        r.dryWeight !== null ? r.dryWeight : '-',
        r.qbVal !== null ? r.qbVal : '-',
        r.qdVal !== null ? r.qdVal : '-',
        r.heparinDisplay,
        r.entry.ufGoal,
        r.ktvDisplay,
        r.entry.ufAchieved,
        r.entry.preBp,
        r.entry.postBp,
        r.complicationLines.join('\n'),
        r.compTimeLines.join('\n'),
        r.dpjpAdviceLines.join('\n'),
        r.transfusionDisplay,
        r.epoDisplay,
        r.entry.nurseName,
        r.entry.doctorName,
        formatVerificationStatusLabel(r.entry.verificationStatus),
      ])
    );
    showToast(`Laporan detail pasien (${tableRows.length} baris) diekspor ke CSV.`, 'success');
  };

  const handleDownloadPatientPdf = () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const pdfMeta = {
        ...bannerMeta,
        nurseCount: nurseBreakdown.length,
      };
      if (activeTab === 'soap') {
        exportPatientSoapPdf({
          notes: filteredSoap,
          meta: pdfMeta,
          filename: `${printDocumentTitle}-SOAP`,
        });
      } else {
        exportPatientServicesPdf({
          rows: tableRows,
          summaryStats,
          meta: pdfMeta,
          filename: printDocumentTitle,
        });
      }
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-4 print:space-y-0">
      {/* Top Toolbar */}
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            {isNurseView
              ? 'Laporan Detail Pelayanan & Perkembangan Pasien'
              : 'Laporan Pasien: Detail Pelayanan Asuhan Keperawatan & Medis'}
          </h2>
          <p className="text-xs text-slate-500">
            Rekapitulasi detail asuhan keperawatan dan medis pasien per shift, lengkap dengan ekspor tabel dan catatan SOAP.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            title="Cetak Langsung (F4 Landscape - 1 Halaman Penuh)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Printer className="h-4 w-4" />
            Cetak
          </button>
          <button
            type="button"
            onClick={handleDownloadPatientPdf}
            disabled={downloadingPdf}
            title={`Unduh PDF (${printDocumentTitle}.pdf)`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
          >
            <FileDown className="h-4 w-4" />
            {downloadingPdf ? 'Membuat PDF...' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-4 w-4" />
            Ekspor CSV
          </button>
          {userProfile?.role !== 'Managerial' && (
            <button
              type="button"
              onClick={handleOpenSoapModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              Tambah Catatan SOAP
            </button>
          )}
        </div>
      </div>

      {archiveLoading && (
        <div className="no-print rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-[#0B5A8E]">
          Memuat arsip laporan pelayanan pasien...
        </div>
      )}

      {/* Filters */}
      <div className="no-print rounded-xl border border-slate-200 bg-white p-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label
            htmlFor="patient-report-patient"
            className="block text-[11px] font-semibold text-slate-600 mb-1"
          >
            Pasien
          </label>
          <select
            id="patient-report-patient"
            aria-label="Filter Pasien"
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
          >
            <option value="ALL">Semua Pasien Hemodialisa</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} ({p.mrn}){p.patientType === 'Non-Reguler' ? ' [Non-Reguler]' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="patient-report-month"
            className="block text-[11px] font-semibold text-slate-600 mb-1"
          >
            Bulan
          </label>
          <input
            id="patient-report-month"
            type="month"
            aria-label="Filter Bulan"
            value={monthFilter}
            onChange={(e) => {
              setMonthFilter(e.target.value);
              setDateFilter('');
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="patient-report-date"
            className="block text-[11px] font-semibold text-slate-600 mb-1"
          >
            Tanggal Dinas
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="patient-report-date"
              type="date"
              aria-label="Filter Tanggal Spesifik"
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
                title="Kembali ke hari aktif"
              >
                Hari Ini
              </button>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="patient-report-search"
            className="block text-[11px] font-semibold text-slate-600 mb-1"
          >
            Pencarian
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="patient-report-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari pasien, RM, perawat, mesin..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Patient Clinical Trend Summary Card (shown when filtering 1 patient) */}
      {selectedPatientObj && (
        <div className="no-print rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Ringkasan Tren Klinis: {selectedPatientObj.fullName}{' '}
                <span className="font-mono font-normal text-slate-500">
                  ({selectedPatientObj.mrn})
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Periode{' '}
                {dateFilter
                  ? formatDateId(dateFilter)
                  : monthFilter
                  ? formatMonthLabel(monthFilter)
                  : 'Semua Waktu'}{' '}
                · Akses: {selectedPatientObj.vascularAccess} · Jadwal:{' '}
                {selectedPatientObj.routineSchedule}
              </p>
            </div>
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0B5A8E] hover:bg-sky-50"
              >
                Lihat Tren 1 Bulan ({formatMonthLabel(monthFilter)})
              </button>
            )}
          </div>

          {!patientTrendSummary ? (
            <p className="text-xs text-slate-500">
              Belum ada sesi dialisis tercatat untuk {selectedPatientObj.fullName} pada periode ini.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
              <div>
                <p className="text-[11px] text-slate-500">Jumlah Sesi</p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                  {patientTrendSummary.sessionsCount} Sesi
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Rata-rata IDWG</p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                  {patientTrendSummary.avgIdwg !== null
                    ? `${patientTrendSummary.avgIdwg >= 0 ? '+' : ''}${formatNumId(
                        patientTrendSummary.avgIdwg,
                        1
                      )} kg`
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Rata-rata UF / Target</p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                  {patientTrendSummary.avgUfAchieved !== null
                    ? `${formatIntId(patientTrendSummary.avgUfAchieved)} / ${formatIntId(
                        patientTrendSummary.avgUfGoal
                      )} ml`
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Durasi &amp; Kt/V</p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                  {patientTrendSummary.avgDuration !== null
                    ? `${formatNumId(patientTrendSummary.avgDuration, 1)} jam`
                    : '-'}{' '}
                  ·{' '}
                  {patientTrendSummary.avgKtv !== null
                    ? formatNumId(patientTrendSummary.avgKtv, 2)
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Komplikasi Intra-HD</p>
                <p
                  className={`mt-0.5 font-mono font-bold tabular-nums ${
                    patientTrendSummary.complicationCount > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {patientTrendSummary.complicationCount > 0
                    ? `${patientTrendSummary.complicationCount}x (${patientTrendSummary.lastComplication})`
                    : 'Nihil'}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Transfusi &amp; EPO</p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums">
                  {patientTrendSummary.transfusionCount} Transfusi · {patientTrendSummary.epoCount}{' '}
                  EPO
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Shift Switcher & Contributing Nurses Summary */}
      {activeTab === 'services' && (
        <div className="no-print rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
              {(
                [
                  { id: 'Pagi', label: 'Shift Pagi', count: shiftCounts.Pagi },
                  { id: 'Siang', label: 'Shift Siang', count: shiftCounts.Siang },
                  ...(hasHistoricalMalam
                    ? [{ id: 'Malam' as const, label: 'Shift Malam', count: shiftCounts.Malam }]
                    : []),
                ] as const
              ).map((opt) => {
                const active = shiftFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setHasManualShift(true);
                      setShiftFilter(opt.id);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}{' '}
                    <span className="font-mono tabular-nums text-[11px] text-slate-500">
                      ({opt.count})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
              <span>
                Total:{' '}
                <strong className="text-slate-900">{filteredServices.length} logbook</strong>
              </span>
              <span>
                Perawat:{' '}
                <strong className="text-slate-900">{nurseBreakdown.length} orang</strong>
              </span>
              <span className="text-emerald-700">
                Approved: <strong>{statusBreakdown.approved}</strong>
              </span>
              <span className="text-amber-700">
                Menunggu Verifikasi: <strong>{statusBreakdown.pending}</strong>
              </span>
              {statusBreakdown.draft > 0 && (
                <span className="text-slate-600">
                  Draft: <strong>{statusBreakdown.draft}</strong>
                </span>
              )}
              {statusBreakdown.revision > 0 && (
                <span className="text-rose-700">
                  Revisi: <strong>{statusBreakdown.revision}</strong>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="no-print flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('services')}
          className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === 'services' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Tabel Logbook Detail Pasien ({tableRows.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('soap')}
          className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            activeTab === 'soap' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Catatan Perkembangan SOAP ({filteredSoap.length})
        </button>
      </div>

      {activeTab === 'services' ? (
        <div
          ref={sheetRef}
          className="f4-print-sheet f4-patient-landscape rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden"
        >
          {/* Dark Clinical Banner Matching PDF */}
          <div className="f4-banner bg-[#0e3a53] px-4 py-3 text-white border-b border-slate-700">
            <h3 className="font-display text-xs sm:text-sm font-bold tracking-wide uppercase">
              LOGBOOK DETAIL PELAYANAN ASUHAN KEPERAWATAN &amp; MEDIS PASIEN HEMODIALISIS
            </h3>
            <p className="mt-1 text-[11px] text-sky-100 leading-relaxed">
              <span className="font-semibold">Shift:</span> {bannerMeta.shiftLabel} &nbsp;|&nbsp;{' '}
              <span className="font-semibold">Hari/Tanggal:</span> {bannerMeta.dateLabel}{' '}
              &nbsp;|&nbsp; <span className="font-semibold">PJ Shift:</span> {bannerMeta.pjShift}{' '}
              &nbsp;|&nbsp; <span className="font-semibold">DPJP:</span> {bannerMeta.dpjpLabel}{' '}
              &nbsp;|&nbsp; <span className="font-semibold">Ka. Ruang:</span> {bannerMeta.kaRuang}{' '}
              &nbsp;|&nbsp; <span className="font-semibold">Total Logbook:</span>{' '}
              {tableRows.length} pasien ({nurseBreakdown.length} perawat)
            </p>
          </div>

          {tableRows.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Belum ada logbook yang diinput perawat untuk tanggal dan shift yang dipilih.
            </div>
          ) : (
            <div className="f4-scroll-wrap max-h-[70vh] overflow-auto">
              <table className="w-full table-auto border-collapse text-[11px] text-slate-800">
                <thead className="sticky top-0 z-20">
                  {/* Row 1: Grouped Category Headers */}
                  <tr className="bg-[#1b4f6e] text-white text-[10px] uppercase tracking-wider leading-tight">
                    <th
                      rowSpan={2}
                      className="w-[72px] min-w-[72px] max-w-[72px] md:sticky md:left-0 z-30 bg-[#1b4f6e] border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-normal"
                    >
                      NO. BED / MESIN
                    </th>
                    <th
                      rowSpan={2}
                      className="w-[172px] min-w-[172px] max-w-[192px] md:sticky md:left-[72px] z-30 bg-[#1b4f6e] md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] border border-[#2d6687] px-2 py-2 text-left font-bold whitespace-normal"
                    >
                      NAMA PASIEN / NO. RM
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      STATUS &amp; RUANG
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      PENGATURAN TEKNIS &amp; PRE-HD
                    </th>
                    <th
                      colSpan={6}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      PARAMETER BERAT BADAN &amp; ALIRAN
                    </th>
                    <th
                      colSpan={3}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      MONITORING ULTRAFILTRASI &amp; ADEKUASI
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      TANDA VITAL (HEMODINAMIK)
                    </th>
                    <th
                      colSpan={3}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      KOMPLIKASI, TATALAKSANA &amp; ADVIS DPJP
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-normal"
                    >
                      TRANSFUSI &amp; EPO
                    </th>
                    <th
                      rowSpan={2}
                      className="border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-normal"
                    >
                      PERAWAT PELAKSANA
                    </th>
                    <th
                      rowSpan={2}
                      className="no-print border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-normal"
                    >
                      STATUS
                    </th>
                    <th
                      rowSpan={2}
                      className="no-print border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-normal"
                    >
                      AKSI
                    </th>
                  </tr>

                  {/* Row 2: Specific Sub-Columns */}
                  <tr className="bg-[#236084] text-white text-[9.5px] uppercase tracking-wide leading-tight">
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      Status
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      RUANG
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-left font-semibold whitespace-normal">
                      AKSES VASKULAR
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      DURASI (JAM)
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      BB PRE HD (KG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      BB POST HD (KG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      BB KERING (KG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      QB (ML/M)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      QD (ML/M)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-left font-semibold whitespace-normal">
                      HEPARIN
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      TARGET UF (ML)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      KT/V
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      CAPAIAN UF (ML)
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      TD PRE (MMHG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      TD POST (MMHG)
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-left font-semibold whitespace-normal">
                      KOMPLIKASI INTRA-HD
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      JAM
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-left font-semibold whitespace-normal">
                      TINDAKAN &amp; ADVIS MEDIS DPJP
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      TRANSFUSI
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-normal">
                      EPO
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {tableRows.map((row, rowIdx) => {
                    const s = row.entry;
                    const isIsolasi = /isolasi|hep/i.test(row.roomCategory);
                    const stickyBg = rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50';

                    return (
                      <tr
                        key={s.id}
                        className={`${stickyBg} hover:bg-sky-50/60 transition-colors`}
                      >
                        {/* NO. BED / MESIN (Kolom Paling Kiri) */}
                        <td
                          className={`f4-col-fit w-[72px] min-w-[72px] max-w-[72px] md:sticky md:left-0 z-10 ${stickyBg} border border-slate-200 px-2 py-2 text-center font-mono font-semibold whitespace-nowrap`}
                        >
                          {row.bedMachine}
                        </td>

                        {/* DATA IDENTITAS & STATUS PASIEN */}
                        <td
                          className={`f4-col-fit w-[172px] min-w-[172px] max-w-[192px] md:sticky md:left-[72px] z-10 ${stickyBg} md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] border border-slate-200 px-2 py-2 whitespace-normal break-words`}
                        >
                          <div className="font-medium text-slate-900">{s.patientName}</div>
                          <div className="f4-patient-sub font-mono text-[10px] text-slate-500 tabular-nums">
                            {s.patientRm}
                          </div>
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-semibold whitespace-nowrap">
                          {row.statusRawat}
                        </td>
                        <td
                          className={`f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center whitespace-nowrap ${
                            isIsolasi ? 'font-bold text-slate-900' : ''
                          }`}
                        >
                          {row.roomCategory}
                        </td>

                        {/* PENGATURAN TEKNIS & PRE-HD */}
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{row.vascularAccessLabel}</div>
                          {row.vascularAccessNote && (
                            <div className="f4-patient-sub text-[10px] text-slate-500">
                              {row.vascularAccessNote}
                            </div>
                          )}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(row.durationHours, 1)}
                        </td>

                        {/* PARAMETER BERAT BADAN & ALIRAN + HEPARIN */}
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(s.preWeight, 1)}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(s.postWeight, 1)}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(row.dryWeight, 1)}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {row.qbVal !== null ? formatIntId(row.qbVal) : '-'}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {row.qdVal !== null ? formatIntId(row.qdVal) : '-'}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 whitespace-nowrap">
                          {row.heparinDisplay}
                        </td>

                        {/* MONITORING ULTRAFILTRASI & ADEKUASI */}
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatIntId(s.ufGoal)}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap text-slate-700">
                          {row.ktvDisplay}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatIntId(s.ufAchieved)}
                        </td>

                        {/* TANDA VITAL */}
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.preBp || '-'}
                        </td>
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.postBp || '-'}
                        </td>

                        {/* KOMPLIKASI, TATALAKSANA & ADVIS DPJP */}
                        <td
                          className={`f4-col-flex border border-slate-200 px-2 py-2 align-top whitespace-normal break-words ${
                            row.hasComplication ? 'font-bold text-rose-700 bg-rose-50/70' : ''
                          }`}
                        >
                          {row.complicationLines.length > 1 ? (
                            <div className="space-y-1">
                              {row.complicationLines.map((line, lineIdx) => (
                                <div
                                  key={`${s.id}-comp-${lineIdx}`}
                                  className={
                                    lineIdx > 0 ? 'border-t border-rose-200/80 pt-1' : undefined
                                  }
                                >
                                  {lineIdx + 1}. {line}
                                </div>
                              ))}
                            </div>
                          ) : (
                            row.complicationLines[0]
                          )}
                        </td>
                        <td
                          className={`f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center font-mono tabular-nums align-top whitespace-nowrap ${
                            row.hasComplication ? 'font-bold text-rose-700 bg-rose-50/70' : ''
                          }`}
                        >
                          {row.compTimeLines.length > 1 ? (
                            <div className="space-y-1">
                              {row.compTimeLines.map((tLine, lineIdx) => (
                                <div
                                  key={`${s.id}-ctime-${lineIdx}`}
                                  className={
                                    lineIdx > 0 ? 'border-t border-rose-200/80 pt-1' : undefined
                                  }
                                >
                                  {tLine}
                                </div>
                              ))}
                            </div>
                          ) : (
                            row.compTimeLines[0]
                          )}
                        </td>
                        <td className="f4-col-flex border border-slate-200 px-2 py-2 align-top whitespace-normal break-words">
                          {row.dpjpAdviceLines.length > 1 ? (
                            <div className="space-y-1">
                              {row.dpjpAdviceLines.map((adv, lineIdx) => (
                                <div
                                  key={`${s.id}-adv-${lineIdx}`}
                                  className={
                                    lineIdx > 0 ? 'border-t border-slate-200/80 pt-1' : undefined
                                  }
                                >
                                  {lineIdx + 1}. {adv}
                                </div>
                              ))}
                            </div>
                          ) : (
                            row.dpjpAdviceLines[0]
                          )}
                        </td>

                        {/* TRANSFUSI & EPO */}
                        <td
                          className={`f4-col-flex border border-slate-200 px-2 py-2 text-center align-top whitespace-normal break-words ${
                            row.transfusionGiven === true ? 'bg-rose-50/50' : ''
                          }`}
                        >
                          {row.transfusionGiven === null ? (
                            <span className="text-slate-400">-</span>
                          ) : row.transfusionGiven ? (
                            <div>
                              <span className="font-semibold text-rose-700">Ya</span>
                              {row.transfusionNote && (
                                <div className="f4-patient-sub text-[10px] text-slate-600 mt-0.5">
                                  {row.transfusionNote}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600">Tidak</span>
                          )}
                        </td>
                        <td
                          className={`f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center align-top whitespace-nowrap ${
                            row.epoGiven === true ? 'bg-teal-50/50' : ''
                          }`}
                        >
                          {row.epoGiven === null ? (
                            <span className="text-slate-400">-</span>
                          ) : row.epoGiven ? (
                            <div>
                              <span className="font-semibold text-teal-700">Ya</span>
                              {row.epoNote && (
                                <div className="f4-patient-sub text-[10px] text-slate-600 mt-0.5 whitespace-normal">
                                  {row.epoNote}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600">Tidak</span>
                          )}
                        </td>

                        {/* PERAWAT PELAKSANA */}
                        <td className="f4-col-fit w-[1%] border border-slate-200 px-2 py-2 whitespace-nowrap">
                          <div className="font-medium text-slate-900">{s.nurseName}</div>
                          <div className="f4-patient-sub text-[10px] font-mono text-slate-500">
                            Shift {s.shift}
                          </div>
                        </td>

                        {/* STATUS VERIFIKASI */}
                        <td className="no-print f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          <VerificationBadge status={s.verificationStatus} />
                        </td>

                        {/* DETAIL BUTTON */}
                        <td className="no-print f4-col-fit w-[1%] border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailEntryId(s.id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                            title="Lihat Detail Lengkap 8 Bagian"
                          >
                            <Eye className="h-3 w-3" />
                            Detail
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {summaryStats && (
                  <tfoot>
                    <tr className="bg-slate-100 font-bold text-slate-900">
                      <td
                        colSpan={2}
                        className="md:sticky md:left-0 z-10 bg-slate-100 md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] border border-slate-300 px-2 py-2 text-center uppercase tracking-wide whitespace-nowrap"
                      >
                        TOTAL &amp; RATA-RATA
                      </td>
                      <td
                        colSpan={3}
                        className="f4-col-fit border border-slate-300 px-2 py-2 text-center text-[10px] font-semibold text-slate-500 whitespace-nowrap"
                      >
                        Ringkasan Shift
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {formatNumId(summaryStats.avgDurasi, 1)}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {formatNumId(summaryStats.avgPreW, 1)}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {formatNumId(summaryStats.avgPostW, 1)}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {formatNumId(summaryStats.avgDry, 1)}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {summaryStats.avgQb !== null ? formatIntId(summaryStats.avgQb) : '-'}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {summaryStats.avgQd !== null ? formatIntId(summaryStats.avgQd) : '-'}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {formatIntId(summaryStats.totalTargetUf)}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        -
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {formatIntId(summaryStats.totalAchievedUf)}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                      <td className="f4-col-flex border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                      <td className="f4-col-flex border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="f4-col-flex border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {summaryStats.transfusionCount > 0 ? `${summaryStats.transfusionCount} Ya` : '-'}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                        {summaryStats.epoCount > 0 ? `${summaryStats.epoCount} Ya` : '-'}
                      </td>
                      <td className="f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                      <td className="no-print f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                      <td className="no-print f4-col-fit w-[1%] border border-slate-300 px-2 py-2 text-center whitespace-nowrap">-</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      ) : (
        <div ref={sheetRef} className="f4-print-sheet f4-patient-landscape space-y-3">
          {filteredSoap.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
              Belum ada catatan perkembangan SOAP untuk periode ini.
            </div>
          ) : (
            <div className="f4-soap-grid space-y-3">
              {filteredSoap.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      {r.patientName}{' '}
                      <span className="font-mono font-normal text-slate-500">({r.patientRm})</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      {formatDateId(r.date)} · Dicatat oleh {r.authorName} ({r.authorRole})
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <span className="font-semibold text-slate-800">S (Subjektif):</span>
                    <p className="mt-1 text-slate-600">{r.soapSubjective}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <span className="font-semibold text-slate-800">O (Objektif):</span>
                    <p className="mt-1 text-slate-600">{r.soapObjective}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <span className="font-semibold text-slate-800">A (Asesmen):</span>
                    <p className="mt-1 text-slate-600">{r.soapAssessment}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <span className="font-semibold text-slate-800">P (Plan / Intervensi):</span>
                    <p className="mt-1 text-slate-600">{r.soapPlan}</p>
                  </div>
                </div>
                {r.medicalOrder && r.medicalOrder !== '-' && (
                  <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                    <strong>Instruksi / Order Medis DPJP: </strong>
                    {r.medicalOrder}
                  </div>
                )}
              </div>
            ))}
            </div>
          )}
        </div>
      )}

      {/* Logbook Detail 8-Part Modal */}
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

      {/* Modal Add SOAP Note */}
      {showSoapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                Tambah Catatan Perkembangan Pasien (SOAP)
              </h3>
              <button
                type="button"
                onClick={() => setShowSoapModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSoap} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pasien</label>
                  <select
                    required
                    value={soapPatientId}
                    onChange={(e) => setSoapPatientId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#0B5A8E] focus:outline-none"
                  >
                    <option value="">-- Pilih Pasien --</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} ({p.mrn})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tanggal</label>
                  <input
                    type="date"
                    required
                    value={soapDate}
                    onChange={(e) => setSoapDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-[#0B5A8E] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Subjektif (Keluhan Pasien)
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={soapS}
                    onChange={(e) => setSoapS(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Objektif (TTV, Lab, Akses)
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={soapO}
                    onChange={(e) => setSoapO(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Asesmen Keperawatan</label>
                  <textarea
                    rows={3}
                    required
                    value={soapA}
                    onChange={(e) => setSoapA(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Plan / Intervensi</label>
                  <textarea
                    rows={3}
                    required
                    value={soapP}
                    onChange={(e) => setSoapP(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Instruksi Medis DPJP</label>
                <input
                  type="text"
                  value={medicalOrder}
                  onChange={(e) => setMedicalOrder(e.target.value)}
                  placeholder="Contoh: Lanjut jadwal HD 2x/minggu, evaluasi Hb berkala"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowSoapModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0B5A8E] px-5 py-2 font-semibold text-white hover:bg-[#094a75] disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Catatan SOAP'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

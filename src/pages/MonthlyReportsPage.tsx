import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Lock,
  Printer,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { useF4OnePagePrint } from '../hooks/useF4OnePagePrint';
import {
  MONTH_NAMES_ID,
  clampString,
  exportToCsv,
  formatDateId,
  formatMonthLabel,
  getDaysInMonth,
} from '../lib/formatters';
import { LogbookDetailModal } from '../components/logbook/LogbookDetailModal';
import { ShiftBadge, VerificationBadge } from '../components/ui/StatusBadge';
import {
  DEFAULT_LOGBOOK_TEMPLATE,
  formatTtvSummary,
  hasAnyTtvValue,
  mergeWithDefaultTemplate,
} from '../lib/logbookTemplate';
import type {
  CustomLogbookField,
  LogbookEntry,
  LogbookFormTemplate,
  ReportEntry,
  StaffDirectoryEntry,
  UserRole,
} from '../types';

interface MonthlyReportsPageProps {
  logbooks: LogbookEntry[];
  staffDirectory: StaffDirectoryEntry[];
  reports?: ReportEntry[];
  formTemplate?: LogbookFormTemplate;
}

interface MonthlyCustomMetricRow {
  key: string;
  no: string;
  category: string;
  description: string;
  standard: string;
  dailyDisplay: string[];
  dailyTitles: string[];
  totalDisplay: string;
  pctDisplay: string;
  keterangan: string;
}

interface MonthlySpoRow {
  id: string;
  category: string;
  description: string;
  standard: string;
}

interface MonthlySpoSection {
  title: string;
  maxMode: 'daily_cap_1' | 'per_patient';
  items: MonthlySpoRow[];
}

// Static default sections/items now superseded dynamically inside MonthlyReportsPage via mergeWithDefaultTemplate(formTemplate)

function isSpoPointDone(entry: LogbookEntry, pointId: string): boolean {
  const checklist = entry.wizardDetails?.spoChecklist;
  if (checklist && Object.prototype.hasOwnProperty.call(checklist, pointId)) {
    return checklist[pointId] === 'DIKERJAKAN';
  }
  const wd = entry.wizardDetails;
  if (!wd) {
    return entry.verificationStatus === 'Approved';
  }
  switch (pointId) {
    case '1.1':
      return Boolean(wd.section1?.roAdequate);
    case '1.2':
      return Boolean(wd.section1?.infectionZoneChecked);
    case '1.3':
      return Boolean(
        wd.section1?.aedReady && wd.section1?.oxygenReady && wd.section1?.emergencyDrugsReady
      );
    case '2.1':
      return Boolean(wd.section2?.apdMask || wd.section2?.apdGloves);
    case '2.2':
      return Boolean(wd.section2?.leakTestPassed);
    case '2.3':
      return Boolean(wd.section2?.bloodlineIntegrity);
    case '2.4':
      return Boolean(wd.section2?.dialysateTemp);
    case '2.5':
      return Boolean(wd.section2?.primingDone);
    case '2.6':
      return Boolean(wd.section2?.anticoagulantType);
    case '3.1':
      return Boolean(entry.patientName && entry.patientRm);
    case '3.2':
      return Boolean(entry.preWeight > 0);
    case '3.3':
      return Boolean(entry.preBp);
    case '3.4':
      return Boolean(wd.section3?.informedConsent);
    case '3.5':
      return Boolean(entry.ufGoal >= 0 && wd.section3?.bfr);
    case '3.6':
      return Boolean(wd.section3?.cannulationDone);
    case '4.1':
      return Boolean((wd.section4?.observations?.length || 0) > 0);
    case '4.2':
      return Boolean(wd.section4?.arterialPressure || wd.section4?.venousPressure);
    case '4.3':
      return Boolean(
        wd.section4?.noComplication ||
          (wd.section4?.complicationIncidents?.length || 0) > 0 ||
          entry.complications
      );
    case '4.4':
      return Boolean(wd.section4?.effectiveCommunicationNotes);
    case '5.1':
      return Boolean(wd.section5?.eduFluidManagement);
    case '5.2':
      return Boolean(wd.section5?.eduNutrition);
    case '5.3':
      return Boolean(wd.section5?.eduVascularCare);
    case '5.4':
      return Boolean(wd.section5?.eduMedicationSchedule);
    case '5.5':
      return wd.section5?.teachBackStatus === 'Baik';
    case '6.1':
      return Boolean(wd.section6?.reinfusionDone);
    case '6.2':
      return Boolean(wd.section6?.hemostasisDone);
    case '6.3':
      return Boolean(entry.postBp && entry.postWeight >= 0);
    case '6.4':
      return Boolean(wd.section6?.wasteDecontaminated);
    case '6.5':
      return Boolean(entry.nursingNotes || wd.section6?.handoverSummary);
    default:
      return false;
  }
}

function getVascularPerformerId(
  entry: LogbookEntry,
  staffByNameMap: Map<string, string>
): string {
  const vascId = entry.wizardDetails?.section3?.vascularNurseId?.trim();
  if (vascId) return vascId;
  const vascName = entry.wizardDetails?.section3?.vascularNurseName?.trim().toLowerCase();
  if (vascName && staffByNameMap.has(vascName)) {
    return staffByNameMap.get(vascName)!;
  }
  return entry.nurseId;
}

function formatRoleTitle(role?: UserRole | string): string {
  switch (role) {
    case 'PJ Shift':
      return 'Penanggung Jawab (PJ) Shift';
    case 'Kepala Ruang':
      return 'Kepala Ruang';
    case 'Perawat Pelaksana':
      return 'Perawat Pelaksana';
    case 'Managerial':
      return 'Managerial';
    case 'Administrator':
      return 'Administrator';
    default:
      return role || 'Perawat Hemodialisis';
  }
}

function formatSignatureRoleTitle(role?: UserRole | string): string {
  switch (role) {
    case 'PJ Shift':
      return 'Penanggung Jawab (PJ) Shift Hemodialisis';
    case 'Kepala Ruang':
      return 'Kepala Ruang Hemodialisis';
    case 'Perawat Pelaksana':
      return 'Perawat Pelaksana Hemodialisis';
    default:
      return `${formatRoleTitle(role)} Hemodialisis`;
  }
}

function formatMonthSlash(monthKey: string): { label: string; upperLabel: string } {
  const [year, month] = monthKey.split('-');
  const idx = Number(month) - 1;
  if (idx >= 0 && idx < 12) {
    const name = MONTH_NAMES_ID[idx];
    return {
      label: `${name} / ${year}`,
      upperLabel: `${name.toUpperCase()} / ${year}`,
    };
  }
  return { label: monthKey, upperLabel: monthKey.toUpperCase() };
}

interface NurseOption {
  uid: string;
  fullName: string;
  nip: string;
  role: UserRole | string;
  verifiedCount: number;
}

function formatSignatureTimestamp(ts: unknown): string {
  if (!ts) return '';
  let dateObj: Date | null = null;
  if (ts instanceof Date) {
    dateObj = ts;
  } else if (
    typeof ts === 'object' &&
    ts !== null &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    dateObj = (ts as { toDate: () => Date }).toDate();
  } else if (
    typeof ts === 'object' &&
    ts !== null &&
    'seconds' in ts &&
    typeof (ts as { seconds: number }).seconds === 'number'
  ) {
    dateObj = new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (!dateObj || Number.isNaN(dateObj.getTime())) return '';
  return dateObj.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MonthlyReportsPage({
  logbooks,
  staffDirectory,
  reports = [],
  formTemplate,
}: MonthlyReportsPageProps) {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const resolvedTemplate = useMemo(
    () => mergeWithDefaultTemplate(formTemplate || DEFAULT_LOGBOOK_TEMPLATE),
    [formTemplate]
  );

  const monthlySpoSections = useMemo<MonthlySpoSection[]>(() => {
    return resolvedTemplate.sections
      .filter((sec) => sec.num >= 1 && sec.num <= 6 && sec.visible !== false)
      .map((sec) => {
        const pts = resolvedTemplate.points
          .filter((p) => p.step === sec.num && p.visible !== false)
          .sort((a, b) => a.order - b.order);
        return {
          title: sec.monthlyTitle || sec.title,
          maxMode: sec.monthlyMaxMode || (sec.num === 1 ? 'daily_cap_1' : 'per_patient'),
          items: pts.map((p) => ({
            id: p.id,
            category: p.category,
            description: p.monthlyDescription || p.statement,
            standard: p.monthlyStandard ?? p.standard ?? '',
          })),
        };
      })
      .filter((sec) => sec.items.length > 0);
  }, [resolvedTemplate]);

  const allSpoItemIds = useMemo(
    () => monthlySpoSections.flatMap((s) => s.items.map((i) => i.id)),
    [monthlySpoSections]
  );

  const sheetRef = useRef<HTMLDivElement>(null);
  const { handlePrint } = useF4OnePagePrint({
    orientation: 'landscape',
    sheetRef,
  });
  const { currentMonthKey: liveMonthKey } = useLiveClock();
  const [trackedMonthKey, setTrackedMonthKey] = useState(liveMonthKey);
  const [monthKey, setMonthKey] = useState(liveMonthKey);
  const [selectedNurseId, setSelectedNurseId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'matrix' | 'recap'>('matrix');
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [signingSlot, setSigningSlot] = useState<'nurse' | 'karu' | null>(null);
  const [signFeedback, setSignFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (liveMonthKey !== trackedMonthKey) {
      setTrackedMonthKey(liveMonthKey);
      setMonthKey((prev) => (prev === trackedMonthKey ? liveMonthKey : prev));
    }
  }, [liveMonthKey, trackedMonthKey]);

  const detailEntry = useMemo(
    () => (detailEntryId ? logbooks.find((item) => item.id === detailEntryId) || null : null),
    [logbooks, detailEntryId]
  );

  const isNurseOnly = userProfile?.role === 'Perawat Pelaksana';

  // Map known NIPs from userProfile and logbooks
  const nipByUid = useMemo(() => {
    const map = new Map<string, string>();
    if (userProfile?.uid && userProfile.nip) {
      map.set(userProfile.uid, userProfile.nip);
    }
    for (const lb of logbooks) {
      if (lb.nurseId && lb.nurseNip && !map.has(lb.nurseId)) {
        map.set(lb.nurseId, lb.nurseNip);
      }
    }
    for (const st of staffDirectory) {
      if (st.uid && st.nip && !map.has(st.uid)) {
        map.set(st.uid, st.nip);
      }
    }
    return map;
  }, [userProfile, logbooks, staffDirectory]);

  const staffByNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const st of staffDirectory) {
      if (st.uid && st.fullName) {
        map.set(st.fullName.trim().toLowerCase(), st.uid);
      }
    }
    for (const lb of logbooks) {
      if (lb.nurseId && lb.nurseName && !map.has(lb.nurseName.trim().toLowerCase())) {
        map.set(lb.nurseName.trim().toLowerCase(), lb.nurseId);
      }
    }
    if (userProfile?.uid && userProfile.fullName) {
      map.set(userProfile.fullName.trim().toLowerCase(), userProfile.uid);
    }
    return map;
  }, [staffDirectory, logbooks, userProfile]);

  // Build selectable nurse list
  const nurseOptions = useMemo<NurseOption[]>(() => {
    const map = new Map<string, NurseOption>();

    const verifiedCountByNurse = new Map<string, number>();
    for (const lb of logbooks) {
      if (lb.monthKey === monthKey && lb.verificationStatus === 'Approved') {
        verifiedCountByNurse.set(lb.nurseId, (verifiedCountByNurse.get(lb.nurseId) || 0) + 1);
      }
    }

    for (const st of staffDirectory) {
      if (
        st.role === 'Perawat Pelaksana' ||
        st.role === 'PJ Shift' ||
        st.role === 'Kepala Ruang'
      ) {
        map.set(st.uid, {
          uid: st.uid,
          fullName: st.fullName,
          nip: nipByUid.get(st.uid) || '-',
          role: st.role,
          verifiedCount: verifiedCountByNurse.get(st.uid) || 0,
        });
      }
    }

    for (const lb of logbooks) {
      if (!map.has(lb.nurseId)) {
        map.set(lb.nurseId, {
          uid: lb.nurseId,
          fullName: lb.nurseName,
          nip: lb.nurseNip || nipByUid.get(lb.nurseId) || '-',
          role: 'Perawat Pelaksana',
          verifiedCount: verifiedCountByNurse.get(lb.nurseId) || 0,
        });
      }
    }

    if (userProfile && !map.has(userProfile.uid)) {
      map.set(userProfile.uid, {
        uid: userProfile.uid,
        fullName: userProfile.fullName,
        nip: userProfile.nip || '-',
        role: userProfile.role,
        verifiedCount: verifiedCountByNurse.get(userProfile.uid) || 0,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.verifiedCount !== a.verifiedCount) return b.verifiedCount - a.verifiedCount;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [staffDirectory, logbooks, monthKey, nipByUid, userProfile]);

  const effectiveNurseId = useMemo(() => {
    if (!userProfile) return '';
    if (isNurseOnly) return userProfile.uid;
    if (selectedNurseId && nurseOptions.some((n) => n.uid === selectedNurseId)) {
      return selectedNurseId;
    }
    const selfOption = nurseOptions.find((n) => n.uid === userProfile.uid);
    if (selfOption && selfOption.verifiedCount > 0) return selfOption.uid;
    const firstWithLogs = nurseOptions.find((n) => n.verifiedCount > 0);
    if (firstWithLogs) return firstWithLogs.uid;
    return selfOption?.uid || nurseOptions[0]?.uid || userProfile.uid;
  }, [userProfile, isNurseOnly, selectedNurseId, nurseOptions]);

  const selectedNurse = useMemo<NurseOption>(() => {
    const found = nurseOptions.find((n) => n.uid === effectiveNurseId);
    if (found) return found;
    return {
      uid: userProfile?.uid || '',
      fullName: userProfile?.fullName || 'Perawat HD',
      nip: userProfile?.nip || '-',
      role: userProfile?.role || 'Perawat Pelaksana',
      verifiedCount: 0,
    };
  }, [nurseOptions, effectiveNurseId, userProfile]);

  // All logs for selected nurse & month (to show unverified notice if applicable)
  const nurseMonthAllLogs = useMemo(
    () =>
      logbooks.filter((l) => l.monthKey === monthKey && l.nurseId === effectiveNurseId),
    [logbooks, monthKey, effectiveNurseId]
  );

  // Verified logs ONLY (Approved by PJ Shift / Kepala Ruang)
  const verifiedLogs = useMemo(
    () =>
      nurseMonthAllLogs
        .filter((l) => l.verificationStatus === 'Approved')
        .sort((a, b) => {
          const dCmp = a.date.localeCompare(b.date);
          if (dCmp !== 0) return dCmp;
          return a.startTime.localeCompare(b.startTime);
        }),
    [nurseMonthAllLogs]
  );

  const pendingOrRevisionCount = nurseMonthAllLogs.length - verifiedLogs.length;

  // All Approved logbooks across unit for the selected month (used for Poin 3.6 vascular access attribution)
  const allApprovedMonthLogs = useMemo(
    () =>
      logbooks.filter(
        (l) => l.monthKey === monthKey && l.verificationStatus === 'Approved'
      ),
    [logbooks, monthKey]
  );

  const daysInMonth = useMemo(() => getDaysInMonth(monthKey), [monthKey]);

  const logsByDate = useMemo(() => {
    const map = new Map<string, LogbookEntry[]>();
    for (const d of daysInMonth) map.set(d, []);
    for (const lb of verifiedLogs) {
      const list = map.get(lb.date);
      if (list) list.push(lb);
    }
    return map;
  }, [daysInMonth, verifiedLogs]);

  // Approved logbooks where the selected nurse actually performed vascular access (Bagian 3 Poin 3.6)
  const vascularLogsByDate = useMemo(() => {
    const map = new Map<string, LogbookEntry[]>();
    for (const d of daysInMonth) map.set(d, []);
    for (const lb of allApprovedMonthLogs) {
      if (!isSpoPointDone(lb, '3.6')) continue;
      if (getVascularPerformerId(lb, staffByNameMap) !== effectiveNurseId) continue;
      const list = map.get(lb.date);
      if (list) list.push(lb);
    }
    return map;
  }, [daysInMonth, allApprovedMonthLogs, staffByNameMap, effectiveNurseId]);

  const crossNurseVascularLogs = useMemo(
    () =>
      allApprovedMonthLogs
        .filter(
          (lb) =>
            isSpoPointDone(lb, '3.6') &&
            getVascularPerformerId(lb, staffByNameMap) === effectiveNurseId &&
            lb.nurseId !== effectiveNurseId
        )
        .sort((a, b) => {
          const dCmp = a.date.localeCompare(b.date);
          if (dCmp !== 0) return dCmp;
          return a.startTime.localeCompare(b.startTime);
        }),
    [allApprovedMonthLogs, staffByNameMap, effectiveNurseId]
  );

  const activeWorkDays = useMemo(() => {
    let count = 0;
    for (const d of daysInMonth) {
      if ((logsByDate.get(d)?.length || 0) > 0) count += 1;
    }
    return count;
  }, [daysInMonth, logsByDate]);

  const shiftCounts = useMemo(() => {
    const seen = new Set<string>();
    let pagi = 0;
    let siang = 0;
    let malam = 0;
    for (const lb of verifiedLogs) {
      const key = `${lb.date}__${lb.shift}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (lb.shift === 'Pagi') pagi += 1;
      else if (lb.shift === 'Siang') siang += 1;
      else if (lb.shift === 'Malam') malam += 1;
    }
    return { pagi, siang, malam };
  }, [verifiedLogs]);

  // Compute dynamic N-row x N-day matrix from template
  const matrixData = useMemo(() => {
    const rowResults = new Map<
      string,
      {
        dailyValues: number[];
        total: number;
        pct: number;
        keterangan: string;
      }
    >();

    const dailyGrandTotals = new Array<number>(daysInMonth.length).fill(0);
    let vascularTotalCount = 0;

    for (const section of monthlySpoSections) {
      for (const item of section.items) {
        const dailyValues = daysInMonth.map((dateStr, dayIdx) => {
          let val = 0;
          if (item.id === '3.6') {
            const vascDayLogs = vascularLogsByDate.get(dateStr) || [];
            val = new Set(vascDayLogs.map((entry) => entry.patientId || entry.id)).size;
          } else {
            const dayLogs = logsByDate.get(dateStr) || [];
            if (dayLogs.length === 0) return 0;

            if (section.maxMode === 'daily_cap_1') {
              val = dayLogs.some((entry) => isSpoPointDone(entry, item.id)) ? 1 : 0;
            } else {
              val = dayLogs.filter((entry) => isSpoPointDone(entry, item.id)).length;
            }
          }
          dailyGrandTotals[dayIdx] += val;
          return val;
        });

        const total = dailyValues.reduce((acc, v) => acc + v, 0);
        let pct = 0;
        let keterangan = '-';

        if (item.id === '3.6') {
          vascularTotalCount = total;
          if (total === 0) {
            pct = 0;
            keterangan = '-';
          } else if (verifiedLogs.length === 0) {
            pct = 100;
            keterangan = `${total} Pasien`;
          } else if (total >= verifiedLogs.length) {
            pct = 100;
            keterangan = total > verifiedLogs.length ? `${total} Pasien` : 'Lengkap';
          } else {
            pct = Math.round((total / verifiedLogs.length) * 100);
            keterangan = `${total}/${verifiedLogs.length}`;
          }
        } else {
          const denom =
            section.maxMode === 'daily_cap_1' ? activeWorkDays : verifiedLogs.length;
          pct = denom > 0 ? Math.min(100, Math.round((total / denom) * 100)) : 0;
          keterangan =
            total === 0 ? '-' : pct >= 100 ? 'Lengkap' : `${total}/${denom}`;
        }

        rowResults.set(item.id, { dailyValues, total, pct, keterangan });
      }
    }

    let maxGrandTotal = 0;
    for (const section of monthlySpoSections) {
      for (const item of section.items) {
        if (item.id === '3.6') {
          maxGrandTotal += Math.max(verifiedLogs.length, vascularTotalCount);
        } else if (section.maxMode === 'daily_cap_1') {
          maxGrandTotal += activeWorkDays;
        } else {
          maxGrandTotal += verifiedLogs.length;
        }
      }
    }

    const grandTotal = dailyGrandTotals.reduce((acc, v) => acc + v, 0);
    const grandPct =
      maxGrandTotal > 0 ? Math.min(100, Math.round((grandTotal / maxGrandTotal) * 100)) : 0;

    return {
      rowResults,
      dailyGrandTotals,
      grandTotal,
      maxGrandTotal,
      grandPct,
    };
  }, [
    monthlySpoSections,
    daysInMonth,
    logsByDate,
    vascularLogsByDate,
    activeWorkDays,
    verifiedLogs.length,
  ]);

  // Compute TTV & custom fields monthly rows
  const customMonthlyRows = useMemo<MonthlyCustomMetricRow[]>(() => {
    const rows: MonthlyCustomMetricRow[] = [];
    const visibleSectionSet = new Set(
      resolvedTemplate.sections.filter((s) => s.visible !== false).map((s) => s.num)
    );

    const buildFieldRow = (
      responseKey: string,
      no: string,
      category: string,
      fld: CustomLogbookField
    ): MonthlyCustomMetricRow => {
      const allNums: number[] = [];
      let filledCount = 0;
      let latestStr = '';
      const dailyDisplay: string[] = [];
      const dailyTitles: string[] = [];

      for (const dateStr of daysInMonth) {
        const dayLogs = logsByDate.get(dateStr) || [];
        const dayNums: number[] = [];
        const dayRawStrings: string[] = [];

        for (const lb of dayLogs) {
          const val = lb.wizardDetails?.customResponses?.[responseKey]?.fields?.[fld.id];
          if (val === undefined || val === null || val === false) continue;
          if (typeof val === 'string' && !val.trim()) continue;

          filledCount += 1;
          const displayVal = val === true ? 'Ya' : String(val).trim();
          dayRawStrings.push(`${lb.patientName}: ${displayVal}`);
          latestStr = displayVal;

          if (fld.type === 'number') {
            const parsed =
              typeof val === 'number' ? val : Number(String(val).replace(',', '.'));
            if (!Number.isNaN(parsed)) {
              dayNums.push(parsed);
              allNums.push(parsed);
            }
          }
        }

        if (dayRawStrings.length === 0) {
          dailyDisplay.push('');
          dailyTitles.push('');
        } else if (
          fld.type === 'number' &&
          fld.monthlyAggregation === 'sum' &&
          dayNums.length > 0
        ) {
          const sum = dayNums.reduce((a, b) => a + b, 0);
          dailyDisplay.push(Number.isInteger(sum) ? String(sum) : sum.toFixed(1));
          dailyTitles.push(dayRawStrings.join(' | '));
        } else if (
          fld.type === 'number' &&
          fld.monthlyAggregation === 'average' &&
          dayNums.length > 0
        ) {
          const avg = dayNums.reduce((a, b) => a + b, 0) / dayNums.length;
          dailyDisplay.push(Number.isInteger(avg) ? String(avg) : avg.toFixed(1));
          dailyTitles.push(dayRawStrings.join(' | '));
        } else {
          dailyDisplay.push(String(dayRawStrings.length));
          dailyTitles.push(dayRawStrings.join(' | '));
        }
      }

      const pct =
        verifiedLogs.length > 0
          ? Math.min(100, Math.round((filledCount / verifiedLogs.length) * 100))
          : 0;
      let totalDisplay = String(filledCount);
      let keterangan = filledCount > 0 ? `${filledCount}/${verifiedLogs.length}` : '-';

      if (fld.type === 'number' && fld.monthlyAggregation === 'sum') {
        const sum = allNums.reduce((a, b) => a + b, 0);
        totalDisplay =
          allNums.length > 0
            ? Number.isInteger(sum)
              ? String(sum)
              : sum.toFixed(1)
            : '0';
        keterangan =
          allNums.length > 0
            ? `Total${fld.unit ? ` (${fld.unit})` : ''} · ${filledCount}x`
            : '-';
      } else if (fld.type === 'number' && fld.monthlyAggregation === 'average') {
        const avg =
          allNums.length > 0 ? allNums.reduce((a, b) => a + b, 0) / allNums.length : 0;
        totalDisplay =
          allNums.length > 0
            ? Number.isInteger(avg)
              ? String(avg)
              : avg.toFixed(1)
            : '-';
        keterangan =
          allNums.length > 0
            ? `Rata-rata${fld.unit ? ` (${fld.unit})` : ''} · ${filledCount}x`
            : '-';
      } else if (fld.monthlyAggregation === 'latest') {
        totalDisplay = String(filledCount);
        keterangan = latestStr
          ? `${latestStr.slice(0, 32)}${fld.unit ? ` ${fld.unit}` : ''}`
          : '-';
      }

      return {
        key: `${responseKey}__${fld.id}`,
        no,
        category,
        description: `${fld.label}${fld.unit ? ` (${fld.unit})` : ''}`,
        standard: `Kolom Tambahan · ${fld.type.toUpperCase()}`,
        dailyDisplay,
        dailyTitles,
        totalDisplay,
        pctDisplay: `${pct}%`,
        keterangan,
      };
    };

    for (const pt of resolvedTemplate.points) {
      if (pt.visible === false || !visibleSectionSet.has(pt.step)) continue;

      if (pt.enableTtv && pt.includeTtvInMonthly !== false) {
        let filledCount = 0;
        let latestSummary = '';
        const dailyDisplay: string[] = [];
        const dailyTitles: string[] = [];

        for (const dateStr of daysInMonth) {
          const dayLogs = logsByDate.get(dateStr) || [];
          const summaries: string[] = [];
          for (const lb of dayLogs) {
            const ttv = lb.wizardDetails?.customResponses?.[pt.id]?.ttv;
            if (hasAnyTtvValue(ttv, pt.ttvConfig)) {
              const s = formatTtvSummary(ttv, pt.ttvConfig);
              filledCount += 1;
              latestSummary = s;
              summaries.push(`${lb.patientName}: ${s}`);
            }
          }
          dailyDisplay.push(summaries.length > 0 ? String(summaries.length) : '');
          dailyTitles.push(summaries.join(' | '));
        }

        const pct =
          verifiedLogs.length > 0
            ? Math.min(100, Math.round((filledCount / verifiedLogs.length) * 100))
            : 0;
        rows.push({
          key: `${pt.id}__ttv`,
          no: `${pt.id}`,
          category: `${pt.category} (TTV)`,
          description: `Penginputan TTV Poin ${pt.id}`,
          standard: 'TD · Nadi · RR · Suhu · SpO₂',
          dailyDisplay,
          dailyTitles,
          totalDisplay: String(filledCount),
          pctDisplay: `${pct}%`,
          keterangan:
            latestSummary ||
            (filledCount > 0 ? `${filledCount}/${verifiedLogs.length}` : '-'),
        });
      }

      for (const fld of pt.customFields || []) {
        if (fld.includeInMonthlyReport === false) continue;
        rows.push(buildFieldRow(pt.id, pt.id, pt.category, fld));
      }
    }

    if (visibleSectionSet.has(7)) {
      const sec7Fields = resolvedTemplate.sectionCustomFields?.['7'] || [];
      for (const fld of sec7Fields) {
        if (fld.includeInMonthlyReport === false) continue;
        rows.push(buildFieldRow('__sec7', '7.K', 'Bagian VII Tambahan', fld));
      }
    }

    return rows;
  }, [resolvedTemplate, daysInMonth, logsByDate, verifiedLogs.length]);

  // Recapitulation of monthly SPO achievement percentage across all nurses
  const allNursesRecap = useMemo(() => {
    const rolePriority: Record<string, number> = {
      'Kepala Ruang': 1,
      'PJ Shift': 2,
      'Perawat Pelaksana': 3,
      Managerial: 4,
      Administrator: 5,
    };

    const sortedNurses = [...nurseOptions].sort((a, b) => {
      const rpA = rolePriority[String(a.role)] ?? 9;
      const rpB = rolePriority[String(b.role)] ?? 9;
      if (rpA !== rpB) return rpA - rpB;
      const nipA = a.nip && a.nip !== '-' ? a.nip : 'zzzz';
      const nipB = b.nip && b.nip !== '-' ? b.nip : 'zzzz';
      const nipCmp = nipA.localeCompare(nipB, 'id', { numeric: true });
      if (nipCmp !== 0) return nipCmp;
      return a.fullName.localeCompare(b.fullName);
    });

    return sortedNurses.map((nurse) => {
      const nurseVerified = allApprovedMonthLogs.filter((l) => l.nurseId === nurse.uid);
      const nurseLogsByDate = new Map<string, LogbookEntry[]>();
      const nurseVascByDate = new Map<string, LogbookEntry[]>();
      for (const d of daysInMonth) {
        nurseLogsByDate.set(d, []);
        nurseVascByDate.set(d, []);
      }
      for (const lb of nurseVerified) {
        nurseLogsByDate.get(lb.date)?.push(lb);
      }
      for (const lb of allApprovedMonthLogs) {
        if (!isSpoPointDone(lb, '3.6')) continue;
        if (getVascularPerformerId(lb, staffByNameMap) !== nurse.uid) continue;
        nurseVascByDate.get(lb.date)?.push(lb);
      }

      let activeDays = 0;
      for (const d of daysInMonth) {
        if ((nurseLogsByDate.get(d)?.length || 0) > 0) activeDays += 1;
      }

      let grandTotal = 0;
      let maxGrandTotal = 0;

      for (const section of monthlySpoSections) {
        for (const item of section.items) {
          let itemTotal = 0;
          for (const dateStr of daysInMonth) {
            if (item.id === '3.6') {
              const vascLogs = nurseVascByDate.get(dateStr) || [];
              itemTotal += new Set(vascLogs.map((e) => e.patientId || e.id)).size;
            } else {
              const dayLogs = nurseLogsByDate.get(dateStr) || [];
              if (dayLogs.length === 0) continue;
              if (section.maxMode === 'daily_cap_1') {
                itemTotal += dayLogs.some((e) => isSpoPointDone(e, item.id)) ? 1 : 0;
              } else {
                itemTotal += dayLogs.filter((e) => isSpoPointDone(e, item.id)).length;
              }
            }
          }
          grandTotal += itemTotal;
          if (item.id === '3.6') {
            maxGrandTotal += Math.max(nurseVerified.length, itemTotal);
          } else if (section.maxMode === 'daily_cap_1') {
            maxGrandTotal += activeDays;
          } else {
            maxGrandTotal += nurseVerified.length;
          }
        }
      }

      const pct =
        maxGrandTotal > 0 ? Math.min(100, Math.round((grandTotal / maxGrandTotal) * 100)) : 0;

      const deterministicReportId = `monthly_${monthKey}_${nurse.uid}`;
      const matchedReport =
        reports.find((r) => r.id === deterministicReportId) ||
        reports.find(
          (r) =>
            r.reportType === 'monthly_unit' &&
            r.monthKey === monthKey &&
            r.targetNurseId === nurse.uid
        ) ||
        null;
      const approvalStatus: 'Sah Final' | 'Menunggu Ka. Ruang' | 'Belum Disahkan' =
        matchedReport?.karuSignedBy
          ? 'Sah Final'
          : matchedReport?.nurseSignedBy
          ? 'Menunggu Ka. Ruang'
          : 'Belum Disahkan';

      return {
        ...nurse,
        roleLabel:
          nurse.role === 'Kepala Ruang' ? 'Kepala Ruangan' : String(nurse.role || 'Perawat'),
        activeDays,
        patientCount: nurseVerified.length,
        grandTotal,
        maxGrandTotal,
        pct,
        approvalStatus,
      };
    });
  }, [
    nurseOptions,
    allApprovedMonthLogs,
    daysInMonth,
    staffByNameMap,
    monthlySpoSections,
    reports,
    monthKey,
  ]);

  const activeMonthlyReport = useMemo(() => {
    if (!effectiveNurseId) return null;
    const deterministicId = `monthly_${monthKey}_${effectiveNurseId}`;
    return (
      reports.find((r) => r.id === deterministicId) ||
      reports.find(
        (r) =>
          r.reportType === 'monthly_unit' &&
          r.monthKey === monthKey &&
          r.targetNurseId === effectiveNurseId
      ) ||
      null
    );
  }, [reports, monthKey, effectiveNurseId]);

  // Determine Kepala Ruang strictly (PJ Shift cannot authorize Laporan Bulanan)
  const verifierInfo = useMemo(() => {
    if (activeMonthlyReport?.karuSignedByName) {
      return {
        name: activeMonthlyReport.karuSignedByName,
        nip:
          (activeMonthlyReport.karuSignedBy && nipByUid.get(activeMonthlyReport.karuSignedBy)) ||
          '-',
      };
    }

    const kepalaRuang = staffDirectory.find((s) => s.isActive && s.role === 'Kepala Ruang');
    if (kepalaRuang) {
      return {
        name: kepalaRuang.fullName,
        nip: nipByUid.get(kepalaRuang.uid) || '-',
      };
    }

    return {
      name: 'Kepala Ruang Hemodialisis',
      nip: '-',
    };
  }, [activeMonthlyReport, staffDirectory, nipByUid]);

  if (!userProfile) return null;

  const canSignNurse = Boolean(
    userProfile.isActive &&
      userProfile.uid === selectedNurse.uid &&
      !activeMonthlyReport?.nurseSignedBy
  );
  const canSignKaru = Boolean(
    userProfile.isActive &&
      userProfile.role === 'Kepala Ruang' &&
      !activeMonthlyReport?.karuSignedBy
  );

  const handleSignNurse = async () => {
    if (!canSignNurse || signingSlot) return;
    setSignFeedback(null);
    setSigningSlot('nurse');
    const reportDocId = activeMonthlyReport?.id || `monthly_${monthKey}_${effectiveNurseId}`;
    try {
      if (activeMonthlyReport) {
        await updateDoc(doc(db, 'reports', reportDocId), {
          nurseSignedBy: userProfile.uid,
          nurseSignedByName: clampString(userProfile.fullName, 120),
          nurseSignedRole: clampString(userProfile.role, 40),
          nurseSignedAt: serverTimestamp(),
          totalTreatments: nurseMonthAllLogs.length,
          approvedTreatments: verifiedLogs.length,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'reports', reportDocId), {
          reportType: 'monthly_unit',
          date: `${monthKey}-01`,
          monthKey,
          authorId: userProfile.uid,
          authorName: clampString(userProfile.fullName, 120),
          authorRole: clampString(userProfile.role, 40),
          targetNurseId: selectedNurse.uid,
          targetNurseName: clampString(selectedNurse.fullName, 120),
          targetNurseNip: clampString(selectedNurse.nip || '-', 40),
          targetNurseRole: clampString(String(selectedNurse.role || 'Perawat Pelaksana'), 40),
          nurseSignedBy: userProfile.uid,
          nurseSignedByName: clampString(userProfile.fullName, 120),
          nurseSignedRole: clampString(userProfile.role, 40),
          nurseSignedAt: serverTimestamp(),
          totalTreatments: nurseMonthAllLogs.length,
          approvedTreatments: verifiedLogs.length,
          status: 'Draft',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setSignFeedback({
        type: 'success',
        message: 'Pengesahan digital perawat berhasil dicatat.',
      });
      showToast('Pengesahan digital perawat berhasil dicatat.', 'success');
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message: 'Gagal menyimpan pengesahan digital perawat.',
      });
      showToast('Gagal menyimpan pengesahan digital perawat.', 'error');
      handleFirestoreError(err, OperationType.UPDATE, `reports/${reportDocId}`);
    } finally {
      setSigningSlot(null);
    }
  };

  const handleSignKaru = async () => {
    if (!canSignKaru || signingSlot) return;
    setSignFeedback(null);
    setSigningSlot('karu');
    const reportDocId = activeMonthlyReport?.id || `monthly_${monthKey}_${effectiveNurseId}`;
    try {
      if (activeMonthlyReport) {
        await updateDoc(doc(db, 'reports', reportDocId), {
          karuSignedBy: userProfile.uid,
          karuSignedByName: clampString(userProfile.fullName, 120),
          karuSignedAt: serverTimestamp(),
          status: 'Final',
          totalTreatments: nurseMonthAllLogs.length,
          approvedTreatments: verifiedLogs.length,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'reports', reportDocId), {
          reportType: 'monthly_unit',
          date: `${monthKey}-01`,
          monthKey,
          authorId: userProfile.uid,
          authorName: clampString(userProfile.fullName, 120),
          authorRole: clampString(userProfile.role, 40),
          targetNurseId: selectedNurse.uid,
          targetNurseName: clampString(selectedNurse.fullName, 120),
          targetNurseNip: clampString(selectedNurse.nip || '-', 40),
          targetNurseRole: clampString(String(selectedNurse.role || 'Perawat Pelaksana'), 40),
          karuSignedBy: userProfile.uid,
          karuSignedByName: clampString(userProfile.fullName, 120),
          karuSignedAt: serverTimestamp(),
          totalTreatments: nurseMonthAllLogs.length,
          approvedTreatments: verifiedLogs.length,
          status: 'Final',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setSignFeedback({
        type: 'success',
        message: `Laporan bulanan ${selectedNurse.fullName} resmi disahkan Kepala Ruang.`,
      });
      showToast(
        `Laporan bulanan ${selectedNurse.fullName} resmi disahkan Kepala Ruang.`,
        'success'
      );
    } catch (err) {
      setSignFeedback({
        type: 'error',
        message: 'Gagal menyimpan pengesahan digital Kepala Ruang.',
      });
      showToast('Gagal menyimpan pengesahan digital Kepala Ruang.', 'error');
      handleFirestoreError(err, OperationType.UPDATE, `reports/${reportDocId}`);
    } finally {
      setSigningSlot(null);
    }
  };

  const { label: monthSlashLabel, upperLabel: monthUpperLabel } = formatMonthSlash(monthKey);

  const handleExportCsv = () => {
    const dayNumbers = daysInMonth.map((_, idx) => String(idx + 1));
    const headers = [
      'NO',
      'KATEGORI FASE ASUHAN',
      'URAIAN KEGIATAN SPESIFIK PERAWAT HEMODIALISIS',
      'STANDAR SPO / INDIKATOR MUTU',
      ...dayNumbers,
      'TOTAL',
      '% CAPAIAN',
      'KETERANGAN',
    ];

    const rows: (string | number)[][] = [];

    // Summary Row 1: Patient count per day
    rows.push([
      '',
      '',
      'JUMLAH PASIEN KELOLAAN TERVERIFIKASI PER HARI',
      '',
      ...daysInMonth.map((d) => logsByDate.get(d)?.length || 0),
      verifiedLogs.length,
      '',
      'Pasien Disahkan',
    ]);

    for (const section of monthlySpoSections) {
      rows.push([section.title, ...new Array(headers.length - 1).fill('')]);
      for (const item of section.items) {
        const res = matrixData.rowResults.get(item.id);
        rows.push([
          item.id,
          item.category,
          item.description,
          item.standard,
          ...(res ? res.dailyValues : daysInMonth.map(() => 0)),
          res?.total ?? 0,
          `${res?.pct ?? 0}%`,
          res?.keterangan ?? '-',
        ]);
      }
    }

    if (customMonthlyRows.length > 0) {
      rows.push([
        'REKAPITULASI PENGINPUTAN TTV & KOLOM TAMBAHAN (SESUAI TEMPLATE LOGBOOK)',
        ...new Array(headers.length - 1).fill(''),
      ]);
      for (const crow of customMonthlyRows) {
        rows.push([
          crow.no,
          crow.category,
          crow.description,
          crow.standard,
          ...crow.dailyDisplay.map((d) => d || '0'),
          crow.totalDisplay,
          crow.pctDisplay,
          crow.keterangan,
        ]);
      }
    }

    // Footer Total Row
    rows.push([
      '',
      '',
      'TOTAL NILAI KEGIATAN TERVERIFIKASI PER HARI',
      '',
      ...matrixData.dailyGrandTotals,
      matrixData.grandTotal,
      `${matrixData.grandPct}%`,
      `Maks: ${matrixData.maxGrandTotal}`,
    ]);

    // Footer Patient Names Row
    rows.push([
      '',
      '',
      'PASIEN KELOLAAN (NAMA PASIEN)',
      '',
      ...daysInMonth.map((d) => {
        const names = Array.from(
          new Set((logsByDate.get(d) || []).map((l) => l.patientName))
        );
        return names.join('; ');
      }),
      verifiedLogs.length,
      '',
      `${verifiedLogs.length} Pasien Terverifikasi`,
    ]);

    if (viewMode === 'recap') {
      exportToCsv(
        `Rekap_Persentase_Capaian_Bulanan_${monthKey}.csv`,
        [
          'NO',
          'NAMA PERAWAT',
          'NIP',
          'JABATAN',
          'HARI DISAHKAN',
          'PASIEN KELOLAAN',
          'NILAI SPO',
          'MAKS SPO',
          '% CAPAIAN',
          'STATUS PENGESAHAN',
        ],
        allNursesRecap.map((item, idx) => [
          idx + 1,
          item.fullName,
          item.nip || '-',
          item.roleLabel,
          `${item.activeDays} Hari`,
          `${item.patientCount} Pasien`,
          item.maxGrandTotal > 0 ? item.grandTotal : '-',
          item.maxGrandTotal > 0 ? item.maxGrandTotal : '-',
          item.maxGrandTotal > 0 ? `${item.pct}%` : '-',
          item.approvalStatus,
        ])
      );
      showToast(`Rekap capaian bulanan ${formatMonthLabel(monthKey)} diekspor ke CSV.`, 'success');
      return;
    }

    const safeName = selectedNurse.fullName.replace(/[^a-zA-Z0-9]+/g, '_');
    exportToCsv(`Logbook_Bulanan_${safeName}_${monthKey}.csv`, headers, rows);
    showToast(`Matriks bulanan ${selectedNurse.fullName} diekspor ke CSV.`, 'success');
  };

  const totalColumns = 4 + daysInMonth.length + 3;

  return (
    <div className="space-y-4 print:space-y-0">
      {/* Page Header & Controls (Hidden in Print) */}
      <div className="no-print flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Laporan Bulanan Logbook Pasien Kelolaan Perawat
          </h2>
          <p className="text-xs text-slate-500">
            Rekap matriks {formatMonthLabel(monthKey)} dari logbook berstatus Approved dengan pengesahan akhir oleh Kepala Ruang.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isNurseOnly && viewMode === 'matrix' && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="monthly-nurse-select"
                className="text-[11px] font-semibold text-slate-600 whitespace-nowrap"
              >
                Perawat:
              </label>
              <select
                id="monthly-nurse-select"
                value={effectiveNurseId}
                onChange={(e) => setSelectedNurseId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#0B5A8E] focus:outline-none min-w-[220px]"
              >
                {nurseOptions.map((n) => (
                  <option key={n.uid} value={n.uid}>
                    {n.fullName} ({n.role}) — {n.verifiedCount} terverifikasi
                  </option>
                ))}
              </select>
            </div>
          )}

          <input
            type="month"
            aria-label="Filter Bulan Laporan Bulanan"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
          />

          <button
            type="button"
            onClick={handlePrint}
            title="Cetak / Simpan PDF (F4 Landscape - 1 Halaman Penuh)"
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

          <button
            type="button"
            onClick={() => setViewMode((prev) => (prev === 'recap' ? 'matrix' : 'recap'))}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'recap'
                ? 'bg-[#164b75] text-white hover:bg-[#103a5c]'
                : 'bg-[#0B5A8E] text-white hover:bg-[#094a75]'
            }`}
          >
            {viewMode === 'recap' ? (
              <>
                <ArrowLeft className="h-4 w-4" />
                Kembali ke Matriks 1–{daysInMonth.length}
              </>
            ) : (
              <>
                <BarChart3 className="h-4 w-4" />
                Persentase Capaian Bulanan
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode === 'recap' ? (
        <div
          ref={sheetRef}
          className="f4-print-sheet rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="inline-flex items-center gap-2 font-display text-sm sm:text-base font-bold text-slate-900">
              <Activity className="h-4 w-4 text-[#0B5A8E]" />
              <span>
                Daftar Rekapitulasi Capaian Logbook Seluruh Perawat ({monthSlashLabel})
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Klik tombol <span className="font-semibold text-slate-700">Buka Matriks</span> pada
              baris perawat untuk membuka tabel matriks 1–{daysInMonth.length} horizontal (
              {allSpoItemIds.length} Poin SPO).
            </p>
          </div>

          <div className="f4-scroll-wrap max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-xs text-slate-800">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#164b75] text-white text-[11px] uppercase tracking-wider">
                  <th className="border-r border-[#27608d] px-3 py-3 text-center font-bold w-12">
                    NO
                  </th>
                  <th className="border-r border-[#27608d] px-4 py-3 text-left font-bold min-w-[220px]">
                    NAMA PERAWAT &amp; NIP
                  </th>
                  <th className="border-r border-[#27608d] px-4 py-3 text-center font-bold min-w-[140px]">
                    JABATAN
                  </th>
                  <th className="border-r border-[#27608d] px-3 py-3 text-center font-bold w-24">
                    HARI
                    <br />
                    DISAHKAN
                  </th>
                  <th className="border-r border-[#27608d] px-3 py-3 text-center font-bold w-28">
                    PASIEN
                    <br />
                    KELOLAAN
                  </th>
                  <th className="border-r border-[#27608d] px-3 py-3 text-center font-bold w-28">
                    NILAI SPO /
                    <br />
                    MAKS
                  </th>
                  <th className="border-r border-[#27608d] px-3 py-3 text-center font-bold w-24">
                    % CAPAIAN
                  </th>
                  <th className="border-r border-[#27608d] px-3 py-3 text-center font-bold min-w-[155px]">
                    STATUS PENGESAHAN
                  </th>
                  <th className="no-print px-4 py-3 text-center font-bold w-32">AKSI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {allNursesRecap.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-xs text-slate-500">
                      Belum ada data perawat pada direktori unit.
                    </td>
                  </tr>
                ) : (
                  allNursesRecap.map((nurse, idx) => {
                    const hasScore = nurse.maxGrandTotal > 0;
                    const canOpenNurseMatrix = !isNurseOnly || nurse.uid === userProfile.uid;
                    return (
                      <tr key={nurse.uid} className="hover:bg-slate-50/80 transition-colors">
                        <td className="border-r border-slate-200 px-3 py-3 text-center font-mono text-xs text-slate-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="border-r border-slate-200 px-4 py-3">
                          <div className="font-bold uppercase text-slate-900">
                            {nurse.fullName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                            NIP: {nurse.nip || '-'}
                          </div>
                        </td>
                        <td className="border-r border-slate-200 px-4 py-3 text-center text-slate-700">
                          {nurse.roleLabel}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-3 text-center font-mono font-semibold text-slate-800 tabular-nums">
                          {nurse.activeDays} Hari
                        </td>
                        <td className="border-r border-slate-200 px-3 py-3 text-center font-mono font-semibold text-slate-800 tabular-nums">
                          {nurse.patientCount} Pasien
                        </td>
                        <td className="border-r border-slate-200 px-3 py-3 text-center font-mono text-slate-700 tabular-nums">
                          {hasScore ? `${nurse.grandTotal} / ${nurse.maxGrandTotal}` : '-'}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-3 text-center font-mono font-bold tabular-nums">
                          {hasScore ? (
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                                nurse.pct >= 90
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : nurse.pct >= 75
                                  ? 'bg-sky-50 text-[#0B5A8E]'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {nurse.pct}%
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-3 text-center">
                          {nurse.approvalStatus === 'Sah Final' ? (
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
                              <ShieldCheck className="h-3 w-3" />
                              Sah Final
                            </span>
                          ) : nurse.approvalStatus === 'Menunggu Ka. Ruang' ? (
                            <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-[#0B5A8E] whitespace-nowrap">
                              <Clock className="h-3 w-3" />
                              Menunggu Ka. Ruang
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
                              Belum Disahkan
                            </span>
                          )}
                        </td>
                        <td className="no-print px-4 py-3 text-center">
                          {canOpenNurseMatrix ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNurseId(nurse.uid);
                                setViewMode('matrix');
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#164b75] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0f3858] transition-colors whitespace-nowrap"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Buka Matriks
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Lock className="h-3 w-3" />
                              Terkunci
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
      {/* Verification Status Notice (Hidden in Print) */}
      <div className="no-print flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 font-semibold text-teal-700">
              <CheckCircle2 className="h-4 w-4" />
              {verifiedLogs.length} Pasien Kelolaan Terverifikasi ({activeWorkDays} Hari Kerja)
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <UserCheck className="h-4 w-4 text-[#0B5A8E]" />
              Perawat: <strong className="text-slate-900">{selectedNurse.fullName}</strong> (
              {selectedNurse.role})
            </span>
            {pendingOrRevisionCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <Clock className="h-4 w-4" />
                {pendingOrRevisionCount} entri bulan ini belum masuk rekap karena masih berstatus
                Draft/Menunggu Verifikasi/Revisi.
              </span>
            )}
          </div>
          <span className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
            Capaian SPO: {matrixData.grandTotal} / {matrixData.maxGrandTotal} ({matrixData.grandPct}%)
          </span>
        </div>
        {signFeedback && (
          <div
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium ${
              signFeedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {signFeedback.message}
          </div>
        )}
      </div>

      {/* Printable Official Monthly Matrix Sheet (Exact Match to Attached PDF) */}
      <div
        ref={sheetRef}
        className="f4-print-sheet f4-monthly-landscape rounded-xl border border-slate-300 bg-white p-4 sm:p-6 shadow-sm"
      >
        {/* Document Header */}
        <div className="monthly-doc-header text-center border-b-2 border-[#1e3a5f] pb-3 mb-3">
          <h1 className="font-display text-sm sm:text-base font-extrabold tracking-wide text-slate-900 uppercase">
            {resolvedTemplate.monthlyReportTitle}
          </h1>
          <p className="mt-0.5 text-[11px] sm:text-xs font-bold tracking-wide text-slate-700 uppercase">
            UNIT PELAYANAN HEMODIALISIS (DIALYSIS CENTER) - RS HAPPY LAND MEDICAL CENTRE
          </p>
        </div>

        {/* Two-Column Staff & Period Metadata */}
        <div className="monthly-meta-grid grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-[11px] text-slate-800 mb-3">
          <div className="space-y-0.5">
            <div className="grid grid-cols-[120px_10px_1fr]">
              <span className="font-bold">Nama Staff</span>
              <span>:</span>
              <span className="font-bold uppercase">{selectedNurse.fullName}</span>
            </div>
            <div className="grid grid-cols-[120px_10px_1fr]">
              <span className="font-bold">NIP / NIRA</span>
              <span>:</span>
              <span className="font-mono">{selectedNurse.nip || '-'}</span>
            </div>
            <div className="grid grid-cols-[120px_10px_1fr]">
              <span className="font-bold">Jabatan / Akses</span>
              <span>:</span>
              <span>
                {formatRoleTitle(selectedNurse.role)} - Instalasi Hemodialisa RS Happy Land Medical
                Centre
              </span>
            </div>
          </div>

          <div className="space-y-0.5">
            <div className="grid grid-cols-[130px_10px_1fr]">
              <span className="font-bold">Bulan / Tahun</span>
              <span>:</span>
              <span className="font-semibold">{monthSlashLabel}</span>
            </div>
            <div className="grid grid-cols-[130px_10px_1fr]">
              <span className="font-bold">Rekap Terverifikasi</span>
              <span>:</span>
              <span className="font-semibold tabular-nums">
                {activeWorkDays} Hari Kerja · {verifiedLogs.length} Pasien Kelolaan Disahkan
              </span>
            </div>
            <div className="grid grid-cols-[130px_10px_1fr]">
              <span className="font-bold">Jumlah Shift</span>
              <span>:</span>
              <span className="tabular-nums">
                {shiftCounts.pagi} Shift Pagi · {shiftCounts.siang} Shift Siang
                {shiftCounts.malam > 0 ? ` · ${shiftCounts.malam} Shift Malam` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Main Matrix Table */}
        <div className="f4-scroll-wrap max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse border border-slate-400 text-[10px] leading-tight text-slate-900">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#1e3a5f] text-white">
                <th
                  rowSpan={2}
                  className="monthly-col-no w-[42px] min-w-[42px] max-w-[42px] md:sticky md:left-0 z-30 bg-[#1e3a5f] border border-slate-500 px-1.5 py-2 text-center font-bold"
                >
                  NO
                </th>
                <th
                  rowSpan={2}
                  className="monthly-col-cat w-[140px] min-w-[140px] max-w-[140px] md:sticky md:left-[42px] z-30 bg-[#1e3a5f] border border-slate-500 px-2 py-2 text-left font-bold"
                >
                  KATEGORI FASE ASUHAN
                </th>
                <th
                  rowSpan={2}
                  className="monthly-col-desc w-[228px] min-w-[228px] max-w-[228px] md:sticky md:left-[182px] z-30 bg-[#1e3a5f] md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] border border-slate-500 px-2 py-2 text-left font-bold"
                >
                  URAIAN KEGIATAN SPESIFIK PERAWAT HEMODIALISIS
                </th>
                <th
                  rowSpan={2}
                  className="monthly-col-spo border border-slate-500 px-2 py-2 text-left font-bold min-w-[155px] max-w-[190px]"
                >
                  STANDAR SPO / INDIKATOR MUTU
                </th>
                <th
                  colSpan={daysInMonth.length}
                  className="border border-slate-500 px-1 py-1 text-center font-bold uppercase tracking-wide"
                >
                  TANGGAL PELAKSANAAN TERVERIFIKASI ({monthUpperLabel})
                </th>
                <th
                  rowSpan={2}
                  className="monthly-col-total border border-slate-500 px-1.5 py-2 text-center font-bold w-11"
                >
                  TOTAL
                </th>
                <th
                  rowSpan={2}
                  className="monthly-col-pct border border-slate-500 px-1.5 py-2 text-center font-bold w-14"
                >
                  % CAPAIAN
                </th>
                <th
                  rowSpan={2}
                  className="monthly-col-ket border border-slate-500 px-2 py-2 text-center font-bold min-w-[78px]"
                >
                  KETERANGAN
                </th>
              </tr>
              <tr className="bg-[#274b7a] text-white">
                {daysInMonth.map((dateStr, idx) => {
                  const hasVerified =
                    (logsByDate.get(dateStr)?.length || 0) > 0 ||
                    (vascularLogsByDate.get(dateStr)?.length || 0) > 0;
                  return (
                    <th
                      key={dateStr}
                      className={`monthly-day-col border border-slate-500 px-0.5 py-1 text-center font-mono font-semibold w-[22px] min-w-[20px] ${
                        hasVerified ? 'bg-[#0f6b76]' : ''
                      }`}
                    >
                      {idx + 1}
                    </th>
                  );
                })}
              </tr>

              {/* Summary Sub-header Row: Verified Patients Per Day */}
              <tr className="bg-[#eef4fb] text-[#1e3a5f] font-bold">
                <td
                  colSpan={3}
                  className="md:sticky md:left-0 z-30 bg-[#eef4fb] md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] border border-slate-400 px-2 py-1.5 text-right uppercase tracking-wide"
                >
                  JUMLAH PASIEN KELOLAAN TERVERIFIKASI PER HARI
                </td>
                <td className="border border-slate-400 bg-[#eef4fb] px-2 py-1.5 text-center text-[9.5px] font-semibold text-slate-500">
                  Harian
                </td>
                {daysInMonth.map((dateStr) => {
                  const count = logsByDate.get(dateStr)?.length || 0;
                  return (
                    <td
                      key={`pat-count-${dateStr}`}
                      className={`monthly-day-col border border-slate-400 px-0.5 py-1.5 text-center font-mono tabular-nums ${
                        count > 0 ? 'bg-teal-50 text-teal-800 font-bold' : ''
                      }`}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
                <td className="border border-slate-400 px-1 py-1.5 text-center font-mono tabular-nums">
                  {verifiedLogs.length}
                </td>
                <td className="border border-slate-400 px-1 py-1.5 text-center font-mono">-</td>
                <td className="border border-slate-400 px-1.5 py-1.5 text-center font-semibold">
                  Pasien Disahkan
                </td>
              </tr>
            </thead>

            <tbody>
              {monthlySpoSections.map((section) => (
                <FragmentSection
                  key={section.title}
                  section={section}
                  totalColumns={totalColumns}
                  daysInMonth={daysInMonth}
                  rowResults={matrixData.rowResults}
                />
              ))}

              {customMonthlyRows.length > 0 && (
                <>
                  <tr className="bg-[#e3edf7] text-[#153152]">
                    <td
                      colSpan={totalColumns}
                      className="monthly-section-title border border-slate-400 px-2 py-1.5 font-bold tracking-wide uppercase"
                    >
                      <span className="md:sticky md:left-2 inline-block">
                        REKAPITULASI PENGINPUTAN TTV &amp; KOLOM TAMBAHAN (SESUAI TEMPLATE LOGBOOK)
                      </span>
                    </td>
                  </tr>
                  {customMonthlyRows.map((crow) => (
                    <tr key={crow.key} className="bg-white hover:bg-slate-50/70">
                      <td className="w-[42px] min-w-[42px] max-w-[42px] md:sticky md:left-0 z-10 bg-white border border-slate-300 px-1.5 py-1.5 text-center font-mono font-bold text-slate-800 align-top">
                        {crow.no}
                      </td>
                      <td className="w-[140px] min-w-[140px] max-w-[140px] md:sticky md:left-[42px] z-10 bg-white border border-slate-300 px-2 py-1.5 font-semibold text-slate-900 align-top">
                        {crow.category}
                      </td>
                      <td className="w-[228px] min-w-[228px] max-w-[228px] md:sticky md:left-[182px] z-10 bg-white md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] border border-slate-300 px-2 py-1.5 text-slate-700 align-top">
                        {crow.description}
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 italic text-slate-500 align-top">
                        {crow.standard}
                      </td>
                      {daysInMonth.map((dateStr, idx) => {
                        const val = crow.dailyDisplay[idx] || '';
                        const title = crow.dailyTitles[idx] || '';
                        return (
                          <td
                            key={`${crow.key}-${dateStr}`}
                            title={title || undefined}
                            className={`monthly-day-col border border-slate-300 px-0.5 py-1.5 text-center font-mono tabular-nums align-middle ${
                              val ? 'bg-sky-50/80 font-bold text-[#0e4e78]' : 'text-slate-300'
                            }`}
                          >
                            {val}
                          </td>
                        );
                      })}
                      <td className="border border-slate-300 px-1 py-1.5 text-center font-mono font-bold tabular-nums text-slate-900 align-middle">
                        {crow.totalDisplay}
                      </td>
                      <td className="border border-slate-300 px-1 py-1.5 text-center font-mono font-semibold tabular-nums text-slate-800 align-middle">
                        {crow.pctDisplay}
                      </td>
                      <td className="border border-slate-300 px-1.5 py-1.5 text-center text-slate-700 align-middle">
                        {crow.keterangan}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>

            <tfoot>
              {/* Total Nilai Kegiatan Per Hari */}
              <tr className="bg-[#eef4fb] font-bold text-[#0f2942]">
                <td
                  colSpan={3}
                  className="md:sticky md:left-0 z-10 bg-[#eef4fb] md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] border border-slate-400 px-2 py-1.5 text-right uppercase tracking-wide"
                >
                  TOTAL NILAI KEGIATAN TERVERIFIKASI PER HARI
                </td>
                <td className="border border-slate-400 bg-[#eef4fb] px-2 py-1.5 text-center text-[9.5px] font-semibold text-slate-500">
                  Akumulasi
                </td>
                {daysInMonth.map((dateStr, idx) => {
                  const dayVal = matrixData.dailyGrandTotals[idx] || 0;
                  return (
                    <td
                      key={`tot-${dateStr}`}
                      className={`monthly-day-col border border-slate-400 px-0.5 py-1.5 text-center font-mono tabular-nums ${
                        dayVal > 0 ? 'bg-sky-100/70 text-[#0B5A8E]' : ''
                      }`}
                    >
                      {dayVal > 0 ? dayVal : ''}
                    </td>
                  );
                })}
                <td className="border border-slate-400 px-1 py-1.5 text-center font-mono tabular-nums">
                  {matrixData.grandTotal}
                </td>
                <td className="border border-slate-400 px-1 py-1.5 text-center font-mono tabular-nums">
                  {matrixData.grandPct}%
                </td>
                <td className="border border-slate-400 px-1.5 py-1.5 text-center font-mono">
                  Maks: {matrixData.maxGrandTotal}
                </td>
              </tr>

              {/* Pasien Kelolaan (Nama Pasien) */}
              <tr className="bg-[#fffaf0] text-slate-900">
                <td
                  colSpan={3}
                  className="md:sticky md:left-0 z-10 bg-[#fffaf0] md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] border border-slate-400 px-2 py-2 text-right font-bold uppercase tracking-wide text-[#1e3a5f]"
                >
                  PASIEN KELOLAAN (NAMA PASIEN)
                </td>
                <td className="border border-slate-400 bg-[#fffaf0] px-2 py-2 text-center text-[9.5px] text-slate-500">
                  Daftar Pasien
                </td>
                {daysInMonth.map((dateStr) => {
                  const dayLogs = logsByDate.get(dateStr) || [];
                  const names = Array.from(new Set(dayLogs.map((l) => l.patientName)));
                  return (
                    <td
                      key={`pat-names-${dateStr}`}
                      title={names.join(', ')}
                      className={`monthly-day-col border border-slate-400 align-middle text-center ${
                        names.length > 0 ? 'px-1.5 py-1' : 'px-0.5 py-1'
                      }`}
                    >
                      {names.length > 0 && (
                        <div className="monthly-patient-names flex flex-col items-stretch justify-center divide-y divide-amber-200/80">
                          {names.map((name) => (
                            <span
                              key={name}
                              className="block py-0.5 text-[9px] font-medium leading-snug text-slate-800 whitespace-nowrap"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td
                  colSpan={3}
                  className="border border-slate-400 px-2 py-2 text-center font-bold text-[#1e3a5f]"
                >
                  {verifiedLogs.length} Pasien Terverifikasi
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Signature Block */}
        <div className="monthly-signatures mt-8 grid grid-cols-2 gap-8 text-[11px] text-slate-900 break-inside-avoid">
          <div className="text-center">
            <p>Mengetahui &amp; Menyatakan,</p>
            <p className="font-bold">{formatSignatureRoleTitle(selectedNurse.role)}</p>
            <div className="monthly-sig-box my-2 min-h-[56px] flex flex-col items-center justify-center gap-1">
              {activeMonthlyReport?.nurseSignedBy ? (
                <div className="monthly-sig-badge inline-flex flex-col items-center rounded-lg border border-sky-300 bg-sky-50/90 px-3 py-1.5 text-center">
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wider text-[#0B5A8E]">
                    <ShieldCheck className="h-3 w-3" />
                    Pengesahan Digital Sah
                  </span>
                  <span className="text-[10.5px] font-bold text-slate-900 mt-0.5">
                    {activeMonthlyReport.nurseSignedByName || selectedNurse.fullName}
                  </span>
                  <span className="font-mono text-[9px] text-[#0B5A8E]">
                    {formatRoleTitle(activeMonthlyReport.nurseSignedRole || selectedNurse.role)} ·{' '}
                    {formatSignatureTimestamp(
                      activeMonthlyReport.nurseSignedAt || activeMonthlyReport.updatedAt
                    ) || 'Tercatat Sistem'}
                  </span>
                  <span className="font-mono text-[8.5px] text-slate-500">
                    ID: SIG-{activeMonthlyReport.nurseSignedBy.slice(0, 8).toUpperCase()}
                  </span>
                </div>
              ) : (
                <>
                  <span className="monthly-sig-placeholder text-[10px] italic text-slate-400">
                    Belum disahkan secara digital
                  </span>
                  <div className="no-print mt-0.5">
                    {canSignNurse ? (
                      <button
                        type="button"
                        disabled={signingSlot !== null}
                        onClick={handleSignNurse}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#094a75] disabled:opacity-60"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {signingSlot === 'nurse' ? 'Mengesahkan...' : 'Sahkan Digital'}
                      </button>
                    ) : (
                      <div className="inline-flex items-start gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-left text-[10px] text-slate-500 max-w-[260px]">
                        <Lock className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                        <span>
                          Hanya akun {selectedNurse.fullName} yang dapat menandatangani laporan ini.
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <p className="font-bold uppercase">( {selectedNurse.fullName} )</p>
            <p className="font-mono text-[10px] text-slate-600">
              NIP/NIRA: {selectedNurse.nip || '-'}
            </p>
          </div>

          <div className="text-center">
            <p>Diverifikasi &amp; Disahkan oleh,</p>
            <p className="font-bold">Kepala Ruang Hemodialisis</p>
            <div className="monthly-sig-box my-2 min-h-[56px] flex flex-col items-center justify-center gap-1">
              {activeMonthlyReport?.karuSignedBy ? (
                <div className="monthly-sig-badge inline-flex flex-col items-center rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-1.5 text-center">
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wider text-emerald-700">
                    <ShieldCheck className="h-3 w-3" />
                    Disetujui &amp; Disahkan Digital
                  </span>
                  <span className="text-[10.5px] font-bold text-slate-900 mt-0.5">
                    {activeMonthlyReport.karuSignedByName || verifierInfo.name}
                  </span>
                  <span className="font-mono text-[9px] text-emerald-800">
                    Kepala Ruang ·{' '}
                    {formatSignatureTimestamp(
                      activeMonthlyReport.karuSignedAt || activeMonthlyReport.updatedAt
                    ) || 'Tercatat Sistem'}
                  </span>
                  <span className="font-mono text-[8.5px] text-slate-500">
                    ID: SIG-{activeMonthlyReport.karuSignedBy.slice(0, 8).toUpperCase()}
                  </span>
                </div>
              ) : (
                <>
                  <span className="monthly-sig-placeholder text-[10px] italic text-slate-400">
                    Belum disahkan Kepala Ruang
                  </span>
                  <div className="no-print mt-0.5">
                    {canSignKaru ? (
                      <button
                        type="button"
                        disabled={signingSlot !== null}
                        onClick={handleSignKaru}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {signingSlot === 'karu'
                          ? 'Mengesahkan...'
                          : 'Sahkan Digital (Kepala Ruang)'}
                      </button>
                    ) : (
                      <div className="inline-flex items-start gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-left text-[10px] text-slate-500 max-w-[270px]">
                        <Lock className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                        <span>
                          Hanya Kepala Ruang yang dapat mengesahkan Laporan Bulanan. Akun{' '}
                          {userProfile.role} tidak memiliki otoritas pengesahan.
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <p className="font-bold uppercase">( {verifierInfo.name} )</p>
            <p className="font-mono text-[10px] text-slate-600">
              NIP: {verifierInfo.nip || '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Supporting Interactive Breakdown of Verified Patient Entries (Hidden in Print) */}
      <div className="no-print rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Rincian Logbook Pasien Terverifikasi — {selectedNurse.fullName} (
              {formatMonthLabel(monthKey)})
            </h3>
            <p className="text-[11px] text-slate-500">
              Hanya tindakan dengan status Approved oleh PJ Shift atau Kepala Ruang yang dihitung
              ke dalam tabel laporan bulanan di atas.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-teal-700 tabular-nums">
            {verifiedLogs.length} Tindakan Disahkan
          </span>
        </div>

        {verifiedLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Belum ada logbook pasien berstatus <strong className="text-slate-700">Approved</strong>{' '}
            untuk {selectedNurse.fullName} pada bulan {formatMonthLabel(monthKey)}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                  <th className="px-4 py-2.5 font-semibold">Shift</th>
                  <th className="px-4 py-2.5 font-semibold">Pasien (No. RM)</th>
                  <th className="px-4 py-2.5 font-semibold">Mesin &amp; Kategori</th>
                  <th className="px-4 py-2.5 font-semibold text-center">Capaian SPO</th>
                  <th className="px-4 py-2.5 font-semibold">Diverifikasi Oleh</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {verifiedLogs.map((entry) => {
                  const doneCount = allSpoItemIds.filter((id) =>
                    isSpoPointDone(entry, id)
                  ).length;
                  const vascPerformerId = getVascularPerformerId(entry, staffByNameMap);
                  const vascPerformerName =
                    entry.wizardDetails?.section3?.vascularNurseName || entry.nurseName;
                  const accessedByOther =
                    isSpoPointDone(entry, '3.6') && vascPerformerId !== entry.nurseId;
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatDateId(entry.date)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <ShiftBadge shift={entry.shift} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{entry.patientName}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {entry.patientRm}
                        </div>
                        {accessedByOther && (
                          <div className="mt-0.5 text-[11px] font-medium text-amber-700">
                            Akses vaskular (3.6) dilakukan oleh: {vascPerformerName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <div>{entry.actionCategory}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {entry.machineNumber} · {entry.startTime}–{entry.endTime}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono font-semibold text-[#0B5A8E] tabular-nums">
                        {doneCount} / {allSpoItemIds.length}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">
                          {entry.verifiedByName || 'PJ Shift / Kepala Ruang'}
                        </div>
                        {entry.verificationNote && (
                          <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            {entry.verificationNote}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <VerificationBadge status={entry.verificationStatus} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setDetailEntryId(entry.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Detail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {crossNurseVascularLogs.length > 0 && (
          <div className="border-t border-slate-200 bg-teal-50/50 px-5 py-3.5 text-xs">
            <p className="font-semibold text-teal-900">
              Tambahan Akses Vaskular (Poin 3.6) pada Pasien Kelolaan Perawat Lain (
              {crossNurseVascularLogs.length} tindakan terverifikasi):
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {crossNurseVascularLogs.map((entry) => (
                <button
                  key={`cross-vasc-${entry.id}`}
                  type="button"
                  onClick={() => setDetailEntryId(entry.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:border-teal-400 hover:bg-teal-50"
                >
                  <span className="font-mono font-semibold text-teal-800">
                    {formatDateId(entry.date)}
                  </span>
                  <span>·</span>
                  <span className="font-semibold text-slate-900">{entry.patientName}</span>
                  <span className="text-slate-500">(Kelolaan: {entry.nurseName})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {detailEntry && (
        <LogbookDetailModal
          entry={detailEntry}
          logbooks={logbooks}
          staffDirectory={staffDirectory}
          formTemplate={formTemplate}
          onClose={() => setDetailEntryId(null)}
        />
      )}
    </div>
  );
}

function FragmentSection({
  section,
  totalColumns,
  daysInMonth,
  rowResults,
}: {
  section: MonthlySpoSection;
  totalColumns: number;
  daysInMonth: string[];
  rowResults: Map<
    string,
    {
      dailyValues: number[];
      total: number;
      pct: number;
      keterangan: string;
    }
  >;
}) {
  return (
    <>
      <tr className="bg-[#e3edf7] text-[#153152]">
        <td
          colSpan={totalColumns}
          className="monthly-section-title border border-slate-400 px-2 py-1.5 font-bold tracking-wide uppercase"
        >
          <span className="md:sticky md:left-2 inline-block">{section.title}</span>
        </td>
      </tr>
      {section.items.map((item) => {
        const res = rowResults.get(item.id);
        return (
          <tr key={item.id} className="bg-white hover:bg-slate-50/70">
            <td className="w-[42px] min-w-[42px] max-w-[42px] md:sticky md:left-0 z-10 bg-white border border-slate-300 px-1.5 py-1.5 text-center font-mono font-bold text-slate-800 align-top">
              {item.id}
            </td>
            <td className="w-[140px] min-w-[140px] max-w-[140px] md:sticky md:left-[42px] z-10 bg-white border border-slate-300 px-2 py-1.5 font-semibold text-slate-900 align-top">
              {item.category}
            </td>
            <td className="w-[228px] min-w-[228px] max-w-[228px] md:sticky md:left-[182px] z-10 bg-white md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] border border-slate-300 px-2 py-1.5 text-slate-700 align-top">
              {item.description}
            </td>
            <td className="border border-slate-300 px-2 py-1.5 italic text-slate-500 align-top">
              {item.standard}
            </td>
            {daysInMonth.map((dateStr, idx) => {
              const val = res?.dailyValues[idx] || 0;
              return (
                <td
                  key={`${item.id}-${dateStr}`}
                  className={`monthly-day-col border border-slate-300 px-0.5 py-1.5 text-center font-mono tabular-nums align-middle ${
                    val > 0 ? 'bg-teal-50/80 font-bold text-teal-800' : 'text-slate-300'
                  }`}
                >
                  {val > 0 ? val : ''}
                </td>
              );
            })}
            <td className="border border-slate-300 px-1 py-1.5 text-center font-mono font-bold tabular-nums text-slate-900 align-middle">
              {res?.total ?? 0}
            </td>
            <td className="border border-slate-300 px-1 py-1.5 text-center font-mono font-semibold tabular-nums text-slate-800 align-middle">
              {res?.pct ?? 0}%
            </td>
            <td className="border border-slate-300 px-1.5 py-1.5 text-center text-slate-700 align-middle">
              {res?.keterangan ?? '-'}
            </td>
          </tr>
        );
      })}
    </>
  );
}

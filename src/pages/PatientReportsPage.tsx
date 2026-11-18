import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Download, Eye, Plus, Printer, Search, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  clampString,
  exportToCsv,
  formatDateId,
  formatFullDayDateId,
  formatMonthLabel,
} from '../lib/formatters';
import { useAuth } from '../context/AuthContext';
import { useLiveClock } from '../hooks/useLiveClock';
import { useF4OnePagePrint } from '../hooks/useF4OnePagePrint';
import { LogbookDetailModal } from '../components/logbook/LogbookDetailModal';
import { VerificationBadge } from '../components/ui/StatusBadge';
import type {
  LogbookEntry,
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

function mapMachineStatusId(status?: Machine['status']): string {
  switch (status) {
    case 'Ready':
      return 'Siap Pakai';
    case 'In Use':
      return 'Digunakan';
    case 'Maintenance':
      return 'Maintenance';
    case 'Sterilisasi':
      return 'Sterilisasi';
    default:
      return 'Siap Pakai';
  }
}

function getShiftRangeLabel(shift: 'ALL' | ShiftType): string {
  if (shift === 'Pagi') return 'Pagi (07.00 - 14.00 WIB)';
  if (shift === 'Siang') return 'Siang (12.00 - 19.00 WIB)';
  if (shift === 'Malam') return 'Malam (21.00 - 07.00 WIB)';
  return 'Semua Shift (Pagi / Siang / Malam)';
}

const SHIFT_SORT_ORDER: Record<ShiftType, number> = {
  Pagi: 1,
  Siang: 2,
  Malam: 3,
};

function subtractMinutes(timeStr: string, mins: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr?.trim() || '');
  if (!m) return '06:30';
  let total = Number(m[1]) * 60 + Number(m[2]) - mins;
  if (total < 0) total += 24 * 60;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function PatientReportsPage({
  patients,
  logbooks,
  reports,
  machines = [],
  staffDirectory = [],
  pjShiftAssignments = [],
}: PatientReportsPageProps) {
  const { userProfile } = useAuth();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { handlePrint } = useF4OnePagePrint({
    orientation: 'landscape',
    sheetRef,
  });
  const { todayDate: liveTodayDate } = useLiveClock();
  const [todayDate, setTodayDate] = useState(liveTodayDate);
  const [selectedPatientId, setSelectedPatientId] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState(liveTodayDate.slice(0, 7));
  const [dateFilter, setDateFilter] = useState(liveTodayDate);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | ShiftType>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'services' | 'soap'>('services');

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
    const counts = { ALL: periodServices.length, Pagi: 0, Siang: 0, Malam: 0 };
    for (const item of periodServices) {
      if (item.shift === 'Pagi' || item.shift === 'Siang' || item.shift === 'Malam') {
        counts[item.shift] += 1;
      }
    }
    return counts;
  }, [periodServices]);

  const shiftFilteredServices = useMemo(() => {
    if (shiftFilter === 'ALL') return periodServices;
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
    return filteredServices.map((s, idx) => {
      const pat = patientMap.get(s.patientId);
      const mach = machineMap.get(s.machineId);
      const sec1 = s.wizardDetails?.section1;
      const sec2 = s.wizardDetails?.section2;
      const sec3 = s.wizardDetails?.section3;
      const sec4 = s.wizardDetails?.section4;
      const sec6 = s.wizardDetails?.section6;

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
      const statusRawat = sec3?.serviceStatus || (isInpatient ? 'Rawat Inap' : 'Rawat Jalan');

      const roomCategory =
        sec3?.patientCategory ||
        mach?.roomZone ||
        (/isolasi/i.test(s.actionCategory) ? s.actionCategory : 'Reguler');

      const bedMachine = s.machineNumber || mach?.machineNumber || '-';

      const dialyzer = sec3?.dialyzerType || 'High Flux';
      const heparinDisplay =
        sec2?.loadingDose && s.heparinType !== 'Bebas Heparin'
          ? `${s.heparinType} (${sec2.loadingDose})`
          : s.heparinType;

      const hasComplication =
        Boolean(s.complications) &&
        !/^tidak ada\b/i.test(s.complications.trim()) &&
        s.complications.trim() !== '-';

      const incidentTimes = (sec4?.complicationIncidents || [])
        .map((inc) => inc.time?.trim())
        .filter(Boolean);
      const compTime = hasComplication
        ? incidentTimes.length > 0
          ? incidentTimes.join(', ')
          : s.endTime || '-'
        : '-';
      const incidentAdvices = (sec4?.complicationIncidents || [])
        .map((inc) => inc.doctorAdvice?.trim())
        .filter(Boolean);
      const dpjpAdviceDisplay = !hasComplication
        ? '-'
        : incidentAdvices.length > 0
        ? incidentAdvices.join('; ')
        : s.nursingNotes || '-';

      const machineStatus = mapMachineStatusId(mach?.status);
      const disinfectionMethod = sec6?.machineDisinfectionType
        ? sec6.machineDisinfectionType === 'Chemical Disinfection'
          ? 'Chemical Clean'
          : 'Heat Clean'
        : 'Heat Clean';

      const techNote =
        sec2 && sec2.leakTestPassed === false
          ? 'Perlu Cek'
          : /hep\s*b/i.test(roomCategory)
          ? 'Khusus Hep B'
          : /hep\s*c/i.test(roomCategory)
          ? 'Khusus Hep C'
          : mach?.notes || 'Normal';

      const roCheckTime = s.startTime ? subtractMinutes(s.startTime, 60) : '06:30';
      const roCondition = sec1?.roStatus
        ? sec1.roStatus === 'Baik'
          ? 'Memenuhi Syarat'
          : sec1.roStatus
        : 'Memenuhi Syarat';

      return {
        index: idx + 1,
        entry: s,
        statusRawat,
        roomCategory,
        bedMachine,
        durationHours,
        dryWeight,
        qbVal: qbVal && !Number.isNaN(qbVal) ? qbVal : null,
        qdVal: qdVal && !Number.isNaN(qdVal) ? qdVal : null,
        dialyzer,
        heparinDisplay,
        ktvDisplay: sec6?.ktv?.trim() || '-',
        hasComplication,
        compTime,
        dpjpAdviceDisplay,
        machineStatus,
        disinfectionMethod,
        techNote,
        roCheckTime,
        roCondition,
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

    return {
      avgDurasi,
      avgDry,
      avgPreW,
      avgPostW,
      avgQb,
      avgQd,
      totalTargetUf,
      totalAchievedUf,
    };
  }, [tableRows]);

  // Dynamic Header Metadata (matching PDF banner)
  const bannerMeta = useMemo(() => {
    const kaRuang =
      staffDirectory.find((s) => s.isActive && s.role === 'Kepala Ruang')?.fullName ||
      'Kepala Ruang HD';
    const assignedPjBanner = dateFilter
      ? shiftFilter === 'ALL'
        ? pjShiftAssignments
            .filter((a) => a.date === dateFilter)
            .sort((a, b) => a.shift.localeCompare(b.shift))
            .map((a) => `${a.shift}: ${a.pjNurseName}`)
            .join(', ')
        : pjShiftAssignments.find((a) => a.date === dateFilter && a.shift === shiftFilter)
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
      await addDoc(collection(db, 'reports'), {
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowSoapModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'reports');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    exportToCsv(
      `logbook-detail-pasien-${dateFilter || monthFilter || 'semua'}.csv`,
      [
        'NO',
        'TANGGAL',
        'SHIFT',
        'NO. RM',
        'NAMA LENGKAP PASIEN',
        'STATUS RAWAT',
        'RUANG / KATEGORI',
        'NO. BED / MESIN',
        'AKSES VASKULAR',
        'WAKTU MULAI',
        'WAKTU SELESAI',
        'DURASI (JAM)',
        'BB KERING (KG)',
        'BB PRE HD (KG)',
        'BB POST HD (KG)',
        'QB (ML/M)',
        'QD (ML/M)',
        'TARGET UF (ML)',
        'KT/V',
        'CAPAIAN UF (ML)',
        'TD PRE (MMHG)',
        'TD POST (MMHG)',
        'DIALISER',
        'HEPARINISASI',
        'KOMPLIKASI INTRA-HD',
        'JAM KOMPLIKASI',
        'TINDAKAN & ADVIS MEDIS DPJP',
        'STATUS MESIN',
        'METODE DISINFEKSI',
        'KET. TEKNIS',
        'JAM CEK RO',
        'KONDISI AIR RO',
        'PERAWAT PELAKSANA',
        'DOKTER DPJP',
        'STATUS VERIFIKASI',
      ],
      tableRows.map((r) => [
        r.index,
        r.entry.date,
        r.entry.shift,
        r.entry.patientRm,
        r.entry.patientName,
        r.statusRawat,
        r.roomCategory,
        r.bedMachine,
        r.entry.vascularAccess,
        r.entry.startTime,
        r.entry.endTime,
        r.durationHours !== null ? r.durationHours : '-',
        r.dryWeight !== null ? r.dryWeight : '-',
        r.entry.preWeight,
        r.entry.postWeight,
        r.qbVal !== null ? r.qbVal : '-',
        r.qdVal !== null ? r.qdVal : '-',
        r.entry.ufGoal,
        r.ktvDisplay,
        r.entry.ufAchieved,
        r.entry.preBp,
        r.entry.postBp,
        r.dialyzer,
        r.heparinDisplay,
        r.entry.complications || 'Tidak ada',
        r.compTime,
        r.dpjpAdviceDisplay,
        r.machineStatus,
        r.disinfectionMethod,
        r.techNote,
        r.roCheckTime,
        r.roCondition,
        r.entry.nurseName,
        r.entry.doctorName,
        r.entry.verificationStatus,
      ])
    );
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
            Menampilkan seluruh logbook (termasuk status Draft secara read-only) yang diinput oleh semua perawat sesuai tanggal dan shift yang dipilih.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            title="Cetak / Simpan PDF (F4 Landscape - 1 Halaman Penuh)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" />
            Cetak / PDF
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Ekspor CSV
          </button>
          {userProfile?.role !== 'Managerial' && (
            <button
              type="button"
              onClick={handleOpenSoapModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75]"
            >
              <Plus className="h-4 w-4" />
              Tambah Catatan SOAP
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="no-print rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm p-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <select
          aria-label="Filter Pasien"
          value={selectedPatientId}
          onChange={(e) => setSelectedPatientId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
        >
          <option value="ALL">Semua Pasien Hemodialisa</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} ({p.mrn})
            </option>
          ))}
        </select>

        <input
          type="month"
          aria-label="Filter Bulan"
          value={monthFilter}
          onChange={(e) => {
            setMonthFilter(e.target.value);
            setDateFilter('');
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
        />

        <div className="flex items-center gap-1.5">
          <input
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

        <select
          aria-label="Filter Shift"
          value={shiftFilter}
          onChange={(e) => setShiftFilter(e.target.value as 'ALL' | ShiftType)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#0B5A8E] focus:outline-none"
        >
          <option value="ALL">Semua Shift ({shiftCounts.ALL})</option>
          <option value="Pagi">Shift Pagi ({shiftCounts.Pagi})</option>
          <option value="Siang">Shift Siang ({shiftCounts.Siang})</option>
          <option value="Malam">Shift Malam ({shiftCounts.Malam})</option>
        </select>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari pasien, RM, perawat, mesin..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs focus:border-[#0B5A8E] focus:outline-none"
          />
        </div>
      </div>

      {/* Quick Shift Switcher & Contributing Nurses Summary */}
      {activeTab === 'services' && (
        <div className="no-print rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
              {(
                [
                  { id: 'Pagi', label: 'Shift Pagi', count: shiftCounts.Pagi },
                  { id: 'Siang', label: 'Shift Siang', count: shiftCounts.Siang },
                  { id: 'Malam', label: 'Shift Malam', count: shiftCounts.Malam },
                ] as const
              ).map((opt) => {
                const active = shiftFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setShiftFilter(opt.id)}
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
                Pending: <strong>{statusBreakdown.pending}</strong>
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
            <div className="f4-scroll-wrap overflow-x-auto">
              <table className="w-full border-collapse text-[11px] text-slate-800">
                <thead>
                  {/* Row 1: Grouped Category Headers */}
                  <tr className="bg-[#1b4f6e] text-white text-[10px] uppercase tracking-wider">
                    <th
                      rowSpan={2}
                      className="border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-nowrap"
                    >
                      NO
                    </th>
                    <th
                      colSpan={4}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      DATA IDENTITAS &amp; STATUS PASIEN
                    </th>
                    <th
                      colSpan={5}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      PENGATURAN TEKNIS &amp; PRE-HD
                    </th>
                    <th
                      colSpan={5}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      PARAMETER BERAT BADAN &amp; ALIRAN (QB/QD)
                    </th>
                    <th
                      colSpan={3}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      MONITORING ULTRAFILTRASI &amp; ADEKUASI
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      TANDA VITAL (HEMODINAMIK)
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      SPESIFIKASI DIALISER &amp; HEPARINISASI
                    </th>
                    <th
                      colSpan={3}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      KOMPLIKASI, TATALAKSANA &amp; ADVIS DPJP
                    </th>
                    <th
                      colSpan={3}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      STATUS OPERASIONAL MESIN &amp; DISINFEKSI
                    </th>
                    <th
                      colSpan={2}
                      className="border border-[#2d6687] px-2 py-1.5 text-center font-bold whitespace-nowrap"
                    >
                      STATUS MUTU WATER TREATMENT RO
                    </th>
                    <th
                      rowSpan={2}
                      className="border border-[#2d6687] px-2.5 py-2 text-center font-bold whitespace-nowrap"
                    >
                      PERAWAT PELAKSANA
                    </th>
                    <th
                      rowSpan={2}
                      className="no-print border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-nowrap"
                    >
                      STATUS
                    </th>
                    <th
                      rowSpan={2}
                      className="no-print border border-[#2d6687] px-2 py-2 text-center font-bold whitespace-nowrap"
                    >
                      AKSI
                    </th>
                  </tr>

                  {/* Row 2: Specific Sub-Columns */}
                  <tr className="bg-[#236084] text-white text-[9.5px] uppercase tracking-wide">
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      NO. RM
                    </th>
                    <th className="border border-[#34759b] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                      NAMA LENGKAP PASIEN
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      STATUS RAWAT
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      RUANG / KATEGORI
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      NO. BED / MESIN
                    </th>
                    <th className="border border-[#34759b] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                      AKSES VASKULAR
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      WAKTU MULAI
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      WAKTU SELESAI
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      DURASI (JAM)
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      BB KERING (KG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      BB PRE HD (KG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      BB POST HD (KG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      QB (ML/M)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      QD (ML/M)
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      TARGET UF (ML)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      KT/V
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      CAPAIAN UF (ML)
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      TD PRE (MMHG)
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      TD POST (MMHG)
                    </th>

                    <th className="border border-[#34759b] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                      DIALISER
                    </th>
                    <th className="border border-[#34759b] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                      HEPARINISASI
                    </th>

                    <th className="border border-[#34759b] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                      KOMPLIKASI INTRA-HD
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      JAM
                    </th>
                    <th className="border border-[#34759b] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap min-w-[220px]">
                      TINDAKAN &amp; ADVIS MEDIS DPJP
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      STATUS MESIN
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      METODE DISINFEKSI
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      KET. TEKNIS
                    </th>

                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      JAM CEK RO
                    </th>
                    <th className="border border-[#34759b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      KONDISI AIR RO
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {tableRows.map((row) => {
                    const s = row.entry;
                    const isIsolasi = /isolasi|hep/i.test(row.roomCategory);

                    return (
                      <tr
                        key={s.id}
                        className="odd:bg-white even:bg-slate-50/70 hover:bg-sky-50/60 transition-colors"
                      >
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums font-medium">
                          {row.index}
                        </td>

                        {/* DATA IDENTITAS & STATUS PASIEN */}
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.patientRm}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-2 font-medium text-slate-900 whitespace-nowrap">
                          {s.patientName}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          {row.statusRawat}
                        </td>
                        <td
                          className={`border border-slate-200 px-2 py-2 text-center whitespace-nowrap ${
                            isIsolasi ? 'font-bold text-slate-900' : ''
                          }`}
                        >
                          {row.roomCategory}
                        </td>

                        {/* PENGATURAN TEKNIS & PRE-HD */}
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono whitespace-nowrap">
                          {row.bedMachine}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-2 whitespace-nowrap">
                          {s.vascularAccess}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.startTime}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.endTime}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(row.durationHours, 1)}
                        </td>

                        {/* PARAMETER BERAT BADAN & ALIRAN */}
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(row.dryWeight, 1)}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(s.preWeight, 1)}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatNumId(s.postWeight, 1)}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {row.qbVal !== null ? formatIntId(row.qbVal) : '-'}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {row.qdVal !== null ? formatIntId(row.qdVal) : '-'}
                        </td>

                        {/* MONITORING ULTRAFILTRASI & ADEKUASI */}
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {formatIntId(s.ufGoal)}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap text-slate-700">
                          {row.ktvDisplay}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatIntId(s.ufAchieved)}
                        </td>

                        {/* TANDA VITAL */}
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.preBp || '-'}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {s.postBp || '-'}
                        </td>

                        {/* SPESIFIKASI DIALISER & HEPARINISASI */}
                        <td className="border border-slate-200 px-2.5 py-2 whitespace-nowrap">
                          {row.dialyzer}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-2 whitespace-nowrap">
                          {row.heparinDisplay}
                        </td>

                        {/* KOMPLIKASI, TATALAKSANA & ADVIS DPJP */}
                        <td
                          className={`border border-slate-200 px-2.5 py-2 whitespace-nowrap ${
                            row.hasComplication ? 'font-bold text-rose-700 bg-rose-50/70' : ''
                          }`}
                        >
                          {s.complications || 'Tidak ada'}
                        </td>
                        <td
                          className={`border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap ${
                            row.hasComplication ? 'font-bold text-rose-700 bg-rose-50/70' : ''
                          }`}
                        >
                          {row.compTime}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-2 max-w-[280px] print:max-w-none">
                          <span className="line-clamp-2 print:line-clamp-none" title={row.dpjpAdviceDisplay}>
                            {row.dpjpAdviceDisplay}
                          </span>
                        </td>

                        {/* STATUS OPERASIONAL MESIN & DISINFEKSI */}
                        <td className="border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          {row.machineStatus}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          {row.disinfectionMethod}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          {row.techNote}
                        </td>

                        {/* STATUS MUTU WATER TREATMENT RO */}
                        <td className="border border-slate-200 px-2 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          {row.roCheckTime}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          {row.roCondition}
                        </td>

                        {/* PERAWAT PELAKSANA */}
                        <td className="border border-slate-200 px-2.5 py-2 whitespace-nowrap">
                          <div className="font-medium text-slate-900">{s.nurseName}</div>
                          <div className="text-[10px] font-mono text-slate-500">
                            Shift {s.shift}
                          </div>
                        </td>

                        {/* STATUS VERIFIKASI */}
                        <td className="no-print border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          <VerificationBadge status={s.verificationStatus} />
                        </td>

                        {/* DETAIL BUTTON */}
                        <td className="no-print border border-slate-200 px-2 py-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDetailEntryId(s.id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                            title="Lihat Detail Lengkap 7 Bagian"
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
                        colSpan={9}
                        className="border border-slate-300 px-3 py-2 text-center uppercase tracking-wide"
                      >
                        TOTAL &amp; RATA-RATA
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {formatNumId(summaryStats.avgDurasi, 1)}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {formatNumId(summaryStats.avgDry, 1)}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {formatNumId(summaryStats.avgPreW, 1)}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {formatNumId(summaryStats.avgPostW, 1)}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {summaryStats.avgQb !== null ? formatIntId(summaryStats.avgQb) : '-'}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {summaryStats.avgQd !== null ? formatIntId(summaryStats.avgQd) : '-'}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {formatIntId(summaryStats.totalTargetUf)}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        -
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center font-mono tabular-nums">
                        {formatIntId(summaryStats.totalAchievedUf)}
                      </td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="no-print border border-slate-300 px-2 py-2 text-center">-</td>
                      <td className="no-print border border-slate-300 px-2 py-2 text-center">-</td>
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

      {/* Logbook Detail 7-Part Modal */}
      {detailEntry && (
        <LogbookDetailModal
          entry={detailEntry}
          logbooks={logbooks}
          patients={patients}
          machines={machines}
          staffDirectory={staffDirectory}
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

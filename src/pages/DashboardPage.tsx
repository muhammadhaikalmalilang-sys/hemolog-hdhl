import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Cpu,
  Database,
  FileCheck2,
  Plus,
  UserCheck,
  Users,
  UserSquare2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLiveClock } from '../hooks/useLiveClock';
import {
  formatDateId,
  formatMonthLabel,
  getDayNameId,
  isLogbookAssignedToVerifier,
  isPatientScheduledOnDay,
  isRegularPatient,
  MONTH_NAMES_ID,
} from '../lib/formatters';
import { seedInitialUnitData } from '../lib/seedData';
import { DialysisChart } from '../components/ui/DialysisChart';
import { MachineStatusBadge, ShiftBadge, VerificationBadge } from '../components/ui/StatusBadge';
import type {
  Doctor,
  LogbookEntry,
  Machine,
  MenuId,
  Patient,
  ScheduleEntry,
  StaffDirectoryEntry,
} from '../types';

interface DashboardPageProps {
  logbooks: LogbookEntry[];
  approvedLogbooks: LogbookEntry[];
  patients: Patient[];
  doctors: Doctor[];
  machines: Machine[];
  staffDirectory: StaffDirectoryEntry[];
  schedules: ScheduleEntry[];
  onNavigate: (menu: MenuId) => void;
}

export function DashboardPage({
  logbooks,
  approvedLogbooks,
  patients,
  doctors,
  machines,
  staffDirectory,
  onNavigate,
}: DashboardPageProps) {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const {
    todayDate: liveTodayDate,
    currentMonthKey: realCurrentMonthKey,
    currentShift: liveCurrentShift,
  } = useLiveClock();
  const [trackedMonthKey, setTrackedMonthKey] = useState(realCurrentMonthKey);
  const [realYearStr, realMonthStr] = realCurrentMonthKey.split('-');
  const realYear = Number(realYearStr);
  const realMonth = Number(realMonthStr);

  const [selectedYear, setSelectedYear] = useState<number>(realYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(realMonth);
  const [seeding, setSeeding] = useState(false);
  const [seedFeedback, setSeedFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (realCurrentMonthKey !== trackedMonthKey) {
      const [prevY, prevM] = trackedMonthKey.split('-').map(Number);
      setTrackedMonthKey(realCurrentMonthKey);
      if (selectedYear === prevY && selectedMonth === prevM) {
        setSelectedYear(realYear);
        setSelectedMonth(realMonth);
      }
    }
  }, [realCurrentMonthKey, trackedMonthKey, realYear, realMonth, selectedYear, selectedMonth]);

  if (!userProfile) return null;

  const isAdmin = userProfile.role === 'Administrator';
  const isManagerial = userProfile.role === 'Managerial';
  const isClinical =
    userProfile.role === 'Kepala Ruang' ||
    userProfile.role === 'PJ Shift' ||
    userProfile.role === 'Perawat Pelaksana';

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const selectedMonthName = MONTH_NAMES_ID[selectedMonth - 1] || '';

  const availableYears = useMemo(() => {
    const years = new Set<number>([realYear - 1, realYear, realYear + 1]);
    for (const lb of logbooks) {
      const y = Number(lb.monthKey.slice(0, 4));
      if (y > 2000) years.add(y);
    }
    return Array.from(years).sort((a, b) => a - b);
  }, [logbooks, realYear]);

  const monthlyApprovedUnit = useMemo(
    () => approvedLogbooks.filter((l) => l.monthKey === selectedMonthKey),
    [approvedLogbooks, selectedMonthKey]
  );

  const monthlyApprovedPersonal = useMemo(
    () =>
      approvedLogbooks.filter(
        (l) => l.monthKey === selectedMonthKey && l.nurseId === userProfile.uid
      ),
    [approvedLogbooks, selectedMonthKey, userProfile.uid]
  );

  const personalActiveDaysCount = useMemo(
    () => new Set(monthlyApprovedPersonal.map((l) => l.date)).size,
    [monthlyApprovedPersonal]
  );

  const unitActiveDaysCount = useMemo(
    () => new Set(monthlyApprovedUnit.map((l) => l.date)).size,
    [monthlyApprovedUnit]
  );

  const monthlyAllUnit = useMemo(
    () => logbooks.filter((l) => l.monthKey === selectedMonthKey),
    [logbooks, selectedMonthKey]
  );

  const pendingCount = useMemo(
    () =>
      logbooks.filter(
        (l) =>
          l.verificationStatus === 'Pending' &&
          isLogbookAssignedToVerifier(l, userProfile)
      ).length,
    [logbooks, userProfile]
  );

  const regularPatients = useMemo(
    () => patients.filter((p) => isRegularPatient(p)),
    [patients]
  );

  const nonRegularPatientsCount = useMemo(
    () => patients.filter((p) => !isRegularPatient(p)).length,
    [patients]
  );

  const activePatientsCount = useMemo(
    () => regularPatients.filter((p) => p.status === 'Aktif').length,
    [regularPatients]
  );

  const activeStaffCount = useMemo(
    () => staffDirectory.filter((s) => s.isActive).length,
    [staffDirectory]
  );

  const readyMachinesCount = useMemo(
    () => machines.filter((m) => m.status === 'Ready' || m.status === 'In Use').length,
    [machines]
  );

  const complicationRate = useMemo(() => {
    if (monthlyApprovedUnit.length === 0) return '0.0';
    const withComp = monthlyApprovedUnit.filter(
      (l) =>
        l.complications &&
        l.complications.toLowerCase() !== 'tidak ada' &&
        l.complications.trim() !== '-'
    ).length;
    return ((withComp / monthlyApprovedUnit.length) * 100).toFixed(1);
  }, [monthlyApprovedUnit]);

  const topNurseSummary = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; ufTotal: number }>();
    for (const item of monthlyApprovedUnit) {
      const existing = counts.get(item.nurseId) || { name: item.nurseName, count: 0, ufTotal: 0 };
      existing.count += 1;
      existing.ufTotal += Number(item.ufAchieved || 0);
      counts.set(item.nurseId, existing);
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [monthlyApprovedUnit]);

  const shiftProgress = useMemo(() => {
    const dayName = getDayNameId(liveTodayDate);
    const scheduled = regularPatients.filter(
      (p) => p.status === 'Aktif' && isPatientScheduledOnDay(p.routineSchedule, dayName, liveCurrentShift)
    );
    const scheduledIds = new Set(scheduled.map((p) => p.id));
    const slotLogs = logbooks.filter(
      (l) => l.date === liveTodayDate && l.shift === liveCurrentShift
    );
    const coveredScheduledIds = new Set(
      slotLogs.filter((l) => scheduledIds.has(l.patientId)).map((l) => l.patientId)
    );
    const approvedCount = slotLogs.filter((l) => l.verificationStatus === 'Approved').length;
    const pendingVerifyCount = slotLogs.filter((l) => l.verificationStatus === 'Pending').length;
    const draftCount = slotLogs.filter(
      (l) => l.verificationStatus === 'Draft' || l.verificationStatus === 'Revision'
    ).length;
    const totalScheduled = scheduled.length;
    const inputtedScheduled = coveredScheduledIds.size;
    const remainingScheduled = Math.max(0, totalScheduled - inputtedScheduled);
    const pct =
      totalScheduled > 0
        ? Math.min(100, Math.round((inputtedScheduled / totalScheduled) * 100))
        : slotLogs.length > 0
        ? 100
        : 0;

    return {
      dayName,
      totalScheduled,
      inputtedScheduled,
      remainingScheduled,
      totalSlotLogs: slotLogs.length,
      approvedCount,
      pendingVerifyCount,
      draftCount,
      pct,
    };
  }, [regularPatients, logbooks, liveTodayDate, liveCurrentShift]);

  const handleSeedMaster = async () => {
    setSeeding(true);
    setSeedFeedback(null);
    try {
      await seedInitialUnitData({
        machinesCount: machines.length,
        doctorsCount: doctors.length,
        patientsCount: patients.length,
        categoriesCount: 0,
        userId: userProfile.uid,
        userName: userProfile.fullName,
      });
      const msg =
        'Data master awal (dokter, mesin HD, kategori tindakan, pasien & jadwal awal) berhasil disimpan ke Supabase.';
      setSeedFeedback(msg);
      showToast(msg, 'success');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Gagal menyimpan data awal.';
      setSeedFeedback(errMsg);
      showToast(errMsg, 'error');
    } finally {
      setSeeding(false);
    }
  };

  const needsInitialMasterSeed =
    isAdmin && patients.length === 0 && doctors.length === 0 && machines.length === 0;

  return (
    <div className="space-y-5">
      {/* Top Section Title & Month/Year Period Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-lg sm:text-xl font-bold uppercase tracking-tight text-slate-900">
          DASHBOARD
        </h2>

        <div className="flex flex-wrap items-center gap-2.5">
          {needsInitialMasterSeed && (
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeedMaster}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-white disabled:opacity-60"
            >
              <Database className="h-3.5 w-3.5 text-[#0B5A8E]" />
              {seeding ? 'Menginisialisasi...' : 'Isi Data Master Awal'}
            </button>
          )}

          {isClinical && (
            <button
              type="button"
              onClick={() => onNavigate('logbook')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B5A8E] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#094a75]"
            >
              <Plus className="h-3.5 w-3.5" />
              Input Logbook HD
            </button>
          )}

          {/* Month / Year Filter Pill Bar */}
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 shadow-sm">
            <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <select
              aria-label="Pilih Bulan Fokus"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              {MONTH_NAMES_ID.map((name, idx) => {
                const mNum = idx + 1;
                const isCurrent = selectedYear === realYear && mNum === realMonth;
                return (
                  <option key={name} value={mNum}>
                    {name}
                    {isCurrent ? ' (Berjalan)' : ''}
                  </option>
                );
              })}
            </select>
            <span className="text-xs text-slate-300">/</span>
            <select
              aria-label="Pilih Tahun Fokus"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent font-mono text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer tabular-nums"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {seedFeedback && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/95 px-4 py-3 text-xs font-medium text-teal-800 shadow-sm">
          {seedFeedback}
        </div>
      )}

      {needsInitialMasterSeed && !seedFeedback && (
        <div className="rounded-2xl border border-sky-200 bg-white/95 backdrop-blur-sm p-4 text-sm text-sky-900 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-semibold">Database Master Unit Hemodialisa Masih Kosong</p>
            <p className="text-xs text-sky-800 mt-0.5">
              Klik tombol di samping untuk mengisi data awal Dokter DPJP, Mesin HD, Pasien, dan
              Kategori Tindakan ke database Supabase agar perawat langsung dapat menginput logbook.
            </p>
          </div>
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedMaster}
            className="shrink-0 rounded-lg bg-[#0B5A8E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#094a75]"
          >
            {seeding ? 'Memproses...' : 'Inisialisasi Data Master'}
          </button>
        </div>
      )}

      {(isClinical || isAdmin) && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-4 shadow-sm space-y-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-bold text-slate-900">
                Progres Shift {liveCurrentShift} Hari Ini ({shiftProgress.dayName},{' '}
                {formatDateId(liveTodayDate)})
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="text-slate-700 font-mono tabular-nums">
                {shiftProgress.totalScheduled > 0 ? (
                  <>
                    <strong className="text-[#0B5A8E]">
                      {shiftProgress.inputtedScheduled}/{shiftProgress.totalScheduled}
                    </strong>{' '}
                    pasien terjadwal terinput
                    {shiftProgress.remainingScheduled > 0 && (
                      <span className="text-amber-700 font-semibold">
                        {' '}
                        ({shiftProgress.remainingScheduled} belum)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <strong className="text-[#0B5A8E]">{shiftProgress.totalSlotLogs}</strong>{' '}
                    logbook terinput
                  </>
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-slate-600">
              <span className="text-emerald-700 font-semibold">
                Approved: {shiftProgress.approvedCount}
              </span>
              <span className="text-amber-700 font-semibold">
                Menunggu Verifikasi: {shiftProgress.pendingVerifyCount}
              </span>
              {shiftProgress.draftCount > 0 && (
                <span className="text-slate-600">Draft/Revisi: {shiftProgress.draftCount}</span>
              )}
              {isClinical && shiftProgress.remainingScheduled > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('logbook')}
                  className="font-sans font-semibold text-[#0B5A8E] hover:underline"
                >
                  Lanjut Input &rarr;
                </button>
              )}
            </div>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#0B5A8E] transition-all duration-300"
              style={{ width: `${shiftProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {(userProfile.role === 'Kepala Ruang' || userProfile.role === 'PJ Shift') &&
        pendingCount > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/95 backdrop-blur-sm p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2.5 text-amber-900">
              <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">
                  Antrian Verifikasi: {pendingCount} Logbook Menunggu Validasi
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Terdapat {pendingCount} logbook yang diajukan kepada akun Anda ({userProfile.fullName}).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('verifikasi')}
              className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Buka Antrian Verifikasi
            </button>
          </div>
        )}

      {/* KPI Row by Role */}
      {isClinical && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 sm:p-6 shadow-sm flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-700">
                Jumlah Treatmen yang Dikelola Pribadi ({selectedMonthName})
              </p>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums">
                  {monthlyApprovedPersonal.length}
                </span>
                <span className="text-xs font-medium text-slate-600">Treatmen</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Akumulasi dari{' '}
                <strong className="font-semibold text-slate-700 tabular-nums">
                  {personalActiveDaysCount} hari dinas
                </strong>{' '}
                terverifikasi
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 border border-teal-100">
              <UserCheck className="h-5 w-5" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 sm:p-6 shadow-sm flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-700">
                Jumlah Treatmen Unit HD ({selectedMonthName})
              </p>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums">
                  {monthlyApprovedUnit.length}
                </span>
                <span className="text-xs font-medium text-slate-600">Treatmen</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Akumulasi dari{' '}
                <strong className="font-semibold text-slate-700 tabular-nums">
                  {unitActiveDaysCount} hari layanan
                </strong>{' '}
                Unit HD
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0B5A8E] border border-sky-100">
              <Users className="h-5 w-5" />
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Perawat & Staf Aktif</span>
              <Users className="h-4 w-4 text-teal-600" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {activeStaffCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">Terdaftar di direktori unit</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Mesin HD Siap / Terpakai</span>
              <Cpu className="h-4 w-4 text-[#0B5A8E]" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {readyMachinesCount}{' '}
              <span className="text-sm font-normal text-slate-400">/ {machines.length}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">Status Ready & In Use</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Pasien Reguler Aktif</span>
              <UserSquare2 className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {activePatientsCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Dari {regularPatients.length} pasien reguler
              {nonRegularPatientsCount > 0 ? ` · ${nonRegularPatientsCount} non-reguler` : ''}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Logbook ({selectedMonthName})</span>
              <FileCheck2 className="h-4 w-4 text-indigo-600" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {monthlyAllUnit.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {monthlyApprovedUnit.length} terverifikasi · {pendingCount} menunggu verifikasi
            </p>
          </div>
        </div>
      )}

      {isManagerial && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">
                Treatment Terverifikasi ({selectedMonthName})
              </span>
              <CheckCircle2 className="h-4 w-4 text-teal-600" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {monthlyApprovedUnit.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Dari {monthlyAllUnit.length} total entri bulan ini
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Kesiapan Mesin HD</span>
              <Cpu className="h-4 w-4 text-[#0B5A8E]" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {machines.length > 0 ? Math.round((readyMachinesCount / machines.length) * 100) : 0}%
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {readyMachinesCount} dari {machines.length} unit operasional
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Rasio Insiden / Komplikasi</span>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {complicationRate}%
            </p>
            <p className="mt-1 text-xs text-slate-500">Pada sesi HD terverifikasi</p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">Pasien Rutin Aktif</span>
              <UserSquare2 className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {activePatientsCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Didukung {doctors.filter((d) => d.status === 'Aktif').length} Dokter DPJP
            </p>
          </div>
        </div>
      )}

      {/* 12-Month Dialysis Chart with Focused Month */}
      <DialysisChart
        logbooks={isClinical ? approvedLogbooks : logbooks}
        year={selectedYear}
        focusedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
        primarySeriesLabel={isClinical ? 'Pribadi' : 'Terverifikasi'}
        secondarySeriesLabel={isClinical ? 'Unit HD' : 'Total Unit'}
        primaryMatchUserId={isClinical ? userProfile.uid : undefined}
      />

      {/* Bottom Split Section: Machine Status / Nurse Performance & Recent Logbooks */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {isManagerial ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm lg:col-span-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Performa Perawat ({formatMonthLabel(selectedMonthKey)})
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('laporan_bulanan')}
                className="text-xs font-semibold text-[#0B5A8E] hover:underline"
              >
                Lihat Semua
              </button>
            </div>
            {topNurseSummary.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                Belum ada tindakan terverifikasi pada bulan {formatMonthLabel(selectedMonthKey)}.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {topNurseSummary.map((n) => (
                  <div key={n.name} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-medium text-slate-800 truncate pr-3">{n.name}</span>
                    <div className="text-right shrink-0">
                      <span className="font-mono text-xs font-semibold text-[#0B5A8E] tabular-nums">
                        {n.count} tindakan
                      </span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {(n.ufTotal / 1000).toFixed(1)} L UF
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm lg:col-span-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Status Mesin Hemodialisa</h3>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => onNavigate('data_mesin')}
                  className="text-xs font-semibold text-[#0B5A8E] hover:underline"
                >
                  Kelola Mesin
                </button>
              )}
            </div>
            {machines.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">Belum ada data mesin HD terdaftar.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {machines.slice(0, 6).map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0 pr-3">
                      <p className="font-mono text-xs font-semibold text-slate-900">
                        {m.machineNumber} ·{' '}
                        <span className="font-sans font-normal text-slate-600">{m.brand}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {m.roomZone || 'Unit HD'}
                      </p>
                    </div>
                    <MachineStatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 shadow-sm lg:col-span-7">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Tindakan Logbook Terbaru</h3>
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  isAdmin
                    ? 'master_logbook'
                    : isManagerial
                    ? 'laporan_pasien'
                    : userProfile.role === 'Perawat Pelaksana'
                    ? 'riwayat'
                    : 'logbook'
                )
              }
              className="text-xs font-semibold text-[#0B5A8E] hover:underline"
            >
              Lihat Detail
            </button>
          </div>
          {logbooks.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-6 text-center">
              <p className="text-sm font-medium text-slate-700">Belum ada catatan logbook</p>
              <p className="mt-1 text-xs text-slate-500">
                Data logbook tindakan hemodialisa akan tampil secara real-time di sini.
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-2.5 font-semibold">Tanggal</th>
                    <th className="pb-2.5 font-semibold">Pasien</th>
                    <th className="pb-2.5 font-semibold">Mesin</th>
                    <th className="pb-2.5 font-semibold">Shift</th>
                    <th className="pb-2.5 font-semibold">Perawat</th>
                    <th className="pb-2.5 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logbooks.slice(0, 6).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatDateId(item.date)}
                      </td>
                      <td className="py-2.5 font-medium text-slate-900">{item.patientName}</td>
                      <td className="py-2.5 font-mono text-slate-600">{item.machineNumber}</td>
                      <td className="py-2.5">
                        <ShiftBadge shift={item.shift} />
                      </td>
                      <td className="py-2.5 text-slate-600">{item.nurseName}</td>
                      <td className="py-2.5 text-right">
                        <VerificationBadge status={item.verificationStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

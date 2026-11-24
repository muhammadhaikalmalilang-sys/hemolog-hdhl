import React, { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { useUnitData } from './hooks/useUnitData';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { RoleGuard } from './components/auth/RoleGuard';
import { SidebarLayout } from './components/layout/SidebarLayout';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { reconnectSupabase, SUPABASE_PROJECT_ID } from './lib/supabase';
import { isLogbookAssignedToVerifier } from './lib/formatters';
import { ROLE_MENUS, type MenuId } from './types';

const loadLoginPage = () =>
  import('./components/auth/LoginPage').then((m) => ({ default: m.LoginPage }));
const loadIdleTimeoutModal = () =>
  import('./components/auth/IdleTimeoutModal').then((m) => ({ default: m.IdleTimeoutModal }));

const pageLoaders: Record<MenuId, () => Promise<{ default: React.ComponentType<any> }>> = {
  dashboard: () => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
  logbook: () => import('./pages/LogbookPage').then((m) => ({ default: m.LogbookPage })),
  master_logbook: () => import('./pages/LogbookPage').then((m) => ({ default: m.LogbookPage })),
  verifikasi: () => import('./pages/VerificationPage').then((m) => ({ default: m.VerificationPage })),
  riwayat: () => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
  laporan_pasien: () => import('./pages/PatientReportsPage').then((m) => ({ default: m.PatientReportsPage })),
  laporan_pj_shift: () => import('./pages/PjShiftReportsPage').then((m) => ({ default: m.PjShiftReportsPage })),
  laporan_bulanan: () => import('./pages/MonthlyReportsPage').then((m) => ({ default: m.MonthlyReportsPage })),
  jadwal_dinas: () => import('./pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
  data_pasien: () => import('./pages/PatientsPage').then((m) => ({ default: m.PatientsPage })),
  data_dokter: () => import('./pages/DoctorsPage').then((m) => ({ default: m.DoctorsPage })),
  data_mesin: () => import('./pages/MachinesPage').then((m) => ({ default: m.MachinesPage })),
  data_akun: () => import('./pages/AccountsPage').then((m) => ({ default: m.AccountsPage })),
  my_account: () => import('./pages/MyAccountPage').then((m) => ({ default: m.MyAccountPage })),
};

const LoginPage = lazy(loadLoginPage);
const IdleTimeoutModal = lazy(loadIdleTimeoutModal);
const DashboardPage = lazy(pageLoaders.dashboard);
const LogbookPage = lazy(pageLoaders.logbook);
const VerificationPage = lazy(pageLoaders.verifikasi);
const HistoryPage = lazy(pageLoaders.riwayat);
const PatientReportsPage = lazy(pageLoaders.laporan_pasien);
const PjShiftReportsPage = lazy(pageLoaders.laporan_pj_shift);
const MonthlyReportsPage = lazy(pageLoaders.laporan_bulanan);
const SchedulesPage = lazy(pageLoaders.jadwal_dinas);
const PatientsPage = lazy(pageLoaders.data_pasien);
const DoctorsPage = lazy(pageLoaders.data_dokter);
const MachinesPage = lazy(pageLoaders.data_mesin);
const AccountsPage = lazy(pageLoaders.data_akun);
const MyAccountPage = lazy(pageLoaders.my_account);

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse" />
        <div className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse" />
        <div className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse" />
      </div>
      <div className="h-72 rounded-xl border border-slate-200 bg-white animate-pulse" />
    </div>
  );
}

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="mt-4 font-display text-lg font-bold text-slate-900">
              Terjadi Kendala Koneksi / Akses Data
            </h2>
            <p className="mt-2 text-xs text-slate-600 break-words">{this.state.message}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  void reconnectSupabase(true);
                  this.setState({ hasError: false, message: '' });
                }}
                className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
              >
                Coba Sambungkan Ulang
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Muat Ulang Aplikasi
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function WorkspaceShell() {
  const {
    authUser,
    userProfile,
    authReady,
    profileLoading,
    supabaseConfigured,
    profileError,
    retryProfile,
    logout,
    logoutDueToIdle,
  } = useAuth();
  const [activeMenu, setActiveMenu] = useState<MenuId>('dashboard');
  const [copiedGrantSql, setCopiedGrantSql] = useState(false);

  const isAuthenticated = authReady && !profileLoading && Boolean(authUser && userProfile);
  const { showWarning, remainingSeconds, resetActivity } = useIdleTimeout({
    enabled: isAuthenticated,
    onTimeout: logoutDueToIdle,
  });

  const {
    loading,
    archiveLoading,
    ensureMonthLoaded,
    ensureAllArchivesLoaded,
    ensureLogbookDetailsByIds,
    ensureMonthDetailsLoaded,
    ensureAllArchiveDetailsLoaded,
    patients,
    doctors,
    machines,
    actionCategories,
    staffDirectory,
    allUsers,
    ownLogbooks,
    approvedLogbooks,
    allLogbooks,
    logbookLocks,
    machineLocks,
    schedules,
    pjShiftAssignments,
    doctorSchedules,
    allReports,
    formTemplate,
  } = useUnitData();

  const prefetchMenu = useCallback((menuId: MenuId) => {
    const loader = pageLoaders[menuId];
    if (loader) {
      void loader().catch(() => undefined);
    }
  }, []);

  // Keep activeMenu valid when role changes
  useEffect(() => {
    if (!userProfile) return;
    const allowed = ROLE_MENUS[userProfile.role]?.map((m) => m.id) || ['dashboard'];
    if (!allowed.includes(activeMenu)) {
      setActiveMenu('dashboard');
    }
  }, [userProfile?.role, activeMenu]);

  // Warm the most frequent role routes during browser idle so tab switches are instant
  useEffect(() => {
    if (!isAuthenticated || !userProfile) return;
    const allowedIds = (ROLE_MENUS[userProfile.role] || []).map((m) => m.id);
    const priorityMenus: MenuId[] = ['logbook', 'verifikasi', 'master_logbook', 'laporan_bulanan', 'riwayat'];
    const targets = priorityMenus.filter((id) => allowedIds.includes(id));

    const runPrefetch = () => {
      targets.forEach((id) => {
        void pageLoaders[id]?.().catch(() => undefined);
      });
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(runPrefetch, { timeout: 1500 });
      return () => {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleId);
        }
      };
    }

    const timer = globalThis.setTimeout(runPrefetch, 900);
    return () => globalThis.clearTimeout(timer);
  }, [isAuthenticated, userProfile?.role]);

  const pendingVerificationCount = useMemo(
    () =>
      allLogbooks.filter(
        (l) =>
          l.verificationStatus === 'Pending' &&
          isLogbookAssignedToVerifier(l, userProfile)
      ).length,
    [allLogbooks, userProfile]
  );

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-xl border border-amber-200 bg-white p-6 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Menunggu Konfigurasi Supabase ({SUPABASE_PROJECT_ID})
              </h2>
              <p className="text-xs text-slate-500">
                Firebase telah diputuskan dari aplikasi HemoLog HDHL.
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Tambahkan environment variable{' '}
            <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              VITE_SUPABASE_ANON_KEY
            </code>{' '}
            untuk project Supabase{' '}
            <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              {SUPABASE_PROJECT_ID}
            </code>{' '}
            dan jalankan file{' '}
            <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
              supabase/schema.sql
            </code>{' '}
            di Supabase SQL Editor agar autentikasi dan database aktif.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady || profileLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-white">
          <Activity className="h-6 w-6 animate-pulse" />
        </div>
        <p className="text-sm font-medium text-slate-600">
          Menghubungkan ke Unit Hemodialisa...
        </p>
      </div>
    );
  }

  if (authUser && profileError) {
    const isPermissionError =
      profileError.includes('42501') ||
      profileError.toLowerCase().includes('permission denied');
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-xl border border-rose-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                {isPermissionError
                  ? 'Hak Akses Tabel Supabase Belum Diberikan'
                  : 'Gagal Memuat Profil Pengguna'}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                {isPermissionError
                  ? `Database Supabase (${SUPABASE_PROJECT_ID}) menolak akses ke tabel users. Pastikan Anda telah menjalankan seluruh isi skrip supabase/schema.sql (termasuk perintah GRANT ke role authenticated) di Supabase SQL Editor.`
                  : 'Terjadi kendala saat mengambil profil akun Anda dari database Supabase.'}
              </p>
            </div>
          </div>

          {isPermissionError && (
            <div className="space-y-2">
              <pre className="rounded-lg bg-slate-900 p-3 text-[11px] font-mono text-slate-100 overflow-x-auto leading-relaxed">
{`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;`}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const sql = `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;\nGRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;\nGRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;\nGRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;\nGRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;`;
                    void navigator.clipboard?.writeText(sql).then(() => {
                      setCopiedGrantSql(true);
                      window.setTimeout(() => setCopiedGrantSql(false), 2500);
                    });
                  }}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedGrantSql ? 'SQL Tersalin!' : 'Salin Skrip SQL'}
                </button>
                <a
                  href={`https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}/sql/new`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                >
                  Buka Supabase SQL Editor →
                </a>
              </div>
            </div>
          )}

          <p className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5 break-all">
            {profileError}
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={retryProfile}
              className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
            >
              Coba Muat Ulang Profil
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Keluar / Ganti Akun
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!authUser || !userProfile) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B5A8E] text-white">
              <Activity className="h-6 w-6 animate-pulse" />
            </div>
            <p className="text-sm font-medium text-slate-600">Memuat halaman masuk...</p>
          </div>
        }
      >
        <LoginPage />
      </Suspense>
    );
  }

  const renderPage = () => {
    if (loading && allLogbooks.length === 0 && patients.length === 0) {
      return <PageSkeleton />;
    }

    switch (activeMenu) {
      case 'dashboard':
        return (
          <DashboardPage
            logbooks={allLogbooks}
            approvedLogbooks={approvedLogbooks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            staffDirectory={staffDirectory}
            schedules={schedules}
            onNavigate={setActiveMenu}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
          />
        );
      case 'logbook':
        return (
          <LogbookPage
            mode="nurse"
            logbooks={allLogbooks}
            logbookLocks={logbookLocks}
            machineLocks={machineLocks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            schedules={schedules}
            doctorSchedules={doctorSchedules}
            pjShiftAssignments={pjShiftAssignments}
            formTemplate={formTemplate}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
            onEnsureAllArchivesLoaded={ensureAllArchivesLoaded}
            onEnsureLogbookDetailsByIds={ensureLogbookDetailsByIds}
          />
        );
      case 'master_logbook':
        return (
          <LogbookPage
            mode="master"
            logbooks={allLogbooks}
            logbookLocks={logbookLocks}
            machineLocks={machineLocks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            schedules={schedules}
            doctorSchedules={doctorSchedules}
            pjShiftAssignments={pjShiftAssignments}
            formTemplate={formTemplate}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
            onEnsureAllArchivesLoaded={ensureAllArchivesLoaded}
            onEnsureLogbookDetailsByIds={ensureLogbookDetailsByIds}
          />
        );
      case 'verifikasi':
        return (
          <VerificationPage
            logbooks={allLogbooks}
            logbookLocks={logbookLocks}
            machineLocks={machineLocks}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            formTemplate={formTemplate}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
            onEnsureAllArchivesLoaded={ensureAllArchivesLoaded}
            onEnsureLogbookDetailsByIds={ensureLogbookDetailsByIds}
          />
        );
      case 'riwayat':
        return (
          <HistoryPage
            logbooks={ownLogbooks}
            reports={allReports}
            patients={patients}
            doctors={doctors}
            machines={machines}
            actionCategories={actionCategories}
            staffDirectory={staffDirectory}
            machineLocks={machineLocks}
            formTemplate={formTemplate}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
            onEnsureAllArchivesLoaded={ensureAllArchivesLoaded}
          />
        );
      case 'laporan_pasien':
        return (
          <PatientReportsPage
            patients={patients}
            logbooks={allLogbooks}
            reports={allReports}
            machines={machines}
            staffDirectory={staffDirectory}
            pjShiftAssignments={pjShiftAssignments}
            formTemplate={formTemplate}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
            onEnsureAllArchivesLoaded={ensureAllArchivesLoaded}
            onEnsureMonthDetailsLoaded={ensureMonthDetailsLoaded}
            onEnsureAllArchiveDetailsLoaded={ensureAllArchiveDetailsLoaded}
            onEnsureLogbookDetailsByIds={ensureLogbookDetailsByIds}
          />
        );
      case 'laporan_pj_shift':
        return (
          <PjShiftReportsPage
            reports={allReports}
            logbooks={allLogbooks}
            patients={patients}
            machines={machines}
            schedules={schedules}
            doctorSchedules={doctorSchedules}
            staffDirectory={staffDirectory}
            pjShiftAssignments={pjShiftAssignments}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
            onEnsureLogbookDetailsByIds={ensureLogbookDetailsByIds}
          />
        );
      case 'laporan_bulanan':
        return (
          <MonthlyReportsPage
            logbooks={allLogbooks}
            staffDirectory={staffDirectory}
            reports={allReports}
            formTemplate={formTemplate}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthDetailsLoaded}
          />
        );
      case 'jadwal_dinas':
        return (
          <SchedulesPage
            schedules={schedules}
            pjShiftAssignments={pjShiftAssignments}
            doctorSchedules={doctorSchedules}
            doctors={doctors}
            staffDirectory={staffDirectory}
            archiveLoading={archiveLoading}
            onEnsureMonthLoaded={ensureMonthLoaded}
          />
        );
      case 'data_pasien':
        return <PatientsPage patients={patients} />;
      case 'data_dokter':
        return <DoctorsPage doctors={doctors} />;
      case 'data_mesin':
        return <MachinesPage machines={machines} />;
      case 'data_akun':
        return <AccountsPage users={allUsers} />;
      case 'my_account':
        return <MyAccountPage />;
      default:
        return null;
    }
  };

  return (
    <>
      <SidebarLayout
        activeMenu={activeMenu}
        onSelectMenu={setActiveMenu}
        onPrefetchMenu={prefetchMenu}
        pendingVerificationCount={pendingVerificationCount}
        schedules={schedules}
      >
        <RoleGuard
          menuId={activeMenu}
          onBackToDashboard={() => setActiveMenu('dashboard')}
        >
          <Suspense fallback={<PageSkeleton />}>{renderPage()}</Suspense>
        </RoleGuard>
      </SidebarLayout>
      {showWarning && (
        <Suspense fallback={null}>
          <IdleTimeoutModal
            isOpen={showWarning}
            remainingSeconds={remainingSeconds}
            onExtend={resetActivity}
            onLogoutNow={() => {
              void logout();
            }}
          />
        </Suspense>
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceShell />
          <OfflineIndicator />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

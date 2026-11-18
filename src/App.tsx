import React, { Component, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useUnitData } from './hooks/useUnitData';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { LoginPage } from './components/auth/LoginPage';
import { IdleTimeoutModal } from './components/auth/IdleTimeoutModal';
import { RoleGuard } from './components/auth/RoleGuard';
import { SidebarLayout } from './components/layout/SidebarLayout';
import { DashboardPage } from './pages/DashboardPage';
import { LogbookPage } from './pages/LogbookPage';
import { VerificationPage } from './pages/VerificationPage';
import { HistoryPage } from './pages/HistoryPage';
import { PatientReportsPage } from './pages/PatientReportsPage';
import { PjShiftReportsPage } from './pages/PjShiftReportsPage';
import { MonthlyReportsPage } from './pages/MonthlyReportsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { PatientsPage } from './pages/PatientsPage';
import { DoctorsPage } from './pages/DoctorsPage';
import { MachinesPage } from './pages/MachinesPage';
import { AccountsPage } from './pages/AccountsPage';
import { MyAccountPage } from './pages/MyAccountPage';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { reconnectFirestore } from './lib/firebase';
import { isLogbookAssignedToVerifier } from './lib/formatters';
import { ROLE_MENUS, type MenuId } from './types';

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
                  void reconnectFirestore(true);
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
    firebaseUser,
    userProfile,
    authReady,
    profileLoading,
    logout,
    logoutDueToIdle,
  } = useAuth();
  const [activeMenu, setActiveMenu] = useState<MenuId>('dashboard');

  const isAuthenticated = authReady && !profileLoading && Boolean(firebaseUser && userProfile);
  const { showWarning, remainingSeconds, resetActivity } = useIdleTimeout({
    enabled: isAuthenticated,
    onTimeout: logoutDueToIdle,
  });

  const {
    loading,
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
  } = useUnitData();

  // Keep activeMenu valid when role changes
  useEffect(() => {
    if (!userProfile) return;
    const allowed = ROLE_MENUS[userProfile.role]?.map((m) => m.id) || ['dashboard'];
    if (!allowed.includes(activeMenu)) {
      setActiveMenu('dashboard');
    }
  }, [userProfile?.role, activeMenu]);

  const pendingVerificationCount = useMemo(
    () =>
      allLogbooks.filter(
        (l) =>
          l.verificationStatus === 'Pending' &&
          isLogbookAssignedToVerifier(l, userProfile)
      ).length,
    [allLogbooks, userProfile]
  );

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

  if (!firebaseUser || !userProfile) {
    return <LoginPage />;
  }

  const renderPage = () => {
    if (loading && allLogbooks.length === 0 && patients.length === 0) {
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
          />
        );
      case 'laporan_bulanan':
        return (
          <MonthlyReportsPage
            logbooks={allLogbooks}
            staffDirectory={staffDirectory}
            reports={allReports}
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
        pendingVerificationCount={pendingVerificationCount}
        schedules={schedules}
      >
        <RoleGuard
          menuId={activeMenu}
          onBackToDashboard={() => setActiveMenu('dashboard')}
        >
          {renderPage()}
        </RoleGuard>
      </SidebarLayout>
      <IdleTimeoutModal
        isOpen={showWarning}
        remainingSeconds={remainingSeconds}
        onExtend={resetActivity}
        onLogoutNow={() => {
          void logout();
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WorkspaceShell />
        <OfflineIndicator />
      </AuthProvider>
    </ErrorBoundary>
  );
}

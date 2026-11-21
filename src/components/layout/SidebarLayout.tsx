import React, { useMemo, useState } from 'react';
import {
  Gauge,
  ClipboardList,
  FolderKanban,
  FileText,
  FileCheck2,
  BarChart3,
  CheckSquare,
  History,
  CalendarDays,
  Calendar,
  Clock,
  ShieldCheck,
  Stethoscope,
  Users,
  UserSquare2,
  Cpu,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLiveClock } from '../../hooks/useLiveClock';
import { formatFullDayDateId } from '../../lib/formatters';
import { ROLE_MENUS, type MenuId, type ScheduleEntry } from '../../types';

const MENU_ICONS: Record<MenuId, React.ComponentType<{ className?: string }>> = {
  dashboard: Gauge,
  logbook: ClipboardList,
  master_logbook: FolderKanban,
  laporan_pasien: FileText,
  laporan_pj_shift: FileCheck2,
  laporan_bulanan: BarChart3,
  verifikasi: CheckSquare,
  riwayat: History,
  jadwal_dinas: CalendarDays,
  data_dokter: Stethoscope,
  data_akun: Users,
  data_pasien: UserSquare2,
  data_mesin: Cpu,
  my_account: User,
};

interface SidebarLayoutProps {
  activeMenu: MenuId;
  onSelectMenu: (menu: MenuId) => void;
  onPrefetchMenu?: (menu: MenuId) => void;
  pendingVerificationCount?: number;
  schedules?: ScheduleEntry[];
  children: React.ReactNode;
}

export function SidebarLayout({
  activeMenu,
  onSelectMenu,
  onPrefetchMenu,
  pendingVerificationCount = 0,
  schedules = [],
  children,
}: SidebarLayoutProps) {
  const { userProfile, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);

  const { todayDate: todayStr } = useLiveClock();
  const todayLabel = formatFullDayDateId(todayStr);

  const todaySchedule = useMemo(() => {
    if (!userProfile) return null;
    return (
      schedules.find((s) => s.nurseId === userProfile.uid && s.date === todayStr) || null
    );
  }, [schedules, userProfile, todayStr]);

  if (!userProfile) return null;

  const menuItems = ROLE_MENUS[userProfile.role] || [];

  const shiftDisplay = todaySchedule
    ? todaySchedule.shift === 'Libur' || todaySchedule.shift === 'Cuti'
      ? `Jadwal Shift: ${todaySchedule.shift}`
      : `Jadwal Shift: Shift ${todaySchedule.shift}`
    : 'Jadwal Shift: Belum Diatur';

  const handleNavClick = (id: MenuId) => {
    onSelectMenu(id);
    setMobileOpen(false);
  };

  const SidebarContent = (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#b6dcf3] via-[#cbe7f7] to-[#ddf0fa] border-r border-[#a3d0eb]">
      {/* Top RSHL Logo */}
      <div className="relative flex items-center justify-center px-4 pt-5 pb-3">
        <div className="flex h-20 w-56 items-center justify-center overflow-hidden">
          {!logoFailed ? (
            <img
              src="/assets/aistudio/LOGO_WARNA_VID_LANDSCAPE_f7d527db.png"
              alt="Logo RSHL Rumah Sakit Happy Land"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="h-full w-full object-contain scale-[2.2] mix-blend-multiply"
            />
          ) : (
            <div className="text-center leading-tight">
              <span className="font-display text-2xl font-extrabold text-[#0B5A8E]">RSHL</span>
              <p className="text-[11px] font-semibold text-[#0B5A8E]">Rumah Sakit Happy Land</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-700 hover:bg-white/50 lg:hidden"
          aria-label="Tutup Menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Role-Based Navigation (Exact Preserved Order) */}
      <nav className="flex-1 overflow-y-auto px-3.5 py-2 space-y-1.5" aria-label="Menu Utama">
        {menuItems.map((item) => {
          const Icon = MENU_ICONS[item.id];
          const isActive = item.id === activeMenu;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              onMouseEnter={() => onPrefetchMenu?.(item.id)}
              onFocus={() => onPrefetchMenu?.(item.id)}
              className={`group flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs uppercase tracking-wide transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/40 ${
                isActive
                  ? 'bg-white text-[#0B5A8E] font-bold shadow-[0_6px_18px_-4px_rgba(11,90,142,0.22)]'
                  : 'text-slate-800 font-semibold hover:bg-white/55 hover:text-[#0B5A8E]'
              }`}
            >
              <span className="flex items-center gap-3 truncate">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-[#0B5A8E]' : 'text-slate-700 group-hover:text-[#0B5A8E]'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'verifikasi' && pendingVerificationCount > 0 && (
                <span
                  className={`ml-2 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                    isActive ? 'bg-[#0B5A8E]/10 text-[#0B5A8E]' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {pendingVerificationCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sidebar Footer Logout (Available for All Roles & Screen Sizes) */}
      <div className="border-t border-[#a3d0eb]/80 p-3.5">
        <button
          type="button"
          onClick={() => logout()}
          className="flex w-full items-center gap-2.5 rounded-xl bg-white/70 px-3.5 py-2.5 text-xs font-bold uppercase tracking-wide text-rose-700 transition-colors hover:bg-white"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex print:min-h-0 print:block print:bg-white">
      {/* Desktop Fixed Sidebar */}
      <aside className="no-print hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-[85vw]">{SidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="relative flex flex-1 flex-col lg:pl-64 print:pl-0 print:block min-w-0">
        {/* Softly Veiled Hospital Facade Background */}
        <div
          className="no-print pointer-events-none fixed inset-0 lg:left-64 z-0 overflow-hidden bg-gradient-to-b from-sky-50 via-slate-50 to-slate-100"
          aria-hidden="true"
        >
          {!bgFailed && (
            <img
              src="/assets/aistudio/2021-10-18_7a7fa8a8.webp"
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setBgFailed(true)}
              className="h-full w-full object-cover object-center opacity-35"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-sky-50/70 via-white/70 to-slate-100/85" />
        </div>

        <main className="relative flex-1 p-4 sm:p-6 lg:p-7 max-w-[1440px] w-full mx-auto space-y-5 print:block print:p-0 print:max-w-none print:space-y-0">
          {/* Retained Context Strip: Tanggal Aktif, Role/Hak Akses, dan Jadwal Shift dari Administrator */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white/90 backdrop-blur-sm px-4 py-2.5 shadow-sm text-xs text-slate-700">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden shrink-0"
                aria-label="Buka Menu Navigasi"
              >
                <Menu className="h-4 w-4" />
              </button>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                <Calendar className="h-3.5 w-3.5 text-[#0B5A8E] shrink-0" />
                <span>{todayLabel}</span>
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#0B5A8E]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>Role: {userProfile.role}</span>
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                <Clock className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                <span>{shiftDisplay}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <User className="h-3.5 w-3.5 text-[#0B5A8E] shrink-0" />
              <span>{userProfile.fullName}</span>
            </div>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

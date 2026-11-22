import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Sun,
  Sunset,
  Moon,
  Coffee,
  Activity,
  Wrench,
  Sparkles,
  ShieldCheck,
  FileEdit,
} from 'lucide-react';
import type {
  MachineStatus,
  ScheduleShiftType,
  UserRole,
  VerificationStatus,
} from '../../types';

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  if (status === 'Approved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        Approved
      </span>
    );
  }
  if (status === 'Revision') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        Revisi
      </span>
    );
  }
  if (status === 'Draft') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
        <FileEdit className="h-3.5 w-3.5 text-slate-500" />
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 text-amber-600" />
      Menunggu Verifikasi
    </span>
  );
}

export function ShiftBadge({ shift }: { shift: ScheduleShiftType }) {
  if (shift === 'Pagi') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 whitespace-nowrap shrink-0">
        <Sun className="h-3 w-3 text-sky-600" />
        Pagi
      </span>
    );
  }
  if (shift === 'Siang') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <Sunset className="h-3 w-3 text-amber-600" />
        Siang
      </span>
    );
  }
  if (shift === 'Malam') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 whitespace-nowrap shrink-0">
        <Moon className="h-3 w-3 text-indigo-600" />
        Malam
      </span>
    );
  }
  if (shift === 'Cuti') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0">
        <Coffee className="h-3 w-3 text-rose-600" />
        Cuti
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0">
      <Coffee className="h-3 w-3 text-slate-500" />
      Libur
    </span>
  );
}

export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  if (status === 'Ready') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        Ready
      </span>
    );
  }
  if (status === 'In Use') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 whitespace-nowrap shrink-0">
        <Activity className="h-3.5 w-3.5 text-sky-600" />
        In Use
      </span>
    );
  }
  if (status === 'Sterilisasi') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        Sterilisasi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0">
      <Wrench className="h-3.5 w-3.5 text-rose-600" />
      Maintenance
    </span>
  );
}

export function ValidationBadge({ status }: { status: 'Draft' | 'Validated' }) {
  if (status === 'Validated') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 whitespace-nowrap shrink-0">
        <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
        Tervalidasi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
      <FileEdit className="h-3.5 w-3.5 text-slate-500" />
      Draft
    </span>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    Administrator: 'border-slate-300 bg-slate-100 text-slate-800',
    Managerial: 'border-sky-200 bg-sky-50 text-sky-800',
    'Kepala Ruang': 'border-teal-200 bg-teal-50 text-teal-800',
    'PJ Shift': 'border-indigo-200 bg-indigo-50 text-indigo-800',
    'Perawat Pelaksana': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${styles[role]}`}
    >
      {role}
    </span>
  );
}

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_MENUS, type MenuId } from '../../types';

interface RoleGuardProps {
  menuId: MenuId;
  onBackToDashboard: () => void;
  children: React.ReactNode;
}

export function RoleGuard({ menuId, onBackToDashboard, children }: RoleGuardProps) {
  const { userProfile } = useAuth();

  if (!userProfile) return null;

  const allowedMenus = ROLE_MENUS[userProfile.role]?.map((m) => m.id) || [];
  if (!allowedMenus.includes(menuId)) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-white p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold text-slate-900">
          Akses Dibatasi Berdasarkan Peran
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Peran Anda saat ini (<span className="font-semibold">{userProfile.role}</span>) tidak memiliki izin untuk mengakses halaman ini.
        </p>
        <button
          type="button"
          onClick={onBackToDashboard}
          className="mt-5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          Kembali ke Dashboard
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

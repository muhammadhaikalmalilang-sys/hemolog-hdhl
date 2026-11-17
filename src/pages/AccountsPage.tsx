import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Search, UserPlus, Users, ShieldCheck, Ban, CheckCircle, X, Trash2, AlertTriangle } from 'lucide-react';
import {
  ACTIVE_FIREBASE_PROJECT_ID,
  db,
  handleFirestoreError,
  isBootstrapAdminEmail,
  OperationType,
} from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { RoleBadge } from '../components/ui/StatusBadge';
import { BulkAddAccountsModal } from '../components/accounts/BulkAddAccountsModal';
import { ROLE_SORT_ORDER, USER_ROLES, type UserProfile, type UserRole } from '../types';

interface AccountsPageProps {
  users: UserProfile[];
}

export function AccountsPage({ users }: AccountsPageProps) {
  const { userProfile, adminCreateAccount, adminDeleteAccount } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [nip, setNip] = useState('');
  const [role, setRole] = useState<UserRole>('Perawat Pelaksana');
  const [phone, setPhone] = useState('');
  const [specialization, setSpecialization] = useState('Perawat Hemodialisa');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return users
      .filter((u) => {
        if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          if (
            !u.fullName.toLowerCase().includes(q) &&
            !u.email.toLowerCase().includes(q) &&
            !u.nip.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const orderDiff = (ROLE_SORT_ORDER[a.role] ?? 99) - (ROLE_SORT_ORDER[b.role] ?? 99);
        if (orderDiff !== 0) return orderDiff;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [users, roleFilter, searchTerm]);

  const handleChangeRole = async (target: UserProfile, nextRole: UserRole) => {
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'users', target.uid), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'staff_directory', target.uid), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });
      setFeedback(`Role ${target.fullName} berhasil diubah menjadi ${nextRole}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${target.uid}`);
    }
  };

  const handleToggleActive = async (target: UserProfile) => {
    if (target.uid === userProfile?.uid) return;
    setFeedback(null);
    const nextActive = !target.isActive;
    try {
      await updateDoc(doc(db, 'users', target.uid), {
        isActive: nextActive,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'staff_directory', target.uid), {
        isActive: nextActive,
        updatedAt: serverTimestamp(),
      });
      setFeedback(
        `Akun ${target.fullName} telah ${nextActive ? 'diaktifkan kembali' : 'diblokir / dinonaktifkan'}.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${target.uid}`);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);
    if (password.length < 6) {
      setErrorMsg('Password minimal 6 karakter.');
      return;
    }

    setCreating(true);
    try {
      await adminCreateAccount({
        email,
        password,
        fullName,
        nip,
        role,
        phone,
        specialization,
      });
      setShowCreateModal(false);
      setEmail('');
      setPassword('');
      setFullName('');
      setNip('');
      setPhone('');
      setFeedback(`Akun Firebase Auth & profil untuk ${fullName} (${role}) berhasil dibuat.`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          'Pembuatan akun Email/Password belum aktif di Firebase Console (Authentication -> Sign-in method -> Email/Password).'
        );
      } else if (code === 'auth/email-already-in-use') {
        setErrorMsg('Email tersebut sudah terdaftar di Firebase Authentication.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal membuat akun baru.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleteErrorCode(null);
    setFeedback(null);
    setDeleting(true);

    try {
      const result = await adminDeleteAccount(deleteTarget.uid);
      const deletedName = deleteTarget.fullName;
      const deletedEmail = deleteTarget.email;
      setDeleteTarget(null);
      setFeedback(
        result.authDeleted
          ? `Akun ${deletedName} (${deletedEmail}) berhasil dihapus permanen dari Data Akun & Firebase Authentication.`
          : `Profil ${deletedName} (${deletedEmail}) berhasil dihapus dari Data Akun (user sudah tidak terdaftar di Firebase Authentication).`
      );
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      setDeleteErrorCode(e.code || null);
      setDeleteError(e.message || 'Gagal menghapus akun pengguna.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Manajemen Akun & Hak Akses Staf
          </h2>
          <p className="text-xs text-slate-500">
            Kelola akun perawat, atur peran (RBAC 5 role), serta aktivasi atau blokir akses pengguna.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setShowBulkModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 bg-white px-4 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
          >
            <Users className="h-4 w-4" />
            Buat Banyak Akun
          </button>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <UserPlus className="h-4 w-4" />
            Buat Akun Staf Baru
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-medium text-teal-800">
          {feedback}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari nama, NIP, atau email..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
        >
          <option value="ALL">Semua Role</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Nama & Email</th>
                <th className="px-4 py-3 font-semibold">NIP</th>
                <th className="px-4 py-3 font-semibold">Role Aktif</th>
                <th className="px-4 py-3 font-semibold">Ubah Role</th>
                <th className="px-4 py-3 font-semibold">Status Akun</th>
                <th className="px-4 py-3 font-semibold text-right">Aksi Akun</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => {
                const isSelf = u.uid === userProfile?.uid;
                const isBootstrapAdmin = isBootstrapAdminEmail(u.email);
                return (
                  <tr key={u.uid} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">
                        {u.fullName} {isSelf && <span className="text-teal-700">(Anda)</span>}
                      </div>
                      <div className="text-[11px] text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{u.nip}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Ubah role ${u.fullName}`}
                        value={u.role}
                        disabled={isSelf}
                        onChange={(e) => handleChangeRole(u, e.target.value as UserRole)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-600 focus:outline-none disabled:opacity-50"
                      >
                        {USER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                          u.isActive
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-rose-200 bg-rose-50 text-rose-700'
                        }`}
                      >
                        {u.isActive ? (
                          <>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Aktif
                          </>
                        ) : (
                          <>
                            <Ban className="h-3.5 w-3.5" />
                            Diblokir
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => handleToggleActive(u)}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                            u.isActive
                              ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {u.isActive ? (
                            <>
                              <Ban className="h-3.5 w-3.5" />
                              Blokir
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-3.5 w-3.5" />
                              Aktifkan
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isSelf || isBootstrapAdmin}
                          title={
                            isSelf
                              ? 'Tidak dapat menghapus akun sendiri'
                              : isBootstrapAdmin
                              ? 'Akun Administrator utama dilindungi'
                              : `Hapus permanen akun ${u.fullName}`
                          }
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteErrorCode(null);
                            setDeleteTarget(u);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Staff Account Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                Tambah Akun Staf Unit Hemodialisa
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700 font-medium">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama Lengkap & Gelar</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ns. Rina Marlina, S.Kep"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">NIP</label>
                  <input
                    type="text"
                    required
                    value={nip}
                    onChange={(e) => setNip(e.target.value)}
                    placeholder="199204122020122004"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email Login</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Password Awal</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Hak Akses (Role)</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">No. HP</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Sertifikasi / Kompetensi</label>
                <input
                  type="text"
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                  placeholder="Perawat Mahir Dialisis (Pelatihan HD)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-teal-600 px-5 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {creating ? 'Membuat Akun...' : 'Buat Akun Staf'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="font-display text-base font-bold">
                  Hapus Akun Permanen
                </h3>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Anda akan menghapus akun staf berikut secara permanen dari{' '}
                <strong className="text-slate-900">Data Akun (Firestore)</strong> dan{' '}
                <strong className="text-slate-900">Firebase Authentication</strong>:
              </p>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                <div className="font-semibold text-slate-900 text-sm">{deleteTarget.fullName}</div>
                <div className="text-slate-600">{deleteTarget.email}</div>
                <div className="text-slate-500 font-mono">
                  NIP: {deleteTarget.nip} • Role: {deleteTarget.role}
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 leading-relaxed">
                Pengguna tidak akan dapat login kembali dengan akun ini. Riwayat tindakan logbook
                dan laporan klinis yang pernah dibuat tetap tersimpan sebagai arsip unit HD.
              </div>

              {deleteError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-rose-800 space-y-2">
                  <p className="font-semibold">{deleteError}</p>
                  {deleteErrorCode === 'FIREBASE_ADMIN_NOT_CONFIGURED' && (
                    <ol className="list-decimal pl-4 space-y-1 text-[11px] text-rose-700">
                      <li>
                        Buka Firebase Console proyek <strong>{ACTIVE_FIREBASE_PROJECT_ID}</strong> &rarr;{' '}
                        <strong>Project Settings &rarr; Service Accounts</strong>.
                      </li>
                      <li>
                        Klik <strong>Generate new private key</strong> untuk mengunduh file JSON.
                      </li>
                      <li>
                        Simpan isi JSON tersebut pada environment variable / Secrets server bernama{' '}
                        <code className="font-mono font-semibold">FIREBASE_SERVICE_ACCOUNT_JSON</code>, lalu restart server.
                      </li>
                    </ol>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDeleteAccount}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Menghapus Akun...' : 'Ya, Hapus Permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkModal && (
        <BulkAddAccountsModal
          existingUsers={users}
          onClose={() => setShowBulkModal(false)}
          onSuccess={(createdCount) => {
            setShowBulkModal(false);
            setFeedback(
              `${createdCount} akun staf baru berhasil dibuat di Firebase Authentication dan Data Akun.`
            );
          }}
        />
      )}
    </div>
  );
}

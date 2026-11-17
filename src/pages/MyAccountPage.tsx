import React, { useState } from 'react';
import { CheckCircle2, KeyRound, MailCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { RoleBadge } from '../components/ui/StatusBadge';

export function MyAccountPage() {
  const {
    firebaseUser,
    userProfile,
    updateOwnProfile,
    changeUserPassword,
    resendVerificationEmail,
  } = useAuth();

  const [fullName, setFullName] = useState(userProfile?.fullName || '');
  const [nip, setNip] = useState(userProfile?.nip || '');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [specialization, setSpecialization] = useState(userProfile?.specialization || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  if (!userProfile || !firebaseUser) return null;

  const isPasswordProvider = firebaseUser.providerData.some(
    (p) => p.providerId === 'password'
  );

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      await updateOwnProfile({ fullName, nip, phone, specialization });
      setProfileMsg('Profil pribadi berhasil diperbarui.');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Gagal memperbarui profil.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);
    if (newPassword.length < 6) {
      setPassMsg({ type: 'err', text: 'Password baru minimal 6 karakter.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassMsg({ type: 'err', text: 'Konfirmasi password baru tidak sama.' });
      return;
    }

    setSavingPass(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setPassMsg({ type: 'ok', text: 'Password berhasil diperbarui.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPassMsg({ type: 'err', text: 'Password saat ini salah.' });
      } else {
        setPassMsg({
          type: 'err',
          text: err instanceof Error ? err.message : 'Gagal mengubah password.',
        });
      }
    } finally {
      setSavingPass(false);
    }
  };

  const handleResendVerification = async () => {
    setVerifyMsg(null);
    try {
      await resendVerificationEmail();
      setVerifyMsg('Email verifikasi telah dikirim ulang ke kotak masuk Anda.');
    } catch (err) {
      setVerifyMsg(err instanceof Error ? err.message : 'Gagal mengirim email verifikasi.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-lg font-bold text-slate-900">Pengaturan Akun Pribadi</h2>
        <p className="text-xs text-slate-500">
          Kelola identitas kepegawaian, kontak, serta keamanan password akun Anda.
        </p>
      </div>

      {!firebaseUser.emailVerified && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-900">
          <div className="flex items-start gap-2.5">
            <MailCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Email Belum Terverifikasi</p>
              <p className="mt-0.5 text-amber-800">
                Verifikasi alamat email <strong>{firebaseUser.email}</strong> untuk keamanan penuh akun Anda.
              </p>
              {verifyMsg && <p className="mt-1 font-semibold text-teal-700">{verifyMsg}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleResendVerification}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 font-semibold text-amber-800 hover:bg-amber-100"
          >
            Kirim Email Verifikasi
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 lg:col-span-7"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-teal-600" />
              <h3 className="text-sm font-semibold text-slate-900">Profil Kepegawaian</h3>
            </div>
            <RoleBadge role={userProfile.role} />
          </div>

          {profileMsg && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs font-medium text-teal-800">
              {profileMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email Akun</label>
            <input
              type="text"
              disabled
              value={userProfile.email}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nama Lengkap & Gelar
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                NIP / ID Pegawai
              </label>
              <input
                type="text"
                required
                value={nip}
                onChange={(e) => setNip(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">No. Telepon</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812-xxxx-xxxx"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Sertifikasi / Bidang
              </label>
              <input
                type="text"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              {savingProfile ? 'Menyimpan...' : 'Simpan Profil'}
            </button>
          </div>
        </form>

        {/* Change Password */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 h-fit">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <KeyRound className="h-4 w-4 text-sky-700" />
            <h3 className="text-sm font-semibold text-slate-900">Ubah Password</h3>
          </div>

          {!isPasswordProvider ? (
            <p className="mt-4 text-xs text-slate-600 leading-relaxed">
              Anda masuk menggunakan autentikasi <strong>Google Sign-In</strong>. Pengelolaan kata sandi dilakukan langsung melalui keamanan Akun Google Anda.
            </p>
          ) : (
            <form onSubmit={handleChangePassword} className="mt-4 space-y-3.5 text-xs">
              {passMsg && (
                <div
                  className={`rounded-lg border p-3 font-medium ${
                    passMsg.type === 'ok'
                      ? 'border-teal-200 bg-teal-50 text-teal-800'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {passMsg.text}
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Password Saat Ini</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Password Baru</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Konfirmasi Password Baru</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={savingPass}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingPass ? 'Memperbarui...' : 'Perbarui Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

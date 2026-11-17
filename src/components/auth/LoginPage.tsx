import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Eye, EyeOff, Lock, User, ArrowLeft, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PWAInstallButton } from '../ui/PWAInstallButton';

const REMEMBER_STORAGE_KEY = 'hemolog_remembered_account';

function resolveStaffEmail(rawInput: string): { email: string; isPureNumericNip: boolean } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { email: '', isPureNumericNip: false };
  }
  if (trimmed.includes('@')) {
    return { email: trimmed, isPureNumericNip: false };
  }
  if (/^\d+$/.test(trimmed)) {
    return { email: trimmed, isPureNumericNip: true };
  }
  return { email: `${trimmed}@hdrshl.com`, isPureNumericNip: false };
}

export function LoginPage() {
  const {
    loginWithEmail,
    resetPassword,
    registerWithEmail,
    loginWithGoogle,
    blockedMessage,
    idleLogoutMessage,
    clearIdleLogoutMessage,
  } = useAuth();

  const savedAccount =
    typeof window !== 'undefined' ? window.localStorage.getItem(REMEMBER_STORAGE_KEY) || '' : '';

  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [accountInput, setAccountInput] = useState(savedAccount);
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [nip, setNip] = useState('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showEnableEmailGuide, setShowEnableEmailGuide] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const switchMode = (nextMode: 'login' | 'register' | 'reset') => {
    setMode(nextMode);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowEnableEmailGuide(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowEnableEmailGuide(false);
    setSubmitting(true);

    try {
      const { email: resolvedEmail, isPureNumericNip } = resolveStaffEmail(accountInput);

      if (mode === 'login') {
        if (!resolvedEmail) {
          throw new Error('Masukkan Email atau Username akun staf Anda.');
        }
        if (isPureNumericNip) {
          throw new Error(
            'Untuk login menggunakan NIP numerik, masukkan alamat email staf lengkap (contoh: nama@hdrshl.com) atau masuk dengan Akun Google.'
          );
        }
        if (!password) {
          throw new Error('Masukkan kata sandi Anda.');
        }

        await loginWithEmail(resolvedEmail, password, rememberMe);

        if (typeof window !== 'undefined') {
          if (rememberMe) {
            window.localStorage.setItem(REMEMBER_STORAGE_KEY, accountInput.trim());
          } else {
            window.localStorage.removeItem(REMEMBER_STORAGE_KEY);
          }
        }
      } else if (mode === 'reset') {
        if (!resolvedEmail || isPureNumericNip) {
          throw new Error(
            'Masukkan alamat email atau username staf Anda (contoh: nama@hdrshl.com) untuk mengirim tautan atur ulang kata sandi.'
          );
        }
        await resetPassword(resolvedEmail);
        setSuccessMsg(
          `Tautan atur ulang kata sandi telah dikirim ke ${resolvedEmail}. Periksa kotak masuk atau folder spam email Anda.`
        );
      } else {
        if (fullName.trim().length < 2) {
          throw new Error('Nama lengkap minimal 2 karakter.');
        }
        if (nip.trim().length < 2) {
          throw new Error('NIP / Nomor Pegawai wajib diisi.');
        }
        if (!resolvedEmail || !resolvedEmail.includes('@') || isPureNumericNip) {
          throw new Error('Masukkan alamat email staf yang valid untuk pendaftaran.');
        }
        if (password.length < 6) {
          throw new Error('Kata sandi minimal 6 karakter.');
        }
        await registerWithEmail({ email: resolvedEmail, password, fullName, nip });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const message = err instanceof Error ? err.message : 'Gagal melakukan autentikasi.';
      if (code === 'auth/operation-not-allowed') {
        setShowEnableEmailGuide(true);
        setErrorMsg(
          'Metode login Email/Password belum diaktifkan pada proyek Firebase Anda. Aktifkan di Firebase Console atau gunakan Masuk dengan Akun Google.'
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' ||
        code === 'auth/invalid-email'
      ) {
        setErrorMsg('Email / ID Akun atau kata sandi tidak sesuai. Silakan periksa kembali.');
      } else if (code === 'auth/email-already-in-use') {
        setErrorMsg('Email sudah terdaftar. Silakan masuk melalui formulir login.');
      } else if (code === 'auth/too-many-requests') {
        setErrorMsg('Terlalu banyak percobaan login. Silakan tunggu beberapa saat.');
      } else {
        setErrorMsg(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowEnableEmailGuide(false);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal masuk dengan Google.';
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-gradient-to-br from-[#0B5A8E] via-[#0c6aa3] to-slate-900">
      {/* Full-bleed Hospital Building Background */}
      {!bgFailed && (
        <img
          src="/assets/aistudio/2021-10-18_7a7fa8a8.webp"
          alt="Gedung Rumah Sakit Happy Land Medical Centre Yogyakarta"
          referrerPolicy="no-referrer"
          onError={() => setBgFailed(true)}
          className="fixed inset-0 h-full w-full object-cover object-center"
        />
      )}
      <div className="fixed inset-0 bg-slate-950/25" aria-hidden="true" />

      {/* Centered Login Card */}
      <main className="relative z-10 w-full max-w-[440px] rounded-2xl bg-white/95 backdrop-blur-md px-7 py-8 sm:px-9 sm:py-9 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.4)]">
        {/* RSHL Logo Header */}
        <div className="text-center">
          <div className="mx-auto flex h-24 w-72 items-center justify-center overflow-hidden">
            {!logoFailed ? (
              <img
                src="/assets/aistudio/LOGO_WARNA_VID_LANDSCAPE_f7d527db.png"
                alt="Logo RSHL Rumah Sakit Happy Land"
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="h-full w-full object-contain scale-[2.2] mix-blend-multiply"
              />
            ) : (
              <div className="flex flex-col items-center">
                <span className="font-display text-3xl font-extrabold tracking-tight text-[#0B5A8E]">
                  RSHL
                </span>
                <span className="text-xs font-semibold text-[#0B5A8E]">
                  Rumah Sakit Happy Land
                </span>
              </div>
            )}
          </div>

          <h1 className="mt-1 font-display text-[20px] sm:text-[22px] font-bold tracking-tight text-[#0B5A8E] uppercase text-balance">
            {mode === 'login'
              ? 'SISTEM LOGBOOK DIALISIS'
              : mode === 'register'
              ? 'PENDAFTARAN AKUN STAF'
              : 'ATUR ULANG KATA SANDI'}
          </h1>
          <p className="mt-1.5 text-[13px] font-medium text-slate-600">
            Unit Hemodialisa (Dialisis)
          </p>
          <p className="text-[13px] text-slate-500">
            RS Happy Land Medical Centre Yogyakarta
          </p>
        </div>

        {idleLogoutMessage && !blockedMessage && !errorMsg && (
          <div
            role="status"
            className="mt-5 rounded-lg bg-amber-50 p-3.5 text-xs text-amber-900 border border-amber-200"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5">
                <Clock className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <p className="font-medium leading-relaxed">{idleLogoutMessage}</p>
              </div>
              <button
                type="button"
                onClick={clearIdleLogoutMessage}
                aria-label="Tutup pemberitahuan"
                className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {(blockedMessage || errorMsg) && (
          <div
            role="alert"
            className="mt-5 rounded-lg bg-rose-50 p-3.5 text-xs text-rose-800 border border-rose-200"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p className="font-medium leading-relaxed">{blockedMessage || errorMsg}</p>
                {showEnableEmailGuide && (
                  <ol className="mt-2 list-decimal pl-4 space-y-1 text-rose-700">
                    <li>Buka Firebase Console dan pilih proyek aplikasi ini.</li>
                    <li>
                      Masuk ke menu <strong>Authentication &rarr; Sign-in method</strong>.
                    </li>
                    <li>
                      Aktifkan provider <strong>Email/Password</strong> lalu simpan.
                    </li>
                  </ol>
                )}
              </div>
            </div>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="mt-5 rounded-lg bg-emerald-50 p-3.5 text-xs text-emerald-800 border border-emerald-200"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <p className="font-medium leading-relaxed">{successMsg}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === 'register' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="reg-fullname"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1.5"
                >
                  NAMA LENGKAP
                </label>
                <input
                  id="reg-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ns. Rina Marlina"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0B5A8E] focus:outline-none focus:ring-2 focus:ring-[#0B5A8E]/20"
                />
              </div>
              <div>
                <label
                  htmlFor="reg-nip"
                  className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1.5"
                >
                  NIP / ID PEGAWAI
                </label>
                <input
                  id="reg-nip"
                  type="text"
                  required
                  value={nip}
                  onChange={(e) => setNip(e.target.value)}
                  placeholder="19920412..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0B5A8E] focus:outline-none focus:ring-2 focus:ring-[#0B5A8E]/20"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="account-identifier"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1.5"
            >
              {mode === 'register'
                ? 'EMAIL STAF RUMAH SAKIT'
                : 'NOMOR INDUK PEGAWAI (NIP) / ID AKUN'}
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="account-identifier"
                type={mode === 'register' ? 'email' : 'text'}
                autoComplete="username"
                required
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                placeholder={
                  mode === 'register'
                    ? 'nama@hdrshl.com'
                    : 'Masukkan NIP / Username / Email...'
                }
                className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0B5A8E] focus:outline-none focus:ring-2 focus:ring-[#0B5A8E]/20"
              />
            </div>
          </div>

          {mode !== 'reset' && (
            <div>
              <label
                htmlFor="account-password"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                KATA SANDI
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="account-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi..."
                  className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0B5A8E] focus:outline-none focus:ring-2 focus:ring-[#0B5A8E]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/30"
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {mode === 'login' && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-xs font-medium text-[#0B5A8E] hover:text-[#08446c] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/30 rounded"
                  >
                    Lupa Kata Sandi?
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'login' && (
            <label className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#0B5A8E] focus:ring-[#0B5A8E]/30"
              />
              <span>Ingat Akun Saya</span>
            </label>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#0B5A8E] px-4 py-3 text-xs sm:text-sm font-bold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-[#094a75] active:bg-[#083f64] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E] focus-visible:ring-offset-2"
          >
            {submitting
              ? 'MEMPROSES...'
              : mode === 'login'
              ? 'MASUK KE SISTEM'
              : mode === 'register'
              ? 'DAFTAR AKUN PERAWAT'
              : 'KIRIM TAUTAN ATUR ULANG'}
          </button>
        </form>

        {mode === 'login' ? (
          <>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-medium text-slate-400">atau</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogleLogin}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/30"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>Masuk dengan Akun Google</span>
            </button>

            <p className="mt-5 text-center text-xs text-slate-500">
              Belum punya akun perawat?{' '}
              <button
                type="button"
                onClick={() => switchMode('register')}
                className="font-semibold text-[#0B5A8E] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/30 rounded"
              >
                Daftar Akun Baru
              </button>
            </p>
          </>
        ) : (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5A8E] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/30 rounded"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Kembali ke Halaman Masuk
            </button>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-slate-200/80 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>Akses cepat di komputer unit HD:</span>
          <PWAInstallButton />
        </div>
      </main>
    </div>
  );
}

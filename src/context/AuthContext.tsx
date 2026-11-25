import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import {
  createSecondarySupabaseClient,
  formatDbError,
  isBootstrapAdminEmail,
  isPermissionDeniedError,
  isSupabaseConfigured,
  isTransientDbError,
  onSupabaseReconnect,
  OperationType,
  reconnectSupabase,
  requireSupabase,
  supabase,
  SUPABASE_PROJECT_ID,
} from '../lib/supabase';
import {
  mapUserRow,
  toStaffDirectoryRow,
  toUserRow,
} from '../lib/db';
import { clampString } from '../lib/formatters';
import { clearLastActivity, stampLastActivity } from '../hooks/useIdleTimeout';
import type { UserProfile, UserRole } from '../types';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  providerIds: string[];
}

function toAuthUser(sbUser: SupabaseUser | null | undefined): AuthUser | null {
  if (!sbUser) return null;
  const meta = (sbUser.user_metadata || {}) as Record<string, unknown>;
  const appMeta = (sbUser.app_metadata || {}) as Record<string, unknown>;
  const providerIds: string[] = Array.isArray(appMeta.providers)
    ? appMeta.providers.map((p) => String(p))
    : appMeta.provider
    ? [String(appMeta.provider)]
    : sbUser.identities?.map((i) => i.provider) || ['email'];

  return {
    uid: sbUser.id,
    email: sbUser.email ?? null,
    displayName:
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      null,
    emailVerified: Boolean(sbUser.email_confirmed_at || sbUser.confirmed_at),
    providerIds,
  };
}

function isSameAuthUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.uid === b.uid &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.emailVerified === b.emailVerified &&
    a.providerIds.join(',') === b.providerIds.join(',')
  );
}

function isSameUserProfile(a: UserProfile | null, b: UserProfile | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.uid === b.uid &&
    a.email === b.email &&
    a.fullName === b.fullName &&
    a.nip === b.nip &&
    a.role === b.role &&
    a.isActive === b.isActive &&
    a.phone === b.phone &&
    a.specialization === b.specialization
  );
}

interface AuthContextValue {
  authUser: AuthUser | null;
  userProfile: UserProfile | null;
  authReady: boolean;
  profileLoading: boolean;
  supabaseConfigured: boolean;
  profileError: string | null;
  retryProfile: () => void;
  blockedMessage: string | null;
  idleLogoutMessage: string | null;
  clearIdleLogoutMessage: () => void;
  getAccessToken: () => Promise<string | null>;
  loginWithEmail: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  registerWithEmail: (params: {
    email: string;
    password: string;
    fullName: string;
    nip: string;
  }) => Promise<{ requiresEmailConfirmation: boolean }>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  logoutDueToIdle: () => Promise<void>;
  updateOwnProfile: (data: {
    fullName: string;
    nip: string;
    phone: string;
    specialization: string;
  }) => Promise<void>;
  changeUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  adminCreateAccount: (params: {
    email: string;
    password: string;
    fullName: string;
    nip: string;
    role: UserRole;
    phone?: string;
    specialization?: string;
  }) => Promise<void>;
  adminBulkCreateAccounts: (
    accounts: {
      rowIndex: number;
      fullName: string;
      nip: string;
      email: string;
      password: string;
      role: UserRole;
      phone?: string;
      specialization?: string;
    }[]
  ) => Promise<{
    ok: boolean;
    createdCount: number;
    failedCount: number;
    results: {
      rowIndex: number;
      email: string;
      fullName: string;
      ok: boolean;
      uid?: string;
      error?: string;
    }[];
  }>;
  adminDeleteAccount: (targetUid: string) => Promise<{ authDeleted: boolean }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function parseApiJsonResponse<T extends { ok?: boolean; error?: string; message?: string }>(
  res: Response,
  fallbackMessage: string
): Promise<T> {
  const rawText = await res.text();
  let parsed: T | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    const trimmed = rawText.trim();
    const looksLikeSpaHtml =
      trimmed.startsWith('<!doctype html') ||
      trimmed.startsWith('<!DOCTYPE html') ||
      trimmed.includes('<div id="root">');
    const err = new Error(
      looksLikeSpaHtml
        ? `Endpoint server /api tidak merespons JSON (HTTP ${res.status}). Pastikan Serverless Function (/api/index.mjs) berjalan dengan benar.`
        : `${fallbackMessage} (HTTP ${res.status}${trimmed ? `: ${trimmed.slice(0, 140)}` : ''})`
    ) as Error & { code?: string };
    err.code = looksLikeSpaHtml ? 'API_UNREACHABLE' : `HTTP_${res.status}`;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(parsed.message || `${fallbackMessage} (HTTP ${res.status})`) as Error & {
      code?: string;
    };
    err.code = parsed.error || `HTTP_${res.status}`;
    throw err;
  }

  return parsed;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(isSupabaseConfigured);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [idleLogoutMessage, setIdleLogoutMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetryNonce, setProfileRetryNonce] = useState(0);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      setAuthReady(true);
      setProfileLoading(false);
      return;
    }

    const sb = supabase;
    let cancelled = false;
    let authEventSeq = 0;
    let profileChannel: ReturnType<typeof sb.channel> | null = null;
    let retryTimer: number | null = null;
    let activeUser: AuthUser | null = null;
    let loadedProfile: UserProfile | null = null;
    let bootstrappingUid: string | null = null;

    const commitUserProfile = (next: UserProfile | null) => {
      if (isSameUserProfile(loadedProfile, next)) return;
      loadedProfile = next;
      setUserProfile(next);
    };

    const cleanupChannel = () => {
      if (profileChannel) {
        void sb.removeChannel(profileChannel);
        profileChannel = null;
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const bootstrapMissingProfile = async (
      sbUser: SupabaseUser,
      mappedUser: AuthUser,
      seq: number
    ) => {
      if (bootstrappingUid === mappedUser.uid) return;
      bootstrappingUid = mappedUser.uid;
      try {
        const meta = (sbUser.user_metadata || {}) as Record<string, unknown>;
        const isBootstrap =
          mappedUser.emailVerified && isBootstrapAdminEmail(mappedUser.email);
        const initialRole: UserRole = isBootstrap ? 'Administrator' : 'Perawat Pelaksana';
        const fallbackName =
          clampString(
            (typeof meta.full_name === 'string' && meta.full_name) ||
              mappedUser.displayName ||
              mappedUser.email?.split('@')[0] ||
              'Perawat HD',
            120
          ) || 'Perawat HD';
        const initialNip = isBootstrap
          ? 'ADM-001'
          : clampString(
              (typeof meta.nip === 'string' && meta.nip) ||
                `HD-${mappedUser.uid.slice(0, 6).toUpperCase()}`,
              40
            );

        const nowIso = new Date().toISOString();
        const userRow = toUserRow({
          uid: mappedUser.uid,
          email: clampString(mappedUser.email || 'staff@hemolog.local', 200),
          fullName: fallbackName,
          nip: initialNip,
          role: initialRole,
          isActive: true,
          phone: '',
          specialization: isBootstrap ? 'System Administrator' : 'Perawat Hemodialisa',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        const dirRow = toStaffDirectoryRow({
          uid: mappedUser.uid,
          fullName: fallbackName,
          nip: initialNip,
          role: initialRole,
          isActive: true,
          updatedAt: nowIso,
        });

        const [{ data: insertedUser, error: uErr }, { error: dErr }] = await Promise.all([
          sb.from('users').upsert(userRow, { onConflict: 'uid' }).select().single(),
          sb.from('staff_directory').upsert(dirRow, { onConflict: 'uid' }),
        ]);

        if (uErr || dErr) {
          throw uErr || dErr;
        }

        if (cancelled || seq !== authEventSeq) return;
        if (insertedUser) {
          commitUserProfile(mapUserRow(insertedUser));
          setAuthReady(true);
          setProfileLoading(false);
        }
      } catch (error) {
        if (cancelled || seq !== authEventSeq) return;
        bootstrappingUid = null;
        if (isTransientDbError(error)) {
          console.warn('Inisialisasi profil tertunda sementara, mencoba ulang:', error);
          retryTimer = window.setTimeout(() => {
            if (!cancelled && seq === authEventSeq) {
              void loadAndWatchProfile(sbUser, mappedUser, seq);
            }
          }, 2500);
        } else {
          console.warn('Inisialisasi profil pengguna Supabase tertahan:', error);
          setProfileError(
            formatDbError(error, OperationType.CREATE, `users/${mappedUser.uid}`, true)
          );
          setAuthReady(true);
          setProfileLoading(false);
        }
      }
    };

    const loadAndWatchProfile = async (
      sbUser: SupabaseUser,
      mappedUser: AuthUser,
      seq: number
    ) => {
      if (cancelled || seq !== authEventSeq) return;
      cleanupChannel();

      try {
        const { data, error } = await sb
          .from('users')
          .select('*')
          .eq('uid', mappedUser.uid)
          .maybeSingle();

        if (cancelled || seq !== authEventSeq) return;

        if (error) {
          if (isTransientDbError(error)) {
            console.warn('Koneksi profil Supabase terputus sementara, menyambungkan ulang...');
            retryTimer = window.setTimeout(() => {
              if (!cancelled && seq === authEventSeq) {
                void loadAndWatchProfile(sbUser, mappedUser, seq);
              }
            }, 3000);
            return;
          }
          if (isPermissionDeniedError(error)) {
            setProfileError(
              formatDbError(error, OperationType.GET, `users/${mappedUser.uid}`, true)
            );
            setAuthReady(true);
            setProfileLoading(false);
            return;
          }
          throw error;
        }

        if (!data) {
          await bootstrapMissingProfile(sbUser, mappedUser, seq);
        } else {
          const profile = mapUserRow(data);
          if (!profile.isActive) {
            setBlockedMessage(
              'Akun Anda sedang dinonaktifkan oleh Administrator. Hubungi Admin Unit Hemodialisa untuk aktivasi kembali.'
            );
            commitUserProfile(null);
            await sb.auth.signOut().catch(() => undefined);
          } else {
            const fallbackName =
              clampString(
                profile.fullName ||
                  mappedUser.displayName ||
                  mappedUser.email?.split('@')[0] ||
                  'Staf HD',
                120
              ) || 'Staf HD';
            commitUserProfile({
              ...profile,
              uid: mappedUser.uid,
              email: profile.email || mappedUser.email || '',
              fullName: fallbackName,
            });
          }
          setAuthReady(true);
          setProfileLoading(false);
        }

        if (cancelled || seq !== authEventSeq) return;
        profileChannel = sb
          .channel(`user-profile-${mappedUser.uid}-${seq}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'users',
              filter: `uid=eq.${mappedUser.uid}`,
            },
            (payload) => {
              if (cancelled || seq !== authEventSeq) return;
              if (payload.eventType === 'DELETE') {
                setBlockedMessage('Akun Anda telah dihapus oleh Administrator.');
                commitUserProfile(null);
                void sb.auth.signOut().catch(() => undefined);
                return;
              }
              if (payload.new) {
                const updated = mapUserRow(payload.new as Record<string, unknown>);
                if (!updated.isActive) {
                  setBlockedMessage(
                    'Akun Anda sedang dinonaktifkan oleh Administrator. Hubungi Admin Unit Hemodialisa untuk aktivasi kembali.'
                  );
                  commitUserProfile(null);
                  void sb.auth.signOut().catch(() => undefined);
                } else {
                  commitUserProfile(updated);
                }
                setAuthReady(true);
                setProfileLoading(false);
              }
            }
          )
          .subscribe();
      } catch (err) {
        if (cancelled || seq !== authEventSeq) return;
        setProfileError(formatDbError(err, OperationType.GET, `users/${mappedUser.uid}`, true));
        setAuthReady(true);
        setProfileLoading(false);
      }
    };

    const handleSession = (session: Session | null, event?: string) => {
      if (cancelled) return;

      const sbUser = session?.user ?? null;
      const mapped = toAuthUser(sbUser);

      if (!sbUser || !mapped) {
        authEventSeq += 1;
        cleanupChannel();
        activeUser = null;
        bootstrappingUid = null;
        setAuthUser(null);
        commitUserProfile(null);
        setProfileError(null);
        setAuthReady(true);
        setProfileLoading(false);
        return;
      }

      const isSameUid = activeUser?.uid === mapped.uid;
      activeUser = mapped;
      setAuthUser((prev) => (isSameAuthUser(prev, mapped) ? prev : mapped));
      setProfileError(null);
      setBlockedMessage(null);
      setIdleLogoutMessage(null);

      // Keep UI mounted cleanly during background TOKEN_REFRESHED or duplicate session events
      if (isSameUid && loadedProfile) {
        if (event === 'USER_UPDATED' || !profileChannel) {
          void loadAndWatchProfile(sbUser, mapped, authEventSeq);
        } else {
          setAuthReady(true);
          setProfileLoading(false);
        }
        return;
      }

      const currentSeq = ++authEventSeq;
      cleanupChannel();
      bootstrappingUid = null;
      if (!loadedProfile) {
        setProfileLoading(true);
      }
      void loadAndWatchProfile(sbUser, mapped, currentSeq);
    };

    void sb.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        handleSession(data.session, 'INITIAL_SESSION');
      }
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (!cancelled) {
        handleSession(session, event);
      }
    });

    const unsubReconnect = onSupabaseReconnect((event) => {
      if (!cancelled && activeUser && event.shouldResubscribe) {
        void sb.auth.getSession().then(({ data }) => {
          if (!cancelled && data.session?.user) {
            const mapped = toAuthUser(data.session.user);
            if (mapped) {
              void loadAndWatchProfile(data.session.user, mapped, authEventSeq);
            }
          }
        });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      unsubReconnect();
      cleanupChannel();
    };
  }, [profileRetryNonce]);

  const retryProfile = () => {
    setProfileError(null);
    setProfileLoading(true);
    setProfileRetryNonce((prev) => prev + 1);
  };

  const getAccessToken = async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  const loginWithEmail = async (email: string, password: string, _rememberMe = true) => {
    const sb = requireSupabase();
    setBlockedMessage(null);
    setIdleLogoutMessage(null);
    stampLastActivity();
    const { error } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    stampLastActivity();
  };

  const resetPassword = async (email: string) => {
    const sb = requireSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    });
    if (error) throw error;
  };

  const registerWithEmail = async (params: {
    email: string;
    password: string;
    fullName: string;
    nip: string;
  }) => {
    const sb = requireSupabase();
    setBlockedMessage(null);
    setIdleLogoutMessage(null);
    stampLastActivity();

    const cleanEmail = clampString(params.email.toLowerCase(), 200);
    const cleanName = clampString(params.fullName, 120);
    const cleanNip = clampString(params.nip, 40);

    const { data, error } = await sb.auth.signUp({
      email: cleanEmail,
      password: params.password,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        data: {
          full_name: cleanName,
          nip: cleanNip,
        },
      },
    });
    if (error) throw error;
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      const dupErr = new Error('Email sudah terdaftar. Silakan masuk melalui formulir login.') as Error & {
        code?: string;
      };
      dupErr.code = 'email_exists';
      throw dupErr;
    }

    stampLastActivity();

    if (data.session && data.user) {
      const emailVerified = Boolean(data.user.email_confirmed_at || data.user.confirmed_at);
      const isBootstrap = emailVerified && isBootstrapAdminEmail(cleanEmail);
      const role: UserRole = isBootstrap ? 'Administrator' : 'Perawat Pelaksana';
      const nowIso = new Date().toISOString();

      const [{ error: uErr }, { error: dErr }] = await Promise.all([
        sb.from('users').upsert(
          toUserRow({
            uid: data.user.id,
            email: cleanEmail,
            fullName: cleanName,
            nip: cleanNip,
            role,
            isActive: true,
            phone: '',
            specialization: isBootstrap ? 'System Administrator' : 'Perawat Hemodialisa',
            createdAt: nowIso,
            updatedAt: nowIso,
          }),
          { onConflict: 'uid' }
        ),
        sb.from('staff_directory').upsert(
          toStaffDirectoryRow({
            uid: data.user.id,
            fullName: cleanName,
            nip: cleanNip,
            role,
            isActive: true,
            updatedAt: nowIso,
          }),
          { onConflict: 'uid' }
        ),
      ]);
      if (uErr || dErr) {
        throw new Error(formatDbError(uErr || dErr, OperationType.CREATE, `users/${data.user.id}`));
      }
      return { requiresEmailConfirmation: false };
    }

    return { requiresEmailConfirmation: true };
  };

  const loginWithGoogle = async () => {
    const sb = requireSupabase();
    setBlockedMessage(null);
    setIdleLogoutMessage(null);
    stampLastActivity();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) throw error;
  };

  const clearIdleLogoutMessage = () => {
    setIdleLogoutMessage(null);
  };

  const logout = async () => {
    clearLastActivity();
    setIdleLogoutMessage(null);
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  const logoutDueToIdle = async () => {
    clearLastActivity();
    setIdleLogoutMessage(
      'Sesi Anda telah otomatis logout karena tidak ada aktivitas pada aplikasi lebih dari 15 menit. Silakan masuk kembali.'
    );
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  const updateOwnProfile = async (data: {
    fullName: string;
    nip: string;
    phone: string;
    specialization: string;
  }) => {
    const sb = requireSupabase();
    if (!authUser || !userProfile) throw new Error('Pengguna belum terautentikasi.');
    const cleanName = clampString(data.fullName, 120);
    const cleanNip = clampString(data.nip, 40);
    const cleanPhone = clampString(data.phone, 30);
    const cleanSpec = clampString(data.specialization, 100);
    const nowIso = new Date().toISOString();

    const [{ error: uErr }, { error: dErr }] = await Promise.all([
      sb
        .from('users')
        .update({
          full_name: cleanName,
          nip: cleanNip,
          phone: cleanPhone,
          specialization: cleanSpec,
          updated_at: nowIso,
        })
        .eq('uid', authUser.uid),
      sb
        .from('staff_directory')
        .update({
          full_name: cleanName,
          nip: cleanNip,
          updated_at: nowIso,
        })
        .eq('uid', authUser.uid),
    ]);

    if (uErr || dErr) {
      throw new Error(formatDbError(uErr || dErr, OperationType.UPDATE, `users/${authUser.uid}`));
    }
  };

  const changeUserPassword = async (currentPassword: string, newPassword: string) => {
    const sb = requireSupabase();
    if (!authUser || !authUser.email) {
      throw new Error('Akun tidak terautentikasi.');
    }

    const verifier = createSecondarySupabaseClient();
    const { error: verifyErr } = await verifier.auth.signInWithPassword({
      email: authUser.email,
      password: currentPassword,
    });
    if (verifyErr) {
      const err = new Error('Kata sandi saat ini tidak sesuai.') as Error & { code?: string };
      err.code = 'invalid_current_password';
      throw err;
    }

    const { error: updErr } = await sb.auth.updateUser({ password: newPassword });
    if (updErr) throw updErr;
  };

  const resendVerificationEmail = async () => {
    const sb = requireSupabase();
    if (!authUser || !authUser.email) throw new Error('Akun tidak terautentikasi.');
    const { error } = await sb.auth.resend({
      type: 'signup',
      email: authUser.email,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) throw error;
  };

  const adminCreateAccount = async (params: {
    email: string;
    password: string;
    fullName: string;
    nip: string;
    role: UserRole;
    phone?: string;
    specialization?: string;
  }) => {
    const sb = requireSupabase();
    if (userProfile?.role !== 'Administrator') {
      throw new Error('Hanya Administrator yang dapat membuat akun baru.');
    }

    const cleanEmail = clampString(params.email.toLowerCase(), 200);
    const cleanName = clampString(params.fullName, 120);
    const cleanNip = clampString(params.nip, 40);
    const cleanPhone = clampString(params.phone || '', 30);
    const cleanSpec = clampString(params.specialization || 'Perawat Hemodialisa', 100);

    const token = await getAccessToken();
    if (token) {
      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: cleanEmail,
            password: params.password,
            fullName: cleanName,
            nip: cleanNip,
            role: params.role,
            phone: cleanPhone,
            specialization: cleanSpec,
          }),
        });
        if (res.status !== 503) {
          const parsed = await parseApiJsonResponse<{
            ok?: boolean;
            uid?: string;
            error?: string;
            message?: string;
          }>(res, 'Gagal membuat akun baru.');
          if (parsed.ok) return;
        }
      } catch (apiErr) {
        const code = (apiErr as { code?: string })?.code;
        if (code && code !== 'SUPABASE_ADMIN_NOT_CONFIGURED' && code !== 'API_UNREACHABLE') {
          throw apiErr;
        }
      }
    }

    // Fallback: client-side in-memory secondary Supabase signUp + primary admin DB insert
    const secondary = createSecondarySupabaseClient();
    const { data, error: signUpErr } = await secondary.auth.signUp({
      email: cleanEmail,
      password: params.password,
      options: {
        data: {
          full_name: cleanName,
          nip: cleanNip,
        },
      },
    });
    if (signUpErr) throw signUpErr;
    if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
      throw new Error('Email sudah terdaftar di Supabase Authentication.');
    }

    const newUid = data.user.id;
    const nowIso = new Date().toISOString();
    const [{ error: uErr }, { error: dErr }] = await Promise.all([
      sb.from('users').upsert(
        toUserRow({
          uid: newUid,
          email: cleanEmail,
          fullName: cleanName,
          nip: cleanNip,
          role: params.role,
          isActive: true,
          phone: cleanPhone,
          specialization: cleanSpec,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
        { onConflict: 'uid' }
      ),
      sb.from('staff_directory').upsert(
        toStaffDirectoryRow({
          uid: newUid,
          fullName: cleanName,
          nip: cleanNip,
          role: params.role,
          isActive: true,
          updatedAt: nowIso,
        }),
        { onConflict: 'uid' }
      ),
    ]);
    if (uErr || dErr) {
      throw new Error(formatDbError(uErr || dErr, OperationType.CREATE, `users/${newUid}`));
    }
  };

  const adminDeleteAccount = async (targetUid: string) => {
    if (!authUser || userProfile?.role !== 'Administrator') {
      throw new Error('Hanya Administrator yang dapat menghapus akun pengguna.');
    }
    if (targetUid === authUser.uid) {
      throw new Error('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Token sesi Supabase tidak ditemukan. Silakan muat ulang halaman.');
    }

    const res = await fetch(`/api/admin/users/${encodeURIComponent(targetUid)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await parseApiJsonResponse<{
      ok?: boolean;
      authDeleted?: boolean;
      error?: string;
      message?: string;
    }>(res, 'Gagal menghapus akun pengguna.');

    if (!data.ok) {
      const err = new Error(data.message || 'Gagal menghapus akun pengguna.') as Error & {
        code?: string;
      };
      err.code = data.error || 'DELETE_USER_FAILED';
      throw err;
    }

    return { authDeleted: Boolean(data.authDeleted) };
  };

  const adminBulkCreateAccounts = async (
    accounts: {
      rowIndex: number;
      fullName: string;
      nip: string;
      email: string;
      password: string;
      role: UserRole;
      phone?: string;
      specialization?: string;
    }[]
  ) => {
    if (!authUser || userProfile?.role !== 'Administrator') {
      throw new Error('Hanya Administrator yang dapat membuat akun massal.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Token sesi Supabase tidak ditemukan. Silakan muat ulang halaman.');
    }

    const res = await fetch('/api/admin/users/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ accounts }),
    });

    const data = await parseApiJsonResponse<{
      ok?: boolean;
      createdCount?: number;
      failedCount?: number;
      results?: {
        rowIndex: number;
        email: string;
        fullName: string;
        ok: boolean;
        uid?: string;
        error?: string;
      }[];
      error?: string;
      message?: string;
    }>(res, `Gagal membuat banyak akun staf pada Supabase (${SUPABASE_PROJECT_ID}).`);

    return {
      ok: Boolean(data.ok),
      createdCount: data.createdCount || 0,
      failedCount: data.failedCount || 0,
      results: data.results || [],
    };
  };

  // Trigger reconnect silently if offline->online occurs while mounted
  useEffect(() => {
    if (authUser?.uid && isSupabaseConfigured) {
      void reconnectSupabase({ force: false, resubscribe: false, reason: 'focus' });
    }
  }, [authUser?.uid]);

  return (
    <AuthContext.Provider
      value={{
        authUser,
        userProfile,
        authReady,
        profileLoading,
        supabaseConfigured: isSupabaseConfigured,
        profileError,
        retryProfile,
        blockedMessage,
        idleLogoutMessage,
        clearIdleLogoutMessage,
        getAccessToken,
        loginWithEmail,
        resetPassword,
        registerWithEmail,
        loginWithGoogle,
        logout,
        logoutDueToIdle,
        updateOwnProfile,
        changeUserPassword,
        resendVerificationEmail,
        adminCreateAccount,
        adminBulkCreateAccounts,
        adminDeleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

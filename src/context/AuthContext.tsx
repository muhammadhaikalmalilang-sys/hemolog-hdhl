import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  isBootstrapAdminEmail,
  handleFirestoreError,
  OperationType,
  withSecondaryAuth,
} from '../lib/firebase';
import { clampString } from '../lib/formatters';
import { clearLastActivity, stampLastActivity } from '../hooks/useIdleTimeout';
import type { UserProfile, UserRole } from '../types';

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  authReady: boolean;
  profileLoading: boolean;
  blockedMessage: string | null;
  idleLogoutMessage: string | null;
  clearIdleLogoutMessage: () => void;
  loginWithEmail: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  registerWithEmail: (params: {
    email: string;
    password: string;
    fullName: string;
    nip: string;
  }) => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [idleLogoutMessage, setIdleLogoutMessage] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setFirebaseUser(user);

      if (!user) {
        setUserProfile(null);
        setAuthReady(true);
        setProfileLoading(false);
        return;
      }

      setBlockedMessage(null);
      setIdleLogoutMessage(null);

      setProfileLoading(true);
      const userRef = doc(db, 'users', user.uid);

      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const isBootstrap = user.emailVerified && isBootstrapAdminEmail(user.email);
          const initialRole: UserRole = isBootstrap ? 'Administrator' : 'Perawat Pelaksana';
          const fallbackName =
            clampString(user.displayName || user.email?.split('@')[0] || 'Perawat HD', 120) ||
            'Perawat HD';
          const initialNip = isBootstrap ? 'ADM-001' : `HD-${user.uid.slice(0, 6).toUpperCase()}`;

          const profilePayload = {
            uid: user.uid,
            email: clampString(user.email || 'staff@hemolog.local', 200),
            fullName: fallbackName,
            nip: initialNip,
            role: initialRole,
            isActive: true,
            phone: '',
            specialization: isBootstrap ? 'System Administrator' : 'Perawat Hemodialisa',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          await setDoc(userRef, profilePayload);
          await setDoc(doc(db, 'staff_directory', user.uid), {
            uid: user.uid,
            fullName: fallbackName,
            role: initialRole,
            isActive: true,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        console.error('Error initializing user profile:', error);
      }

      unsubscribeProfile = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            if (!data.isActive) {
              setBlockedMessage(
                'Akun Anda sedang dinonaktifkan oleh Administrator. Hubungi Admin Unit Hemodialisa untuk aktivasi kembali.'
              );
              setUserProfile(null);
              signOut(auth).catch(() => undefined);
            } else {
              const fallbackName =
                clampString(
                  data.fullName || user.displayName || user.email?.split('@')[0] || 'Staf HD',
                  120
                ) || 'Staf HD';
              setUserProfile({
                ...data,
                uid: user.uid,
                email: data.email || user.email || '',
                fullName: fallbackName,
              });
            }
          } else {
            setUserProfile(null);
          }
          setAuthReady(true);
          setProfileLoading(false);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const loginWithEmail = async (email: string, password: string, rememberMe = true) => {
    setBlockedMessage(null);
    setIdleLogoutMessage(null);
    stampLastActivity();
    await setPersistence(
      auth,
      rememberMe ? browserLocalPersistence : browserSessionPersistence
    );
    await signInWithEmailAndPassword(auth, email.trim(), password);
    stampLastActivity();
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const registerWithEmail = async (params: {
    email: string;
    password: string;
    fullName: string;
    nip: string;
  }) => {
    setBlockedMessage(null);
    setIdleLogoutMessage(null);
    stampLastActivity();
    const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
    stampLastActivity();
    const user = cred.user;
    const isBootstrap = user.emailVerified && isBootstrapAdminEmail(user.email);
    const role: UserRole = isBootstrap ? 'Administrator' : 'Perawat Pelaksana';
    const cleanName = clampString(params.fullName, 120);
    const cleanNip = clampString(params.nip, 40);

    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: clampString(params.email.trim(), 200),
        fullName: cleanName,
        nip: cleanNip,
        role,
        isActive: true,
        phone: '',
        specialization: 'Perawat Hemodialisa',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'staff_directory', user.uid), {
        uid: user.uid,
        fullName: cleanName,
        role,
        isActive: true,
        updatedAt: serverTimestamp(),
      });
      await sendEmailVerification(user).catch(() => undefined);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
    }
  };

  const loginWithGoogle = async () => {
    setBlockedMessage(null);
    setIdleLogoutMessage(null);
    stampLastActivity();
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    stampLastActivity();
  };

  const clearIdleLogoutMessage = () => {
    setIdleLogoutMessage(null);
  };

  const logout = async () => {
    clearLastActivity();
    setIdleLogoutMessage(null);
    await signOut(auth);
  };

  const logoutDueToIdle = async () => {
    clearLastActivity();
    setIdleLogoutMessage(
      'Sesi Anda telah otomatis logout karena tidak ada aktivitas pada aplikasi lebih dari 15 menit. Silakan masuk kembali.'
    );
    await signOut(auth);
  };

  const updateOwnProfile = async (data: {
    fullName: string;
    nip: string;
    phone: string;
    specialization: string;
  }) => {
    if (!firebaseUser || !userProfile) throw new Error('Pengguna belum terautentikasi.');
    const cleanName = clampString(data.fullName, 120);
    const cleanNip = clampString(data.nip, 40);
    const cleanPhone = clampString(data.phone, 30);
    const cleanSpec = clampString(data.specialization, 100);

    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        fullName: cleanName,
        nip: cleanNip,
        phone: cleanPhone,
        specialization: cleanSpec,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'staff_directory', firebaseUser.uid), {
        fullName: cleanName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const changeUserPassword = async (currentPassword: string, newPassword: string) => {
    if (!firebaseUser || !firebaseUser.email) {
      throw new Error('Akun tidak terautentikasi.');
    }
    const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, newPassword);
  };

  const resendVerificationEmail = async () => {
    if (!firebaseUser) throw new Error('Akun tidak terautentikasi.');
    await sendEmailVerification(firebaseUser);
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
    if (userProfile?.role !== 'Administrator') {
      throw new Error('Hanya Administrator yang dapat membuat akun baru.');
    }

    const cleanEmail = clampString(params.email, 200);
    const cleanName = clampString(params.fullName, 120);
    const cleanNip = clampString(params.nip, 40);
    const cleanPhone = clampString(params.phone || '', 30);
    const cleanSpec = clampString(params.specialization || 'Perawat Hemodialisa', 100);

    const newUid = await withSecondaryAuth(async (secAuth) => {
      const cred = await createUserWithEmailAndPassword(secAuth, cleanEmail, params.password);
      const uid = cred.user.uid;
      await sendEmailVerification(cred.user).catch(() => undefined);
      await signOut(secAuth);
      return uid;
    });

    try {
      await setDoc(doc(db, 'users', newUid), {
        uid: newUid,
        email: cleanEmail,
        fullName: cleanName,
        nip: cleanNip,
        role: params.role,
        isActive: true,
        phone: cleanPhone,
        specialization: cleanSpec,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'staff_directory', newUid), {
        uid: newUid,
        fullName: cleanName,
        role: params.role,
        isActive: true,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${newUid}`);
    }
  };

  const adminDeleteAccount = async (targetUid: string) => {
    if (!firebaseUser || userProfile?.role !== 'Administrator') {
      throw new Error('Hanya Administrator yang dapat menghapus akun pengguna.');
    }
    if (targetUid === firebaseUser.uid) {
      throw new Error('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.');
    }

    const idToken = await firebaseUser.getIdToken();
    const res = await fetch(`/api/admin/users/${encodeURIComponent(targetUid)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      authDeleted?: boolean;
      error?: string;
      message?: string;
    };

    if (!res.ok) {
      const err = new Error(data.message || 'Gagal menghapus akun pengguna.') as Error & {
        code?: string;
      };
      err.code = data.error;
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
    if (!firebaseUser || userProfile?.role !== 'Administrator') {
      throw new Error('Hanya Administrator yang dapat membuat akun massal.');
    }

    const idToken = await firebaseUser.getIdToken();
    const res = await fetch('/api/admin/users/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ accounts }),
    });

    const data = (await res.json().catch(() => ({}))) as {
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
    };

    if (!res.ok) {
      const err = new Error(data.message || 'Gagal membuat banyak akun staf.') as Error & {
        code?: string;
      };
      err.code = data.error;
      throw err;
    }

    return {
      ok: Boolean(data.ok),
      createdCount: data.createdCount || 0,
      failedCount: data.failedCount || 0,
      results: data.results || [],
    };
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        authReady,
        profileLoading,
        blockedMessage,
        idleLogoutMessage,
        clearIdleLogoutMessage,
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

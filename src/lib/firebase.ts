import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  enableNetwork,
  disableNetwork,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;

const firebaseConfig = envApiKey
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)',
    }
  : firebaseAppletConfig;

const app: FirebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const activeDatabaseId = firebaseConfig.firestoreDatabaseId || '(default)';

function createFirestoreInstance(targetApp: FirebaseApp, databaseId: string): Firestore {
  try {
    // Use per-tab isolated in-memory cache so different accounts in separate tabs
    // never share IndexedDB cache or proxy queries through another tab's auth session.
    return initializeFirestore(
      targetApp,
      {
        localCache: memoryLocalCache(),
      },
      databaseId
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('already been called') || message.includes('already exists')) {
      return getFirestore(targetApp, databaseId);
    }
    return getFirestore(targetApp, databaseId);
  }
}

function createAuthInstance(targetApp: FirebaseApp): Auth {
  try {
    // Isolate Auth session per browser tab via sessionStorage so multiple accounts
    // can stay logged in simultaneously across separate tabs without overwriting each other.
    return initializeAuth(targetApp, {
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('already-initialized') || message.includes('already exists')) {
      return getAuth(targetApp);
    }
    return getAuth(targetApp);
  }
}

export const db: Firestore = createFirestoreInstance(app, activeDatabaseId);
export const auth: Auth = createAuthInstance(app);

export const ACTIVE_FIREBASE_PROJECT_ID: string = firebaseConfig.projectId;
export const BOOTSTRAP_ADMIN_EMAILS = [
  'muhammadhaikalmalilang@gmail.com',
] as const;
export const BOOTSTRAP_ADMIN_EMAIL = BOOTSTRAP_ADMIN_EMAILS[0];

export function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return BOOTSTRAP_ADMIN_EMAILS.some((adminEmail) => adminEmail.toLowerCase() === normalized);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function formatFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  const json = JSON.stringify(errInfo);
  console.error('Firestore Error: ', json);
  return json;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  throw new Error(formatFirestoreError(error, operationType, path));
}

export function getUserFriendlyFirestoreError(
  error: unknown,
  fallbackMessage: string
): string {
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code.replace(/^firestore\//, '').toLowerCase()
      : '';
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const lower = rawMessage.toLowerCase();

  if (code === 'permission-denied' || lower.includes('missing or insufficient permissions')) {
    return 'Akses penyimpanan ditolak (permission-denied). Pastikan akun Anda aktif dan memiliki peran yang sesuai.';
  }
  if (isTransientFirestoreError(error)) {
    return 'Koneksi ke server Firestore sedang terganggu. Periksa jaringan internet Anda lalu coba simpan kembali.';
  }
  if (code === 'not-found') {
    return 'Data tujuan tidak ditemukan di server. Muat ulang halaman lalu coba simpan kembali.';
  }
  if (code === 'invalid-argument') {
    return 'Format data tidak valid. Periksa kembali isian formulir Anda.';
  }
  return fallbackMessage;
}

const TRANSIENT_FIRESTORE_CODES = new Set([
  'unavailable',
  'aborted',
  'deadline-exceeded',
  'resource-exhausted',
  'cancelled',
  'unknown',
]);

export function isTransientFirestoreError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    const normalized = code.replace(/^firestore\//, '').toLowerCase();
    if (TRANSIENT_FIRESTORE_CODES.has(normalized)) return true;
  }
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof (error as { message?: unknown }).message === 'string'
      ? String((error as { message?: string }).message).toLowerCase()
      : '';
  return (
    message.includes('the client is offline') ||
    message.includes('failed to get document because the client is offline') ||
    message.includes('network') ||
    message.includes('unavailable') ||
    message.includes('deadline') ||
    message.includes('timeout')
  );
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    const normalized = code.replace(/^firestore\//, '').toLowerCase();
    if (normalized === 'permission-denied') return true;
  }
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof (error as { message?: unknown }).message === 'string'
      ? String((error as { message?: string }).message).toLowerCase()
      : '';
  return message.includes('missing or insufficient permissions') || message.includes('permission-denied');
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
      return false;
    }
    return !isTransientFirestoreError(error);
  }
}

export type ReconnectReason = 'online' | 'visibilitychange' | 'focus' | 'error' | 'manual';

export interface ReconnectEvent {
  reason: ReconnectReason;
  shouldResubscribe: boolean;
}

export interface ReconnectOptions {
  force?: boolean;
  hardReset?: boolean;
  resubscribe?: boolean;
  reason?: ReconnectReason;
}

const reconnectListeners = new Set<(event: ReconnectEvent) => void>();

export function onFirestoreReconnect(listener: (event: ReconnectEvent) => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

const RECONNECT_COOLDOWN_MS = 5000;
const RESUBSCRIBE_COOLDOWN_MS = 15000;
const STALE_BACKGROUND_MS = 120000;

let lastReconnectAt = 0;
let lastResubscribeAt = 0;
let lastHiddenAt = 0;
let wasOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
let reconnectPromise: Promise<void> | null = null;

export async function reconnectFirestore(
  forceOrOptions: boolean | ReconnectOptions = false
): Promise<void> {
  const opts: ReconnectOptions =
    typeof forceOrOptions === 'boolean'
      ? {
          force: forceOrOptions,
          hardReset: forceOrOptions,
          resubscribe: true,
          reason: forceOrOptions ? 'manual' : 'focus',
        }
      : forceOrOptions;

  const force = Boolean(opts.force);
  const hardReset = Boolean(opts.hardReset);
  const wantResubscribe = opts.resubscribe ?? true;
  const reason: ReconnectReason = opts.reason ?? (force ? 'manual' : 'focus');

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    wasOffline = true;
    return;
  }

  // On normal focus/short tab switches while already online, Firestore SDK's persistent channel stays live;
  // avoid redundant server probes or listener tear-downs.
  if (!force && !hardReset && !wasOffline && reason === 'focus') {
    return Promise.resolve();
  }

  const now = Date.now();
  if (reconnectPromise) {
    return reconnectPromise;
  }
  if (!force && now - lastReconnectAt < RECONNECT_COOLDOWN_MS) {
    return Promise.resolve();
  }

  lastReconnectAt = now;
  const hadOfflineGap = wasOffline;
  const task = (async () => {
    try {
      if (hardReset) {
        await disableNetwork(db).catch(() => undefined);
      }
      await enableNetwork(db).catch(() => undefined);
      if (hardReset || hadOfflineGap || reason === 'online' || reason === 'error' || reason === 'manual') {
        const reachable = await testConnection();
        if (!reachable && !hardReset) {
          await disableNetwork(db).catch(() => undefined);
          await enableNetwork(db).catch(() => undefined);
          await testConnection();
        }
      }
      wasOffline = false;
    } finally {
      reconnectPromise = null;
      const doneAt = Date.now();
      const needsResubscribeByReason =
        force ||
        hadOfflineGap ||
        reason === 'online' ||
        reason === 'manual' ||
        reason === 'error';
      const shouldResubscribe =
        wantResubscribe &&
        needsResubscribeByReason &&
        (reason === 'online' ||
          reason === 'manual' ||
          reason === 'error' ||
          doneAt - lastResubscribeAt >= RESUBSCRIBE_COOLDOWN_MS);
      if (shouldResubscribe) {
        lastResubscribeAt = doneAt;
      }
      reconnectListeners.forEach((cb) => {
        try {
          cb({ reason, shouldResubscribe });
        } catch {
          // Ignore callback error
        }
      });
    }
  })();

  reconnectPromise = task;
  return task;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('offline', () => {
    wasOffline = true;
  });
  window.addEventListener('online', () => {
    void reconnectFirestore({
      force: true,
      hardReset: wasOffline,
      resubscribe: true,
      reason: 'online',
    });
  });
  window.addEventListener('focus', () => {
    if (!wasOffline) return;
    void reconnectFirestore({
      force: true,
      hardReset: true,
      resubscribe: true,
      reason: 'focus',
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === 'visible') {
      const hiddenDuration = lastHiddenAt > 0 ? Date.now() - lastHiddenAt : 0;
      const staleBackground = hiddenDuration >= STALE_BACKGROUND_MS;
      if (!wasOffline && !staleBackground) return;
      void reconnectFirestore({
        force: wasOffline || staleBackground,
        hardReset: wasOffline,
        resubscribe: true,
        reason: 'visibilitychange',
      });
    }
  });
}

void testConnection();

/**
 * Secondary Firebase app instance for Administrator account provisioning
 * so creating a new user in Firebase Auth does not sign out the active Admin session.
 */
export async function withSecondaryAuth<T>(fn: (secondaryAuth: Auth) => Promise<T>): Promise<T> {
  const secondaryAppName = `AdminProvisioner_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  let secondaryAuth: Auth;
  try {
    secondaryAuth = initializeAuth(secondaryApp, {
      persistence: inMemoryPersistence,
    });
  } catch {
    secondaryAuth = getAuth(secondaryApp);
  }
  try {
    return await fn(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

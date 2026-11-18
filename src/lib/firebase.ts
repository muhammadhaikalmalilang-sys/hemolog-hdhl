import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  enableNetwork,
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

function createFirestoreInstance(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    // Fallback if Firestore was already initialized (e.g., module hot reload or multiple imports)
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db: Firestore = createFirestoreInstance();
export const auth: Auth = getAuth(app);

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

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
    }
  }
}

const reconnectListeners = new Set<() => void>();

export function onFirestoreReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

let lastReconnectAt = 0;
let reconnectPromise: Promise<void> | null = null;

export async function reconnectFirestore(force = false): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastReconnectAt < 2500) {
    return reconnectPromise ?? Promise.resolve();
  }
  lastReconnectAt = now;
  reconnectPromise = (async () => {
    try {
      await enableNetwork(db).catch(() => undefined);
      await testConnection();
    } finally {
      reconnectListeners.forEach((cb) => {
        try {
          cb();
        } catch {
          // Ignore callback error
        }
      });
    }
  })();
  return reconnectPromise;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('online', () => {
    void reconnectFirestore(true);
  });
  window.addEventListener('focus', () => {
    void reconnectFirestore(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void reconnectFirestore(false);
    }
  });
}

testConnection();

/**
 * Secondary Firebase app instance for Administrator account provisioning
 * so creating a new user in Firebase Auth does not sign out the active Admin session.
 */
export async function withSecondaryAuth<T>(fn: (secondaryAuth: Auth) => Promise<T>): Promise<T> {
  const secondaryAppName = `AdminProvisioner_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    return await fn(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

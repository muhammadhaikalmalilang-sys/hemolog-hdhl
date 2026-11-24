import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';

export const SUPABASE_PROJECT_ID = 'wowaehkpbefqbaebbask';
export const DEFAULT_SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

const envSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const envSupabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const SUPABASE_URL: string = envSupabaseUrl || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY: string = envSupabaseAnonKey;
export const isSupabaseConfigured: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const BOOTSTRAP_ADMIN_EMAILS = ['muhammadhaikalmalilang@gmail.com'] as const;
export const BOOTSTRAP_ADMIN_EMAIL = BOOTSTRAP_ADMIN_EMAILS[0];

export function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return BOOTSTRAP_ADMIN_EMAILS.some((adminEmail) => adminEmail.toLowerCase() === normalized);
}

/**
 * Adapter sessionStorage per tab browser agar beberapa akun staf/verifikator/admin
 * dapat tetap login secara terpisah pada tab yang berbeda tanpa saling menimpa sesi.
 */
const tabSessionStorage: SupportedStorage | undefined =
  typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
    ? {
        getItem: (key: string) => {
          try {
            return window.sessionStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key: string, value: string) => {
          try {
            window.sessionStorage.setItem(key, value);
          } catch {
            // Ignore quota errors
          }
        },
        removeItem: (key: string) => {
          try {
            window.sessionStorage.removeItem(key);
          } catch {
            // Ignore errors
          }
        },
      }
    : undefined;

function createInMemoryStorage(): SupportedStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

let supabaseClient: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: `hemolog-sb-${SUPABASE_PROJECT_ID}`,
      storage: tabSessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

export const supabase: SupabaseClient | null = supabaseClient;

export function requireSupabase(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error(
      `Konfigurasi Supabase (VITE_SUPABASE_ANON_KEY) belum diatur untuk project ${SUPABASE_PROJECT_ID}.`
    );
  }
  return supabaseClient;
}

export function createSecondarySupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Konfigurasi Supabase belum lengkap.');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: `hemolog-sb-secondary-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      storage: createInMemoryStorage(),
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function extractDbErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const obj = error as { code?: unknown; status?: unknown };
  if (typeof obj.code === 'string') return obj.code.toLowerCase();
  if (typeof obj.status === 'number') return String(obj.status);
  return '';
}

export function extractDbErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const obj = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [obj.message, obj.details, obj.hint]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (parts.length > 0) return parts.join(' — ');
  }
  return String(error);
}

export function isPermissionDeniedError(error: unknown): boolean {
  const code = extractDbErrorCode(error);
  const msg = extractDbErrorMessage(error).toLowerCase();
  return (
    code === '42501' ||
    code === 'pgrst301' ||
    code === '401' ||
    code === '403' ||
    msg.includes('permission denied') ||
    msg.includes('row-level security') ||
    msg.includes('insufficient_privilege') ||
    msg.includes('jwt expired')
  );
}

export function isTransientDbError(error: unknown): boolean {
  const code = extractDbErrorCode(error);
  const msg = extractDbErrorMessage(error).toLowerCase();
  return (
    code === '503' ||
    code === '504' ||
    code === '502' ||
    code === '08006' ||
    code === '08001' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('temporarily unavailable')
  );
}

export function isDuplicateKeyError(error: unknown): boolean {
  const code = extractDbErrorCode(error);
  const msg = extractDbErrorMessage(error).toLowerCase();
  return code === '23505' || msg.includes('duplicate key value');
}

export function formatDbError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const errInfo = {
    error: extractDbErrorMessage(error),
    code: extractDbErrorCode(error) || null,
    operationType,
    path,
    projectId: SUPABASE_PROJECT_ID,
  };
  const json = JSON.stringify(errInfo);
  console.error('Supabase DB Error:', json);
  return json;
}

export function handleDbError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  throw new Error(formatDbError(error, operationType, path));
}

export function getUserFriendlyDbError(error: unknown, fallbackMessage: string): string {
  const code = extractDbErrorCode(error);
  const rawMessage = extractDbErrorMessage(error);
  const lower = rawMessage.toLowerCase();

  if (isPermissionDeniedError(error)) {
    return 'Akses penyimpanan ditolak oleh kebijakan RLS Supabase. Pastikan akun Anda aktif, skema SQL sudah dijalankan, dan peran Anda sesuai.';
  }
  if (isDuplicateKeyError(error)) {
    return 'Data dengan kunci yang sama sudah ada di database (duplikat). Muat ulang halaman lalu coba kembali.';
  }
  if (isTransientDbError(error)) {
    return 'Koneksi ke server Supabase sedang terganggu. Periksa jaringan internet Anda lalu coba simpan kembali.';
  }
  if (code === '23503') {
    return 'Referensi data terkait tidak ditemukan di database.';
  }
  if (code === '23514' || code === '22p02') {
    return 'Format data tidak sesuai aturan kolom database. Periksa kembali isian formulir Anda.';
  }
  if (code === '42p01' || lower.includes('relation') && lower.includes('does not exist')) {
    return 'Tabel database belum tersedia di Supabase. Jalankan skrip supabase/schema.sql di SQL Editor Supabase terlebih dahulu.';
  }
  return fallbackMessage;
}

export type ReconnectReason = 'online' | 'visibilitychange' | 'focus' | 'error' | 'manual';

export interface ReconnectEvent {
  reason: ReconnectReason;
  shouldResubscribe: boolean;
}

export interface ReconnectOptions {
  force?: boolean;
  resubscribe?: boolean;
  reason?: ReconnectReason;
}

const reconnectListeners = new Set<(event: ReconnectEvent) => void>();

export function onSupabaseReconnect(listener: (event: ReconnectEvent) => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

let lastReconnectAt = 0;
let lastHiddenAt = 0;
let wasOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;

export async function reconnectSupabase(
  forceOrOptions: boolean | ReconnectOptions = false
): Promise<void> {
  if (!supabaseClient) return;
  const opts: ReconnectOptions =
    typeof forceOrOptions === 'boolean'
      ? { force: forceOrOptions, resubscribe: true, reason: forceOrOptions ? 'manual' : 'focus' }
      : forceOrOptions;

  const force = Boolean(opts.force);
  const wantResubscribe = opts.resubscribe ?? true;
  const reason: ReconnectReason = opts.reason ?? (force ? 'manual' : 'focus');

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    wasOffline = true;
    return;
  }

  const now = Date.now();
  if (!force && now - lastReconnectAt < 5000) return;
  lastReconnectAt = now;
  const hadOfflineGap = wasOffline;
  wasOffline = false;

  try {
    supabaseClient.realtime.connect();
  } catch {
    // Ignore realtime reconnect errors
  }

  const shouldResubscribe =
    wantResubscribe && (force || hadOfflineGap || reason === 'online' || reason === 'manual');

  reconnectListeners.forEach((cb) => {
    try {
      cb({ reason, shouldResubscribe });
    } catch {
      // Ignore callback error
    }
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('offline', () => {
    wasOffline = true;
  });
  window.addEventListener('online', () => {
    void reconnectSupabase({ force: true, resubscribe: true, reason: 'online' });
  });
  window.addEventListener('focus', () => {
    if (!wasOffline) return;
    void reconnectSupabase({ force: true, resubscribe: true, reason: 'focus' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === 'visible') {
      const hiddenDuration = lastHiddenAt > 0 ? Date.now() - lastHiddenAt : 0;
      if (!wasOffline && hiddenDuration < 120_000) return;
      void reconnectSupabase({
        force: true,
        resubscribe: true,
        reason: 'visibilitychange',
      });
    }
  });
}

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const BOOTSTRAP_ADMIN_EMAILS = new Set([
  'muhammadhaikalmalilang@gmail.com',
]);

function isBootstrapAdminEmail(email) {
  return Boolean(email && BOOTSTRAP_ADMIN_EMAILS.has(String(email).trim().toLowerCase()));
}

function loadAppletFirebaseConfig() {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
  ];

  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // Ignore invalid or unreadable local file and fall back to env variables
    }
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
    firestoreDatabaseId:
      process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || '(default)',
  };
}

const appletConfig = loadAppletFirebaseConfig();
const targetProjectId =
  process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId;
const targetDatabaseId =
  process.env.FIREBASE_DATABASE_ID ||
  process.env.VITE_FIREBASE_DATABASE_ID ||
  appletConfig.firestoreDatabaseId ||
  '(default)';

function escapeControlCharsInJsonStrings(input) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === '\r') continue;
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
    }
    out += ch;
  }

  return out;
}

function tryParseJsonObject(raw) {
  const candidates = [raw, escapeControlCharsInJsonStrings(raw)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        const inner = parsed.trim();
        if (inner.startsWith('{')) {
          const innerParsed = JSON.parse(escapeControlCharsInJsonStrings(inner));
          if (innerParsed && typeof innerParsed === 'object' && !Array.isArray(innerParsed)) {
            return innerParsed;
          }
        }
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function parseServiceAccountFromEnv(rawValue) {
  let trimmed = String(rawValue || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.startsWith('{') || inner.startsWith('{\\')) {
      trimmed = inner;
    }
  }

  let jsonText = trimmed;
  if (!trimmed.startsWith('{')) {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
    if (decoded.startsWith('{')) {
      jsonText = decoded;
    }
  }

  if (jsonText.includes('\\"') && !jsonText.includes('"type"')) {
    jsonText = jsonText.replace(/\\"/g, '"');
  }

  const parsed = tryParseJsonObject(jsonText);
  if (!parsed) {
    throw new Error('Invalid Service Account JSON format.');
  }

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  if (typeof parsed.privateKey === 'string') {
    parsed.privateKey = parsed.privateKey.replace(/\\n/g, '\n');
  }

  const hasClientEmail = Boolean(parsed.client_email || parsed.clientEmail);
  const hasPrivateKey = Boolean(parsed.private_key || parsed.privateKey);
  if (!hasClientEmail || !hasPrivateKey) {
    throw new Error('Service Account JSON missing client_email or private_key.');
  }

  return parsed;
}

function resolveLocalServiceAccountPath() {
  if (!targetProjectId) return null;
  const candidate = path.resolve(process.cwd(), '.secrets', `${targetProjectId}-adminsdk.json`);
  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveAdminFirestore(adminApp) {
  return targetDatabaseId && targetDatabaseId !== '(default)'
    ? getFirestore(adminApp, targetDatabaseId)
    : getFirestore(adminApp);
}

function createTaggedError(message, code, statusCode) {
  const err = new Error(message);
  if (code) err.code = code;
  if (statusCode) err.statusCode = statusCode;
  return err;
}

function getFirebaseAdmin() {
  const existingApp = getApps().find((a) => a.name === 'hemolog-admin');
  if (existingApp) {
    return {
      app: existingApp,
      auth: getAuth(existingApp),
      db: resolveAdminFirestore(existingApp),
    };
  }

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const envClientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const envPrivateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  const localServiceAccountPath = resolveLocalServiceAccountPath();

  let serviceAccount = null;

  if (rawServiceAccount && rawServiceAccount.trim()) {
    try {
      serviceAccount = parseServiceAccountFromEnv(rawServiceAccount);
    } catch {
      throw createTaggedError(
        'Format FIREBASE_SERVICE_ACCOUNT_JSON tidak valid. Pastikan berisi JSON Service Account utuh dari Firebase Console.',
        'FIREBASE_ADMIN_INVALID_CREDENTIALS'
      );
    }
  } else if (envClientEmail && envPrivateKey) {
    serviceAccount = {
      projectId: targetProjectId,
      clientEmail: envClientEmail,
      privateKey: envPrivateKey.replace(/\\n/g, '\n'),
    };
  } else if (localServiceAccountPath) {
    try {
      const fileRaw = fs.readFileSync(localServiceAccountPath, 'utf-8');
      serviceAccount = parseServiceAccountFromEnv(fileRaw);
    } catch {
      throw createTaggedError(
        'Gagal membaca file kredensial Service Account lokal.',
        'FIREBASE_ADMIN_INVALID_CREDENTIALS'
      );
    }
  }

  if (!serviceAccount) {
    throw createTaggedError(
      'FIREBASE_SERVICE_ACCOUNT_JSON belum dikonfigurasi pada server.',
      'FIREBASE_ADMIN_NOT_CONFIGURED'
    );
  }

  const resolvedProjectId =
    targetProjectId || serviceAccount.project_id || serviceAccount.projectId || '';
  const saProjectId = serviceAccount.project_id || serviceAccount.projectId;
  if (resolvedProjectId && saProjectId && saProjectId !== resolvedProjectId) {
    throw createTaggedError(
      `Service Account JSON berasal dari project "${saProjectId}", sedangkan aplikasi terhubung ke "${resolvedProjectId}".`,
      'FIREBASE_ADMIN_PROJECT_MISMATCH'
    );
  }

  let adminApp;
  try {
    adminApp = initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: resolvedProjectId,
      },
      'hemolog-admin'
    );
  } catch {
    throw createTaggedError(
      'Kredensial FIREBASE_SERVICE_ACCOUNT_JSON gagal dimuat oleh Firebase Admin SDK. Pastikan private_key dan JSON utuh.',
      'FIREBASE_ADMIN_INVALID_CREDENTIALS'
    );
  }

  return {
    app: adminApp,
    auth: getAuth(adminApp),
    db: resolveAdminFirestore(adminApp),
  };
}

const ALLOWED_ROLES = new Set([
  'Administrator',
  'Managerial',
  'Kepala Ruang',
  'PJ Shift',
  'Perawat Pelaksana',
]);

async function verifyAdminCaller(req, services) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;

  const decoded = await services.auth.verifyIdToken(token);
  const isBootstrapCaller =
    decoded.email_verified === true && isBootstrapAdminEmail(decoded.email);

  if (isBootstrapCaller) return decoded;

  const callerSnap = await services.db.collection('users').doc(decoded.uid).get();
  const callerData = callerSnap.data();
  const isAdminCaller =
    callerSnap.exists &&
    callerData?.isActive === true &&
    callerData?.role === 'Administrator';

  if (!isAdminCaller) {
    throw createTaggedError(
      'Hanya Administrator aktif yang berhak mengelola akun pengguna.',
      'FORBIDDEN',
      403
    );
  }

  return decoded;
}

export function createApiApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (
      p.includes('.secrets') ||
      p.includes('.env') ||
      p.includes('firebase-adminsdk') ||
      p.includes('service-account')
    ) {
      res.status(404).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    const hasJson = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
    const hasPair = Boolean(
      process.env.FIREBASE_CLIENT_EMAIL?.trim() && process.env.FIREBASE_PRIVATE_KEY?.trim()
    );
    const hasLocalFile = Boolean(resolveLocalServiceAccountPath());

    let adminReady = false;
    let adminErrorCode = null;
    let adminErrorMessage = null;
    try {
      getFirebaseAdmin();
      adminReady = true;
    } catch (err) {
      adminErrorCode = err?.code || 'FIREBASE_ADMIN_ERROR';
      adminErrorMessage = err instanceof Error ? err.message : String(err);
    }

    res.json({
      ok: true,
      projectId: targetProjectId,
      databaseId: targetDatabaseId,
      adminConfigured: hasJson || hasPair || hasLocalFile,
      adminReady,
      adminErrorCode,
      adminErrorMessage,
    });
  });

  app.post('/api/admin/users/bulk', async (req, res) => {
    let services;
    try {
      services = getFirebaseAdmin();
    } catch (err) {
      res.status(503).json({
        error: err?.code || 'FIREBASE_ADMIN_NOT_CONFIGURED',
        message: err instanceof Error ? err.message : 'Firebase Admin belum dikonfigurasi.',
      });
      return;
    }

    try {
      const caller = await verifyAdminCaller(req, services);
      if (!caller) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Token autentikasi tidak ditemukan.',
        });
        return;
      }
    } catch (err) {
      res.status(err?.statusCode || 401).json({
        error: err?.code || 'UNAUTHORIZED',
        message:
          (err instanceof Error && err.message) || 'Gagal memverifikasi otoritas Administrator.',
      });
      return;
    }

    const body = req.body || {};
    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    if (accounts.length === 0) {
      res.status(400).json({
        error: 'EMPTY_PAYLOAD',
        message: 'Daftar akun tidak boleh kosong.',
      });
      return;
    }

    if (accounts.length > 100) {
      res.status(400).json({
        error: 'BATCH_TOO_LARGE',
        message: 'Maksimal 100 akun dalam satu kali pembuatan massal.',
      });
      return;
    }

    const results = [];

    for (let i = 0; i < accounts.length; i++) {
      const item = accounts[i] || {};
      const rowIndex = typeof item.rowIndex === 'number' ? item.rowIndex : i;
      const fullName = String(item.fullName || '').trim().slice(0, 120);
      const nip = String(item.nip || '').trim().slice(0, 40);
      const email = String(item.email || '').trim().toLowerCase().slice(0, 200);
      const password = String(item.password || '');
      const role = String(item.role || 'Perawat Pelaksana').trim();
      const phone = String(item.phone || '').trim().slice(0, 30);
      const specialization =
        String(item.specialization || 'Perawat Hemodialisa').trim().slice(0, 100) ||
        'Perawat Hemodialisa';

      if (fullName.length < 2) {
        results.push({ rowIndex, email, fullName, ok: false, error: 'Nama minimal 2 karakter.' });
        continue;
      }
      if (nip.length < 1) {
        results.push({ rowIndex, email, fullName, ok: false, error: 'NIP wajib diisi.' });
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        results.push({ rowIndex, email, fullName, ok: false, error: 'Format email tidak valid.' });
        continue;
      }
      if (password.length < 6 || password.length > 128) {
        results.push({
          rowIndex,
          email,
          fullName,
          ok: false,
          error: 'Password harus 6–128 karakter.',
        });
        continue;
      }
      if (!ALLOWED_ROLES.has(role)) {
        results.push({
          rowIndex,
          email,
          fullName,
          ok: false,
          error: `Role "${role}" tidak valid.`,
        });
        continue;
      }

      let createdUid = null;
      try {
        const userRecord = await services.auth.createUser({
          email,
          password,
          displayName: fullName,
          emailVerified: false,
        });
        createdUid = userRecord.uid;

        const batch = services.db.batch();
        batch.set(services.db.collection('users').doc(createdUid), {
          uid: createdUid,
          email,
          fullName,
          nip,
          role,
          isActive: true,
          phone,
          specialization,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(services.db.collection('staff_directory').doc(createdUid), {
          uid: createdUid,
          fullName,
          role,
          isActive: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        results.push({
          rowIndex,
          email,
          fullName,
          ok: true,
          uid: createdUid,
        });
      } catch (err) {
        if (createdUid) {
          await services.auth.deleteUser(createdUid).catch(() => undefined);
        }
        const code = err?.code || '';
        let message = err instanceof Error ? err.message : 'Gagal membuat akun.';
        if (code === 'auth/email-already-exists') {
          message = 'Email sudah terdaftar di Firebase Authentication.';
        } else if (code === 'auth/invalid-password') {
          message = 'Password minimal 6 karakter.';
        } else if (code === 'auth/invalid-email') {
          message = 'Format email tidak valid.';
        }
        results.push({
          rowIndex,
          email,
          fullName,
          ok: false,
          error: message,
        });
      }
    }

    const createdCount = results.filter((r) => r.ok).length;
    const failedCount = results.length - createdCount;

    res.json({
      ok: failedCount === 0,
      createdCount,
      failedCount,
      results,
    });
  });

  app.delete('/api/admin/users/:uid', async (req, res) => {
    const targetUid = String(req.params.uid || '').trim();
    if (!targetUid || !/^[a-zA-Z0-9_-]{1,128}$/.test(targetUid)) {
      res.status(400).json({
        error: 'INVALID_UID',
        message: 'UID target tidak valid.',
      });
      return;
    }

    let services;
    try {
      services = getFirebaseAdmin();
    } catch (err) {
      res.status(503).json({
        error: err?.code || 'FIREBASE_ADMIN_NOT_CONFIGURED',
        message: err instanceof Error ? err.message : 'Firebase Admin belum dikonfigurasi.',
      });
      return;
    }

    try {
      const decoded = await verifyAdminCaller(req, services);
      if (!decoded) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Token autentikasi tidak ditemukan.',
        });
        return;
      }

      if (decoded.uid === targetUid) {
        res.status(400).json({
          error: 'SELF_DELETE_FORBIDDEN',
          message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.',
        });
        return;
      }

      const targetUserSnap = await services.db.collection('users').doc(targetUid).get();
      const targetEmail = String(targetUserSnap.data()?.email || '').toLowerCase();
      if (isBootstrapAdminEmail(targetEmail)) {
        res.status(403).json({
          error: 'BOOTSTRAP_ADMIN_PROTECTED',
          message: 'Akun Administrator utama tidak dapat dihapus.',
        });
        return;
      }

      let authDeleted = true;
      try {
        await services.auth.deleteUser(targetUid);
      } catch (authErr) {
        const code = authErr?.code;
        if (code === 'auth/user-not-found') {
          authDeleted = false;
        } else {
          throw authErr;
        }
      }

      await Promise.all([
        services.db.collection('users').doc(targetUid).delete(),
        services.db.collection('staff_directory').doc(targetUid).delete(),
      ]);

      res.json({
        ok: true,
        deletedUid: targetUid,
        authDeleted,
      });
    } catch (err) {
      console.error('Failed to delete Firebase user:', err);
      res.status(err?.statusCode || 500).json({
        error: err?.code || 'DELETE_USER_FAILED',
        message:
          (err instanceof Error && err.message) ||
          'Gagal menghapus akun dari Firebase Authentication.',
      });
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'API_ROUTE_NOT_FOUND',
      message: `Endpoint API tidak ditemukan (${req.method} ${req.originalUrl}).`,
    });
  });

  return app;
}

let cachedApp = null;

function getApp() {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  return cachedApp;
}

export default function handler(req, res) {
  const rawUrl = req.url || '/';
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const apiPath = parsed.searchParams.get('__api_path');
    if (apiPath !== null) {
      parsed.searchParams.delete('__api_path');
      const qs = parsed.searchParams.toString();
      const normalizedPath = apiPath.replace(/^\/+/, '');
      if (parsed.pathname === '/api/index' || parsed.pathname === '/api') {
        req.url = `/api/${normalizedPath}${qs ? `?${qs}` : ''}`;
      } else {
        req.url = `${parsed.pathname}${qs ? `?${qs}` : ''}`;
      }
    }
  } catch {
    // Keep original req.url if URL parsing fails
  }

  try {
    const app = getApp();
    return app(req, res);
  } catch (err) {
    console.error('Unhandled API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'SERVER_HANDLER_ERROR',
          message: err instanceof Error ? err.message : 'Terjadi kesalahan internal server API.',
        })
      );
    }
  }
}

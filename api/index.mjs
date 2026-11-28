import express from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_PROJECT_ID = 'wowaehkpbefqbaebbask';
const DEFAULT_SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

const BOOTSTRAP_ADMIN_EMAILS = new Set(['muhammadhaikalmalilang@gmail.com']);

function isBootstrapAdminEmail(email) {
  return Boolean(email && BOOTSTRAP_ADMIN_EMAILS.has(String(email).trim().toLowerCase()));
}

function createTaggedError(message, code, statusCode) {
  const err = new Error(message);
  if (code) err.code = code;
  if (statusCode) err.statusCode = statusCode;
  return err;
}

function getSupabaseConfig() {
  const url = String(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
  ).trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, serviceRoleKey };
}

function getSupabaseAdmin() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) {
    throw createTaggedError(
      'SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi pada server.',
      'SUPABASE_ADMIN_NOT_CONFIGURED',
      503
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

const ALLOWED_ROLES = new Set([
  'Administrator',
  'Managerial',
  'Koordinator Unit Hemodialisa',
  'Kepala Ruang',
  'PJ Shift',
  'Perawat Pelaksana',
]);

async function verifyAdminCaller(req, supabaseAdmin) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw createTaggedError(
      'Sesi login Anda tidak valid atau sudah berakhir. Silakan login ulang.',
      'UNAUTHORIZED',
      401
    );
  }

  const caller = userData.user;
  const emailVerified = Boolean(caller.email_confirmed_at || caller.confirmed_at);
  if (emailVerified && isBootstrapAdminEmail(caller.email)) {
    return caller;
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('users')
    .select('uid, role, is_active')
    .eq('uid', caller.id)
    .maybeSingle();

  if (profileErr) {
    throw createTaggedError(
      'Gagal memverifikasi otoritas Administrator.',
      'FORBIDDEN',
      403
    );
  }

  const isAdminCaller = Boolean(
    profile && profile.is_active === true && profile.role === 'Administrator'
  );
  if (!isAdminCaller) {
    throw createTaggedError(
      'Hanya Administrator aktif yang berhak mengelola akun pengguna.',
      'FORBIDDEN',
      403
    );
  }

  return caller;
}

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (p.includes('.secrets') || p.includes('.env')) {
      res.status(404).end();
      return;
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const { url, serviceRoleKey } = getSupabaseConfig();
    let adminReady = false;
    let adminErrorCode = null;
    let adminErrorMessage = null;

    try {
      const sbAdmin = getSupabaseAdmin();
      const { error } = await sbAdmin.from('users').select('uid').limit(1);
      if (error) {
        adminErrorCode = error.code || 'SUPABASE_QUERY_ERROR';
        adminErrorMessage = error.message;
      } else {
        adminReady = true;
      }
    } catch (err) {
      adminErrorCode = err?.code || 'SUPABASE_ADMIN_ERROR';
      adminErrorMessage = err instanceof Error ? err.message : String(err);
    }

    res.json({
      ok: true,
      projectId: SUPABASE_PROJECT_ID,
      supabaseUrl: url,
      adminConfigured: Boolean(url && serviceRoleKey),
      adminReady,
      adminErrorCode,
      adminErrorMessage,
    });
  });

  app.post('/api/admin/users', async (req, res) => {
    let supabaseAdmin;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch (err) {
      res.status(503).json({
        error: err?.code || 'SUPABASE_ADMIN_NOT_CONFIGURED',
        message: err instanceof Error ? err.message : 'Supabase Admin belum dikonfigurasi.',
      });
      return;
    }

    try {
      const caller = await verifyAdminCaller(req, supabaseAdmin);
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
    const fullName = String(body.fullName || '').trim().slice(0, 120);
    const nip = String(body.nip || '').trim().slice(0, 40);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const password = String(body.password || '');
    const role = String(body.role || 'Perawat Pelaksana').trim();
    const phone = String(body.phone || '').trim().slice(0, 30);
    const specialization =
      String(body.specialization || 'Perawat Hemodialisa').trim().slice(0, 100) ||
      'Perawat Hemodialisa';

    if (fullName.length < 2) {
      res.status(400).json({ error: 'INVALID_NAME', message: 'Nama minimal 2 karakter.' });
      return;
    }
    if (!nip) {
      res.status(400).json({ error: 'INVALID_NIP', message: 'NIP wajib diisi.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'INVALID_EMAIL', message: 'Format email tidak valid.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Password harus 6–128 karakter.' });
      return;
    }
    if (!ALLOWED_ROLES.has(role)) {
      res.status(400).json({ error: 'INVALID_ROLE', message: `Role "${role}" tidak valid.` });
      return;
    }

    let createdUid = null;
    try {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          nip,
        },
      });

      if (createErr || !created?.user) {
        const msg = createErr?.message || 'Gagal membuat user di Supabase Auth.';
        const isDuplicate = msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists');
        res.status(isDuplicate ? 409 : 400).json({
          error: isDuplicate ? 'EMAIL_EXISTS' : 'AUTH_CREATE_FAILED',
          message: isDuplicate ? 'Email sudah terdaftar di Supabase Authentication.' : msg,
        });
        return;
      }

      createdUid = created.user.id;
      const nowIso = new Date().toISOString();

      const [{ error: userInsertErr }, { error: dirInsertErr }] = await Promise.all([
        supabaseAdmin.from('users').upsert(
          {
            uid: createdUid,
            email,
            full_name: fullName,
            nip,
            role,
            is_active: true,
            phone,
            specialization,
            created_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: 'uid' }
        ),
        supabaseAdmin.from('staff_directory').upsert(
          {
            uid: createdUid,
            full_name: fullName,
            nip,
            role,
            is_active: true,
            updated_at: nowIso,
          },
          { onConflict: 'uid' }
        ),
      ]);

      if (userInsertErr || dirInsertErr) {
        throw userInsertErr || dirInsertErr;
      }

      res.json({ ok: true, uid: createdUid });
    } catch (err) {
      if (createdUid) {
        await supabaseAdmin.auth.admin.deleteUser(createdUid).catch(() => undefined);
      }
      res.status(500).json({
        error: err?.code || 'CREATE_USER_FAILED',
        message: err instanceof Error ? err.message : 'Gagal menyimpan profil akun pengguna.',
      });
    }
  });

  app.post('/api/admin/users/bulk', async (req, res) => {
    let supabaseAdmin;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch (err) {
      res.status(503).json({
        error: err?.code || 'SUPABASE_ADMIN_NOT_CONFIGURED',
        message: err instanceof Error ? err.message : 'Supabase Admin belum dikonfigurasi.',
      });
      return;
    }

    try {
      const caller = await verifyAdminCaller(req, supabaseAdmin);
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
        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            nip,
          },
        });

        if (createErr || !created?.user) {
          throw createErr || new Error('Gagal membuat akun.');
        }

        createdUid = created.user.id;
        const nowIso = new Date().toISOString();

        const [{ error: userErr }, { error: dirErr }] = await Promise.all([
          supabaseAdmin.from('users').upsert(
            {
              uid: createdUid,
              email,
              full_name: fullName,
              nip,
              role,
              is_active: true,
              phone,
              specialization,
              created_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'uid' }
          ),
          supabaseAdmin.from('staff_directory').upsert(
            {
              uid: createdUid,
              full_name: fullName,
              nip,
              role,
              is_active: true,
              updated_at: nowIso,
            },
            { onConflict: 'uid' }
          ),
        ]);

        if (userErr || dirErr) {
          throw userErr || dirErr;
        }

        results.push({
          rowIndex,
          email,
          fullName,
          ok: true,
          uid: createdUid,
        });
      } catch (err) {
        if (createdUid) {
          await supabaseAdmin.auth.admin.deleteUser(createdUid).catch(() => undefined);
        }
        const rawMsg = err instanceof Error ? err.message : 'Gagal membuat akun.';
        const lower = rawMsg.toLowerCase();
        let message = rawMsg;
        if (lower.includes('already') || lower.includes('exists') || lower.includes('registered')) {
          message = 'Email sudah terdaftar di Supabase Authentication.';
        } else if (lower.includes('password')) {
          message = 'Password minimal 6 karakter.';
        } else if (lower.includes('email')) {
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

    let supabaseAdmin;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch (err) {
      res.status(503).json({
        error: err?.code || 'SUPABASE_ADMIN_NOT_CONFIGURED',
        message: err instanceof Error ? err.message : 'Supabase Admin belum dikonfigurasi.',
      });
      return;
    }

    try {
      const caller = await verifyAdminCaller(req, supabaseAdmin);
      if (!caller) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Token autentikasi tidak ditemukan.',
        });
        return;
      }

      if (caller.id === targetUid) {
        res.status(400).json({
          error: 'SELF_DELETE_FORBIDDEN',
          message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.',
        });
        return;
      }

      const { data: targetUser } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('uid', targetUid)
        .maybeSingle();

      const targetEmail = String(targetUser?.email || '').toLowerCase();
      if (isBootstrapAdminEmail(targetEmail)) {
        res.status(403).json({
          error: 'BOOTSTRAP_ADMIN_PROTECTED',
          message: 'Akun Administrator utama tidak dapat dihapus.',
        });
        return;
      }

      let authDeleted = true;
      const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(targetUid);
      if (delAuthErr) {
        const msg = delAuthErr.message.toLowerCase();
        if (msg.includes('not found') || delAuthErr.status === 404) {
          authDeleted = false;
        } else {
          throw delAuthErr;
        }
      }

      const [{ error: delUserErr }, { error: delDirErr }] = await Promise.all([
        supabaseAdmin.from('users').delete().eq('uid', targetUid),
        supabaseAdmin.from('staff_directory').delete().eq('uid', targetUid),
      ]);

      if (delUserErr || delDirErr) {
        throw delUserErr || delDirErr;
      }

      res.json({
        ok: true,
        deletedUid: targetUid,
        authDeleted,
      });
    } catch (err) {
      console.error('Failed to delete Supabase user:', err);
      res.status(err?.statusCode || 500).json({
        error: err?.code || 'DELETE_USER_FAILED',
        message:
          (err instanceof Error && err.message) ||
          'Gagal menghapus akun dari Supabase Authentication.',
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

-- HemoLog HDHL — Skema Database PostgreSQL, RLS, Triggers, & Realtime untuk Supabase
-- Target Project ID: wowaehkpbefqbaebbask
-- Jalankan seluruh skrip ini satu kali di Supabase Dashboard -> SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. TABEL UTAMA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  uid text PRIMARY KEY,
  email text NOT NULL,
  full_name text NOT NULL,
  nip text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'Perawat Pelaksana'
    CHECK (role IN ('Administrator', 'Managerial', 'Koordinator Unit Hemodialisa', 'Kepala Ruang', 'PJ Shift', 'Perawat Pelaksana')),
  is_active boolean NOT NULL DEFAULT true,
  phone text NOT NULL DEFAULT '',
  specialization text NOT NULL DEFAULT 'Perawat Hemodialisa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_directory (
  uid text PRIMARY KEY,
  full_name text NOT NULL,
  nip text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'Perawat Pelaksana'
    CHECK (role IN ('Administrator', 'Managerial', 'Koordinator Unit Hemodialisa', 'Kepala Ruang', 'PJ Shift', 'Perawat Pelaksana')),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patients (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mrn text NOT NULL,
  full_name text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('L', 'P')),
  birth_year integer NOT NULL DEFAULT 1970,
  vascular_access text NOT NULL
    CHECK (vascular_access IN ('AV Shunt', 'AV Fistula', 'CDL', 'Femoral', 'AVG', 'CVC')),
  diagnosis text NOT NULL DEFAULT '',
  dpjp_id text NOT NULL DEFAULT '-',
  dpjp_name text NOT NULL DEFAULT '-',
  routine_schedule text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Aktif'
    CHECK (status IN ('Aktif', 'Rujuk', 'Meninggal', 'Nonaktif')),
  patient_type text CHECK (patient_type IS NULL OR patient_type IN ('Reguler', 'Non-Reguler')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  full_name text NOT NULL,
  sip_number text NOT NULL,
  specialization text NOT NULL,
  phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Aktif'
    CHECK (status IN ('Aktif', 'Cuti', 'Nonaktif')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.machines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  machine_number text NOT NULL,
  brand text NOT NULL,
  serial_number text NOT NULL DEFAULT '',
  room_zone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Ready'
    CHECK (status IN ('Ready', 'In Use', 'Maintenance', 'Sterilisasi')),
  last_maintenance_date text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.action_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.schedules (
  id text PRIMARY KEY,
  nurse_id text NOT NULL,
  nurse_name text NOT NULL,
  date text NOT NULL,
  month_key text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('Pagi', 'Siang', 'Malam', 'Libur', 'Cuti')),
  validation_status text NOT NULL DEFAULT 'Draft'
    CHECK (validation_status IN ('Draft', 'Validated')),
  validated_by text,
  validated_by_name text,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctor_schedules (
  id text PRIMARY KEY,
  date text NOT NULL,
  month_key text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('Pagi', 'Siang', 'Malam')),
  dpjp_doctor_id text NOT NULL,
  dpjp_doctor_name text NOT NULL,
  duty_doctor_id text NOT NULL DEFAULT '',
  duty_doctor_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pj_shift_assignments (
  id text PRIMARY KEY,
  date text NOT NULL,
  month_key text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('Pagi', 'Siang', 'Malam')),
  pj_nurse_id text NOT NULL,
  pj_nurse_name text NOT NULL,
  pj_nurse_role text NOT NULL DEFAULT 'PJ Shift',
  notes text NOT NULL DEFAULT '',
  assigned_by text,
  assigned_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logbook (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nurse_id text NOT NULL,
  nurse_name text NOT NULL,
  nurse_nip text NOT NULL DEFAULT '',
  patient_id text NOT NULL,
  patient_name text NOT NULL,
  patient_rm text NOT NULL DEFAULT '',
  machine_id text NOT NULL,
  machine_number text NOT NULL,
  doctor_id text NOT NULL,
  doctor_name text NOT NULL,
  duty_doctor_id text NOT NULL DEFAULT '',
  duty_doctor_name text NOT NULL DEFAULT '',
  action_category text NOT NULL DEFAULT 'HD Reguler',
  date text NOT NULL,
  month_key text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('Pagi', 'Siang', 'Malam')),
  start_time text NOT NULL,
  end_time text NOT NULL,
  pre_weight double precision NOT NULL DEFAULT 0,
  post_weight double precision NOT NULL DEFAULT 0,
  pre_bp text NOT NULL DEFAULT '',
  post_bp text NOT NULL DEFAULT '',
  uf_goal double precision NOT NULL DEFAULT 0,
  uf_achieved double precision NOT NULL DEFAULT 0,
  vascular_access text NOT NULL
    CHECK (vascular_access IN ('AV Shunt', 'AV Fistula', 'CDL', 'Femoral', 'AVG', 'CVC')),
  heparin_type text NOT NULL
    CHECK (heparin_type IN ('Standar', 'Minimal', 'Bebas Heparin', 'Heparin', 'LMWH')),
  complications text NOT NULL DEFAULT 'Tidak ada',
  nursing_notes text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT 'Draft'
    CHECK (verification_status IN ('Draft', 'Pending', 'Revision', 'Approved')),
  target_verifier_role text
    CHECK (target_verifier_role IS NULL OR target_verifier_role IN ('PJ Shift', 'Kepala Ruang', 'Koordinator Unit Hemodialisa')),
  target_verifier_id text NOT NULL DEFAULT '',
  target_verifier_name text NOT NULL DEFAULT '',
  verified_by text,
  verified_by_name text,
  verification_note text,
  verified_at timestamptz,
  wizard_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logbook_locks (
  id text PRIMARY KEY,
  date text NOT NULL,
  month_key text NOT NULL,
  patient_id text NOT NULL,
  patient_name text NOT NULL,
  nurse_id text NOT NULL,
  nurse_name text NOT NULL,
  logbook_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.machine_locks (
  id text PRIMARY KEY,
  date text NOT NULL,
  month_key text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('Pagi', 'Siang', 'Malam')),
  machine_id text NOT NULL,
  machine_number text NOT NULL,
  patient_id text NOT NULL,
  patient_name text NOT NULL,
  nurse_id text NOT NULL,
  nurse_name text NOT NULL,
  logbook_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  report_type text NOT NULL CHECK (report_type IN ('pj_shift', 'patient_care', 'monthly_unit')),
  date text NOT NULL,
  month_key text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  author_role text NOT NULL,
  shift text CHECK (shift IS NULL OR shift IN ('Pagi', 'Siang', 'Malam')),
  total_patients integer,
  active_machines integer,
  nurses_on_duty text,
  incidents text,
  handover_notes text,
  section_d_items jsonb,
  sbar_situation text,
  sbar_background text,
  sbar_assessment text,
  sbar_recommendation text,
  handover_signed_by text,
  handover_signed_by_name text,
  handover_signed_shift text,
  handover_signed_at timestamptz,
  received_signed_by text,
  received_signed_by_name text,
  received_signed_shift text,
  received_signed_date text,
  received_signed_at timestamptz,
  review_status text CHECK (review_status IS NULL OR review_status IN ('Submitted', 'Reviewed')),
  reviewed_by text,
  reviewed_by_name text,
  review_note text,
  reviewed_at timestamptz,
  patient_id text,
  patient_name text,
  patient_rm text,
  soap_subjective text,
  soap_objective text,
  soap_assessment text,
  soap_plan text,
  medical_order text,
  total_treatments integer,
  approved_treatments integer,
  summary_notes text,
  status text CHECK (status IS NULL OR status IN ('Draft', 'Final')),
  target_nurse_id text,
  target_nurse_name text,
  target_nurse_nip text,
  target_nurse_role text,
  nurse_signed_by text,
  nurse_signed_by_name text,
  nurse_signed_role text,
  nurse_signed_at timestamptz,
  karu_signed_by text,
  karu_signed_by_name text,
  karu_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.form_templates (
  id text PRIMARY KEY,
  form_title text NOT NULL,
  monthly_report_title text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indeks performa query harian & bulanan
CREATE INDEX IF NOT EXISTS idx_logbook_date_shift ON public.logbook (date, shift);
CREATE INDEX IF NOT EXISTS idx_logbook_nurse_date ON public.logbook (nurse_id, date);
CREATE INDEX IF NOT EXISTS idx_logbook_month_key ON public.logbook (month_key);
CREATE INDEX IF NOT EXISTS idx_schedules_month_nurse ON public.schedules (month_key, nurse_id);
CREATE INDEX IF NOT EXISTS idx_reports_type_date ON public.reports (report_type, date);
CREATE INDEX IF NOT EXISTS idx_logbook_locks_date ON public.logbook_locks (date);
CREATE INDEX IF NOT EXISTS idx_machine_locks_date_shift ON public.machine_locks (date, shift);

-- ============================================================================
-- 2. TRIGGER OTOMATIS updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users',
    'staff_directory',
    'patients',
    'doctors',
    'machines',
    'action_categories',
    'schedules',
    'doctor_schedules',
    'pj_shift_assignments',
    'logbook',
    'logbook_locks',
    'machine_locks',
    'reports',
    'form_templates'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      tbl,
      tbl
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- 3. HELPER FUNCTIONS UNTUK RLS (SECURITY DEFINER TANPA REKURSI)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_is_bootstrap_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = auth.uid()
      AND lower(coalesce(au.email, '')) = 'muhammadhaikalmalilang@gmail.com'
      AND (au.email_confirmed_at IS NOT NULL OR au.confirmed_at IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.uid = auth.uid()::text
    AND u.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.app_is_active_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = auth.uid()::text
      AND u.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.app_is_bootstrap_admin() OR public.app_current_role() = 'Administrator';
$$;

CREATE OR REPLACE FUNCTION public.app_is_leader_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_current_role() IN ('Administrator', 'Managerial', 'Koordinator Unit Hemodialisa', 'Kepala Ruang', 'PJ Shift');
$$;

CREATE OR REPLACE FUNCTION public.app_is_verifier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_current_role() IN ('Kepala Ruang', 'PJ Shift', 'Koordinator Unit Hemodialisa');
$$;

CREATE OR REPLACE FUNCTION public.app_is_karu_uid(target_uid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = target_uid
      AND u.role = 'Kepala Ruang'
  );
$$;

CREATE OR REPLACE FUNCTION public.app_own_user_role_unchanged(
  target_uid text,
  new_role text,
  new_active boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = target_uid
      AND u.role = new_role
      AND u.is_active = new_active
  );
$$;

-- ============================================================================
-- 4. ENABLE ROW LEVEL SECURITY & POLICIES
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pj_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;

-- USERS
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR public.app_is_admin());

DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_admin()
    OR (
      uid = auth.uid()::text
      AND (
        role = 'Perawat Pelaksana'
        OR (role = 'Administrator' AND public.app_is_bootstrap_admin())
      )
    )
  );

DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.app_is_admin() OR uid = auth.uid()::text)
  WITH CHECK (
    public.app_is_admin()
    OR (
      uid = auth.uid()::text
      AND public.app_own_user_role_unchanged(uid, role, is_active)
    )
  );

DROP POLICY IF EXISTS users_delete ON public.users;
CREATE POLICY users_delete ON public.users
  FOR DELETE TO authenticated
  USING (
    public.app_is_admin()
    AND uid <> auth.uid()::text
    AND lower(email) <> 'muhammadhaikalmalilang@gmail.com'
  );

-- STAFF DIRECTORY
DROP POLICY IF EXISTS staff_dir_select ON public.staff_directory;
CREATE POLICY staff_dir_select ON public.staff_directory
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff() OR uid = auth.uid()::text);

DROP POLICY IF EXISTS staff_dir_insert ON public.staff_directory;
CREATE POLICY staff_dir_insert ON public.staff_directory
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_admin()
    OR (
      uid = auth.uid()::text
      AND (
        role = 'Perawat Pelaksana'
        OR (role = 'Administrator' AND public.app_is_bootstrap_admin())
      )
    )
  );

DROP POLICY IF EXISTS staff_dir_update ON public.staff_directory;
CREATE POLICY staff_dir_update ON public.staff_directory
  FOR UPDATE TO authenticated
  USING (public.app_is_admin() OR uid = auth.uid()::text)
  WITH CHECK (
    public.app_is_admin()
    OR (
      uid = auth.uid()::text
      AND public.app_own_user_role_unchanged(uid, role, is_active)
    )
  );

DROP POLICY IF EXISTS staff_dir_delete ON public.staff_directory;
CREATE POLICY staff_dir_delete ON public.staff_directory
  FOR DELETE TO authenticated
  USING (public.app_is_admin() AND uid <> auth.uid()::text);

-- MASTER PATIENTS (staf aktif boleh input cepat pasien baru dari wizard logbook)
DROP POLICY IF EXISTS patients_select ON public.patients;
CREATE POLICY patients_select ON public.patients
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS patients_insert ON public.patients;
CREATE POLICY patients_insert ON public.patients
  FOR INSERT TO authenticated
  WITH CHECK (public.app_is_active_staff());

DROP POLICY IF EXISTS patients_update ON public.patients;
CREATE POLICY patients_update ON public.patients
  FOR UPDATE TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS patients_delete ON public.patients;
CREATE POLICY patients_delete ON public.patients
  FOR DELETE TO authenticated
  USING (public.app_is_admin());

-- MASTER DOCTORS, MACHINES, ACTION CATEGORIES
DROP POLICY IF EXISTS doctors_select ON public.doctors;
CREATE POLICY doctors_select ON public.doctors
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS doctors_write ON public.doctors;
CREATE POLICY doctors_write ON public.doctors
  FOR ALL TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS machines_select ON public.machines;
CREATE POLICY machines_select ON public.machines
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS machines_write ON public.machines;
CREATE POLICY machines_write ON public.machines
  FOR ALL TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS action_categories_select ON public.action_categories;
CREATE POLICY action_categories_select ON public.action_categories
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS action_categories_write ON public.action_categories;
CREATE POLICY action_categories_write ON public.action_categories
  FOR ALL TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

-- SCHEDULES, DOCTOR SCHEDULES, PJ SHIFT ASSIGNMENTS
DROP POLICY IF EXISTS schedules_select ON public.schedules;
CREATE POLICY schedules_select ON public.schedules
  FOR SELECT TO authenticated
  USING (
    public.app_is_active_staff()
    AND (public.app_is_leader_or_admin() OR nurse_id = auth.uid()::text)
  );

DROP POLICY IF EXISTS schedules_write ON public.schedules;
CREATE POLICY schedules_write ON public.schedules
  FOR ALL TO authenticated
  USING (public.app_current_role() IN ('Administrator', 'Kepala Ruang', 'PJ Shift'))
  WITH CHECK (public.app_current_role() IN ('Administrator', 'Kepala Ruang', 'PJ Shift'));

DROP POLICY IF EXISTS doctor_schedules_select ON public.doctor_schedules;
CREATE POLICY doctor_schedules_select ON public.doctor_schedules
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS doctor_schedules_write ON public.doctor_schedules;
CREATE POLICY doctor_schedules_write ON public.doctor_schedules
  FOR ALL TO authenticated
  USING (public.app_current_role() IN ('Administrator', 'Kepala Ruang', 'PJ Shift'))
  WITH CHECK (public.app_current_role() IN ('Administrator', 'Kepala Ruang', 'PJ Shift'));

DROP POLICY IF EXISTS pj_shift_assignments_select ON public.pj_shift_assignments;
CREATE POLICY pj_shift_assignments_select ON public.pj_shift_assignments
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS pj_shift_assignments_write ON public.pj_shift_assignments;
CREATE POLICY pj_shift_assignments_write ON public.pj_shift_assignments
  FOR ALL TO authenticated
  USING (public.app_current_role() IN ('Administrator', 'Kepala Ruang', 'PJ Shift'))
  WITH CHECK (public.app_current_role() IN ('Administrator', 'Kepala Ruang', 'PJ Shift'));

-- LOGBOOK (Mendukung Draft, Pending, Revision, Approved + Verifikasi Kepala Ruang / PJ Shift)
DROP POLICY IF EXISTS logbook_select ON public.logbook;
CREATE POLICY logbook_select ON public.logbook
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS logbook_insert ON public.logbook;
CREATE POLICY logbook_insert ON public.logbook
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR (
        nurse_id = auth.uid()::text
        AND verification_status IN ('Draft', 'Pending')
      )
    )
  );

DROP POLICY IF EXISTS logbook_update ON public.logbook;
CREATE POLICY logbook_update ON public.logbook
  FOR UPDATE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR (
        nurse_id = auth.uid()::text
        AND verification_status IN ('Draft', 'Revision')
      )
      OR (
        public.app_is_verifier()
        AND nurse_id <> auth.uid()::text
        AND verification_status IN ('Pending', 'Revision', 'Approved')
        AND (
          public.app_current_role() <> 'Koordinator Unit Hemodialisa'
          OR public.app_is_karu_uid(nurse_id)
        )
      )
    )
  )
  WITH CHECK (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR (
        nurse_id = auth.uid()::text
        AND verification_status IN ('Draft', 'Pending', 'Revision')
      )
      OR (
        public.app_is_verifier()
        AND nurse_id <> auth.uid()::text
        AND verification_status IN ('Pending', 'Revision', 'Approved')
        AND (
          public.app_current_role() <> 'Koordinator Unit Hemodialisa'
          OR public.app_is_karu_uid(nurse_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS logbook_delete ON public.logbook;
CREATE POLICY logbook_delete ON public.logbook
  FOR DELETE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR (
        nurse_id = auth.uid()::text
        AND verification_status IN ('Draft', 'Revision')
      )
    )
  );

-- LOGBOOK LOCKS & MACHINE LOCKS
DROP POLICY IF EXISTS logbook_locks_select ON public.logbook_locks;
CREATE POLICY logbook_locks_select ON public.logbook_locks
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS logbook_locks_insert ON public.logbook_locks;
CREATE POLICY logbook_locks_insert ON public.logbook_locks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_active_staff()
    AND (public.app_is_admin() OR nurse_id = auth.uid()::text)
  );

DROP POLICY IF EXISTS logbook_locks_update ON public.logbook_locks;
CREATE POLICY logbook_locks_update ON public.logbook_locks
  FOR UPDATE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (public.app_is_admin() OR nurse_id = auth.uid()::text OR public.app_is_verifier())
  )
  WITH CHECK (
    public.app_is_active_staff()
    AND (public.app_is_admin() OR nurse_id = auth.uid()::text OR public.app_is_verifier())
  );

DROP POLICY IF EXISTS logbook_locks_delete ON public.logbook_locks;
CREATE POLICY logbook_locks_delete ON public.logbook_locks
  FOR DELETE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR nurse_id = auth.uid()::text
      OR public.app_is_verifier()
      OR NOT EXISTS (SELECT 1 FROM public.logbook l WHERE l.id = logbook_id)
    )
  );

DROP POLICY IF EXISTS machine_locks_select ON public.machine_locks;
CREATE POLICY machine_locks_select ON public.machine_locks
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS machine_locks_insert ON public.machine_locks;
CREATE POLICY machine_locks_insert ON public.machine_locks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_active_staff()
    AND (public.app_is_admin() OR nurse_id = auth.uid()::text)
  );

DROP POLICY IF EXISTS machine_locks_update ON public.machine_locks;
CREATE POLICY machine_locks_update ON public.machine_locks
  FOR UPDATE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (public.app_is_admin() OR nurse_id = auth.uid()::text OR public.app_is_verifier())
  )
  WITH CHECK (
    public.app_is_active_staff()
    AND (public.app_is_admin() OR nurse_id = auth.uid()::text OR public.app_is_verifier())
  );

DROP POLICY IF EXISTS machine_locks_delete ON public.machine_locks;
CREATE POLICY machine_locks_delete ON public.machine_locks
  FOR DELETE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR nurse_id = auth.uid()::text
      OR public.app_is_verifier()
      OR (
        logbook_id <> ''
        AND NOT EXISTS (SELECT 1 FROM public.logbook l WHERE l.id = logbook_id)
      )
    )
  );

-- REPORTS
DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports
  FOR SELECT TO authenticated
  USING (
    public.app_is_active_staff()
    AND (
      public.app_is_leader_or_admin()
      OR report_type = 'patient_care'
      OR author_id = auth.uid()::text
      OR target_nurse_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR author_id = auth.uid()::text
      OR (report_type = 'pj_shift' AND public.app_current_role() IN ('PJ Shift', 'Kepala Ruang'))
      OR (report_type = 'monthly_unit' AND public.app_current_role() IN ('Kepala Ruang', 'PJ Shift', 'Perawat Pelaksana'))
    )
  );

DROP POLICY IF EXISTS reports_update ON public.reports;
CREATE POLICY reports_update ON public.reports
  FOR UPDATE TO authenticated
  USING (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR (
        report_type = 'patient_care'
        AND (author_id = auth.uid()::text OR public.app_current_role() IN ('Kepala Ruang', 'PJ Shift'))
      )
      OR (
        report_type = 'pj_shift'
        AND public.app_current_role() IN ('PJ Shift', 'Kepala Ruang', 'Managerial')
      )
      OR (
        report_type = 'monthly_unit'
        AND (
          author_id = auth.uid()::text
          OR target_nurse_id = auth.uid()::text
          OR public.app_current_role() IN ('Kepala Ruang', 'Managerial', 'PJ Shift')
        )
      )
    )
  )
  WITH CHECK (
    public.app_is_active_staff()
    AND (
      public.app_is_admin()
      OR (
        report_type = 'patient_care'
        AND (author_id = auth.uid()::text OR public.app_current_role() IN ('Kepala Ruang', 'PJ Shift'))
      )
      OR (
        report_type = 'pj_shift'
        AND public.app_current_role() IN ('PJ Shift', 'Kepala Ruang', 'Managerial')
      )
      OR (
        report_type = 'monthly_unit'
        AND (
          author_id = auth.uid()::text
          OR target_nurse_id = auth.uid()::text
          OR public.app_current_role() IN ('Kepala Ruang', 'Managerial', 'PJ Shift')
        )
      )
    )
  );

DROP POLICY IF EXISTS reports_delete ON public.reports;
CREATE POLICY reports_delete ON public.reports
  FOR DELETE TO authenticated
  USING (
    public.app_is_admin()
    OR (
      author_id = auth.uid()::text
      AND review_status IS DISTINCT FROM 'Reviewed'
      AND status IS DISTINCT FROM 'Final'
    )
  );

-- FORM TEMPLATES
DROP POLICY IF EXISTS form_templates_select ON public.form_templates;
CREATE POLICY form_templates_select ON public.form_templates
  FOR SELECT TO authenticated
  USING (public.app_is_active_staff());

DROP POLICY IF EXISTS form_templates_write ON public.form_templates;
CREATE POLICY form_templates_write ON public.form_templates
  FOR ALL TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

-- ============================================================================
-- 4B. GRANT HAK AKSES ROLE SUPABASE (WAJIB AGAR RLS DAPAT DIJALANKAN)
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Fungsi statistik ukuran database & tabel untuk menu Kuota (khusus Administrator)
CREATE OR REPLACE FUNCTION public.app_get_storage_quota()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_db_bytes bigint;
  v_tables jsonb;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Hanya Administrator yang berhak mengakses statistik kuota database.'
      USING ERRCODE = '42501';
  END IF;

  v_db_bytes := pg_database_size(current_database());

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.total_bytes DESC), '[]'::jsonb)
  INTO v_tables
  FROM (
    SELECT
      'logbook'::text AS table_name,
      (SELECT count(*) FROM public.logbook)::bigint AS row_count,
      pg_table_size('public.logbook'::regclass)::bigint AS data_bytes,
      pg_indexes_size('public.logbook'::regclass)::bigint AS index_bytes,
      pg_total_relation_size('public.logbook'::regclass)::bigint AS total_bytes
    UNION ALL
    SELECT 'reports', (SELECT count(*) FROM public.reports), pg_table_size('public.reports'::regclass), pg_indexes_size('public.reports'::regclass), pg_total_relation_size('public.reports'::regclass)
    UNION ALL
    SELECT 'patients', (SELECT count(*) FROM public.patients), pg_table_size('public.patients'::regclass), pg_indexes_size('public.patients'::regclass), pg_total_relation_size('public.patients'::regclass)
    UNION ALL
    SELECT 'schedules', (SELECT count(*) FROM public.schedules), pg_table_size('public.schedules'::regclass), pg_indexes_size('public.schedules'::regclass), pg_total_relation_size('public.schedules'::regclass)
    UNION ALL
    SELECT 'doctor_schedules', (SELECT count(*) FROM public.doctor_schedules), pg_table_size('public.doctor_schedules'::regclass), pg_indexes_size('public.doctor_schedules'::regclass), pg_total_relation_size('public.doctor_schedules'::regclass)
    UNION ALL
    SELECT 'pj_shift_assignments', (SELECT count(*) FROM public.pj_shift_assignments), pg_table_size('public.pj_shift_assignments'::regclass), pg_indexes_size('public.pj_shift_assignments'::regclass), pg_total_relation_size('public.pj_shift_assignments'::regclass)
    UNION ALL
    SELECT 'doctors', (SELECT count(*) FROM public.doctors), pg_table_size('public.doctors'::regclass), pg_indexes_size('public.doctors'::regclass), pg_total_relation_size('public.doctors'::regclass)
    UNION ALL
    SELECT 'machines', (SELECT count(*) FROM public.machines), pg_table_size('public.machines'::regclass), pg_indexes_size('public.machines'::regclass), pg_total_relation_size('public.machines'::regclass)
    UNION ALL
    SELECT 'users', (SELECT count(*) FROM public.users), pg_table_size('public.users'::regclass), pg_indexes_size('public.users'::regclass), pg_total_relation_size('public.users'::regclass)
    UNION ALL
    SELECT 'staff_directory', (SELECT count(*) FROM public.staff_directory), pg_table_size('public.staff_directory'::regclass), pg_indexes_size('public.staff_directory'::regclass), pg_total_relation_size('public.staff_directory'::regclass)
    UNION ALL
    SELECT 'logbook_locks', (SELECT count(*) FROM public.logbook_locks), pg_table_size('public.logbook_locks'::regclass), pg_indexes_size('public.logbook_locks'::regclass), pg_total_relation_size('public.logbook_locks'::regclass)
    UNION ALL
    SELECT 'machine_locks', (SELECT count(*) FROM public.machine_locks), pg_table_size('public.machine_locks'::regclass), pg_indexes_size('public.machine_locks'::regclass), pg_total_relation_size('public.machine_locks'::regclass)
    UNION ALL
    SELECT 'action_categories', (SELECT count(*) FROM public.action_categories), pg_table_size('public.action_categories'::regclass), pg_indexes_size('public.action_categories'::regclass), pg_total_relation_size('public.action_categories'::regclass)
    UNION ALL
    SELECT 'form_templates', (SELECT count(*) FROM public.form_templates), pg_table_size('public.form_templates'::regclass), pg_indexes_size('public.form_templates'::regclass), pg_total_relation_size('public.form_templates'::regclass)
  ) t;

  RETURN jsonb_build_object(
    'databaseBytes', v_db_bytes,
    'tables', v_tables,
    'measuredAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_storage_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_storage_quota() TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO authenticated, service_role;

-- ============================================================================
-- 5. SUPABASE REALTIME PUBLICATION
-- ============================================================================

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users',
    'staff_directory',
    'patients',
    'doctors',
    'machines',
    'action_categories',
    'schedules',
    'doctor_schedules',
    'pj_shift_assignments',
    'logbook',
    'logbook_locks',
    'machine_locks',
    'reports',
    'form_templates'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END;
$$;

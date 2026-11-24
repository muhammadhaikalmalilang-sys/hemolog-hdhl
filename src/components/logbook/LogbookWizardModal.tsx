import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  Hand,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Square,
  Sun,
  Sunset,
  Syringe,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatDbError,
  getUserFriendlyDbError,
  isDuplicateKeyError,
  isPermissionDeniedError,
  isTransientDbError,
  OperationType,
  SUPABASE_PROJECT_ID,
} from '../../lib/supabase';
import {
  deleteRowByColumn,
  generateRecordId,
  getRowByColumn,
  insertRow,
  mapLogbookLockRow,
  mapLogbookRow,
  mapMachineLockRow,
  toLogbookLockRow,
  toLogbookRow,
  toMachineLockRow,
  updateRowByColumn,
  upsertRow,
} from '../../lib/db';
import {
  clampString,
  extractShiftFromSchedule,
  formatFullDayDateId,
  getDayNameId,
  getLogbookSubmissionAccess,
  getLogbookVerificationAccess,
  getTodayDateStr,
  isPatientScheduledOnDay,
  isRegularPatient,
} from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import { useLiveClock } from '../../hooks/useLiveClock';
import {
  DEFAULT_TTV_CONFIG,
  mergeWithDefaultTemplate,
  sanitizeCustomResponses,
} from '../../lib/logbookTemplate';
import type {
  ActionCategory,
  CustomLogbookField,
  Doctor,
  IntraObservationRow,
  IntraTtvObservationItem,
  LogbookEntry,
  LogbookFormTemplate,
  LogbookLock,
  LogbookPointTemplate,
  LogbookWizardDetails,
  Machine,
  MachineLock,
  Patient,
  PjShiftAssignmentEntry,
  ShiftType,
  StaffDirectoryEntry,
  TtvSubFieldsConfig,
  TtvValue,
  VascularAccessType,
  WizardCustomPointResponse,
} from '../../types';

import { VerificationBadge } from '../ui/StatusBadge';

interface LogbookWizardModalProps {
  editingEntry: LogbookEntry | null;
  readOnly?: boolean;
  verifierEditMode?: boolean;
  initialPatientId?: string;
  initialMachineId?: string;
  initialDate?: string;
  initialShift?: ShiftType;
  initialDoctorId?: string;
  initialDutyDoctorId?: string;
  initialDutyDoctorName?: string;
  logbooks: LogbookEntry[];
  logbookLocks: LogbookLock[];
  machineLocks?: MachineLock[];
  patients: Patient[];
  doctors: Doctor[];
  machines: Machine[];
  actionCategories: ActionCategory[];
  staffDirectory: StaffDirectoryEntry[];
  pjShiftAssignments?: PjShiftAssignmentEntry[];
  formTemplate?: LogbookFormTemplate;
  verifierReview?: {
    canEdit: boolean;
    note: string;
    onNoteChange: (val: string) => void;
    processing: boolean;
    editSuccessMsg?: string | null;
    onSwitchToEdit: () => void;
    onRequestRevision: () => void;
    onApprove: () => void;
  };
  onClose: () => void;
  onSaved?: () => void;
}

type SpoCheckStatus = 'DIKERJAKAN' | 'TIDAK DIKERJAKAN';

interface SpoPointMeta {
  id: string;
  step: number;
  category: string;
  statement: string;
  description: string;
  standard: string;
}

const STEPS = [
  { num: 1, short: 'Ruang & RO', title: 'Bagian 1: Kesiapan Ruangan dan Air RO' },
  { num: 2, short: 'PPI & Mesin', title: 'Bagian 2: PPI, Mesin dan BHP' },
  { num: 3, short: 'Pre HD', title: 'Bagian 3: PRE HD (Pengkajian Sebelum Tindakan)' },
  { num: 4, short: 'Intra HD', title: 'Bagian 4: Intra HD (Monitoring Selama Tindakan)' },
  { num: 5, short: 'Edukasi', title: 'Bagian 5: Edukasi Pasien & Keluarga' },
  { num: 6, short: 'Post HD', title: 'Bagian 6: Post HD (Pengakhiran & Evaluasi)' },
  { num: 7, short: 'Transfusi & EPO', title: 'Bagian 7: Transfusi Darah & Pemberian EPO' },
  { num: 8, short: 'Verifikasi', title: 'Bagian 8: Pengajuan Verifikasi' },
];

const SPO_POINTS: SpoPointMeta[] = [
  // Bagian 1
  {
    id: '1.1',
    step: 1,
    category: 'Water Treatment & Mutu Air RO',
    statement:
      'Memastikan kesiapan sistem Water Treatment (Reverse Osmosis / RO), uji konduktivitas, tekanan sirkulasi, serta kualitas air dialisis sesuai baku mutu AAMI/PERNEFRI.',
    description:
      'Periksa konduktivitas air RO (< 10 µS/cm), tekanan pompa distribusi, level garam softner, dan bebas klorin/kloramin sebelum shift dimulai.',
    standard: 'TDS / Konduktivitas RO < 10 µS/cm · Total Chlorine < 0.1 mg/L · Tekanan Loop RO Stabil',
  },
  {
    id: '1.2',
    step: 1,
    category: 'Kesiapan Ruangan & Zonasi Infeksi',
    statement:
      'Memastikan kesiapan ruangan hemodialisis, suhu dan kelembaban lingkungan, sanitasi permukaan tempat tidur, serta kepatuhan pemisahan area infeksius (Hepatitis B/C).',
    description:
      'Pastikan suhu ruangan 20–24°C, kelembaban 40–60%, pencahayaan cukup, kebersihan bed, serta pemisahan tegas zona Reguler dan Isolasi Hep B / Hep C.',
    standard: 'Suhu 20–24°C · Zonasi Reguler & Isolasi Terpisah · Linen & Bed Siap Pakai',
  },
  {
    id: '1.3',
    step: 1,
    category: 'Emergency Room & Troli Emergensi',
    statement:
      'Memastikan kesiapan fasilitas kegawatdaruratan (Emergency Trolley, obat-obatan emergensi, defibrilator, oksigen sentral, dan suction) sebelum pelayanan dimulai.',
    description:
      'Periksa segel troli emergensi, kelengkapan obat life-saving (Epinefrin, Sulfas Atropin, Dextrose 40%, NaCl 0,9%), defibrilator, ambubag, dan oksigen sentral.',
    standard: 'Troli Emergensi Terkunci/Lengkap · Oksigen & Suction Siap · Defibrilator Ready',
  },
  // Bagian 2
  {
    id: '2.1',
    step: 2,
    category: 'PPI & Keselamatan Petugas',
    statement:
      'Melaksanakan kepatuhan kebersihan tangan (5 Moments for Hand Hygiene) dan pemakaian Alat Pelindung Diri (APD) standar dialisis sebelum kontak pasien/mesin.',
    description:
      'Lakukan hand hygiene 6 langkah pada 5 momen WHO dan gunakan APD lengkap (masker medis, apron/gown kedap air, goggle/faceshield, sarung tangan bersih/steril).',
    standard: '',
  },
  {
    id: '2.2',
    step: 2,
    category: 'Kalibrasi & Uji Fungsi Mesin',
    statement:
      'Menjalankan pengujian fungsi otomatis (Automated Self-Test / T1 Test) pada mesin hemodialisis hingga seluruh modul hidrolik dan elektrikal dinyatakan layak pakai.',
    description:
      'Nyalakan mesin HD dan pastikan seluruh tahapan automated self-test (T1 test: hidrolik, pompa darah, UF module, bypass) lulus tanpa kode error.',
    standard: 'T1 / Self-Test Passed · Bebas Kode Alarm Teknis',
  },
  {
    id: '2.3',
    step: 2,
    category: 'Keamanan Sirkuit Ekstrakorporeal',
    statement:
      'Memverifikasi kepekaan sensor keamanan utama mesin meliputi Blood Leak Detector (BLD), Air Bubble Detector, dan klem pengaman vena otomatis.',
    description:
      'Pastikan sensor kebocoran darah (BLD) dan detektor gelembung udara (ultrasonic air detector + venous clamp) aktif dan merespons dengan akurat.',
    standard: 'Sensor BLD Aktif · Air Detector & Venous Clamp Aktif',
  },
  {
    id: '2.4',
    step: 2,
    category: 'Komposisi & Suhu Dialisat',
    statement:
      'Memeriksa ketepatan komposisi cairan konsentrat (Acid & Bicarbonate), kestabilan konduktivitas (13.5–14.5 mS/cm), serta suhu cairan dialisat (36.0–37.0°C).',
    description:
      'Pastikan konsentrat Acid & Bikarbonat terpasang benar, konduktivitas dialisat stabil di 13.5–14.5 mS/cm, dan suhu dialisat 36.0–37.0°C.',
    standard: 'Konduktivitas 13.5–14.5 mS/cm · Suhu Dialisat 36.0–37.0°C',
  },
  {
    id: '2.5',
    step: 2,
    category: 'Pemasangan Sirkuit & Priming',
    statement:
      'Memasang dialyzer dan blood tubing set secara aseptik serta melakukan priming menggunakan NaCl 0,9% hingga seluruh udara dan partikel residu terbilas bersih.',
    description:
      'Pasang dialyzer dan bloodline secara aseptik, lakukan pembilasan (priming) dengan NaCl 0,9% minimal 500–1000 mL hingga sirkuit bebas udara dan residu.',
    standard: 'Teknik Aseptik · Sirkuit Bebas Gelembung Udara',
  },
  {
    id: '2.6',
    step: 2,
    category: 'Antikoagulasi & Kit Kanulasi',
    statement:
      'Menyiapkan spuit antikoagulan (Heparin/LMWH atau program Free Heparin) pada syringe pump serta kelengkapan set steril kanulasi AVF atau perawatan kateter CDL.',
    description:
      'Siapkan spuit heparin sesuai dosis resep (Standar/Minimal/Free Heparin) pada syringe pump serta siapkan set dressing/kanulasi AV Fistula atau perawatan CDL steril.',
    standard: 'Dosis Heparin Terverifikasi · Set Kanulasi / Dressing Steril',
  },
  // Bagian 3
  {
    id: '3.1',
    step: 3,
    category: 'Sasaran Keselamatan Pasien (SKP 1)',
    statement:
      'Melakukan identifikasi aktif pasien menggunakan minimal 2 penanda resmi (Nama Lengkap, Tanggal Lahir, Nomor RM) serta memvalidasi status rawat dan ruang zonasi infeksi.',
    description:
      'Cocokkan minimal 2 identitas (Nama Lengkap & Tanggal Lahir / No. RM) secara verbal dan gelang/kartu RM, serta pastikan status/Rawat Jalan/Inap & kategori zonasi.',
    standard: '2 Identitas Cocok (SKP 1) · Status Rawat & Zona Tepat',
  },
  {
    id: '3.2',
    step: 3,
    category: 'Evaluasi Cairan & Berat Badan',
    statement:
      'Menimbang Berat Badan Pre-HD, membandingkannya dengan Berat Badan Kering (Dry Weight), menghitung Interdialytic Weight Gain (IDWG), dan mengkaji status hidrasi/edema.',
    description:
      'Timbang BB Pre-HD secara akurat, bandingkan terhadap BB Kering (Dry Weight), hitung kenaikan berat badan interdialitik (IDWG), dan evaluasi tanda overload cairan.',
    standard: 'BB Pre-HD & BB Kering Tercatat · IDWG Terhitung Akurat',
  },
  {
    id: '3.3',
    step: 3,
    category: 'Pengkajian Hemodinamik Awal',
    statement:
      'Melakukan pengukuran lengkap tanda-tanda vital (Tekanan Darah, Nadi, Pernapasan, Suhu, dan SpO₂) serta keluhan subjektif pasien sebelum inisiasi hemodialisis.',
    description:
      'Ukur Tekanan Darah (duduk/berbaring), frekuensi nadi, laju pernapasan, suhu tubuh, dan saturasi oksigen (SpO2) sebelum memulai kanulasi/sirkulasi darah.',
    standard: 'TD, Nadi, RR, Suhu & SpO2 Tercatat · Hemodinamik Layak HD',
  },
  {
    id: '3.4',
    step: 3,
    category: 'Skrining Risiko Jatuh & Persetujuan Tindakan',
    statement:
      'Melaksanakan pengkajian risiko jatuh (SKP 6: penguncian roda bed, pemasangan pengaman sisi tempat tidur) dan memverifikasi kelengkapan Informed Consent tindakan HD.',
    description:
      'Lakukan asesmen risiko jatuh (pasang penanda kuning & kunci roda bed bila berisiko) serta pastikan dokumen Informed Consent tindakan HD masih berlaku dan lengkap.',
    standard: 'Risiko Jatuh Terkaji & Roda Bed Terkunci · Informed Consent Lengkap',
  },
  {
    id: '3.5',
    step: 3,
    category: 'Verifikasi Preskripsi Dialisis',
    statement:
      'Memverifikasi dan memprogram parameter resep hemodialisis dari DPJP ke mesin meliputi durasi tindakan (Time), Target UFG, QB, QD, serta dosis antikoagulan.',
    description:
      'Konfirmasi preskripsi DPJP meliputi durasi jam HD, Target Ultrafiltrasi (UFG), kecepatan aliran darah (QB), aliran dialisat (QD), dan regimen heparinisasi.',
    standard: 'Time, Target UFG, QB, QD & Heparin Sesuai Advis DPJP',
  },
  {
    id: '3.6',
    step: 3,
    category: 'Manajemen Akses Vaskular & Inisiasi',
    statement:
      'Mengkaji patensi akses vaskular (bruit/thrill AVF atau kepatenan dan exit-site CDL/Femoral) serta melakukan kanulasi atau penyambungan sirkuit dengan teknik aseptik.',
    description:
      'Inspeksi/palpasi/auskultasi bruit & thrill pada AVF Cimino atau evaluasi exit-site CDL/Femoral, lakukan antisepsis CHG 2%/alkohol, kanulasi/koneksi sesuai aseptik & fiksasi aman.',
    standard: 'Bruit/Thrill AVF Baik atau Lumen CDL Lancar · Teknik Aseptik & Fiksasi Aman',
  },
  // Bagian 4
  {
    id: '4.1',
    step: 4,
    category: 'Observasi Berkala Hemodinamik',
    statement:
      'Melakukan pemantauan berkala dan pencatatan pada lembar observasi Intra-HD setiap jam meliputi Tekanan Darah, Nadi, kesadaran, QB, UF Rate, dan volume UF tercapai.',
    description:
      'Pantau dan dokumentasikan TD, Nadi, RR, kesadaran, QB, QD, UF Rate, dan kumulatif UF setiap 60 menit (atau tiap 15 - 30 menit pada pasien kritis/tidak stabil).',
    standard: 'Flowsheet TTV Per Jam Lengkap · Respon Cepat Perubahan Hemodinamik',
  },
  {
    id: '4.2',
    step: 4,
    category: 'Keamanan Sirkuit & Tekanan Ekstrakorporeal',
    statement:
      'Memantau indikator tekanan ekstrakorporeal (Arterial Pressure, Venous Pressure, TMP), keamanan fiksasi jarum/kateter dari risiko venous needle dislodgement, dan tanda clotting.',
    description:
      'Awasi tren Arterial Pressure, Venous Pressure, dan Transmembrane Pressure (TMP), pastikan posisi jarum/kateter tidak tertekuk/dislodgement, dan cegah pembekuan sirkuit.',
    standard: 'AP, VP & TMP Dalam Batas Aman · Akses Terlihat (Uncovered) & Bebas Clotting',
  },
  {
    id: '4.3',
    step: 4,
    category: 'Deteksi & Tata Laksana Komplikasi Akut',
    statement:
      'Mendeteksi secara dini dan melaksanakan intervensi keperawatan cepat terhadap komplikasi akut Intra-HD (hipotensi, kram otot, mual/muntah, menggigil, clotting, perdarahan akses).',
    description:
      'Identifikasi segera gejala hipotensi intradialitik, hipertensi, kram otot, mual/muntah, nyeri dada, atau reaksi pirogenik, serta lakukan intervensi keperawatan darurat sesuai SPO.',
    standard: 'Deteksi Dini Komplikasi · Tindakan Korektif Cepat & Terukur',
  },
  {
    id: '4.4',
    step: 4,
    category: 'Komunikasi Efektif SBAR / TBAK Medis',
    statement:
      'Melaksanakan kolaborasi medis serta pelaporan perubahan kondisi klinis pasien kepada Dokter Jaga Ruangan atau DPJP menggunakan komunikasi efektif SBAR dan verifikasi TBAK.',
    description:
      'Laporkan perubahan klinis bermakna kepada Dokter Jaga / DPJP dengan metode SBAR dan dokumentasikan instruksi terapi/modifikasi resep menggunakan prinsip TBAK.',
    standard: 'Komunikasi SBAR Efektif · Advis DPJP / Dokter Jaga Terdokumentasi',
  },
  // Bagian 5
  {
    id: '5.1',
    step: 5,
    category: 'Manajemen Cairan & Pembatasan IDWG',
    statement:
      'Memberikan edukasi terstruktur kepada pasien dan keluarga mengenai perhitungan batas asupan cairan harian dan pengendalian kenaikan berat badan interdialitik (IDWG).',
    description:
      'Edukasi takaran minum harian (volume urin 24 jam + 500 mL IWL), tips mengatasi haus, serta target kenaikan BB antar-dialisis tidak melebihi 3 - 4% dari BB kering.',
    standard: 'Target IDWG < 3–4% BB Kering · Takaran Cairan Harian Dipahami',
  },
  {
    id: '5.2',
    step: 5,
    category: 'Nutrisi & Diet Ginjal Kronik',
    statement:
      'Memberikan penyuluhan gizi dialisis terkait pembatasan kalium, natrium, dan fosfat serta pemenuhan protein bernilai biologis tinggi guna mencegah hiperkalemia dan malnutrisi.',
    description:
      'Jelaskan pemilihan makanan rendah kalium (hindari pisang/air kelapa berlebih), rendah garam/natrium, batasi fosfat, serta kecukupan protein (putih telur, ikan) agar tidak malnutrisi.',
    standard: 'Diet Rendah Kalium, Natrium & Fosfat · Asupan Protein Adekuat',
  },
  {
    id: '5.3',
    step: 5,
    category: 'Perawatan Mandiri Akses Vaskular',
    statement:
      'Mengedukasi pasien dan keluarga tentang cara menjaga kebersihan dan patensi akses vaskular (AVF/CDL) di rumah serta penanganan darurat bila terjadi perdarahan atau tanda infeksi.',
    description:
      'Ajarkan menjaga balutan CDL tetap kering/bersih, larangan tensi/angkat beban pada lengan AV Shunt, raba getaran thrill tiap hari, dan tanda bahaya perdarahan/infeksi.',
    standard: 'Cek Thrill Mandiri / Balutan CDL Kering · Kenali Tanda Perdarahan & Infeksi',
  },
  {
    id: '5.4',
    step: 5,
    category: 'Kepatuhan Obat & Jadwal HD',
    statement:
      'Mengedukasi ketepatan waktu konsumsi obat-obatan rutin pasien dialisis (antihipertensi, pengikat fosfat, suplementasi zat besi/EPO) dan pentingnya kepatuhan jadwal HD.',
    description:
      'Ingatkan aturan minum obat antihipertensi (sebelum/sesudah HD sesuai instruksi dokter), cara konsumsi CaCO3 bersama makan, terapi eritropoietin, dan disiplin jadwal HD.',
    standard: 'Kepatuhan Regimen Obat · Disiplin Kehadiran Jadwal HD',
  },
  {
    id: '5.5',
    step: 5,
    category: 'Verifikasi Pemahaman (Teach-Back)',
    statement:
      'Memvalidasi tingkat pemahaman pasien dan keluarga terhadap materi edukasi melalui metode Teach-Back serta mendokumentasikannya pada rekam edukasi terintegrasi.',
    description:
      'Minta pasien/pendamping mengulangi poin kunci edukasi dengan bahasa sendiri (Teach-Back) dan lengkapi pencatatan pada formulir edukasi terintegrasi.',
    standard: 'Evaluasi Teach-Back Tervalidasi · Formulir KIE Terdokumentasi',
  },
  // Bagian 6
  {
    id: '6.1',
    step: 6,
    category: 'Prosedur Terminasi & Re-infusi',
    statement: 'Terminasi HD Aman (Washback)',
    description:
      'Kembalikan darah dari sirkuit ekstrakorporeal ke tubuh pasien dengan bilasan NaCl 0,9% kecepatan rendah secara tertutup (closed system) tanpa risiko emboli udara.',
    standard: 'Closed-System Re-infusion · Bebas Emboli Udara & Sisa Clotting',
  },
  {
    id: '6.2',
    step: 6,
    category: 'Hemostasis & Penutupan Akses Vaskular',
    statement: 'Hemostasis & Balut Tekan Akses',
    description:
      'Cabut jarum AVF dengan sudut tepat dan tekan titik punksi 10 - 15 menit hingga hemostasis sempurna (bruit tetap teraba), atau lakukan flushing NaCl & heparin/citrate lock steril pada CDL.',
    standard: 'Hemostasis Sempurna Tanpa Perdarahan · Heparin Lock & Dressing CDL Steril',
  },
  {
    id: '6.3',
    step: 6,
    category: 'Evaluasi Klinis Pasca-Dialisis',
    statement: 'Evaluasi TTV & Berat Badan Post-HD',
    description:
      'Ukur TD & Nadi Post-HD (pastikan bebas hipotensi ortostatik sebelum pasien berdiri/pulang), timbang BB Post-HD, catat total capaian UF aktual, dan nilai adekuasi Kt/V.',
    standard: 'TTV & BB Post-HD Tercatat · Capaian UF & Kt/V Terevaluasi',
  },
  {
    id: '6.4',
    step: 6,
    category: 'Dekontaminasi Limbah & Disinfeksi Mesin',
    statement: 'Disinfeksi Mesin HD (Heat / Chemical)',
    description:
      'Buang jarum ke safety box dan bloodline/dialyzer ke limbah infeksius kuning, dekontaminasi permukaan luar mesin/bed, dan jalankan siklus Heat/Citric/Chemical Disinfection.',
    standard: 'Safety Box & Limbah B3 Sesuai PPI · Siklus Heat / Chemical Clean Aktif',
  },
  {
    id: '6.5',
    step: 6,
    category: 'Dokumentasi Rekam Medis & Timbang Terima',
    statement: 'Dokumentasi Asuhan & Rekam Medis (CPPT)',
    description:
      'Lengkapi seluruh dokumentasi asuhan keperawatan HD pada CPPT/rekam medis dan sistem logbook digital, lalu laksanakan timbang terima pasien/alat kepada PJ Shift.',
    standard: 'Dokumentasi CPPT & Logbook 100% Lengkap · Serah Terima Shift Terverifikasi',
  },
];

const SPO_POINT_MAP = new Map<string, SpoPointMeta>(SPO_POINTS.map((p) => [p.id, p]));

const INTRA_COMPLICATION_TYPES = [
  'Hipertensi',
  'Hipotensi',
  'Hipoglikemi',
  'Hipertermi',
  'Kram Otot',
  'Mual',
  'Muntah',
  'Clotting',
  'Akses Bleeding',
  'First-Use Syndrome',
  'Penurunan Kesadaran',
  'Komplikasi Lainnya',
];

type ComplicationInputMeta = {
  field: 'bp' | 'clinicalDetail';
  label: string;
  unit?: string;
  placeholder: string;
  required: boolean;
  summaryPrefix?: string;
  summaryUnit?: string;
  advicePlaceholder: string;
};

const COMPLICATION_INPUT_CONFIG: Record<string, ComplicationInputMeta> = {
  Hipertensi: {
    field: 'bp',
    label: 'TEKANAN DARAH',
    unit: '(mmHg)',
    placeholder: '',
    required: true,
    summaryPrefix: 'TD',
    summaryUnit: 'mmHg',
    advicePlaceholder: '',
  },
  Hipotensi: {
    field: 'bp',
    label: 'TEKANAN DARAH',
    unit: '(mmHg)',
    placeholder: '',
    required: true,
    summaryPrefix: 'TD',
    summaryUnit: 'mmHg',
    advicePlaceholder: '',
  },
  Hipoglikemi: {
    field: 'clinicalDetail',
    label: 'KADAR GULA DARAH / GDS',
    unit: '(mg/dL)',
    placeholder: '',
    required: true,
    summaryPrefix: 'GDS',
    summaryUnit: 'mg/dL',
    advicePlaceholder: '',
  },
  Hipertermi: {
    field: 'clinicalDetail',
    label: 'SUHU TUBUH',
    unit: '(°C)',
    placeholder: '',
    required: true,
    summaryPrefix: 'Suhu',
    summaryUnit: '°C',
    advicePlaceholder: '',
  },
  'Kram Otot': {
    field: 'clinicalDetail',
    label: 'LOKASI KRAM & TINDAKAN',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  },
  Mual: {
    field: 'clinicalDetail',
    label: 'KELUHAN & TTV TERKAIT',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  },
  Muntah: {
    field: 'clinicalDetail',
    label: 'FREKUENSI & VOLUME MUNTAH',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  },
  Clotting: {
    field: 'clinicalDetail',
    label: 'LOKASI CLOTTING & TINDAKAN',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  },
  'Akses Bleeding': {
    field: 'clinicalDetail',
    label: 'LOKASI PERDARAHAN & TINDAKAN',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  },
  'First-Use Syndrome': {
    field: 'clinicalDetail',
    label: 'GEJALA REAKSI & TTV (TD / SpO₂)',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  },
  'Penurunan Kesadaran': {
    field: 'clinicalDetail',
    label: 'SKOR GCS / KESADARAN & TTV',
    placeholder: '',
    required: true,
    advicePlaceholder: '',
  },
  'Komplikasi Lainnya': {
    field: 'clinicalDetail',
    label: 'DETAIL KOMPLIKASI & PARAMETER KLINIS',
    placeholder: '',
    required: true,
    advicePlaceholder: '',
  },
};

function getComplicationInputMeta(type: string): ComplicationInputMeta {
  if (COMPLICATION_INPUT_CONFIG[type]) {
    return COMPLICATION_INPUT_CONFIG[type];
  }
  if (/hipotensi|hipertensi/i.test(type)) {
    return COMPLICATION_INPUT_CONFIG.Hipertensi;
  }
  if (/hipertermi|demam|menggigil/i.test(type)) {
    return COMPLICATION_INPUT_CONFIG.Hipertermi;
  }
  if (/hipoglikem/i.test(type)) {
    return COMPLICATION_INPUT_CONFIG.Hipoglikemi;
  }
  return {
    field: 'clinicalDetail',
    label: 'DETAIL KLINIS KOMPLIKASI',
    placeholder: '',
    required: false,
    advicePlaceholder: '',
  };
}

type ComplicationIncidentItem = {
  id: string;
  type: string;
  time: string;
  bp: string;
  clinicalDetail?: string;
  doctorAdvice: string;
};

function getCurrentTimeHHmm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const DEFAULT_OBSERVATIONS: IntraObservationRow[] = [
  { hourLabel: 'Jam ke-1', bp: '', pulse: '', bfr: '', ufr: '', arterialPressure: '', venousPressure: '', tmp: '' },
  { hourLabel: 'Jam ke-2', bp: '', pulse: '', bfr: '', ufr: '', arterialPressure: '', venousPressure: '', tmp: '' },
  { hourLabel: 'Jam ke-3', bp: '', pulse: '', bfr: '', ufr: '', arterialPressure: '', venousPressure: '', tmp: '' },
  { hourLabel: 'Jam ke-4', bp: '', pulse: '', bfr: '', ufr: '', arterialPressure: '', venousPressure: '', tmp: '' },
];

function buildInitialSpoChecklist(
  saved?: Record<string, SpoCheckStatus>,
  points: Pick<LogbookPointTemplate, 'id'>[] = SPO_POINTS
): Record<string, SpoCheckStatus> {
  const result: Record<string, SpoCheckStatus> = {};
  for (const pt of points) {
    result[pt.id] = saved?.[pt.id] === 'DIKERJAKAN' ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN';
  }
  if (saved) {
    for (const [k, v] of Object.entries(saved)) {
      if (!(k in result)) {
        result[k] = v === 'DIKERJAKAN' ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN';
      }
    }
  }
  return result;
}

export function LogbookWizardModal({
  editingEntry,
  readOnly = false,
  verifierEditMode = false,
  initialPatientId,
  initialMachineId,
  initialDate,
  initialShift,
  initialDoctorId,
  initialDutyDoctorId,
  initialDutyDoctorName,
  logbooks,
  logbookLocks,
  machineLocks = [],
  patients,
  doctors,
  machines,
  actionCategories,
  staffDirectory,
  pjShiftAssignments = [],
  formTemplate,
  verifierReview,
  onClose,
  onSaved,
}: LogbookWizardModalProps) {
  const { userProfile } = useAuth();
  const { nowMs, wibTimeLabel } = useLiveClock();
  const isVerifierEdit = Boolean(
    verifierEditMode &&
      editingEntry &&
      !readOnly &&
      userProfile?.role !== 'Administrator'
  );
  const isSubmitterKaru =
    !readOnly && !isVerifierEdit && userProfile?.role === 'Kepala Ruang';
  const resolvedTemplate = useMemo(
    () => mergeWithDefaultTemplate(formTemplate),
    [formTemplate]
  );
  const activeSections = resolvedTemplate.sections;
  const activeSpoPoints = useMemo(
    () =>
      resolvedTemplate.points
        .filter((p) => p.step >= 1 && p.step <= 6 && p.visible !== false)
        .sort((a, b) => (a.step !== b.step ? a.step - b.step : a.order - b.order)),
    [resolvedTemplate.points]
  );
  const extraStep7Points = useMemo(
    () =>
      resolvedTemplate.points
        .filter((p) => p.step === 7 && p.visible !== false && p.id !== '7.1' && p.id !== '7.2')
        .sort((a, b) => a.order - b.order),
    [resolvedTemplate.points]
  );
  const pointTemplateMap = useMemo(
    () => new Map<string, LogbookPointTemplate>(resolvedTemplate.points.map((p) => [p.id, p])),
    [resolvedTemplate.points]
  );
  const section7CustomFields = resolvedTemplate.sectionCustomFields?.['7'] || [];
  const activePatients = useMemo(() => patients.filter((p) => p.status === 'Aktif'), [patients]);
  const activeRegularPatients = useMemo(
    () => activePatients.filter((p) => isRegularPatient(p)),
    [activePatients]
  );
  const activeDoctors = useMemo(() => doctors.filter((d) => d.status === 'Aktif'), [doctors]);
  const activeCategories = useMemo(
    () => actionCategories.filter((c) => c.isActive),
    [actionCategories]
  );

  const initialDetails = editingEntry?.wizardDetails;
  const startDateValue = editingEntry?.date || initialDate || getTodayDateStr();
  const startDayName = getDayNameId(startDateValue);

  const initialLockedIds = new Set<string>();
  if (!editingEntry) {
    for (const lk of logbookLocks) {
      if (lk.date === startDateValue) initialLockedIds.add(lk.patientId);
    }
    for (const lb of logbooks) {
      if (lb.date === startDateValue) initialLockedIds.add(lb.patientId);
    }
  }

  const initialScheduledList = activeRegularPatients.filter((p) =>
    isPatientScheduledOnDay(p.routineSchedule, startDayName)
  );
  const initialUnlockedScheduled = initialScheduledList.filter((p) => !initialLockedIds.has(p.id));
  const initialUnlockedAll = activePatients.filter((p) => !initialLockedIds.has(p.id));
  const initialRequestedPatient = initialPatientId
    ? patients.find((p) => p.id === initialPatientId && !initialLockedIds.has(p.id))
    : undefined;
  const resolvedInitialPatient = editingEntry?.patientId
    ? patients.find((p) => p.id === editingEntry.patientId)
    : initialRequestedPatient || initialUnlockedScheduled[0] || initialUnlockedAll[0];

  const initialIsScheduled = resolvedInitialPatient
    ? isRegularPatient(resolvedInitialPatient) &&
      isPatientScheduledOnDay(resolvedInitialPatient.routineSchedule, startDayName)
    : initialUnlockedScheduled.length > 0;

  const [step, setStep] = useState(1);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [onlyScheduledForDay, setOnlyScheduledForDay] = useState<boolean>(
    editingEntry ? false : initialIsScheduled
  );

  useLayoutEffect(() => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [step]);

  type TrackedWizardEntry = Pick<
    LogbookEntry,
    | 'id'
    | 'date'
    | 'shift'
    | 'machineId'
    | 'patientId'
    | 'verificationStatus'
    | 'nurseId'
    | 'nurseName'
  >;
  const [autoSavedEntry, setAutoSavedEntry] = useState<TrackedWizardEntry | null>(null);
  const autoSavedEntryRef = useRef<TrackedWizardEntry | null>(null);
  const activeEntry = editingEntry || autoSavedEntry;
  const activeEntryId = activeEntry?.id;
  const [autoSaveInfo, setAutoSaveInfo] = useState<{
    status: 'idle' | 'saving' | 'saved';
    timeLabel?: string;
    docStatus?: 'Draft' | 'Revision';
  }>({ status: 'idle' });

  // SPO Checklist state ("TIDAK DIKERJAKAN" / "DIKERJAKAN") for every point
  const [spoChecklist, setSpoChecklist] = useState<Record<string, SpoCheckStatus>>(() =>
    buildInitialSpoChecklist(initialDetails?.spoChecklist, resolvedTemplate.points)
  );
  const [customResponses, setCustomResponses] = useState<
    Record<string, WizardCustomPointResponse>
  >(() => sanitizeCustomResponses(initialDetails?.customResponses));

  // Core metadata
  const [patientId, setPatientId] = useState(
    editingEntry?.patientId || resolvedInitialPatient?.id || ''
  );
  const [rmSearch, setRmSearch] = useState(
    editingEntry?.patientRm || resolvedInitialPatient?.mrn || ''
  );
  const [machineId, setMachineId] = useState(
    editingEntry?.machineId || initialMachineId || machines[0]?.id || ''
  );
  const [doctorId, setDoctorId] = useState(
    editingEntry?.doctorId ||
      initialDoctorId ||
      activeDoctors[0]?.id ||
      ''
  );
  const [dutyDoctorId, setDutyDoctorId] = useState(
    editingEntry?.dutyDoctorId ||
      (editingEntry?.dutyDoctorName ? '__manual__' : initialDutyDoctorId || activeDoctors[0]?.id || '')
  );
  const [manualDutyDoctorName, setManualDutyDoctorName] = useState(
    editingEntry?.dutyDoctorId === '__manual__' || (!editingEntry?.dutyDoctorId && editingEntry?.dutyDoctorName)
      ? editingEntry?.dutyDoctorName || ''
      : initialDutyDoctorId === '__manual__'
      ? initialDutyDoctorName || ''
      : ''
  );
  const [actionCategory, setActionCategory] = useState(
    editingEntry?.actionCategory || activeCategories[0]?.name || 'HD Reguler'
  );
  const [date, setDate] = useState(startDateValue);
  const [shift, setShift] = useState<ShiftType>(
    editingEntry?.shift ||
      initialShift ||
      extractShiftFromSchedule(resolvedInitialPatient?.routineSchedule) ||
      'Pagi'
  );
  const [startTime, setStartTime] = useState(editingEntry?.startTime || '07:30');
  const [endTime, setEndTime] = useState(editingEntry?.endTime || '12:00');

  // Section 1: Kesiapan Ruangan & Air RO
  const [roStatus, setRoStatus] = useState<'Baik' | 'Perlu Perhatian' | 'Gangguan'>(
    initialDetails?.section1.roStatus || 'Baik'
  );
  const [roAdequate, setRoAdequate] = useState(initialDetails?.section1.roAdequate ?? true);
  const [roTds, setRoTds] = useState(initialDetails?.section1.roTds || '4 ppm');
  const [roConductivity, setRoConductivity] = useState(
    initialDetails?.section1.roConductivity || '14.0 mS/cm'
  );
  const [roNotes, setRoNotes] = useState(
    initialDetails?.section1.roNotes || 'Kualitas air RO memenuhi standar AAMI'
  );
  const [infectionZoneStatus, setInfectionZoneStatus] = useState<'Sesuai' | 'Tidak'>(
    initialDetails?.section1.infectionZoneStatus || 'Sesuai'
  );
  const [infectionZoneChecked, setInfectionZoneChecked] = useState(
    initialDetails?.section1.infectionZoneChecked ?? true
  );
  const [emergencyStatus, setEmergencyStatus] = useState<'Lengkap' | 'Ada yang Kurang'>(
    initialDetails?.section1.emergencyStatus || 'Lengkap'
  );
  const [aedReady, setAedReady] = useState(initialDetails?.section1.aedReady ?? true);
  const [oxygenReady, setOxygenReady] = useState(initialDetails?.section1.oxygenReady ?? true);
  const [emergencyDrugsReady, setEmergencyDrugsReady] = useState(
    initialDetails?.section1.emergencyDrugsReady ?? true
  );
  const [emergencyNotes, setEmergencyNotes] = useState(
    initialDetails?.section1.emergencyNotes || 'Troli emergensi tersegel dan siap digunakan'
  );

  // Section 2: PPI, Mesin & BHP
  const [handHygieneChecked, setHandHygieneChecked] = useState(
    initialDetails?.spoChecklist?.['2.1'] === 'DIKERJAKAN'
  );
  const [apdUsedChecked, setApdUsedChecked] = useState(
    initialDetails?.spoChecklist?.['2.1'] === 'DIKERJAKAN'
  );
  const [apdMask, setApdMask] = useState(initialDetails?.section2.apdMask ?? true);
  const [apdGoggles, setApdGoggles] = useState(initialDetails?.section2.apdGoggles ?? true);
  const [apdGloves, setApdGloves] = useState(initialDetails?.section2.apdGloves ?? true);
  const [apdApron, setApdApron] = useState(initialDetails?.section2.apdApron ?? true);
  const [machineConductivity, setMachineConductivity] = useState(
    initialDetails?.section2.machineConductivity || '13.8 mS/cm'
  );
  const [machinePh, setMachinePh] = useState(initialDetails?.section2.machinePh || '7.3');
  const [leakTestPassed, setLeakTestPassed] = useState(
    initialDetails?.section2.leakTestPassed ?? true
  );
  const [bloodlineIntegrity, setBloodlineIntegrity] = useState(
    initialDetails?.section2.bloodlineIntegrity ?? true
  );
  const [dialysateTemp, setDialysateTemp] = useState(
    initialDetails?.section2.dialysateTemp || '36.5'
  );
  const [dialysateType, setDialysateType] = useState<'Bikarbonat' | 'Asetat'>(
    initialDetails?.section2.dialysateType || 'Bikarbonat'
  );
  const [primingDone, setPrimingDone] = useState(initialDetails?.section2.primingDone ?? true);
  const [primingVolume, setPrimingVolume] = useState(
    initialDetails?.section2.primingVolume || '1000'
  );
  const [anticoagulantType, setAnticoagulantType] = useState<'Heparin' | 'LMWH' | 'Bebas Heparin'>(
    initialDetails?.section2.anticoagulantType || 'Heparin'
  );
  const [loadingDose, setLoadingDose] = useState(
    editingEntry ? initialDetails?.section2.loadingDose || '' : ''
  );
  const [maintenanceDose, setMaintenanceDose] = useState(
    initialDetails?.section2.maintenanceDose || '1000 IU/jam'
  );
  const [fistulaNeedleSize, setFistulaNeedleSize] = useState<
    '15G' | '16G' | '17G' | 'CDL / Non-Fistula'
  >(initialDetails?.section2.fistulaNeedleSize || '16G');

  // Section 3: PRE HD
  const [serviceStatus, setServiceStatus] = useState<'Rawat Jalan' | 'Rawat Inap' | ''>(
    initialDetails?.section3.serviceStatus || ''
  );
  const [inpatientWard, setInpatientWard] = useState<'CAMELIA' | 'DAHLIA' | 'ICU' | ''>(
    initialDetails?.section3.inpatientWard || ''
  );
  const [citoStatus, setCitoStatus] = useState<'Tidak' | 'Ya' | ''>(
    initialDetails?.section3.citoStatus ||
      (initialDetails?.section3.serviceStatus === 'Rawat Inap' ? 'Tidak' : '')
  );
  const [patientCategory, setPatientCategory] = useState<
    'Reguler' | 'Isolasi Hepatitis B' | 'Isolasi Hepatitis C/HIV' | ''
  >(initialDetails?.section3.patientCategory || '');
  const [dryWeight, setDryWeight] = useState(
    editingEntry
      ? initialDetails?.section3.dryWeight !== undefined
        ? String(initialDetails.section3.dryWeight)
        : ''
      : ''
  );
  const [preWeight, setPreWeight] = useState(
    editingEntry ? String(editingEntry.preWeight ?? '') : ''
  );
  const initialBpParts = (editingEntry?.preBp || '').split('/');
  const [systolicBp, setSystolicBp] = useState(
    editingEntry && initialBpParts[0] ? initialBpParts[0].trim() : ''
  );
  const [diastolicBp, setDiastolicBp] = useState(
    editingEntry && initialBpParts[1] ? initialBpParts[1].trim() : ''
  );
  const [preBp, setPreBp] = useState(editingEntry?.preBp || '');
  const [prePulse, setPrePulse] = useState(initialDetails?.section3.prePulse || '84');
  const [preResp, setPreResp] = useState(initialDetails?.section3.preResp || '20');
  const [preTemp, setPreTemp] = useState(initialDetails?.section3.preTemp || '36.6');
  const [preSpo2, setPreSpo2] = useState(initialDetails?.section3.preSpo2 || '98');
  const [fallRiskScale, setFallRiskScale] = useState<'Morse' | 'Edmonson'>(
    initialDetails?.section3.fallRiskScale || 'Morse'
  );
  const [fallRiskLevel, setFallRiskLevel] = useState<
    'Risiko Rendah' | 'Risiko Sedang' | 'Risiko Tinggi'
  >(initialDetails?.section3.fallRiskLevel || 'Risiko Rendah');
  const [informedConsent, setInformedConsent] = useState(
    initialDetails?.section3.informedConsent ?? true
  );
  const [dialyzerType, setDialyzerType] = useState(
    initialDetails?.section3.dialyzerType || 'High-Flux FX80'
  );
  const [dialysisDurationHours, setDialysisDurationHours] = useState(
    editingEntry ? initialDetails?.section3.dialysisDurationHours || '' : ''
  );
  const [bfr, setBfr] = useState(editingEntry ? initialDetails?.section3.bfr || '' : '');
  const [dfr, setDfr] = useState(editingEntry ? initialDetails?.section3.dfr || '' : '');
  const [ufGoal, setUfGoal] = useState(
    editingEntry ? String(editingEntry.ufGoal ?? '') : ''
  );
  const [vascularAccess, setVascularAccess] = useState<VascularAccessType>(
    editingEntry?.vascularAccess || resolvedInitialPatient?.vascularAccess || 'AV Fistula'
  );
  const [selectedAccessOption, setSelectedAccessOption] = useState<
    'CIMINO' | 'CDL' | 'FEMORAL' | ''
  >(() => {
    if (!editingEntry) return '';
    if (editingEntry.vascularAccess === 'CDL' || editingEntry.vascularAccess === 'CVC') return 'CDL';
    if (editingEntry.vascularAccess === 'Femoral') return 'FEMORAL';
    return 'CIMINO';
  });
  const [vascularNurseId, setVascularNurseId] = useState(
    initialDetails?.section3.vascularNurseId ||
      ((readOnly || verifierEditMode) && editingEntry ? editingEntry.nurseId : userProfile?.uid) ||
      ''
  );
  const [ciminoNote, setCiminoNote] = useState(
    initialDetails?.section3.ciminoNote ||
      (editingEntry &&
      (editingEntry.vascularAccess === 'AV Fistula' || editingEntry.vascularAccess === 'AV Shunt')
        ? initialDetails?.section3.accessDetailNote || ''
        : '')
  );
  const [cdlNote, setCdlNote] = useState(
    initialDetails?.section3.cdlNote ||
      (editingEntry && (editingEntry.vascularAccess === 'CDL' || editingEntry.vascularAccess === 'CVC')
        ? initialDetails?.section3.accessDetailNote || ''
        : '')
  );
  const [femoralNote, setFemoralNote] = useState(
    initialDetails?.section3.femoralNote ||
      (editingEntry && editingEntry.vascularAccess === 'Femoral'
        ? initialDetails?.section3.accessDetailNote || ''
        : '')
  );
  const [cannulationDone, setCannulationDone] = useState(
    initialDetails?.section3.cannulationDone ?? true
  );

  // Section 4: Intra HD
  const [observations, setObservations] = useState<IntraObservationRow[]>(
    initialDetails?.section4.observations || DEFAULT_OBSERVATIONS
  );
  const [intraObservations, setIntraObservations] = useState<IntraTtvObservationItem[]>(() => {
    const saved = initialDetails?.section4.intraObservations;
    if (saved && saved.length > 0) {
      return saved.map((obs, idx) => ({
        id: obs.id || `obs_${idx + 1}`,
        time: obs.time || '',
        systolic: obs.systolic || '',
        diastolic: obs.diastolic || '',
        pulse: obs.pulse || '',
        resp: obs.resp || '',
        temp: obs.temp || '',
        spo2: obs.spo2 || '',
      }));
    }
    return [
      {
        id: 'obs_1',
        time: initialDetails?.section4.intraObsTime || '',
        systolic: initialDetails?.section4.intraSystolicBp || '',
        diastolic: initialDetails?.section4.intraDiastolicBp || '',
        pulse: '',
        resp: '',
        temp: '',
        spo2: '',
      },
    ];
  });
  const [intraObsTime, setIntraObsTime] = useState(
    initialDetails?.section4.intraObservations?.[0]?.time ||
      initialDetails?.section4.intraObsTime ||
      ''
  );
  const [intraSystolicBp, setIntraSystolicBp] = useState(
    initialDetails?.section4.intraObservations?.[0]?.systolic ||
      initialDetails?.section4.intraSystolicBp ||
      ''
  );
  const [intraDiastolicBp, setIntraDiastolicBp] = useState(
    initialDetails?.section4.intraObservations?.[0]?.diastolic ||
      initialDetails?.section4.intraDiastolicBp ||
      ''
  );
  const [arterialPressure, setArterialPressure] = useState(
    initialDetails?.section4.arterialPressure || '-120'
  );
  const [venousPressure, setVenousPressure] = useState(
    initialDetails?.section4.venousPressure || '130'
  );
  const [tmp, setTmp] = useState(initialDetails?.section4.tmp || '85');
  const [noComplication, setNoComplication] = useState<boolean>(
    initialDetails?.section4.noComplication ??
      (editingEntry
        ? !editingEntry.complications || editingEntry.complications.toLowerCase() === 'tidak ada'
        : false)
  );
  const [complicationIncidents, setComplicationIncidents] = useState<ComplicationIncidentItem[]>(
    (initialDetails?.section4.complicationIncidents || []).map((inc) => ({
      ...inc,
      clinicalDetail: inc.clinicalDetail || '',
    }))
  );
  const [complicationFlags, setComplicationFlags] = useState<string[]>(
    initialDetails?.section4.complicationFlags || ['Tidak ada']
  );
  const [complications, setComplications] = useState(editingEntry?.complications || 'Tidak ada');
  const [effectiveCommunicationNotes, setEffectiveCommunicationNotes] = useState(
    initialDetails?.section4.effectiveCommunicationNotes ||
      'Pasien kooperatif, dijelaskan tanda gejala hipotensi/kram agar segera melapor.'
  );

  // Section 5: Edukasi Pasien & Keluarga
  const [eduFluidManagement, setEduFluidManagement] = useState(
    initialDetails?.section5.eduFluidManagement ?? true
  );
  const [eduNutrition, setEduNutrition] = useState(initialDetails?.section5.eduNutrition ?? true);
  const [eduVascularCare, setEduVascularCare] = useState(
    initialDetails?.section5.eduVascularCare ?? true
  );
  const [eduMedicationSchedule, setEduMedicationSchedule] = useState(
    initialDetails?.section5.eduMedicationSchedule ?? true
  );
  const [teachBackStatus, setTeachBackStatus] = useState<'Baik' | 'Perlu Pengulangan'>(
    initialDetails?.section5.teachBackStatus || 'Baik'
  );
  const [educationNotes, setEducationNotes] = useState(
    initialDetails?.section5.educationNotes ||
      'Pasien dan keluarga mampu mengulang kembali cara pembatasan cairan harian dan perawatan AV Shunt.'
  );

  // Section 6: Post HD
  const [reinfusionDone, setReinfusionDone] = useState(
    initialDetails?.section6.reinfusionDone ?? true
  );
  const [hemostasisDone, setHemostasisDone] = useState(
    initialDetails?.section6.hemostasisDone ?? true
  );
  const [bleedingStopMinutes, setBleedingStopMinutes] = useState(
    initialDetails?.section6.bleedingStopMinutes || '10'
  );
  const [postWeight, setPostWeight] = useState(
    editingEntry ? String(editingEntry.postWeight ?? '') : ''
  );
  const [ufAchieved, setUfAchieved] = useState(
    editingEntry ? String(editingEntry.ufAchieved ?? '') : ''
  );
  const [postBp, setPostBp] = useState(editingEntry ? editingEntry.postBp || '' : '');
  const [ktv, setKtv] = useState(initialDetails?.section6.ktv || '');
  const [postPulse, setPostPulse] = useState(initialDetails?.section6.postPulse || '80');
  const [postResp, setPostResp] = useState(initialDetails?.section6.postResp || '18');
  const [postTemp, setPostTemp] = useState(initialDetails?.section6.postTemp || '36.5');
  const [postSpo2, setPostSpo2] = useState(initialDetails?.section6.postSpo2 || '99');
  const [wasteDecontaminated, setWasteDecontaminated] = useState(
    initialDetails?.section6.wasteDecontaminated ?? true
  );
  const [machineDisinfectionType, setMachineDisinfectionType] = useState<
    'Heat Disinfection' | 'Chemical Disinfection'
  >(initialDetails?.section6.machineDisinfectionType || 'Heat Disinfection');
  const [nursingNotes, setNursingNotes] = useState(editingEntry?.nursingNotes || '');
  const [handoverSummary, setHandoverSummary] = useState(
    initialDetails?.section6.handoverSummary || 'Kondisi stabil pasca dialisis, siap pulang / timbang terima.'
  );

  // Section 7: Transfusi & EPO
  const [transfusionGiven, setTransfusionGiven] = useState<boolean>(
    initialDetails?.section7?.transfusionGiven ?? false
  );
  const [transfusionComponent, setTransfusionComponent] = useState<string>(
    initialDetails?.section7?.transfusionComponent || 'PRC (Packed Red Cell)'
  );
  const [transfusionBloodGroup, setTransfusionBloodGroup] = useState<string>(
    initialDetails?.section7?.transfusionBloodGroup || ''
  );
  const [transfusionBagCount, setTransfusionBagCount] = useState<string>(
    initialDetails?.section7?.transfusionBagCount || '1'
  );
  const [transfusionVolumeMl, setTransfusionVolumeMl] = useState<string>(
    initialDetails?.section7?.transfusionVolumeMl || ''
  );
  const [transfusionBagNumber, setTransfusionBagNumber] = useState<string>(
    initialDetails?.section7?.transfusionBagNumber || ''
  );
  const [transfusionReaction, setTransfusionReaction] = useState<string>(
    initialDetails?.section7?.transfusionReaction || 'Tidak Ada Reaksi'
  );
  const [transfusionNote, setTransfusionNote] = useState<string>(
    initialDetails?.section7?.transfusionNote || ''
  );
  const [epoGiven, setEpoGiven] = useState<boolean>(
    initialDetails?.section7?.epoGiven ?? false
  );
  const [epoPreparation, setEpoPreparation] = useState<string>(
    initialDetails?.section7?.epoPreparation || 'Epoetin Alfa'
  );
  const [epoDose, setEpoDose] = useState<string>(
    initialDetails?.section7?.epoDose || ''
  );
  const [epoRoute, setEpoRoute] = useState<string>(
    initialDetails?.section7?.epoRoute || 'Subkutan (SC)'
  );
  const [epoNote, setEpoNote] = useState<string>(
    initialDetails?.section7?.epoNote || ''
  );

  // Section 8: Submission Target
  const [targetVerifierRole, setTargetVerifierRole] = useState<'PJ Shift' | 'Kepala Ruang'>(() => {
    if (!readOnly && !verifierEditMode && userProfile?.role === 'Kepala Ruang') {
      return 'PJ Shift';
    }
    return editingEntry?.targetVerifierRole || 'Kepala Ruang';
  });
  const [targetVerifierId, setTargetVerifierId] = useState(editingEntry?.targetVerifierId || '');
  const [submissionNote, setSubmissionNote] = useState(
    editingEntry ? initialDetails?.section6.handoverSummary || '' : ''
  );
  const [submissionConfirmed, setSubmissionConfirmed] = useState(
    Boolean(editingEntry && editingEntry.verificationStatus !== 'Draft')
  );

  const prevEntryMachineIdRef = useRef(editingEntry?.machineId || '');

  // Real-time sync when viewing in readOnly mode (Detail / Verification Review modal)
  useEffect(() => {
    if (!readOnly || !editingEntry) return;
    const d = editingEntry.wizardDetails;
    setSpoChecklist(buildInitialSpoChecklist(d?.spoChecklist, resolvedTemplate.points));
    setCustomResponses(sanitizeCustomResponses(d?.customResponses));
    setPatientId(editingEntry.patientId || '');
    setRmSearch(editingEntry.patientRm || '');
    setMachineId(editingEntry.machineId || '');
    setDoctorId(editingEntry.doctorId || '');
    setDutyDoctorId(
      editingEntry.dutyDoctorId || (editingEntry.dutyDoctorName ? '__manual__' : '')
    );
    setManualDutyDoctorName(
      editingEntry.dutyDoctorId === '__manual__' ||
        (!editingEntry.dutyDoctorId && editingEntry.dutyDoctorName)
        ? editingEntry.dutyDoctorName || ''
        : ''
    );
    setActionCategory(editingEntry.actionCategory || 'HD Reguler');
    setDate(editingEntry.date || getTodayDateStr());
    setShift(editingEntry.shift || 'Pagi');
    setStartTime(editingEntry.startTime || '07:30');
    setEndTime(editingEntry.endTime || '12:00');

    setRoStatus(d?.section1.roStatus || 'Baik');
    setRoAdequate(d?.section1.roAdequate ?? true);
    setRoTds(d?.section1.roTds || '4 ppm');
    setRoConductivity(d?.section1.roConductivity || '14.0 mS/cm');
    setRoNotes(d?.section1.roNotes || 'Kualitas air RO memenuhi standar AAMI');
    setInfectionZoneStatus(d?.section1.infectionZoneStatus || 'Sesuai');
    setInfectionZoneChecked(d?.section1.infectionZoneChecked ?? true);
    setEmergencyStatus(d?.section1.emergencyStatus || 'Lengkap');
    setAedReady(d?.section1.aedReady ?? true);
    setOxygenReady(d?.section1.oxygenReady ?? true);
    setEmergencyDrugsReady(d?.section1.emergencyDrugsReady ?? true);
    setEmergencyNotes(d?.section1.emergencyNotes || 'Troli emergensi tersegel dan siap digunakan');

    setHandHygieneChecked(d?.spoChecklist?.['2.1'] === 'DIKERJAKAN');
    setApdUsedChecked(d?.spoChecklist?.['2.1'] === 'DIKERJAKAN');
    setApdMask(d?.section2.apdMask ?? true);
    setApdGoggles(d?.section2.apdGoggles ?? true);
    setApdGloves(d?.section2.apdGloves ?? true);
    setApdApron(d?.section2.apdApron ?? true);
    setMachineConductivity(d?.section2.machineConductivity || '13.8 mS/cm');
    setMachinePh(d?.section2.machinePh || '7.3');
    setLeakTestPassed(d?.section2.leakTestPassed ?? true);
    setBloodlineIntegrity(d?.section2.bloodlineIntegrity ?? true);
    setDialysateTemp(d?.section2.dialysateTemp || '36.5');
    setDialysateType(d?.section2.dialysateType || 'Bikarbonat');
    setPrimingDone(d?.section2.primingDone ?? true);
    setPrimingVolume(d?.section2.primingVolume || '1000');
    setAnticoagulantType(d?.section2.anticoagulantType || 'Heparin');
    setLoadingDose(d?.section2.loadingDose || '');
    setMaintenanceDose(d?.section2.maintenanceDose || '1000 IU/jam');
    setFistulaNeedleSize(d?.section2.fistulaNeedleSize || '16G');

    setServiceStatus(d?.section3.serviceStatus || '');
    setInpatientWard(d?.section3.inpatientWard || '');
    setCitoStatus(
      d?.section3.citoStatus || (d?.section3.serviceStatus === 'Rawat Inap' ? 'Tidak' : '')
    );
    setPatientCategory(d?.section3.patientCategory || '');
    setDryWeight(d?.section3.dryWeight !== undefined ? String(d.section3.dryWeight) : '');
    setPreWeight(String(editingEntry.preWeight ?? ''));
    const bpParts = (editingEntry.preBp || '').split('/');
    setSystolicBp(bpParts[0] ? bpParts[0].trim() : '');
    setDiastolicBp(bpParts[1] ? bpParts[1].trim() : '');
    setPreBp(editingEntry.preBp || '');
    setPrePulse(d?.section3.prePulse || '84');
    setPreResp(d?.section3.preResp || '20');
    setPreTemp(d?.section3.preTemp || '36.6');
    setPreSpo2(d?.section3.preSpo2 || '98');
    setFallRiskScale(d?.section3.fallRiskScale || 'Morse');
    setFallRiskLevel(d?.section3.fallRiskLevel || 'Risiko Rendah');
    setInformedConsent(d?.section3.informedConsent ?? true);
    setDialyzerType(d?.section3.dialyzerType || 'High-Flux FX80');
    setDialysisDurationHours(d?.section3.dialysisDurationHours || '');
    setBfr(d?.section3.bfr || '');
    setDfr(d?.section3.dfr || '');
    setUfGoal(String(editingEntry.ufGoal ?? ''));
    setVascularAccess(editingEntry.vascularAccess || 'AV Fistula');
    setSelectedAccessOption(
      editingEntry.vascularAccess === 'CDL' || editingEntry.vascularAccess === 'CVC'
        ? 'CDL'
        : editingEntry.vascularAccess === 'Femoral'
        ? 'FEMORAL'
        : 'CIMINO'
    );
    setVascularNurseId(d?.section3.vascularNurseId || editingEntry.nurseId || '');
    setCiminoNote(
      d?.section3.ciminoNote ||
        (editingEntry.vascularAccess === 'AV Fistula' || editingEntry.vascularAccess === 'AV Shunt'
          ? d?.section3.accessDetailNote || ''
          : '')
    );
    setCdlNote(
      d?.section3.cdlNote ||
        (editingEntry.vascularAccess === 'CDL' || editingEntry.vascularAccess === 'CVC'
          ? d?.section3.accessDetailNote || ''
          : '')
    );
    setFemoralNote(
      d?.section3.femoralNote ||
        (editingEntry.vascularAccess === 'Femoral' ? d?.section3.accessDetailNote || '' : '')
    );
    setCannulationDone(d?.section3.cannulationDone ?? true);

    setObservations(d?.section4.observations || DEFAULT_OBSERVATIONS);
    const savedIntra = d?.section4.intraObservations;
    setIntraObservations(
      savedIntra && savedIntra.length > 0
        ? savedIntra.map((obs, idx) => ({
            id: obs.id || `obs_${idx + 1}`,
            time: obs.time || '',
            systolic: obs.systolic || '',
            diastolic: obs.diastolic || '',
            pulse: obs.pulse || '',
            resp: obs.resp || '',
            temp: obs.temp || '',
            spo2: obs.spo2 || '',
          }))
        : [
            {
              id: 'obs_1',
              time: d?.section4.intraObsTime || '',
              systolic: d?.section4.intraSystolicBp || '',
              diastolic: d?.section4.intraDiastolicBp || '',
              pulse: '',
              resp: '',
              temp: '',
              spo2: '',
            },
          ]
    );
    setIntraObsTime(d?.section4.intraObservations?.[0]?.time || d?.section4.intraObsTime || '');
    setIntraSystolicBp(
      d?.section4.intraObservations?.[0]?.systolic || d?.section4.intraSystolicBp || ''
    );
    setIntraDiastolicBp(
      d?.section4.intraObservations?.[0]?.diastolic || d?.section4.intraDiastolicBp || ''
    );
    setArterialPressure(d?.section4.arterialPressure || '-120');
    setVenousPressure(d?.section4.venousPressure || '130');
    setTmp(d?.section4.tmp || '85');
    setNoComplication(
      d?.section4.noComplication ??
        (!editingEntry.complications || editingEntry.complications.toLowerCase() === 'tidak ada')
    );
    setComplicationIncidents(
      (d?.section4.complicationIncidents || []).map((inc) => ({
        ...inc,
        clinicalDetail: inc.clinicalDetail || '',
      }))
    );
    setComplicationFlags(d?.section4.complicationFlags || ['Tidak ada']);
    setComplications(editingEntry.complications || 'Tidak ada');
    setEffectiveCommunicationNotes(
      d?.section4.effectiveCommunicationNotes ||
        'Pasien kooperatif, dijelaskan tanda gejala hipotensi/kram agar segera melapor.'
    );

    setEduFluidManagement(d?.section5.eduFluidManagement ?? true);
    setEduNutrition(d?.section5.eduNutrition ?? true);
    setEduVascularCare(d?.section5.eduVascularCare ?? true);
    setEduMedicationSchedule(d?.section5.eduMedicationSchedule ?? true);
    setTeachBackStatus(d?.section5.teachBackStatus || 'Baik');
    setEducationNotes(
      d?.section5.educationNotes ||
        'Pasien dan keluarga mampu mengulang kembali cara pembatasan cairan harian dan perawatan AV Shunt.'
    );

    setReinfusionDone(d?.section6.reinfusionDone ?? true);
    setHemostasisDone(d?.section6.hemostasisDone ?? true);
    setBleedingStopMinutes(d?.section6.bleedingStopMinutes || '10');
    setPostWeight(String(editingEntry.postWeight ?? ''));
    setUfAchieved(String(editingEntry.ufAchieved ?? ''));
    setPostBp(editingEntry.postBp || '');
    setKtv(d?.section6.ktv || '');
    setPostPulse(d?.section6.postPulse || '80');
    setPostResp(d?.section6.postResp || '18');
    setPostTemp(d?.section6.postTemp || '36.5');
    setPostSpo2(d?.section6.postSpo2 || '99');
    setWasteDecontaminated(d?.section6.wasteDecontaminated ?? true);
    setMachineDisinfectionType(d?.section6.machineDisinfectionType || 'Heat Disinfection');
    setNursingNotes(editingEntry.nursingNotes || '');
    setHandoverSummary(
      d?.section6.handoverSummary || 'Kondisi stabil pasca dialisis, siap pulang / timbang terima.'
    );

    setTransfusionGiven(d?.section7?.transfusionGiven ?? false);
    setTransfusionComponent(d?.section7?.transfusionComponent || 'PRC (Packed Red Cell)');
    setTransfusionBloodGroup(d?.section7?.transfusionBloodGroup || '');
    setTransfusionBagCount(d?.section7?.transfusionBagCount || '1');
    setTransfusionVolumeMl(d?.section7?.transfusionVolumeMl || '');
    setTransfusionBagNumber(d?.section7?.transfusionBagNumber || '');
    setTransfusionReaction(d?.section7?.transfusionReaction || 'Tidak Ada Reaksi');
    setTransfusionNote(d?.section7?.transfusionNote || '');
    setEpoGiven(d?.section7?.epoGiven ?? false);
    setEpoPreparation(d?.section7?.epoPreparation || 'Epoetin Alfa');
    setEpoDose(d?.section7?.epoDose || '');
    setEpoRoute(d?.section7?.epoRoute || 'Subkutan (SC)');
    setEpoNote(d?.section7?.epoNote || '');

    setTargetVerifierRole(editingEntry.targetVerifierRole || 'Kepala Ruang');
    setTargetVerifierId(editingEntry.targetVerifierId || '');
    setSubmissionNote(d?.section6.handoverSummary || '');
    setSubmissionConfirmed(editingEntry.verificationStatus !== 'Draft');
  }, [readOnly, editingEntry]);

  // In editable mode, mirror external BED/Mesin updates without clobbering user edits
  useEffect(() => {
    if (readOnly || !editingEntry) return;
    if (editingEntry.machineId && editingEntry.machineId !== prevEntryMachineIdRef.current) {
      if (machineId === prevEntryMachineIdRef.current) {
        setMachineId(editingEntry.machineId);
      }
      prevEntryMachineIdRef.current = editingEntry.machineId;
    }
  }, [readOnly, editingEntry?.machineId, machineId]);

  // Keep spoChecklist synced when new custom points are added via formTemplate
  useEffect(() => {
    setSpoChecklist((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const pt of resolvedTemplate.points) {
        if (pt.step >= 1 && pt.step <= 6 && !(pt.id in next)) {
          next[pt.id] =
            initialDetails?.spoChecklist?.[pt.id] === 'DIKERJAKAN'
              ? 'DIKERJAKAN'
              : 'TIDAK DIKERJAKAN';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [resolvedTemplate.points, initialDetails?.spoChecklist]);

  // Computed SPO counts (dynamic from template)
  const totalSpoCount = activeSpoPoints.length;
  const doneSpoCount = useMemo(
    () => activeSpoPoints.filter((p) => spoChecklist[p.id] === 'DIKERJAKAN').length,
    [activeSpoPoints, spoChecklist]
  );

  const stepPoints = useMemo(
    () => activeSpoPoints.filter((p) => p.step === step),
    [activeSpoPoints, step]
  );

  const stepDoneCount = useMemo(
    () => stepPoints.filter((p) => spoChecklist[p.id] === 'DIKERJAKAN').length,
    [stepPoints, spoChecklist]
  );

  const updatePointTtv = (pointId: string, key: keyof TtvValue, val: string) => {
    if (readOnly) return;
    setCustomResponses((prev) => {
      const current = prev[pointId] || {};
      return {
        ...prev,
        [pointId]: {
          ...current,
          ttv: {
            ...(current.ttv || {}),
            [key]: val,
          },
        },
      };
    });
    setErrorMsg(null);
  };

  const updatePointCustomField = (
    responseKey: string,
    fieldId: string,
    value: string | number | boolean
  ) => {
    if (readOnly) return;
    setCustomResponses((prev) => {
      const current = prev[responseKey] || {};
      return {
        ...prev,
        [responseKey]: {
          ...current,
          fields: {
            ...(current.fields || {}),
            [fieldId]: value,
          },
        },
      };
    });
    setErrorMsg(null);
  };

  const syncBooleanSubChecks = (pointId: string, done: boolean) => {
    switch (pointId) {
      case '1.1':
        setRoAdequate(done);
        setRoStatus(done ? 'Baik' : 'Perlu Perhatian');
        break;
      case '1.2':
        setInfectionZoneChecked(done);
        setInfectionZoneStatus(done ? 'Sesuai' : 'Tidak');
        break;
      case '1.3':
        setAedReady(done);
        setOxygenReady(done);
        setEmergencyDrugsReady(done);
        setEmergencyStatus(done ? 'Lengkap' : 'Ada yang Kurang');
        break;
      case '2.1':
        setHandHygieneChecked(done);
        setApdUsedChecked(done);
        setApdMask(done);
        setApdGoggles(done);
        setApdGloves(done);
        setApdApron(done);
        break;
      case '2.2':
        setLeakTestPassed(done);
        break;
      case '2.3':
        setBloodlineIntegrity(done);
        break;
      case '2.5':
        setPrimingDone(done);
        break;
      case '3.1':
        if (!done) {
          setServiceStatus('');
          setInpatientWard('');
          setCitoStatus('');
          setPatientCategory('');
        }
        break;
      case '3.2':
        if (!done) {
          setPreWeight('');
          setPostWeight('');
          setDryWeight('');
        }
        break;
      case '3.3':
        if (!done) {
          setSystolicBp('');
          setDiastolicBp('');
          setPreBp('');
        }
        break;
      case '3.4':
        setInformedConsent(done);
        break;
      case '3.5':
        if (!done) {
          setDialysisDurationHours('');
          setUfGoal('');
          setBfr('');
          setDfr('');
          setLoadingDose('');
          setAnticoagulantType('Heparin');
        }
        break;
      case '3.6':
        setCannulationDone(done);
        if (!done) {
          setSelectedAccessOption('');
          setCiminoNote('');
          setCdlNote('');
          setFemoralNote('');
        }
        break;
      case '4.1':
        if (!done) {
          setIntraObsTime('');
          setIntraSystolicBp('');
          setIntraDiastolicBp('');
          setIntraObservations([
            {
              id: 'obs_1',
              time: '',
              systolic: '',
              diastolic: '',
              pulse: '',
              resp: '',
              temp: '',
              spo2: '',
            },
          ]);
          setObservations((prev) =>
            prev.map((row, idx) => (idx === 0 ? { ...row, bp: '' } : row))
          );
        }
        break;
      case '4.3':
        if (done) {
          if (complicationIncidents.length === 0) {
            setNoComplication(true);
            setComplicationFlags(['Tidak ada']);
            setComplications('Tidak ada');
          }
        } else {
          setNoComplication(false);
          setComplicationIncidents([]);
          setComplicationFlags(['Tidak ada']);
          setComplications('Tidak ada');
        }
        break;
      case '5.1':
        setEduFluidManagement(done);
        break;
      case '5.2':
        setEduNutrition(done);
        break;
      case '5.3':
        setEduVascularCare(done);
        break;
      case '5.4':
        setEduMedicationSchedule(done);
        break;
      case '5.5':
        setTeachBackStatus(done ? 'Baik' : 'Perlu Pengulangan');
        break;
      case '6.1':
        setReinfusionDone(done);
        break;
      case '6.2':
        setHemostasisDone(done);
        break;
      case '6.3':
        if (!done) {
          setPostBp('');
          setUfAchieved('');
          setKtv('');
        }
        break;
      case '6.4':
        setWasteDecontaminated(done);
        break;
      default:
        break;
    }
  };

  const toggleHandHygieneSubCheck = (checked: boolean) => {
    setHandHygieneChecked(checked);
    const nextBoth = checked && apdUsedChecked;
    setSpoChecklist((prev) => ({
      ...prev,
      '2.1': nextBoth ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
  };

  const toggleApdSubCheck = (checked: boolean) => {
    setApdUsedChecked(checked);
    setApdMask(checked);
    setApdGoggles(checked);
    setApdGloves(checked);
    setApdApron(checked);
    const nextBoth = handHygieneChecked && checked;
    setSpoChecklist((prev) => ({
      ...prev,
      '2.1': nextBoth ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
  };

  const isPoint31Complete = (
    nextServiceStatus: 'Rawat Jalan' | 'Rawat Inap' | '',
    nextPatientCategory: 'Reguler' | 'Isolasi Hepatitis B' | 'Isolasi Hepatitis C/HIV' | '',
    nextWard: 'CAMELIA' | 'DAHLIA' | 'ICU' | '' = inpatientWard,
    nextCito: 'Tidak' | 'Ya' | '' = citoStatus
  ) => {
    if (!nextServiceStatus || !nextPatientCategory) return false;
    if (nextServiceStatus === 'Rawat Inap') {
      return Boolean(nextWard && nextCito);
    }
    return true;
  };

  const isPoint32Complete = (nextPre: string, nextPost: string, nextDry: string) =>
    Boolean(nextPre.trim() && nextPost.trim() && nextDry.trim());

  const isPoint35Complete = (
    nextDuration: string,
    nextUfGoal: string,
    nextBfr: string,
    nextDfr: string,
    nextHeparinDose: string
  ) =>
    Boolean(
      nextDuration.trim() &&
        nextUfGoal.trim() &&
        nextBfr.trim() &&
        nextDfr.trim() &&
        nextHeparinDose.trim()
    );

  const updatePoint31Selection = (
    nextServiceStatus: 'Rawat Jalan' | 'Rawat Inap' | '',
    nextPatientCategory: 'Reguler' | 'Isolasi Hepatitis B' | 'Isolasi Hepatitis C/HIV' | '',
    nextWardOverride?: 'CAMELIA' | 'DAHLIA' | 'ICU' | '',
    nextCitoOverride?: 'Tidak' | 'Ya' | ''
  ) => {
    const resolvedWard =
      nextServiceStatus === 'Rawat Inap'
        ? nextWardOverride !== undefined
          ? nextWardOverride
          : inpatientWard
        : '';
    const resolvedCito =
      nextServiceStatus === 'Rawat Inap'
        ? nextCitoOverride !== undefined
          ? nextCitoOverride
          : citoStatus || 'Tidak'
        : '';

    setServiceStatus(nextServiceStatus);
    setInpatientWard(resolvedWard);
    setCitoStatus(resolvedCito);
    setPatientCategory(nextPatientCategory);

    const complete = isPoint31Complete(
      nextServiceStatus,
      nextPatientCategory,
      resolvedWard,
      resolvedCito
    );
    setSpoChecklist((prev) => ({
      ...prev,
      '3.1': complete ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
    if (complete) setErrorMsg(null);
  };

  const updateWeightFields = (nextPre: string, nextPost: string, nextDry: string) => {
    setPreWeight(nextPre);
    setPostWeight(nextPost);
    setDryWeight(nextDry);
    const complete = isPoint32Complete(nextPre, nextPost, nextDry);
    setSpoChecklist((prev) => ({
      ...prev,
      '3.2': complete ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
    if (complete) setErrorMsg(null);
  };

  const updateSystolicDiastolic = (nextSys: string, nextDia: string) => {
    setSystolicBp(nextSys);
    setDiastolicBp(nextDia);
    const s = nextSys.trim();
    const d = nextDia.trim();
    if (s && d) {
      setPreBp(`${s}/${d}`);
      setSpoChecklist((prev) => ({ ...prev, '3.3': 'DIKERJAKAN' }));
    } else {
      setPreBp('');
      setSpoChecklist((prev) => ({ ...prev, '3.3': 'TIDAK DIKERJAKAN' }));
    }
  };

  const syncPoint35Checklist = (
    nextDuration: string,
    nextUfGoal: string,
    nextBfr: string,
    nextDfr: string,
    nextHeparinDose: string
  ) => {
    const complete = isPoint35Complete(nextDuration, nextUfGoal, nextBfr, nextDfr, nextHeparinDose);
    setSpoChecklist((prev) => ({
      ...prev,
      '3.5': complete ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
    if (complete) setErrorMsg(null);
  };

  const handleDurationHoursChange = (val: string) => {
    setDialysisDurationHours(val);
    const hours = Number(val.replace(',', '.'));
    if (!Number.isNaN(hours) && hours > 0 && hours <= 12 && startTime.includes(':')) {
      const [sh, sm] = startTime.split(':').map(Number);
      if (!Number.isNaN(sh) && !Number.isNaN(sm)) {
        const totalMins = (sh * 60 + sm + Math.round(hours * 60)) % (24 * 60);
        const eh = String(Math.floor(totalMins / 60)).padStart(2, '0');
        const em = String(totalMins % 60).padStart(2, '0');
        setEndTime(`${eh}:${em}`);
      }
    }
    syncPoint35Checklist(val, ufGoal, bfr, dfr, loadingDose);
  };

  const handleSelectVascularOption = (opt: 'CIMINO' | 'CDL' | 'FEMORAL' | '') => {
    setSelectedAccessOption(opt);
    if (opt === 'CIMINO') setVascularAccess('AV Fistula');
    else if (opt === 'CDL') setVascularAccess('CDL');
    else if (opt === 'FEMORAL') setVascularAccess('Femoral');
    setCannulationDone(Boolean(opt));
    setSpoChecklist((prev) => ({
      ...prev,
      '3.6': opt ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
    if (opt) setErrorMsg(null);
  };

  const updatePostHdEvaluation = (nextPostBp: string, nextUf: string, nextKtv: string) => {
    setPostBp(nextPostBp);
    setUfAchieved(nextUf);
    setKtv(nextKtv);
    const complete = Boolean(nextPostBp.trim() && nextUf.trim() && nextKtv.trim());
    setSpoChecklist((prev) => ({
      ...prev,
      '6.3': complete ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN',
    }));
    if (complete) setErrorMsg(null);
  };

  const isFieldValueMissing = (v: unknown) =>
    v === undefined ||
    v === null ||
    (typeof v === 'string' && !v.trim()) ||
    (typeof v === 'boolean' && !v);

  const getPointRequirementError = (pointId: string): string | null => {
    if (pointId === '3.1' && !isPoint31Complete(serviceStatus, patientCategory)) {
      if (serviceStatus === 'Rawat Inap' && !inpatientWard) {
        return 'Wajib memilih Nama Bangsal / Ruang Rawat Inap (CAMELIA, DAHLIA, atau ICU) terlebih dahulu pada Poin 3.1.';
      }
      return 'Wajib memilih salah satu Status Pelayanan dan Kategori Pasien terlebih dahulu pada Poin 3.1.';
    }
    if (pointId === '3.2' && !isPoint32Complete(preWeight, postWeight, dryWeight)) {
      return 'Wajib mengisi kolom Berat Badan Datang, Berat Badan Pulang, dan Berat Badan Kering terlebih dahulu pada Poin 3.2.';
    }
    if (pointId === '3.3' && (!systolicBp.trim() || !diastolicBp.trim())) {
      return 'Wajib mengisi kedua kolom Sistolik dan Diastolik terlebih dahulu pada Poin 3.3.';
    }
    if (pointId === '3.5' && !isPoint35Complete(dialysisDurationHours, ufGoal, bfr, dfr, loadingDose)) {
      return 'Wajib mengisi kolom Waktu Dialisis / Time, Target UFG, QB, QD, dan Dosis Heparin terlebih dahulu pada Poin 3.5.';
    }
    if (pointId === '3.6' && !selectedAccessOption) {
      return 'Wajib mencentang salah satu akses vaskular (CIMINO, CDL, atau FEMORAL) terlebih dahulu pada Poin 3.6.';
    }
    if (pointId === '4.1' && (!intraSystolicBp.trim() || !intraDiastolicBp.trim())) {
      return 'Wajib mengisi kedua kolom Sistolik dan Diastolik terlebih dahulu pada Poin 4.1.';
    }
    if (pointId === '6.3' && (!postBp.trim() || !ufAchieved.trim() || !ktv.trim())) {
      return 'Wajib mengisi semua kolom (Tekanan Darah Post HD, Nilai UFG Tercapai, dan KT/V) terlebih dahulu pada Poin 6.3.';
    }
    const meta = pointTemplateMap.get(pointId);
    if (meta?.customFields && meta.customFields.length > 0) {
      const respFields = customResponses[pointId]?.fields || {};
      for (const fld of meta.customFields) {
        if (fld.required && isFieldValueMissing(respFields[fld.id])) {
          return `Wajib mengisi kolom "${fld.label}" terlebih dahulu pada Poin ${pointId}.`;
        }
      }
    }
    return null;
  };

  const setSpoPointStatus = (pointId: string, nextStatus: SpoCheckStatus) => {
    if (readOnly) return;
    if (nextStatus === 'DIKERJAKAN') {
      const reqErr = getPointRequirementError(pointId);
      if (reqErr) {
        setErrorMsg(reqErr);
        return;
      }
    }
    setErrorMsg(null);
    setSpoChecklist((prev) => ({
      ...prev,
      [pointId]: nextStatus,
    }));
    syncBooleanSubChecks(pointId, nextStatus === 'DIKERJAKAN');
  };

  const markStepAllDone = (targetStep: number) => {
    const pts = activeSpoPoints.filter((p) => p.step === targetStep);
    const allowedIds: string[] = [];
    const blockedIds: string[] = [];
    for (const pt of pts) {
      if (getPointRequirementError(pt.id)) {
        blockedIds.push(pt.id);
      } else {
        allowedIds.push(pt.id);
      }
    }

    setSpoChecklist((prev) => {
      const next = { ...prev };
      for (const id of allowedIds) {
        next[id] = 'DIKERJAKAN';
      }
      return next;
    });
    for (const id of allowedIds) {
      syncBooleanSubChecks(id, true);
    }
    if (blockedIds.length > 0) {
      setErrorMsg(
        `Poin ${blockedIds.join(', ')} belum dapat ditandai DIKERJAKAN sebelum kolom wajibnya terisi lengkap.`
      );
    } else {
      setErrorMsg(null);
    }
  };

  const resetStepChecklist = (targetStep: number) => {
    const pts = activeSpoPoints.filter((p) => p.step === targetStep);
    setSpoChecklist((prev) => {
      const next = { ...prev };
      for (const pt of pts) {
        next[pt.id] = 'TIDAK DIKERJAKAN';
      }
      return next;
    });
    for (const pt of pts) {
      syncBooleanSubChecks(pt.id, false);
    }
    setCustomResponses((prev) => {
      const next = { ...prev };
      for (const pt of resolvedTemplate.points.filter((p) => p.step === targetStep)) {
        delete next[pt.id];
      }
      if (targetStep === 7) delete next['__sec7'];
      return next;
    });
  };

  const resetAllChecklist = () => {
    setSpoChecklist(buildInitialSpoChecklist(undefined, resolvedTemplate.points));
    for (const pt of activeSpoPoints) {
      syncBooleanSubChecks(pt.id, false);
    }
    setCustomResponses({});
    setSubmissionConfirmed(false);
  };

  // Computed IDWG (BB Datang - BB Kering) & Persentase IDWG ((IDWG / BB Kering) * 100)
  const idwgMetrics = useMemo(() => {
    const pre = Number(String(preWeight).replace(',', '.'));
    const post = Number(String(postWeight).replace(',', '.'));
    const dry = Number(String(dryWeight).replace(',', '.'));
    const hasPreAndDry =
      Boolean(preWeight.trim()) &&
      Boolean(dryWeight.trim()) &&
      !Number.isNaN(pre) &&
      !Number.isNaN(dry) &&
      pre > 0 &&
      dry > 0;
    const hasPreAndPost =
      Boolean(preWeight.trim()) &&
      Boolean(postWeight.trim()) &&
      !Number.isNaN(pre) &&
      !Number.isNaN(post) &&
      pre > 0 &&
      post > 0;

    if (!hasPreAndDry) {
      return {
        ready: false,
        idwgKg: 0,
        idwgPercent: 0,
        ufEstimateMl: 0,
        weightLossKg: hasPreAndPost ? Number((pre - post).toFixed(2)) : null,
        categoryLabel: 'Menunggu Input BB Datang & BB Kering',
        categoryTone: 'neutral' as const,
      };
    }

    const diffKg = Number((pre - dry).toFixed(2));
    const pct = Number(((diffKg / dry) * 100).toFixed(2));
    const ufEstimateMl = Math.max(0, Math.round(diffKg * 1000));
    const weightLossKg = hasPreAndPost ? Number((pre - post).toFixed(2)) : null;

    let categoryLabel = 'Normal / Terkendali (≤ 4%)';
    let categoryTone: 'neutral' | 'emerald' | 'amber' | 'rose' = 'emerald';

    if (diffKg < 0) {
      categoryLabel = 'Di Bawah BB Kering';
      categoryTone = 'amber';
    } else if (pct > 6) {
      categoryLabel = 'Overload Berat (> 6%)';
      categoryTone = 'rose';
    } else if (pct > 4) {
      categoryLabel = 'Melebihi Target (> 4%)';
      categoryTone = 'amber';
    }

    return {
      ready: true,
      idwgKg: diffKg,
      idwgPercent: pct,
      ufEstimateMl,
      weightLossKg,
      categoryLabel,
      categoryTone,
    };
  }, [preWeight, postWeight, dryWeight]);

  const idwg = idwgMetrics.ready ? idwgMetrics.idwgKg : 0;

  const currentDayName = useMemo(() => getDayNameId(date), [date]);

  const lockedPatientsForDate = useMemo(() => {
    const map = new Map<string, { nurseName: string; status: string; logbookId: string }>();
    const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));
    for (const lk of logbookLocks) {
      if (lk.date === date && lk.logbookId !== activeEntryId) {
        if (lk.nurseId === userProfile?.uid && !existingLogbookIds.has(lk.logbookId)) {
          continue;
        }
        map.set(lk.patientId, {
          nurseName: lk.nurseName,
          status: 'Sudah Diinput',
          logbookId: lk.logbookId,
        });
      }
    }
    for (const lb of logbooks) {
      if (lb.date === date && lb.id !== activeEntryId && !map.has(lb.patientId)) {
        map.set(lb.patientId, {
          nurseName: lb.nurseName,
          status: lb.verificationStatus,
          logbookId: lb.id,
        });
      }
    }
    return map;
  }, [logbookLocks, logbooks, date, activeEntryId, userProfile?.uid]);

  const lockedMachinesForSlot = useMemo(() => {
    const map = new Map<
      string,
      { nurseId: string; nurseName: string; patientId: string; patientName: string; logbookId: string }
    >();
    const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));

    for (const lk of machineLocks) {
      if (lk.date !== date || lk.shift !== shift) continue;
      if (lk.logbookId && lk.logbookId === activeEntryId) continue;
      if (!lk.logbookId && lk.nurseId === userProfile?.uid && lk.patientId === patientId) continue;
      if (lk.logbookId && lk.nurseId === userProfile?.uid && !existingLogbookIds.has(lk.logbookId)) {
        continue;
      }
      map.set(lk.machineId, {
        nurseId: lk.nurseId,
        nurseName: lk.nurseName,
        patientId: lk.patientId,
        patientName: lk.patientName,
        logbookId: lk.logbookId,
      });
    }

    for (const lb of logbooks) {
      if (lb.date === date && lb.shift === shift && lb.id !== activeEntryId && !map.has(lb.machineId)) {
        map.set(lb.machineId, {
          nurseId: lb.nurseId,
          nurseName: lb.nurseName,
          patientId: lb.patientId,
          patientName: lb.patientName,
          logbookId: lb.id,
        });
      }
    }
    return map;
  }, [machineLocks, logbooks, date, shift, activeEntryId, userProfile?.uid, patientId]);

  const scheduledPatientsForDate = useMemo(
    () =>
      activeRegularPatients.filter((p) =>
        isPatientScheduledOnDay(p.routineSchedule, currentDayName)
      ),
    [activeRegularPatients, currentDayName]
  );

  const displayedPatientOptions = useMemo(() => {
    return onlyScheduledForDay ? scheduledPatientsForDate : activePatients;
  }, [onlyScheduledForDay, scheduledPatientsForDate, activePatients]);

  const unlockedDisplayedCount = useMemo(
    () => displayedPatientOptions.filter((p) => !lockedPatientsForDate.has(p.id)).length,
    [displayedPatientOptions, lockedPatientsForDate]
  );

  const resolvedDutyDoctorName = useMemo(() => {
    if (dutyDoctorId === '__manual__') {
      return manualDutyDoctorName.trim();
    }
    return doctors.find((d) => d.id === dutyDoctorId)?.fullName || '';
  }, [dutyDoctorId, manualDutyDoctorName, doctors]);

  const selectedPatient = useMemo(() => {
    const found = patients.find((p) => p.id === patientId);
    if (found) return found;
    if (editingEntry && editingEntry.patientId === patientId) {
      return {
        id: editingEntry.patientId,
        fullName: editingEntry.patientName,
        mrn: editingEntry.patientRm,
        vascularAccess: editingEntry.vascularAccess,
      } as Patient;
    }
    return undefined;
  }, [patients, patientId, editingEntry]);

  const selectedMachine = useMemo(() => {
    const found = machines.find((m) => m.id === machineId) || machines[0];
    if (found) return found;
    if (editingEntry) {
      return {
        id: editingEntry.machineId,
        machineNumber: editingEntry.machineNumber,
      } as Machine;
    }
    return undefined;
  }, [machines, machineId, editingEntry]);

  const assignedPjForSlot = useMemo(() => {
    return pjShiftAssignments.find((a) => a.date === date && a.shift === shift) || null;
  }, [pjShiftAssignments, date, shift]);

  const verifierCandidates = useMemo(() => {
    const matching = staffDirectory.filter((s) => s.isActive && s.role === targetVerifierRole);
    if (targetVerifierRole === 'PJ Shift') {
      const submitterUid = editingEntry?.nurseId || userProfile?.uid;
      const peers = matching.filter((s) => s.uid !== submitterUid);
      const baseList = peers.length > 0 ? peers : matching;
      if (assignedPjForSlot) {
        const idx = baseList.findIndex((s) => s.uid === assignedPjForSlot.pjNurseId);
        if (idx > 0) {
          const ordered = [...baseList];
          const [picked] = ordered.splice(idx, 1);
          ordered.unshift(picked);
          return ordered;
        }
      }
      return baseList;
    }
    return matching;
  }, [
    staffDirectory,
    targetVerifierRole,
    editingEntry?.nurseId,
    userProfile?.uid,
    assignedPjForSlot,
  ]);

  const resolvedVerifierId = useMemo(() => {
    if (targetVerifierId && verifierCandidates.some((c) => c.uid === targetVerifierId)) {
      return targetVerifierId;
    }
    return verifierCandidates[0]?.uid || '';
  }, [targetVerifierId, verifierCandidates]);

  const selectedVerifierObj = useMemo(
    () => verifierCandidates.find((c) => c.uid === resolvedVerifierId) || null,
    [verifierCandidates, resolvedVerifierId]
  );

  const vascularNurseOptions = useMemo(() => {
    const nurses = staffDirectory.filter(
      (s) =>
        s.isActive &&
        (s.role === 'Perawat Pelaksana' || s.role === 'PJ Shift' || s.role === 'Kepala Ruang')
    );
    const list: { uid: string; label: string; fullName: string }[] = [];
    const savedVascId = initialDetails?.section3.vascularNurseId;
    const savedVascName = initialDetails?.section3.vascularNurseName;
    if (savedVascId && savedVascName) {
      list.push({
        uid: savedVascId,
        fullName: savedVascName,
        label: savedVascName,
      });
    }
    if (editingEntry?.nurseId && editingEntry.nurseName && !list.some((n) => n.uid === editingEntry.nurseId)) {
      list.push({
        uid: editingEntry.nurseId,
        fullName: editingEntry.nurseName,
        label: editingEntry.nurseName,
      });
    }
    if (userProfile && !list.some((n) => n.uid === userProfile.uid)) {
      list.push({
        uid: userProfile.uid,
        fullName: userProfile.fullName,
        label: `${userProfile.fullName} (Saya · ${userProfile.role})`,
      });
    }
    for (const s of nurses) {
      if (!list.some((n) => n.uid === s.uid)) {
        list.push({
          uid: s.uid,
          fullName: s.fullName,
          label: `${s.fullName} (${s.role})`,
        });
      }
    }
    return list;
  }, [staffDirectory, userProfile, initialDetails, editingEntry]);

  const handleSelectPatient = (id: string) => {
    if (id && lockedPatientsForDate.has(id)) {
      const info = lockedPatientsForDate.get(id);
      setErrorMsg(
        `Pasien tersebut sudah diinput logbooknya pada ${date}${info ? ` oleh ${info.nurseName}` : ''} dan tidak dapat dipilih kembali.`
      );
      return;
    }
    setErrorMsg(null);
    setPatientId(id);
    const p = patients.find((item) => item.id === id);
    if (p) {
      setRmSearch(p.mrn);
      setVascularAccess(p.vascularAccess);
      const detectedShift = extractShiftFromSchedule(p.routineSchedule);
      if (detectedShift && !editingEntry) {
        setShift(detectedShift);
      }
    }
  };

  const handleDateChange = (nextDate: string) => {
    setDate(nextDate);
    setErrorMsg(null);
    const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));
    const nextLocked = new Set<string>();
    for (const lk of logbookLocks) {
      if (lk.date === nextDate && lk.logbookId !== editingEntry?.id) {
        if (lk.nurseId === userProfile?.uid && !existingLogbookIds.has(lk.logbookId)) {
          continue;
        }
        nextLocked.add(lk.patientId);
      }
    }
    for (const lb of logbooks) {
      if (lb.date === nextDate && lb.id !== editingEntry?.id) {
        nextLocked.add(lb.patientId);
      }
    }
    const nextDay = getDayNameId(nextDate);
    const pool = onlyScheduledForDay
      ? activeRegularPatients.filter((p) => isPatientScheduledOnDay(p.routineSchedule, nextDay))
      : activePatients;
    const nextUnlocked = pool.filter((p) => !nextLocked.has(p.id));

    if ((patientId && nextLocked.has(patientId)) || (!editingEntry && onlyScheduledForDay)) {
      if (
        nextUnlocked.length > 0 &&
        (!patientId || nextLocked.has(patientId) || !nextUnlocked.some((p) => p.id === patientId))
      ) {
        const first = nextUnlocked[0];
        setPatientId(first.id);
        setRmSearch(first.mrn);
        setVascularAccess(first.vascularAccess);
      } else if (nextUnlocked.length === 0) {
        setPatientId('');
        setRmSearch('');
      }
    }
  };

  const handleRmLookup = (queryVal: string) => {
    setRmSearch(queryVal);
    const clean = queryVal.trim().toLowerCase();
    if (!clean) return;
    const pool = (onlyScheduledForDay ? scheduledPatientsForDate : activePatients).filter(
      (p) => !lockedPatientsForDate.has(p.id)
    );
    const fallbackPool = activePatients.filter((p) => !lockedPatientsForDate.has(p.id));
    const exact =
      pool.find((p) => p.mrn.toLowerCase() === clean || p.fullName.toLowerCase().includes(clean)) ||
      fallbackPool.find(
        (p) => p.mrn.toLowerCase() === clean || p.fullName.toLowerCase().includes(clean)
      );
    if (exact) {
      if (
        onlyScheduledForDay &&
        (!isRegularPatient(exact) || !isPatientScheduledOnDay(exact.routineSchedule, currentDayName))
      ) {
        setOnlyScheduledForDay(false);
      }
      handleSelectPatient(exact.id);
    }
  };

  const syncIntraObservationsState = (nextList: IntraTtvObservationItem[]) => {
    setIntraObservations(nextList);
    const primary = nextList[0];
    const nextTime = primary?.time || '';
    const nextSys = primary?.systolic || '';
    const nextDia = primary?.diastolic || '';
    setIntraObsTime(nextTime);
    setIntraSystolicBp(nextSys);
    setIntraDiastolicBp(nextDia);

    setObservations((prev) => {
      const base = prev.length > 0 ? prev : DEFAULT_OBSERVATIONS;
      const maxLen = Math.max(base.length, nextList.length);
      const updated: IntraObservationRow[] = [];
      for (let i = 0; i < maxLen; i++) {
        const existingRow = base[i] || {
          hourLabel: `Jam ke-${i + 1}`,
          bp: '',
          pulse: '',
          bfr: bfr || '',
          ufr: '',
          arterialPressure: '',
          venousPressure: '',
          tmp: '',
        };
        const ttvItem = nextList[i];
        if (ttvItem) {
          const s = ttvItem.systolic.trim();
          const d = ttvItem.diastolic.trim();
          const bpStr = s && d ? `${s}/${d}` : i === 0 ? '' : existingRow.bp;
          updated.push({
            ...existingRow,
            hourLabel: ttvItem.time.trim()
              ? `Jam ke-${i + 1} (${ttvItem.time.trim()})`
              : existingRow.hourLabel,
            bp: bpStr,
            pulse: ttvItem.pulse?.trim() || existingRow.pulse,
          });
        } else {
          updated.push(existingRow);
        }
      }
      return updated;
    });

    if (nextSys.trim() && nextDia.trim()) {
      setSpoChecklist((prev) => ({ ...prev, '4.1': 'DIKERJAKAN' }));
      setErrorMsg(null);
    } else {
      setSpoChecklist((prev) => ({ ...prev, '4.1': 'TIDAK DIKERJAKAN' }));
    }
  };

  const handleAddIntraObservation = () => {
    const nextItem: IntraTtvObservationItem = {
      id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: getCurrentTimeHHmm(),
      systolic: '',
      diastolic: '',
      pulse: '',
      resp: '',
      temp: '',
      spo2: '',
    };
    syncIntraObservationsState([...intraObservations, nextItem]);
  };

  const handleUpdateIntraObservation = (
    id: string,
    field: keyof Omit<IntraTtvObservationItem, 'id'>,
    value: string
  ) => {
    const nextList = intraObservations.map((obs) =>
      obs.id === id ? { ...obs, [field]: value } : obs
    );
    syncIntraObservationsState(nextList);
  };

  const handleRemoveIntraObservation = (id: string) => {
    if (intraObservations.length <= 1) return;
    const nextList = intraObservations.filter((obs) => obs.id !== id);
    syncIntraObservationsState(nextList);
  };

  const formatIncidentSummaryText = (inc: ComplicationIncidentItem): string => {
    const meta = getComplicationInputMeta(inc.type);
    const val = meta.field === 'bp' ? inc.bp.trim() : (inc.clinicalDetail || '').trim();
    if (!val) return inc.type;
    const unitSuffix =
      meta.summaryUnit && !val.toLowerCase().includes(meta.summaryUnit.toLowerCase())
        ? ` ${meta.summaryUnit}`
        : '';
    return meta.summaryPrefix
      ? `${inc.type} (${meta.summaryPrefix} ${val}${unitSuffix})`
      : `${inc.type} (${val}${unitSuffix})`;
  };

  const syncIncidentsDerivedState = (
    nextIncidents: ComplicationIncidentItem[],
    nextNoComplication: boolean
  ) => {
    if (nextIncidents.length > 0) {
      setNoComplication(false);
      setComplications(nextIncidents.map(formatIncidentSummaryText).join('; '));
      setComplicationFlags(Array.from(new Set(nextIncidents.map((inc) => inc.type))));
      const advices = nextIncidents.map((inc) => inc.doctorAdvice.trim()).filter(Boolean);
      if (advices.length > 0) {
        setEffectiveCommunicationNotes(advices.join('; '));
      }
      setSpoChecklist((prev) => ({ ...prev, '4.3': 'DIKERJAKAN' }));
    } else if (nextNoComplication) {
      setComplications('Tidak ada');
      setComplicationFlags(['Tidak ada']);
      setSpoChecklist((prev) => ({ ...prev, '4.3': 'DIKERJAKAN' }));
    } else {
      setComplications('Tidak ada');
      setComplicationFlags(['Tidak ada']);
      setSpoChecklist((prev) => ({ ...prev, '4.3': 'TIDAK DIKERJAKAN' }));
    }
  };

  const handleAddComplicationIncident = () => {
    const newItem: ComplicationIncidentItem = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'Hipertensi',
      time: getCurrentTimeHHmm(),
      bp: '',
      clinicalDetail: '',
      doctorAdvice: '',
    };
    const next = [...complicationIncidents, newItem];
    setComplicationIncidents(next);
    syncIncidentsDerivedState(next, false);
  };

  const handleUpdateComplicationIncident = (
    id: string,
    field: keyof Omit<ComplicationIncidentItem, 'id'>,
    value: string
  ) => {
    const next = complicationIncidents.map((item) => {
      if (item.id !== id) return item;
      if (field === 'type') {
        const prevMeta = getComplicationInputMeta(item.type);
        const nextMeta = getComplicationInputMeta(value);
        if (prevMeta.field !== nextMeta.field) {
          return {
            ...item,
            type: value,
            bp: nextMeta.field === 'bp' ? item.bp : '',
            clinicalDetail: nextMeta.field === 'clinicalDetail' ? item.clinicalDetail || '' : '',
          };
        }
      }
      return { ...item, [field]: value };
    });
    setComplicationIncidents(next);
    syncIncidentsDerivedState(next, false);
  };

  const handleRemoveComplicationIncident = (id: string) => {
    const next = complicationIncidents.filter((item) => item.id !== id);
    setComplicationIncidents(next);
    syncIncidentsDerivedState(next, noComplication);
  };

  const handleToggleNoComplication = (checked: boolean) => {
    setNoComplication(checked);
    if (checked) {
      setComplicationIncidents([]);
      syncIncidentsDerivedState([], true);
      setErrorMsg(null);
    } else {
      syncIncidentsDerivedState(complicationIncidents, false);
    }
  };

  const validateStep = (targetStep: number): string | null => {
    const isPointVisible = (id: string) => pointTemplateMap.get(id)?.visible !== false;

    if (targetStep === 1 && isPointVisible('1.1')) {
      if (!roTds.trim() || !roConductivity.trim()) {
        return 'Lengkapi catatan TDS dan Conductivity Air RO pada Bagian 1.';
      }
    }
    if (targetStep === 2) {
      if (!machineId) return 'Pilih nomor mesin HD pada Bagian 2.';
      const machineConflict = lockedMachinesForSlot.get(machineId);
      if (machineConflict) {
        return `Mesin / Bed HD ${selectedMachine?.machineNumber || ''} pada Shift ${shift} tanggal ${date} sudah dipilih oleh ${machineConflict.nurseName}.`;
      }
      if (isPointVisible('2.4') && !dialysateTemp.trim()) return 'Isi suhu dialisat pada Bagian 2.';
    }
    if (targetStep === 3) {
      if (!patientId) return 'Pilih pasien yang belum terinput pada daftar pasien.';
      if (lockedPatientsForDate.has(patientId)) {
        return 'Pasien ini sudah memiliki logbook pada tanggal tersebut dan tidak dapat dipilih kembali.';
      }
      if (machineId && lockedMachinesForSlot.has(machineId)) {
        const mc = lockedMachinesForSlot.get(machineId)!;
        return `Mesin / Bed HD ${selectedMachine?.machineNumber || ''} pada Shift ${shift} tanggal ${date} sudah dipilih oleh ${mc.nurseName}.`;
      }
      if (!doctorId) return 'Pilih Dokter DPJP terlebih dahulu.';
      if (!resolvedDutyDoctorName) return 'Pilih atau ketik nama Dokter Jaga Ruang HD terlebih dahulu.';
      if (isPointVisible('3.1') && serviceStatus === 'Rawat Inap' && !inpatientWard) {
        return 'Wajib memilih Nama Bangsal / Ruang Rawat Inap (CAMELIA, DAHLIA, atau ICU) pada Poin 3.1 (Bagian 3).';
      }
      if (isPointVisible('3.2') && !preWeight.trim()) {
        return 'Lengkapi Berat Badan Datang (Pre-HD) pada Poin 3.2 (Bagian 3).';
      }
      if (isPointVisible('3.3') && (!systolicBp.trim() || !diastolicBp.trim())) {
        return 'Wajib mengisi kedua kolom Sistolik dan Diastolik pada Poin 3.3 (Bagian 3).';
      }
      if (isPointVisible('3.4') && !informedConsent) {
        return 'Persetujuan tindakan (Informed Consent) harus terverifikasi.';
      }
    }
    if (targetStep === 6) {
      if (isPointVisible('6.3') && (!postBp.trim() || !ufAchieved.trim() || !ktv.trim())) {
        return 'Wajib mengisi semua kolom (Tekanan Darah Post HD, Nilai UFG Tercapai, dan KT/V) pada Poin 6.3 (Bagian 6).';
      }
      if (isPointVisible('3.2') && !postWeight.trim()) {
        return 'Lengkapi Berat Badan Pulang (Post-HD) pada Poin 3.2 (Bagian 3).';
      }
    }
    if (targetStep === 7) {
      if (isPointVisible('7.1') && transfusionGiven) {
        if (!transfusionComponent.trim()) {
          return 'Pilih Komponen Darah pada Poin 7.1 (Bagian 7).';
        }
        const bagNum = Number(transfusionBagCount);
        if (!transfusionBagCount.trim() || Number.isNaN(bagNum) || bagNum < 1) {
          return 'Isi Jumlah Kantong transfusi minimal 1 pada Poin 7.1 (Bagian 7).';
        }
      }
      if (isPointVisible('7.2') && epoGiven) {
        if (!epoPreparation.trim()) {
          return 'Isi Jenis / Nama Preparat EPO pada Poin 7.2 (Bagian 7).';
        }
        if (!epoDose.trim()) {
          return 'Isi Dosis Pemberian EPO pada Poin 7.2 (Bagian 7).';
        }
      }
      if (section7CustomFields.length > 0) {
        const sec7Resp = customResponses['__sec7']?.fields || {};
        for (const fld of section7CustomFields) {
          if (fld.required && isFieldValueMissing(sec7Resp[fld.id])) {
            return `Wajib mengisi kolom "${fld.label}" pada Bagian 7.`;
          }
        }
      }
    }

    // Validate required custom fields on any visible points in targetStep
    const visiblePtsInStep = resolvedTemplate.points.filter(
      (p) => p.step === targetStep && p.visible !== false
    );
    for (const pt of visiblePtsInStep) {
      if (pt.customFields && pt.customFields.length > 0) {
        const respFields = customResponses[pt.id]?.fields || {};
        for (const fld of pt.customFields) {
          if (fld.required && isFieldValueMissing(respFields[fld.id])) {
            return `Wajib mengisi kolom "${fld.label}" pada Poin ${pt.id}.`;
          }
        }
      }
    }

    return null;
  };

  const handleNextStep = () => {
    setErrorMsg(null);
    const err = validateStep(step);
    if (err) {
      setErrorMsg(err);
      return;
    }
    setStep((s) => Math.min(8, s + 1));
  };

  const getAutoDraftStatus = (): 'Draft' | 'Revision' => {
    const current = editingEntry || autoSavedEntryRef.current;
    return current?.verificationStatus === 'Revision' ? 'Revision' : 'Draft';
  };

  const handleSave = async (
    submitStatus: 'Draft' | 'Pending' | 'Revision',
    options?: { keepOpen?: boolean; silentIfNotReady?: boolean }
  ): Promise<'saved' | 'skipped' | 'error'> => {
    if (!userProfile) return 'error';
    const keepOpen = Boolean(options?.keepOpen);
    const silentIfNotReady = Boolean(options?.silentIfNotReady);
    if (!keepOpen) {
      setErrorMsg(null);
    }

    const currentEntry = editingEntry || autoSavedEntryRef.current;

    const pat = patients.find((p) => p.id === patientId);
    const mach = machines.find((m) => m.id === machineId) || machines[0];
    const docObj = doctors.find((d) => d.id === doctorId) || activeDoctors[0];

    if (!pat) {
      if (silentIfNotReady) return 'skipped';
      setStep(3);
      setErrorMsg('Pilih pasien yang belum memiliki catatan logbook pada tanggal tindakan ini.');
      return 'error';
    }

    const existingLock = lockedPatientsForDate.get(pat.id);
    if (existingLock) {
      if (silentIfNotReady && !currentEntry) return 'skipped';
      setStep(3);
      setErrorMsg(
        `Pasien ${pat.fullName} sudah diinput logbooknya pada ${date} oleh ${existingLock.nurseName} dan tidak dapat dipilih kembali.`
      );
      return 'error';
    }

    if (!mach || !docObj) {
      if (silentIfNotReady) return 'skipped';
      setErrorMsg(
        'Data master Mesin HD atau Dokter DPJP belum tersedia. Hubungi Administrator untuk mengisi data master terlebih dahulu.'
      );
      return 'error';
    }

    const existingMachineLock = lockedMachinesForSlot.get(mach.id);
    if (existingMachineLock) {
      if (silentIfNotReady && !currentEntry) return 'skipped';
      setStep(3);
      setErrorMsg(
        `Mesin / Bed HD ${mach.machineNumber} pada Shift ${shift} tanggal ${date} sudah dipilih oleh ${existingMachineLock.nurseName} (Pasien: ${existingMachineLock.patientName}).`
      );
      return 'error';
    }

    if (isVerifierEdit) {
      if (userProfile.role === 'Administrator') {
        setErrorMsg('Administrator tidak memiliki wewenang untuk memverifikasi logbook.');
        return 'error';
      }
      if (currentEntry) {
        const verAccess = getLogbookVerificationAccess(currentEntry, userProfile, Date.now());
        if (!verAccess.allowed) {
          setErrorMsg(
            verAccess.reason ||
              'Di luar jam verifikasi logbook. Perubahan verifikator tidak dapat disimpan.'
          );
          return 'error';
        }
      }
    }

    const preCheckDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayDateStr();
    const preCheckShift: ShiftType =
      shift === 'Siang' || shift === 'Malam' ? shift : 'Pagi';
    const liveSubAccess = getLogbookSubmissionAccess(
      preCheckDate,
      preCheckShift,
      currentEntry || editingEntry || null,
      Date.now()
    );

    if (!isVerifierEdit && currentEntry?.verificationStatus === 'Revision' && !liveSubAccess.canEditRevision) {
      if (!silentIfNotReady) {
        setErrorMsg(
          liveSubAccess.reason ||
            'Batas waktu perbaikan revisi (1 jam) telah berakhir.'
        );
      }
      return 'error';
    }

    if (submitStatus === 'Pending' || isVerifierEdit) {
      if (submitStatus === 'Pending' && !isVerifierEdit && !liveSubAccess.canSubmitPending) {
        setStep(8);
        setErrorMsg(
          liveSubAccess.reason ||
            'Pengajuan verifikasi tidak dapat dilakukan di luar jam operasional WIB.'
        );
        return 'error';
      }
      for (const s of [1, 2, 3, 6, 7]) {
        const err = validateStep(s);
        if (err) {
          setStep(s);
          setErrorMsg(err);
          return 'error';
        }
      }
      if (submitStatus === 'Pending' && !isVerifierEdit && !submissionConfirmed) {
        setStep(8);
        setErrorMsg(
          'Centang pernyataan konfirmasi bahwa seluruh indikator SPO dan data asuhan Bagian I–VII telah diperiksa sebelum mengajukan verifikasi.'
        );
        return 'error';
      }
    }

    const selectedVerifier =
      staffDirectory.find((s) => s.uid === resolvedVerifierId) || selectedVerifierObj || undefined;
    const selectedVascularNurse = vascularNurseOptions.find((n) => n.uid === vascularNurseId);
    const resolvedPreBp =
      systolicBp.trim() && diastolicBp.trim()
        ? `${systolicBp.trim()}/${diastolicBp.trim()}`
        : preBp.trim();
    const resolvedAccessNote =
      selectedAccessOption === 'CDL'
        ? cdlNote
        : selectedAccessOption === 'FEMORAL'
        ? femoralNote
        : ciminoNote;

    const wizardDetails: LogbookWizardDetails = {
      section1: {
        roStatus,
        roAdequate,
        roTds: clampString(roTds, 40),
        roConductivity: clampString(roConductivity, 40),
        roNotes: clampString(roNotes, 200),
        infectionZoneStatus,
        infectionZoneChecked,
        emergencyStatus,
        aedReady,
        oxygenReady,
        emergencyDrugsReady,
        emergencyNotes: clampString(emergencyNotes, 200),
      },
      section2: {
        apdMask,
        apdGoggles,
        apdGloves,
        apdApron,
        machineConductivity: clampString(machineConductivity, 40),
        machinePh: clampString(machinePh, 20),
        leakTestPassed,
        bloodlineIntegrity,
        dialysateTemp: clampString(dialysateTemp, 20),
        dialysateType,
        primingDone,
        primingVolume: clampString(primingVolume, 20),
        anticoagulantType,
        loadingDose: clampString(loadingDose, 40),
        maintenanceDose: clampString(maintenanceDose, 40),
        fistulaNeedleSize,
      },
      section3: {
        serviceStatus,
        inpatientWard: serviceStatus === 'Rawat Inap' ? inpatientWard : '',
        citoStatus: serviceStatus === 'Rawat Inap' ? citoStatus || 'Tidak' : '',
        patientCategory,
        dryWeight: Math.min(300, Math.max(0, Number(dryWeight) || 0)),
        idwg,
        prePulse: clampString(prePulse, 20),
        preResp: clampString(preResp, 20),
        preTemp: clampString(preTemp, 20),
        preSpo2: clampString(preSpo2, 20),
        fallRiskScale,
        fallRiskLevel,
        informedConsent,
        dialyzerType: clampString(dialyzerType, 80),
        dialysisDurationHours: clampString(dialysisDurationHours, 20),
        bfr: clampString(bfr, 20),
        dfr: clampString(dfr, 20),
        cannulationDone,
        vascularNurseId: selectedVascularNurse?.uid || vascularNurseId || '',
        vascularNurseName: clampString(
          selectedVascularNurse?.fullName ||
            (editingEntry ? editingEntry.nurseName : userProfile.fullName),
          120
        ),
        accessDetailNote: clampString(resolvedAccessNote, 160),
        ciminoNote: clampString(ciminoNote, 160),
        cdlNote: clampString(cdlNote, 160),
        femoralNote: clampString(femoralNote, 160),
      },
      section4: {
        observations: observations.slice(0, 12),
        arterialPressure: clampString(arterialPressure, 20),
        venousPressure: clampString(venousPressure, 20),
        tmp: clampString(tmp, 20),
        complicationFlags: complicationFlags.slice(0, 12),
        effectiveCommunicationNotes: clampString(effectiveCommunicationNotes, 300),
        intraObsTime: clampString(intraObservations[0]?.time || intraObsTime, 10),
        intraSystolicBp: clampString(intraObservations[0]?.systolic || intraSystolicBp, 10),
        intraDiastolicBp: clampString(intraObservations[0]?.diastolic || intraDiastolicBp, 10),
        intraObservations: intraObservations.slice(0, 12).map((obs) => ({
          id: clampString(obs.id, 40),
          time: clampString(obs.time, 10),
          systolic: clampString(obs.systolic, 10),
          diastolic: clampString(obs.diastolic, 10),
          pulse: clampString(obs.pulse || '', 15),
          resp: clampString(obs.resp || '', 15),
          temp: clampString(obs.temp || '', 15),
          spo2: clampString(obs.spo2 || '', 15),
        })),
        noComplication,
        complicationIncidents: complicationIncidents.slice(0, 10).map((inc) => ({
          id: clampString(inc.id, 40),
          type: clampString(inc.type, 60),
          time: clampString(inc.time, 10),
          bp: clampString(inc.bp, 20),
          clinicalDetail: clampString(inc.clinicalDetail || '', 120),
          doctorAdvice: clampString(inc.doctorAdvice, 250),
        })),
      },
      section5: {
        eduFluidManagement,
        eduNutrition,
        eduVascularCare,
        eduMedicationSchedule,
        teachBackStatus,
        educationNotes: clampString(educationNotes, 300),
      },
      section6: {
        reinfusionDone,
        hemostasisDone,
        bleedingStopMinutes: clampString(bleedingStopMinutes, 20),
        postPulse: clampString(postPulse, 20),
        postResp: clampString(postResp, 20),
        postTemp: clampString(postTemp, 20),
        postSpo2: clampString(postSpo2, 20),
        wasteDecontaminated,
        machineDisinfectionType,
        handoverSummary: clampString(submissionNote.trim() || handoverSummary, 300),
        ktv: clampString(ktv, 20),
      },
      section7: {
        transfusionGiven,
        transfusionComponent: transfusionGiven
          ? clampString(transfusionComponent || 'PRC (Packed Red Cell)', 60)
          : '',
        transfusionBloodGroup: transfusionGiven ? clampString(transfusionBloodGroup, 10) : '',
        transfusionBagCount: transfusionGiven ? clampString(transfusionBagCount || '1', 10) : '',
        transfusionVolumeMl: transfusionGiven ? clampString(transfusionVolumeMl, 20) : '',
        transfusionBagNumber: transfusionGiven ? clampString(transfusionBagNumber, 60) : '',
        transfusionReaction: transfusionGiven
          ? clampString(transfusionReaction || 'Tidak Ada Reaksi', 60)
          : '',
        transfusionNote: transfusionGiven ? clampString(transfusionNote, 300) : '',
        epoGiven,
        epoPreparation: epoGiven ? clampString(epoPreparation || 'Epoetin Alfa', 80) : '',
        epoDose: epoGiven ? clampString(epoDose, 40) : '',
        epoRoute: epoGiven ? clampString(epoRoute || 'Subkutan (SC)', 40) : '',
        epoNote: epoGiven ? clampString(epoNote, 300) : '',
      },
      spoChecklist,
      ...(Object.keys(sanitizeCustomResponses(customResponses)).length > 0
        ? { customResponses: sanitizeCustomResponses(customResponses) }
        : {}),
    };

    const derivedCategory =
      patientCategory && patientCategory !== 'Reguler'
        ? patientCategory
        : actionCategory || 'HD Reguler';

    const resolvedHandover = submissionNote.trim() || handoverSummary;
    const safeStartTime = clampString(startTime.trim() || '07:30', 10) || '07:30';
    const safeEndTime = clampString(endTime.trim() || '12:00', 10) || '12:00';
    const safePreBp = clampString(resolvedPreBp, 20);
    const safePostBp = clampString(postBp.trim(), 20);

    const normalizedSpoChecklist: Record<string, SpoCheckStatus> = {};
    for (const pt of activeSpoPoints) {
      normalizedSpoChecklist[pt.id] =
        spoChecklist[pt.id] === 'DIKERJAKAN' ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN';
    }
    for (const [k, v] of Object.entries(spoChecklist)) {
      if (!(k in normalizedSpoChecklist) && Object.keys(normalizedSpoChecklist).length < 120) {
        normalizedSpoChecklist[k] = v === 'DIKERJAKAN' ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN';
      }
    }
    wizardDetails.spoChecklist = normalizedSpoChecklist;

    const allowedVascular: VascularAccessType[] = [
      'AV Shunt',
      'AV Fistula',
      'CDL',
      'Femoral',
      'AVG',
      'CVC',
    ];
    const safeVascularAccess: VascularAccessType = allowedVascular.includes(vascularAccess)
      ? vascularAccess
      : 'AV Fistula';
    const allowedHeparin = ['Standar', 'Minimal', 'Bebas Heparin', 'Heparin', 'LMWH'] as const;
    const safeHeparinType = (allowedHeparin as readonly string[]).includes(anticoagulantType)
      ? anticoagulantType
      : 'Heparin';
    const safeShift: ShiftType =
      shift === 'Siang' || shift === 'Malam' ? shift : 'Pagi';
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayDateStr();
    const safeTargetVerifierRole: 'PJ Shift' | 'Kepala Ruang' = isSubmitterKaru
      ? 'PJ Shift'
      : targetVerifierRole === 'PJ Shift'
      ? 'PJ Shift'
      : 'Kepala Ruang';

    const payload = {
      patientId: pat.id,
      patientName: clampString(pat.fullName, 120) || 'Pasien HD',
      patientRm: clampString(pat.mrn || '', 40),
      machineId: mach.id,
      machineNumber: clampString(mach.machineNumber, 40) || 'HD',
      doctorId: docObj.id,
      doctorName: clampString(docObj.fullName, 120) || 'Dokter DPJP',
      dutyDoctorId: clampString(dutyDoctorId || '', 128),
      dutyDoctorName: clampString(resolvedDutyDoctorName || '', 120),
      actionCategory: clampString(derivedCategory, 80) || 'HD Reguler',
      date: safeDate,
      monthKey: safeDate.slice(0, 7),
      shift: safeShift,
      startTime: safeStartTime,
      endTime: safeEndTime,
      preWeight: Math.min(300, Math.max(0, Number(preWeight) || 0)),
      postWeight: Math.min(300, Math.max(0, Number(postWeight) || 0)),
      preBp: safePreBp,
      postBp: safePostBp,
      ufGoal: Math.min(10000, Math.max(0, Number(ufGoal) || 0)),
      ufAchieved: Math.min(10000, Math.max(0, Number(ufAchieved) || 0)),
      vascularAccess: safeVascularAccess,
      heparinType: safeHeparinType,
      complications: clampString(complications || 'Tidak ada', 300),
      nursingNotes: clampString(
        submissionNote.trim() ||
          nursingNotes.trim() ||
          `[Draft] Tindakan HD ${pat.fullName}, akses ${safeVascularAccess}, timbang terima: ${resolvedHandover}`,
        1000
      ),
      verificationStatus: submitStatus,
      targetVerifierRole: safeTargetVerifierRole,
      targetVerifierId: clampString(selectedVerifier?.uid || '', 128),
      targetVerifierName: clampString(selectedVerifier?.fullName || safeTargetVerifierRole, 120),
      wizardDetails,
    };

    setSaving(true);
    if (keepOpen) {
      setAutoSaveInfo((prev) => ({ ...prev, status: 'saving' }));
    }
    let txOp: OperationType = currentEntry ? OperationType.UPDATE : OperationType.CREATE;
    let txPath = currentEntry ? `logbook/${currentEntry.id}` : 'logbook';
    const queuedTxOps: string[] = [];
    let createdDraftLogId: string | null = null;
    let createdPatientLockId: string | null = null;
    let createdMachineLockId: string | null = null;
    const isAdminRole = userProfile.role === 'Administrator';
    const isVerifierRole =
      userProfile.role === 'Kepala Ruang' ||
      userProfile.role === 'PJ Shift';
    let canVerifierEditCurrent = false;
    try {
      const monthKey = safeDate.slice(0, 7);
      const newMachineLockId = `${safeDate}_${safeShift}_${mach.id}`;
      const oldMachineLockId = currentEntry
        ? `${currentEntry.date}_${currentEntry.shift}_${currentEntry.machineId}`
        : '';
      const safeLockPatientName = clampString(pat.fullName, 120) || 'Pasien HD';
      const safeLockNurseName = clampString(userProfile.fullName, 120) || 'Perawat HD';
      const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));
      const savedDocId = currentEntry ? currentEntry.id : generateRecordId();
      const oldMachineLockIdToDelete =
        oldMachineLockId && oldMachineLockId !== newMachineLockId ? oldMachineLockId : null;

      let newPatientLockId: string | null = null;
      let oldPatientLockIdToDelete: string | null = null;
      if (currentEntry) {
        const oldLockId = `${currentEntry.date}_${currentEntry.patientId}`;
        const newLockId = `${safeDate}_${pat.id}`;
        if (oldLockId !== newLockId) {
          newPatientLockId = newLockId;
          oldPatientLockIdToDelete = oldLockId;
        }
      } else {
        newPatientLockId = `${safeDate}_${pat.id}`;
      }

      const safeMachineNumber = clampString(mach.machineNumber, 40) || 'HD';
      const localMatchingMachineLock =
        currentEntry && oldMachineLockId === newMachineLockId
          ? machineLocks.find(
              (ml) =>
                ml.id === newMachineLockId &&
                ml.logbookId === currentEntry.id &&
                ml.patientId === pat.id &&
                ml.machineId === mach.id &&
                ml.machineNumber === safeMachineNumber &&
                ml.date === safeDate &&
                ml.shift === safeShift &&
                Boolean(ml.createdAt) &&
                Boolean(ml.updatedAt) &&
                (isAdminRole ||
                  isVerifierRole ||
                  ml.nurseId === userProfile.uid)
            )
          : undefined;
      const skipRedundantMachineLockSync = Boolean(localMatchingMachineLock);

      // Preflight conflict checks in parallel before mutating logbook
      const [prePatientLockRow, preMachineLockRow] = await Promise.all([
        newPatientLockId ? getRowByColumn('logbook_locks', 'id', newPatientLockId) : Promise.resolve(null),
        skipRedundantMachineLockSync ? Promise.resolve(null) : getRowByColumn('machine_locks', 'id', newMachineLockId),
      ]);

      if (newPatientLockId && prePatientLockRow) {
        txOp = OperationType.GET;
        txPath = `logbook_locks/${newPatientLockId}`;
        const plData = mapLogbookLockRow(prePatientLockRow);
        const sameEntry = Boolean(currentEntry && plData.logbookId === currentEntry.id);
        const canCheckOrphan = Boolean(
          isAdminRole || plData.nurseId === userProfile.uid || (currentEntry && isVerifierRole)
        );
        const knownOrphan = Boolean(
          canCheckOrphan && plData.logbookId && !existingLogbookIds.has(plData.logbookId)
        );
        if (!sameEntry && !knownOrphan) {
          throw new Error(`PATIENT_LOCKED:${plData.nurseName || 'staf lain'}`);
        }
        if (!sameEntry && knownOrphan) {
          await deleteRowByColumn('logbook_locks', 'id', newPatientLockId).catch(() => undefined);
        }
      }

      if (!skipRedundantMachineLockSync && preMachineLockRow) {
        txOp = OperationType.GET;
        txPath = `machine_locks/${newMachineLockId}`;
        const lockData = mapMachineLockRow(preMachineLockRow);
        const ownedByCurrent = lockData.nurseId === userProfile.uid;
        const matchesThisSlot =
          (currentEntry && lockData.logbookId === currentEntry.id) ||
          (!lockData.logbookId && lockData.patientId === pat.id);
        const canCheckOrphan = Boolean(
          isAdminRole || ownedByCurrent || (currentEntry && isVerifierRole)
        );
        const knownOrphan = Boolean(
          canCheckOrphan && lockData.logbookId && !existingLogbookIds.has(lockData.logbookId)
        );
        if (
          !(ownedByCurrent && matchesThisSlot) &&
          !(
            (isAdminRole || (currentEntry && isVerifierRole)) &&
            currentEntry &&
            lockData.logbookId === currentEntry.id
          ) &&
          !knownOrphan
        ) {
          throw new Error(`MACHINE_LOCKED:${lockData.nurseName || 'staf lain'}`);
        }
      }

      let entryOwnerId = userProfile.uid;
      let entryOwnerName = safeLockNurseName;

      // Phase 1: Write logbook entry (new entries start as Draft so rollback delete is always permitted)
      const initialCreateStatus = currentEntry ? submitStatus : 'Draft';
      if (currentEntry) {
        txOp = OperationType.GET;
        txPath = `logbook/${savedDocId}`;
        const existingLogRow = await getRowByColumn('logbook', 'id', savedDocId);
        if (!existingLogRow) {
          throw new Error('LOGBOOK_MISSING');
        }
        const currentLogData = mapLogbookRow(existingLogRow);
        const currentStatus = currentLogData.verificationStatus;
        canVerifierEditCurrent =
          isVerifierRole &&
          currentLogData.nurseId !== userProfile.uid &&
          (currentStatus === 'Pending' || currentStatus === 'Revision');

        if (
          !isAdminRole &&
          !canVerifierEditCurrent &&
          currentLogData.nurseId !== userProfile.uid
        ) {
          throw new Error('LOGBOOK_NOT_OWNER');
        }
        if (
          !isAdminRole &&
          currentStatus !== 'Draft' &&
          currentStatus !== 'Revision' &&
          !canVerifierEditCurrent
        ) {
          throw new Error(`LOGBOOK_LOCKED:${currentStatus || 'Pending'}`);
        }

        if (typeof currentLogData.nurseId === 'string' && currentLogData.nurseId) {
          entryOwnerId = currentLogData.nurseId;
        }
        if (typeof currentLogData.nurseName === 'string' && currentLogData.nurseName.trim()) {
          entryOwnerName = clampString(currentLogData.nurseName, 120) || safeLockNurseName;
        }

        txOp = OperationType.UPDATE;
        txPath = `logbook/${savedDocId}`;
        const updateData: Partial<LogbookEntry> = { ...payload };
        if (typeof currentLogData.nurseNip !== 'string' || currentLogData.nurseNip.length > 40) {
          updateData.nurseNip = clampString(
            typeof currentLogData.nurseNip === 'string'
              ? currentLogData.nurseNip
              : currentLogData.nurseId === userProfile.uid
              ? userProfile.nip || ''
              : '',
            40
          );
        }
        if (
          typeof currentLogData.nurseName !== 'string' ||
          currentLogData.nurseName.trim().length === 0 ||
          currentLogData.nurseName.length > 120
        ) {
          updateData.nurseName = entryOwnerName;
        }
        await updateRowByColumn('logbook', 'id', savedDocId, toLogbookRow(updateData));
      } else {
        txOp = OperationType.CREATE;
        txPath = `logbook/${savedDocId}`;
        await insertRow(
          'logbook',
          toLogbookRow({
            id: savedDocId,
            ...payload,
            verificationStatus: initialCreateStatus,
            nurseId: userProfile.uid,
            nurseName: safeLockNurseName,
            nurseNip: clampString(userProfile.nip || '', 40),
          })
        );
        createdDraftLogId = savedDocId;
      }
      queuedTxOps.push(`${currentEntry ? 'update' : 'create'}:logbook/${savedDocId}`);

      // Phase 2 & Phase 3: Claim / update patient daily lock and machine slot lock in parallel
      const runPatientLockPhase = async () => {
        if (!newPatientLockId) return;
        txOp = OperationType.GET;
        txPath = `logbook_locks/${newPatientLockId}`;
        const existingPLRow = await getRowByColumn('logbook_locks', 'id', newPatientLockId);

        let shouldDeleteOrphanFirst = false;
        if (existingPLRow) {
          const plData = mapLogbookLockRow(existingPLRow);
          const sameEntry = Boolean(
            (currentEntry && plData.logbookId === currentEntry.id) ||
              plData.logbookId === savedDocId
          );
          const knownOrphan = Boolean(
            (isAdminRole || plData.nurseId === userProfile.uid || canVerifierEditCurrent) &&
              plData.logbookId &&
              !existingLogbookIds.has(plData.logbookId)
          );
          if (!sameEntry && !knownOrphan) {
            throw new Error(`PATIENT_LOCKED:${plData.nurseName || 'staf lain'}`);
          }
          shouldDeleteOrphanFirst =
            knownOrphan &&
            plData.nurseId !== entryOwnerId &&
            !isAdminRole &&
            !isVerifierRole;
        }

        const patientLockRow = toLogbookLockRow({
          id: newPatientLockId,
          date: safeDate,
          monthKey,
          patientId: pat.id,
          patientName: safeLockPatientName,
          nurseId: entryOwnerId,
          nurseName: entryOwnerName,
          logbookId: savedDocId,
        });

        if (shouldDeleteOrphanFirst) {
          await deleteRowByColumn('logbook_locks', 'id', newPatientLockId);
        }

        const patientLockOpMode: 'create' | 'update' =
          existingPLRow && !shouldDeleteOrphanFirst ? 'update' : 'create';
        txOp = patientLockOpMode === 'update' ? OperationType.UPDATE : OperationType.CREATE;
        txPath = `logbook_locks/${newPatientLockId}`;

        if (patientLockOpMode === 'update') {
          await upsertRow('logbook_locks', patientLockRow, 'id');
        } else {
          try {
            await insertRow('logbook_locks', patientLockRow);
            createdPatientLockId = newPatientLockId;
          } catch (insertErr) {
            if (isDuplicateKeyError(insertErr)) {
              const raced = await getRowByColumn('logbook_locks', 'id', newPatientLockId).catch(() => null);
              const lockerName =
                typeof raced?.nurse_name === 'string' && raced.nurse_name.trim()
                  ? raced.nurse_name
                  : 'staf lain';
              throw new Error(`PATIENT_LOCKED:${lockerName}`);
            }
            throw insertErr;
          }
        }
        queuedTxOps.push(`${patientLockOpMode}:logbook_locks/${newPatientLockId}`);
      };

      const runMachineLockPhase = async () => {
        if (skipRedundantMachineLockSync) return;
        let machineLockOpMode: 'create' | 'update' | 'skip' = 'skip';
        txOp = OperationType.GET;
        txPath = `machine_locks/${newMachineLockId}`;
        const existingMLRow = await getRowByColumn('machine_locks', 'id', newMachineLockId);

        if (existingMLRow) {
          const existingML = mapMachineLockRow(existingMLRow);
          const ownedByCurrent = existingML.nurseId === userProfile.uid;
          const matchesThisSlot =
            (currentEntry && existingML.logbookId === currentEntry.id) ||
            existingML.logbookId === savedDocId ||
            (!existingML.logbookId && existingML.patientId === pat.id);
          const knownOrphan = Boolean(
            (isAdminRole || ownedByCurrent || canVerifierEditCurrent) &&
              existingML.logbookId &&
              !existingLogbookIds.has(existingML.logbookId)
          );
          if (
            !(ownedByCurrent && matchesThisSlot) &&
            !(
              (isAdminRole || canVerifierEditCurrent) &&
              currentEntry &&
              existingML.logbookId === currentEntry.id
            ) &&
            !knownOrphan
          ) {
            throw new Error(`MACHINE_LOCKED:${existingML.nurseName || 'staf lain'}`);
          }

          const sameOwner = existingML.nurseId === entryOwnerId;
          const isOrphanReclaim =
            Boolean(existingML.logbookId) &&
            !existingLogbookIds.has(existingML.logbookId);
          const preserveOtherOwner =
            !sameOwner && (isAdminRole || canVerifierEditCurrent) && !isOrphanReclaim;
          const targetLockNurseId =
            preserveOtherOwner && existingML.nurseId ? existingML.nurseId : entryOwnerId;
          const targetLockNurseName =
            preserveOtherOwner && existingML.nurseName
              ? clampString(existingML.nurseName, 120) || entryOwnerName
              : entryOwnerName;

          const lockAlreadyMatches =
            Boolean(existingML.createdAt) &&
            Boolean(existingML.updatedAt) &&
            existingML.id === newMachineLockId &&
            existingML.date === safeDate &&
            existingML.monthKey === monthKey &&
            existingML.shift === safeShift &&
            existingML.machineId === mach.id &&
            existingML.machineNumber === safeMachineNumber &&
            existingML.patientId === pat.id &&
            existingML.patientName === safeLockPatientName &&
            existingML.nurseId === targetLockNurseId &&
            existingML.nurseName === targetLockNurseName &&
            existingML.logbookId === savedDocId;

          if (!lockAlreadyMatches) {
            const machineLockRow = toMachineLockRow({
              id: newMachineLockId,
              date: safeDate,
              monthKey,
              shift: safeShift,
              machineId: mach.id,
              machineNumber: safeMachineNumber,
              patientId: pat.id,
              patientName: safeLockPatientName,
              nurseId: targetLockNurseId,
              nurseName: targetLockNurseName,
              logbookId: savedDocId,
            });
            const deleteOrphanFirst =
              isOrphanReclaim &&
              existingML.nurseId !== targetLockNurseId &&
              !isAdminRole &&
              !isVerifierRole;
            if (deleteOrphanFirst) {
              await deleteRowByColumn('machine_locks', 'id', newMachineLockId);
              machineLockOpMode = 'create';
              txOp = OperationType.CREATE;
              txPath = `machine_locks/${newMachineLockId}`;
              try {
                await insertRow('machine_locks', machineLockRow);
                createdMachineLockId = newMachineLockId;
              } catch (insertErr) {
                if (isDuplicateKeyError(insertErr)) {
                  const raced = await getRowByColumn('machine_locks', 'id', newMachineLockId).catch(() => null);
                  const lockerName =
                    typeof raced?.nurse_name === 'string' && raced.nurse_name.trim()
                      ? raced.nurse_name
                      : 'staf lain';
                  throw new Error(`MACHINE_LOCKED:${lockerName}`);
                }
                throw insertErr;
              }
            } else {
              machineLockOpMode = 'update';
              txOp = OperationType.UPDATE;
              txPath = `machine_locks/${newMachineLockId}`;
              await upsertRow('machine_locks', machineLockRow, 'id');
            }
          } else {
            machineLockOpMode = 'skip';
          }
        } else {
          machineLockOpMode = 'create';
          txOp = OperationType.CREATE;
          txPath = `machine_locks/${newMachineLockId}`;
          try {
            await insertRow(
              'machine_locks',
              toMachineLockRow({
                id: newMachineLockId,
                date: safeDate,
                monthKey,
                shift: safeShift,
                machineId: mach.id,
                machineNumber: safeMachineNumber,
                patientId: pat.id,
                patientName: safeLockPatientName,
                nurseId: entryOwnerId,
                nurseName: entryOwnerName,
                logbookId: savedDocId,
              })
            );
            createdMachineLockId = newMachineLockId;
          } catch (insertErr) {
            if (isDuplicateKeyError(insertErr)) {
              const raced = await getRowByColumn('machine_locks', 'id', newMachineLockId).catch(() => null);
              const lockerName =
                typeof raced?.nurse_name === 'string' && raced.nurse_name.trim()
                  ? raced.nurse_name
                  : 'staf lain';
              throw new Error(`MACHINE_LOCKED:${lockerName}`);
            }
            throw insertErr;
          }
        }

        if (machineLockOpMode !== 'skip') {
          queuedTxOps.push(`${machineLockOpMode}:machine_locks/${newMachineLockId}`);
        }
      };

      await Promise.all([runPatientLockPhase(), runMachineLockPhase()]);

      if (oldPatientLockIdToDelete || oldMachineLockIdToDelete) {
        await Promise.all([
          (async () => {
            if (!oldPatientLockIdToDelete) return;
            const oldPatientLockRow = await getRowByColumn('logbook_locks', 'id', oldPatientLockIdToDelete).catch(() => null);
            if (oldPatientLockRow) {
              const oldPL = mapLogbookLockRow(oldPatientLockRow);
              if (isAdminRole || canVerifierEditCurrent || oldPL.nurseId === userProfile.uid) {
                txOp = OperationType.DELETE;
                txPath = `logbook_locks/${oldPatientLockIdToDelete}`;
                queuedTxOps.push(`delete:${txPath}`);
                await deleteRowByColumn('logbook_locks', 'id', oldPatientLockIdToDelete);
              }
            }
          })(),
          (async () => {
            if (!oldMachineLockIdToDelete) return;
            const oldMachineLockRow = await getRowByColumn('machine_locks', 'id', oldMachineLockIdToDelete).catch(() => null);
            if (oldMachineLockRow) {
              const oldML = mapMachineLockRow(oldMachineLockRow);
              if (isAdminRole || canVerifierEditCurrent || oldML.nurseId === userProfile.uid) {
                txOp = OperationType.DELETE;
                txPath = `machine_locks/${oldMachineLockIdToDelete}`;
                queuedTxOps.push(`delete:${txPath}`);
                await deleteRowByColumn('machine_locks', 'id', oldMachineLockIdToDelete);
              }
            }
          })(),
        ]);
      }

      // Phase 4: If newly created entry should be submitted immediately, promote Draft -> Pending
      if (!currentEntry && submitStatus === 'Pending') {
        txOp = OperationType.UPDATE;
        txPath = `logbook/${savedDocId}`;
        await updateRowByColumn(
          'logbook',
          'id',
          savedDocId,
          toLogbookRow({ verificationStatus: 'Pending' })
        );
        queuedTxOps.push(`promote:logbook/${savedDocId}`);
      }

      // All phases committed cleanly; disarm rollback
      createdDraftLogId = null;
      createdPatientLockId = null;
      createdMachineLockId = null;

      const savedOwnerId = entryOwnerId;
      const savedOwnerName = entryOwnerName;
      const tracked: TrackedWizardEntry = {
        id: savedDocId,
        date: safeDate,
        shift: safeShift,
        machineId: mach.id,
        patientId: pat.id,
        verificationStatus: submitStatus,
        nurseId: savedOwnerId,
        nurseName: savedOwnerName,
      };
      if (!editingEntry) {
        autoSavedEntryRef.current = tracked;
        setAutoSavedEntry(tracked);
      }

      if (keepOpen) {
        const nowTime = new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setAutoSaveInfo({
          status: 'saved',
          timeLabel: nowTime,
          docStatus: submitStatus === 'Revision' ? 'Revision' : 'Draft',
        });
        onSaved?.();
        return 'saved';
      }

      onSaved?.();
      onClose();
      return 'saved';
    } catch (err) {
      if (createdMachineLockId) {
        await deleteRowByColumn('machine_locks', 'id', createdMachineLockId).catch(() => undefined);
      }
      if (createdPatientLockId) {
        await deleteRowByColumn('logbook_locks', 'id', createdPatientLockId).catch(() => undefined);
      }
      if (createdDraftLogId) {
        await deleteRowByColumn('logbook', 'id', createdDraftLogId).catch(() => undefined);
      }
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('MACHINE_LOCKED:')) {
        const lockerName = msg.replace('MACHINE_LOCKED:', '').trim() || 'staf lain';
        setErrorMsg(
          `Mesin / Bed HD ${mach.machineNumber} pada Shift ${safeShift} tanggal ${safeDate} baru saja dipilih oleh ${lockerName}.`
        );
      } else if (msg.startsWith('PATIENT_LOCKED:')) {
        const lockerName = msg.replace('PATIENT_LOCKED:', '').trim() || 'staf lain';
        setErrorMsg(
          `Pasien ${pat.fullName} pada tanggal ${safeDate} sudah diinput logbooknya oleh ${lockerName}.`
        );
      } else if (msg === 'LOGBOOK_MISSING') {
        setErrorMsg('Entri logbook tidak ditemukan atau sudah dihapus sebelumnya.');
      } else if (msg === 'LOGBOOK_NOT_OWNER') {
        setErrorMsg('Anda tidak memiliki izin mengubah entri logbook milik perawat lain.');
      } else if (msg.startsWith('LOGBOOK_LOCKED:')) {
        const statusLabel = msg.replace('LOGBOOK_LOCKED:', '').trim();
        setErrorMsg(
          `Entri logbook ini sudah berstatus ${statusLabel} sehingga terkunci dan tidak dapat diubah lagi.`
        );
      } else if (isTransientDbError(err)) {
        setErrorMsg(
          'Koneksi ke server Supabase sedang terputus atau sibuk sementara. Data Anda tetap aman — silakan klik Simpan & Lanjut kembali.'
        );
      } else {
        console.error('Logbook save failed:', {
          projectId: SUPABASE_PROJECT_ID,
          lastOp: txOp,
          lastPath: txPath,
          queuedTxOps,
          role: userProfile.role,
          isEdit: Boolean(currentEntry),
          submitStatus,
          err,
        });
        const friendlyMsg = getUserFriendlyDbError(
          err,
          `Gagal menyimpan logbook (${txOp} pada ${txPath}). Silakan muat ulang halaman dan coba lagi.`
        );
        if (isPermissionDeniedError(err)) {
          setErrorMsg(
            `${friendlyMsg} (Peran: ${userProfile.role}, status target: ${submitStatus}).`
          );
        } else {
          setErrorMsg(friendlyMsg);
        }
        if (keepOpen) {
          setAutoSaveInfo((prev) => ({ ...prev, status: prev.timeLabel ? 'saved' : 'idle' }));
        }
        formatDbError(err, txOp, txPath);
      }
      if (keepOpen) {
        setAutoSaveInfo((prev) => ({ ...prev, status: prev.timeLabel ? 'saved' : 'idle' }));
      }
      return 'error';
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchStep = async (
    targetStep: number,
    options?: { validateCurrent?: boolean }
  ) => {
    if (targetStep === step || saving) return;
    setErrorMsg(null);

    if (options?.validateCurrent) {
      const err = validateStep(step);
      if (err) {
        setErrorMsg(err);
        return;
      }
    }

    if (!readOnly && !isVerifierEdit) {
      const activeForAccess = editingEntry || autoSavedEntryRef.current;
      const switchAccess = getLogbookSubmissionAccess(date, shift, activeForAccess, Date.now());
      const revisionLocked =
        activeForAccess?.verificationStatus === 'Revision' && !switchAccess.canEditRevision;
      if (!revisionLocked) {
        const result = await handleSave(getAutoDraftStatus(), {
          keepOpen: true,
          silentIfNotReady: true,
        });
        if (result === 'error') {
          return;
        }
      }
    }

    setStep(targetStep);
  };

  const renderTtvAndCustomFields = (
    responseKey: string,
    config?: {
      enableTtv?: boolean;
      ttvConfig?: TtvSubFieldsConfig;
      customFields?: CustomLogbookField[];
    }
  ): React.ReactNode => {
    const showTtv = Boolean(config?.enableTtv);
    const customFields = config?.customFields || [];
    if (!showTtv && customFields.length === 0) return null;

    const currentTtv = customResponses[responseKey]?.ttv || {};
    const currentFields = customResponses[responseKey]?.fields || {};
    const ttvCfg = { ...DEFAULT_TTV_CONFIG, ...(config?.ttvConfig || {}) };

    return (
      <div className="space-y-3">
        {showTtv && (
          <div className="rounded-lg border border-sky-200/80 bg-sky-50/40 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#0e4e78]">
              <Activity className="h-3.5 w-3.5" />
              <span>Penginputan Tanda-Tanda Vital (TTV)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {ttvCfg.td && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                    Tekanan Darah (mmHg)
                  </label>
                  <input
                    type="text"
                    value={currentTtv.td || ''}
                    disabled={readOnly}
                    onChange={(e) => updatePointTtv(responseKey, 'td', e.target.value)}
                    placeholder="cth: 120/80"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>
              )}
              {ttvCfg.nadi && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                    Nadi (x/mnt)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={currentTtv.nadi || ''}
                    disabled={readOnly}
                    onChange={(e) => updatePointTtv(responseKey, 'nadi', e.target.value)}
                    placeholder="cth: 82"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>
              )}
              {ttvCfg.rr && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                    Napas / RR (x/mnt)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={currentTtv.rr || ''}
                    disabled={readOnly}
                    onChange={(e) => updatePointTtv(responseKey, 'rr', e.target.value)}
                    placeholder="cth: 20"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>
              )}
              {ttvCfg.suhu && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                    Suhu (°C)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={currentTtv.suhu || ''}
                    disabled={readOnly}
                    onChange={(e) => updatePointTtv(responseKey, 'suhu', e.target.value)}
                    placeholder="cth: 36.6"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>
              )}
              {ttvCfg.spo2 && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                    SpO₂ (%)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={currentTtv.spo2 || ''}
                    disabled={readOnly}
                    onChange={(e) => updatePointTtv(responseKey, 'spo2', e.target.value)}
                    placeholder="cth: 98"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {customFields.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {customFields.map((fld) => {
                const rawVal = currentFields[fld.id];
                if (fld.type === 'checkbox') {
                  const checked = Boolean(rawVal);
                  return (
                    <label
                      key={fld.id}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        readOnly ? 'cursor-default' : 'cursor-pointer'
                      } ${
                        checked
                          ? 'border-emerald-400 bg-emerald-50/70 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly}
                        onChange={(e) =>
                          updatePointCustomField(responseKey, fld.id, e.target.checked)
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>
                        {fld.label}
                        {fld.required && <span className="text-rose-600"> *</span>}
                      </span>
                    </label>
                  );
                }

                if (fld.type === 'textarea') {
                  return (
                    <div key={fld.id} className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        {fld.label}
                        {fld.unit && <span className="text-slate-400 font-normal"> ({fld.unit})</span>}
                        {fld.required && <span className="text-rose-600"> *</span>}
                      </label>
                      <textarea
                        rows={2}
                        disabled={readOnly}
                        value={typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : ''}
                        onChange={(e) => updatePointCustomField(responseKey, fld.id, e.target.value)}
                        placeholder={fld.placeholder || ''}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                  );
                }

                if (fld.type === 'select') {
                  return (
                    <div key={fld.id}>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        {fld.label}
                        {fld.required && <span className="text-rose-600"> *</span>}
                      </label>
                      <select
                        disabled={readOnly}
                        value={typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : ''}
                        onChange={(e) => updatePointCustomField(responseKey, fld.id, e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                      >
                        <option value="">-- Pilih --</option>
                        {(fld.options || []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                return (
                  <div key={fld.id}>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {fld.label}
                      {fld.required && <span className="text-rose-600"> *</span>}
                    </label>
                    <div className="relative">
                      <input
                        type={fld.type === 'number' ? 'number' : 'text'}
                        step={fld.type === 'number' ? 'any' : undefined}
                        disabled={readOnly}
                        value={typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : ''}
                        onChange={(e) => {
                          if (fld.type === 'number') {
                            const raw = e.target.value;
                            if (raw === '') {
                              updatePointCustomField(responseKey, fld.id, '');
                            } else {
                              const parsed = Number(raw);
                              updatePointCustomField(
                                responseKey,
                                fld.id,
                                Number.isNaN(parsed) ? raw : parsed
                              );
                            }
                          } else {
                            updatePointCustomField(responseKey, fld.id, e.target.value);
                          }
                        }}
                        placeholder={fld.placeholder || ''}
                        className={`w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none ${
                          fld.unit ? 'pl-3 pr-14' : 'px-3'
                        }`}
                      />
                      {fld.unit && (
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                          {fld.unit}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBuiltInPointFooter = (pointId: string): React.ReactNode => {
    switch (pointId) {
      case '2.1':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs font-bold tracking-wide uppercase cursor-pointer transition-colors ${
                handHygieneChecked
                  ? 'border-emerald-400 bg-emerald-50/70 text-emerald-800'
                  : 'border-slate-200 bg-slate-50/50 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={handHygieneChecked}
                onChange={(e) => toggleHandHygieneSubCheck(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <Hand
                className={`h-4 w-4 shrink-0 ${
                  handHygieneChecked ? 'text-emerald-600' : 'text-[#0e4e78]'
                }`}
              />
              <span>HAND HYGIENE</span>
            </label>

            <label
              className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs font-bold tracking-wide uppercase cursor-pointer transition-colors ${
                apdUsedChecked
                  ? 'border-emerald-400 bg-emerald-50/70 text-emerald-800'
                  : 'border-slate-200 bg-slate-50/50 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={apdUsedChecked}
                onChange={(e) => toggleApdSubCheck(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <ShieldCheck
                className={`h-4 w-4 shrink-0 ${
                  apdUsedChecked ? 'text-emerald-600' : 'text-[#0e4e78]'
                }`}
              />
              <span>PENGGUNAAN APD</span>
            </label>
          </div>
        );

      case '3.1':
        return (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Status Pelayanan */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0e4e78]" />
                    STATUS PELAYANAN
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      serviceStatus ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {serviceStatus ? 'TERPILIH' : 'BELUM DIPILIH'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {(['Rawat Jalan', 'Rawat Inap'] as const).map((statusOption) => {
                    const checked = serviceStatus === statusOption;
                    return (
                      <label
                        key={statusOption}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          readOnly ? 'cursor-default' : 'cursor-pointer'
                        } ${
                          checked
                            ? 'border-[#0B4A75] bg-[#0B4A75] text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={readOnly}
                          onChange={() =>
                            updatePoint31Selection(
                              checked ? '' : statusOption,
                              patientCategory
                            )
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78] accent-white focus:ring-[#0e4e78]"
                        />
                        <span>{statusOption.toUpperCase()}</span>
                      </label>
                    );
                  })}
                </div>

                {serviceStatus === 'Rawat Inap' && (
                  <div className="space-y-3 border-t border-slate-200/80 pt-3">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                          <Building2 className="h-3.5 w-3.5 text-slate-500" />
                          Nama Bangsal / Ruang Rawat Inap:
                        </span>
                        <span
                          className={`text-[10px] font-bold ${
                            inpatientWard ? 'text-emerald-700' : 'text-amber-600'
                          }`}
                        >
                          {inpatientWard ? inpatientWard : 'Wajib Dipilih'}
                        </span>
                      </div>
                      <select
                        value={inpatientWard}
                        disabled={readOnly}
                        onChange={(e) =>
                          updatePoint31Selection(
                            'Rawat Inap',
                            patientCategory,
                            e.target.value as 'CAMELIA' | 'DAHLIA' | 'ICU' | '',
                            citoStatus || 'Tidak'
                          )
                        }
                        className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold focus:outline-none ${
                          inpatientWard
                            ? 'border-slate-300 bg-white text-slate-900 focus:border-[#0B5A8E]'
                            : 'border-amber-400 bg-amber-50/40 text-slate-800 focus:border-amber-500'
                        }`}
                      >
                        <option value="">-- Pilih Nama Bangsal --</option>
                        <option value="CAMELIA">CAMELIA</option>
                        <option value="DAHLIA">DAHLIA</option>
                        <option value="ICU">ICU</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                          <AlertTriangle className="h-3.5 w-3.5 text-slate-600" />
                          Status CITO / Urgensi Pasien:
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide ${
                            (citoStatus || 'Tidak') === 'Ya'
                              ? 'text-rose-600'
                              : 'text-slate-500'
                          }`}
                        >
                          {(citoStatus || 'Tidak') === 'Ya'
                            ? 'CITO (URGENT)'
                            : 'BIASA (NON-CITO)'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            updatePoint31Selection(
                              'Rawat Inap',
                              patientCategory,
                              inpatientWard,
                              'Tidak'
                            )
                          }
                          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                            (citoStatus || 'Tidak') === 'Tidak'
                              ? 'border-[#0f172a] bg-[#0f172a] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          Tidak (Elektif)
                        </button>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            updatePoint31Selection(
                              'Rawat Inap',
                              patientCategory,
                              inpatientWard,
                              'Ya'
                            )
                          }
                          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                            citoStatus === 'Ya'
                              ? 'border-rose-600 bg-rose-600 text-white'
                              : 'border-rose-300 bg-white text-rose-600 hover:bg-rose-50'
                          }`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Ya (CITO)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Kategori Pasien */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    KATEGORI PASIEN
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      patientCategory ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {patientCategory ? patientCategory.toUpperCase() : 'BELUM DIPILIH'}
                  </span>
                </div>
                <div className="space-y-2">
                  {(
                    [
                      {
                        value: 'Reguler',
                        label: 'REGULER',
                        hint: 'Pasien HD non-isolasi',
                      },
                      {
                        value: 'Isolasi Hepatitis B',
                        label: 'ISOLASI HEPATITIS B',
                        hint: 'HBsAg (+), mesin & ruang terpisah',
                      },
                      {
                        value: 'Isolasi Hepatitis C/HIV',
                        label: 'ISOLASI HEPATITIS C/HIV',
                        hint: 'Anti-HCV (+) atau HIV (+)',
                      },
                    ] as const
                  ).map((cat) => {
                    const checked = patientCategory === cat.value;
                    return (
                      <label
                        key={cat.value}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                          readOnly ? 'cursor-default' : 'cursor-pointer'
                        } ${
                          checked
                            ? 'border-emerald-400 bg-emerald-50/60 text-emerald-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2 font-bold uppercase tracking-wide">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={readOnly}
                            onChange={() =>
                              updatePoint31Selection(serviceStatus, checked ? '' : cat.value)
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>{cat.label}</span>
                        </span>
                        <span className="text-[11px] font-normal text-slate-400">{cat.hint}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-700">Catatan:</span> Identifikasi Pasien (
              {selectedPatient?.fullName || 'Pasien'}, RM: {selectedPatient?.mrn || '-'}
              {serviceStatus
                ? `, Status: ${serviceStatus.toUpperCase()}${
                    serviceStatus === 'Rawat Inap'
                      ? ` · Bangsal: ${inpatientWard || 'Belum dipilih'} · ${
                          (citoStatus || 'Tidak') === 'Ya' ? 'Ya (CITO)' : 'Tidak (Elektif)'
                        }`
                      : ''
                  }`
                : ''}
              ) —{' '}
              {isPoint31Complete(serviceStatus, patientCategory)
                ? `Kategori ${patientCategory}`
                : !serviceStatus
                ? 'Menunggu pilihan Status Pelayanan'
                : serviceStatus === 'Rawat Inap' && !inpatientWard
                ? 'Menunggu pilihan Nama Bangsal Rawat Inap'
                : 'Menunggu pilihan Kategori Pasien'}
            </div>

            {!isPoint31Complete(serviceStatus, patientCategory) && (
              <p className="text-[11px] font-medium text-amber-600">
                {serviceStatus === 'Rawat Inap' && !inpatientWard
                  ? 'Pilih Nama Bangsal Rawat Inap (CAMELIA, DAHLIA, atau ICU) dan Kategori Pasien agar Poin 3.1 otomatis bernilai DIKERJAKAN.'
                  : 'Pilih Status Pelayanan dan Kategori Pasien agar Poin 3.1 otomatis bernilai DIKERJAKAN.'}
              </p>
            )}
          </div>
        );

      case '3.2':
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Berat Badan Datang
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={preWeight}
                    onChange={(e) => updateWeightFields(e.target.value, postWeight, dryWeight)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    kg
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Berat Badan Pulang
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={postWeight}
                    onChange={(e) => updateWeightFields(preWeight, e.target.value, dryWeight)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    kg
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Berat Badan Kering
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={dryWeight}
                    onChange={(e) => updateWeightFields(preWeight, postWeight, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    kg
                  </span>
                </div>
              </div>
            </div>

            {/* Kalkulator IDWG Otomatis */}
            <div className="rounded-lg border border-sky-200/80 bg-sky-50/45 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Calculator className="h-3.5 w-3.5 text-[#0e4e78]" />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#0e4e78]">
                    Kalkulator IDWG Otomatis
                  </span>
                  <span className="text-[11px] text-slate-500">(BB Datang − BB Kering)</span>
                </div>

                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    idwgMetrics.categoryTone === 'emerald'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : idwgMetrics.categoryTone === 'amber'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : idwgMetrics.categoryTone === 'rose'
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {idwgMetrics.categoryLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Nilai IDWG (kg)
                  </span>
                  <span
                    className={`mt-0.5 block font-mono text-sm font-bold tabular-nums ${
                      !idwgMetrics.ready
                        ? 'text-slate-400'
                        : idwgMetrics.categoryTone === 'rose'
                        ? 'text-rose-700'
                        : idwgMetrics.categoryTone === 'amber'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {idwgMetrics.ready
                      ? `${idwgMetrics.idwgKg > 0 ? '+' : ''}${idwgMetrics.idwgKg.toFixed(2)} kg`
                      : '—'}
                  </span>
                </div>

                <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Persentase IDWG
                  </span>
                  <span
                    className={`mt-0.5 block font-mono text-sm font-bold tabular-nums ${
                      !idwgMetrics.ready
                        ? 'text-slate-400'
                        : idwgMetrics.categoryTone === 'rose'
                        ? 'text-rose-700'
                        : idwgMetrics.categoryTone === 'amber'
                        ? 'text-amber-700'
                        : 'text-[#0e4e78]'
                    }`}
                  >
                    {idwgMetrics.ready ? `${idwgMetrics.idwgPercent.toFixed(2)}%` : '—'}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    Target SPO ≤ 4% BB Kering
                  </span>
                </div>

                <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Estimasi UF Cairan
                    </span>
                    {!readOnly && idwgMetrics.ready && idwgMetrics.ufEstimateMl > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const val = String(idwgMetrics.ufEstimateMl);
                          setUfGoal(val);
                          syncPoint35Checklist(
                            dialysisDurationHours,
                            val,
                            bfr,
                            dfr,
                            loadingDose
                          );
                        }}
                        className="text-[10px] font-bold text-[#0B5A8E] hover:underline"
                      >
                        Isi ke UFG
                      </button>
                    )}
                  </div>
                  <span className="mt-0.5 block font-mono text-sm font-bold tabular-nums text-slate-800">
                    {idwgMetrics.ready
                      ? `${idwgMetrics.ufEstimateMl.toLocaleString('id-ID')} mL`
                      : '—'}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    Acuan target UFG (Poin 3.5)
                  </span>
                </div>

                <div className="rounded-md border border-slate-200/80 bg-white px-3 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Selisih Pre − Post HD
                  </span>
                  <span className="mt-0.5 block font-mono text-sm font-bold tabular-nums text-slate-800">
                    {idwgMetrics.weightLossKg !== null
                      ? `${idwgMetrics.weightLossKg.toFixed(2)} kg`
                      : '—'}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    Penurunan BB setelah HD
                  </span>
                </div>
              </div>
            </div>

            {!isPoint32Complete(preWeight, postWeight, dryWeight) && (
              <p className="text-[11px] font-medium text-amber-600">
                Wajib mengisi kolom Berat Badan Datang, Berat Badan Pulang, dan Berat Badan Kering agar Poin 3.2 bernilai DIKERJAKAN.
              </p>
            )}
          </div>
        );

      case '3.3':
        return (
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
              Tekanan Darah Pre HD (mmHg)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={systolicBp}
                onChange={(e) => updateSystolicDiastolic(e.target.value, diastolicBp)}
                placeholder="Sistolik"
                className="w-36 sm:w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
              />
              <span className="text-sm font-semibold text-slate-400">/</span>
              <input
                type="text"
                inputMode="numeric"
                value={diastolicBp}
                onChange={(e) => updateSystolicDiastolic(systolicBp, e.target.value)}
                placeholder="Diastolik"
                className="w-36 sm:w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
              />
              <span className="text-xs font-semibold text-slate-500">mmHg</span>
              {(!systolicBp.trim() || !diastolicBp.trim()) && (
                <span className="text-[11px] font-medium text-amber-600">
                  Wajib mengisi kedua kolom Sistolik dan Diastolik agar status ringkasan dikerjakan.
                </span>
              )}
            </div>
          </div>
        );

      case '3.5':
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Waktu Dialisis / Time
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={dialysisDurationHours}
                    onChange={(e) => handleDurationHoursChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-11 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    Jam
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Target UFG
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={ufGoal}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUfGoal(val);
                      syncPoint35Checklist(dialysisDurationHours, val, bfr, dfr, loadingDose);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    mL
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">QB</label>
                <div className="relative">
                  <input
                    type="number"
                    value={bfr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBfr(val);
                      syncPoint35Checklist(dialysisDurationHours, ufGoal, val, dfr, loadingDose);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-16 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    mL/mnt
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">QD</label>
                <div className="relative">
                  <input
                    type="number"
                    value={dfr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDfr(val);
                      syncPoint35Checklist(dialysisDurationHours, ufGoal, bfr, val, loadingDose);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-16 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    mL/mnt
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Dosis Heparin
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={loadingDose}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLoadingDose(val);
                      if (/free|bebas/i.test(val)) {
                        setAnticoagulantType('Bebas Heparin');
                      } else if (/lmwh/i.test(val)) {
                        setAnticoagulantType('LMWH');
                      } else if (val.trim()) {
                        setAnticoagulantType('Heparin');
                      }
                      syncPoint35Checklist(dialysisDurationHours, ufGoal, bfr, dfr, val);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-16 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                    iu/jam
                  </span>
                </div>
              </div>
            </div>
            {!isPoint35Complete(dialysisDurationHours, ufGoal, bfr, dfr, loadingDose) && (
              <p className="text-[11px] font-medium text-amber-600">
                Wajib mengisi kolom Waktu Dialisis / Time, Target UFG, QB, QD, dan Dosis Heparin agar Poin 3.5 bernilai DIKERJAKAN.
              </p>
            )}
          </div>
        );

      case '3.6':
        return (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/40 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">
                  Perawat yang Melakukan Aksessing Vaskular
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  Pilih perawat yang secara aktual melakukan kanulasi / aksessing vaskular pada pasien ini (nilai Laporan Pasien Poin 3 dalam masa/aksi perawat pelaksana aksessing setelah diverifikasi).
                </p>
              </div>
              <select
                value={vascularNurseId}
                onChange={(e) => setVascularNurseId(e.target.value)}
                className="w-full sm:w-64 shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#0e4e78] focus:outline-none"
              >
                {vascularNurseOptions.map((n) => (
                  <option key={n.uid} value={n.uid}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div
                className={`rounded-lg border p-3 transition-colors ${
                  selectedAccessOption === 'CIMINO'
                    ? 'border-[#0e4e78] bg-[#0e4e78]/[0.03]'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <input
                      type="checkbox"
                      checked={selectedAccessOption === 'CIMINO'}
                      onChange={() =>
                        handleSelectVascularOption(
                          selectedAccessOption === 'CIMINO' ? '' : 'CIMINO'
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78] focus:ring-[#0e4e78]"
                    />
                    <span>CIMINO</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    AV Shunt / Fistula
                  </span>
                </label>
              </div>

              <div
                className={`rounded-lg border p-3 transition-colors ${
                  selectedAccessOption === 'CDL'
                    ? 'border-[#0e4e78] bg-[#0e4e78]/[0.03]'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <input
                      type="checkbox"
                      checked={selectedAccessOption === 'CDL'}
                      onChange={() =>
                        handleSelectVascularOption(selectedAccessOption === 'CDL' ? '' : 'CDL')
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78] focus:ring-[#0e4e78]"
                    />
                    <span>CDL</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    Catheter Double Lumen
                  </span>
                </label>
              </div>

              <div
                className={`rounded-lg border p-3 transition-colors ${
                  selectedAccessOption === 'FEMORAL'
                    ? 'border-[#0e4e78] bg-[#0e4e78]/[0.03]'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <input
                      type="checkbox"
                      checked={selectedAccessOption === 'FEMORAL'}
                      onChange={() =>
                        handleSelectVascularOption(
                          selectedAccessOption === 'FEMORAL' ? '' : 'FEMORAL'
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78] focus:ring-[#0e4e78]"
                    />
                    <span>FEMORAL</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    Akses Vena Femoralis
                  </span>
                </label>
              </div>
            </div>
            {!selectedAccessOption && (
              <p className="text-[11px] font-medium text-amber-600">
                Wajib mencentang salah satu kolom akses vaskular (CIMINO, CDL, atau FEMORAL) agar Poin 3.6 bernilai DIKERJAKAN.
              </p>
            )}
          </div>
        );

      case '4.1':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/40 px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5 text-[#0e4e78]" />
                <span className="font-bold text-slate-800">
                  Observasi Tanda-Tanda Vital (TTV) Intra HD
                </span>
                <span className="text-[11px] text-slate-400">
                  ({intraObservations.length} Observasi)
                </span>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={handleAddIntraObservation}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-xs hover:bg-[#0a3c5d] transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>TAMBAH OBSERVASI TTV</span>
                </button>
              )}
            </div>

            {intraObservations.map((obs, idx) => (
              <div
                key={obs.id}
                className="rounded-lg border border-slate-200 bg-slate-50/40 p-3.5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0e4e78] text-[11px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-slate-800">Observasi TTV #{idx + 1}</span>
                    <span className="text-[11px] text-slate-400">
                      {idx === 0 ? '(Utama · Jam, TD & TTV)' : '(Observasi Lanjutan)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateIntraObservation(obs.id, 'time', getCurrentTimeHHmm())
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 hover:text-teal-700"
                      >
                        <Clock className="h-3 w-3" />
                        <span>Jam Sekarang</span>
                      </button>
                    )}
                    {!readOnly && idx > 0 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveIntraObservation(obs.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Hapus</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Jam Observasi
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={obs.time}
                        onChange={(e) =>
                          handleUpdateIntraObservation(obs.id, 'time', e.target.value)
                        }
                        className="w-40 sm:w-48 rounded-lg border border-slate-300 bg-white pl-3 pr-9 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                      <Clock className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Tekanan Darah Intra HD{' '}
                      <span className="text-slate-400 font-normal">(mmHg)</span>
                      {idx === 0 && <span className="text-rose-600"> *</span>}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={obs.systolic}
                        onChange={(e) =>
                          handleUpdateIntraObservation(obs.id, 'systolic', e.target.value)
                        }
                        placeholder="Sistolik"
                        className="w-32 sm:w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                      <span className="text-sm font-semibold text-slate-400">/</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={obs.diastolic}
                        onChange={(e) =>
                          handleUpdateIntraObservation(obs.id, 'diastolic', e.target.value)
                        }
                        placeholder="Diastolik"
                        className="w-32 sm:w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-slate-500">mmHg</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      Nadi (x/mnt)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={obs.pulse || ''}
                      onChange={(e) =>
                        handleUpdateIntraObservation(obs.id, 'pulse', e.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      Napas / RR (x/mnt)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={obs.resp || ''}
                      onChange={(e) =>
                        handleUpdateIntraObservation(obs.id, 'resp', e.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      Suhu (°C)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={obs.temp || ''}
                      onChange={(e) =>
                        handleUpdateIntraObservation(obs.id, 'temp', e.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      SpO₂ (%)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={obs.spo2 || ''}
                      onChange={(e) =>
                        handleUpdateIntraObservation(obs.id, 'spo2', e.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}

            {(!intraSystolicBp.trim() || !intraDiastolicBp.trim()) && (
              <p className="text-[11px] font-medium text-amber-600">
                Wajib mengisi kedua kolom Sistolik dan Diastolik pada Observasi #1 agar status logbook Poin 4.1 dikerjakan.
              </p>
            )}
          </div>
        );

      case '4.3':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-end gap-2.5 rounded-lg border border-slate-200 bg-slate-50/40 px-3.5 py-2.5">
              {!readOnly && (
                <button
                  type="button"
                  onClick={handleAddComplicationIncident}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-xs hover:bg-[#0a3c5d] transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>+ TAMBAH KOMPLIKASI</span>
                </button>
              )}

              <label
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                  noComplication
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={noComplication}
                  onChange={(e) => handleToggleNoComplication(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Tidak Ada Komplikasi (Nihil)</span>
              </label>
            </div>

            {complicationIncidents.map((inc, idx) => {
              const inputMeta = getComplicationInputMeta(inc.type);
              const detailValue = inputMeta.field === 'bp' ? inc.bp : inc.clinicalDetail || '';
              return (
                <div
                  key={inc.id}
                  className="rounded-xl border border-amber-300 bg-amber-50/20 p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[11px] font-bold text-white">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        Insiden Komplikasi #{idx + 1}
                      </span>
                      <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        Pukul {inc.time || '--:--'} WIB
                      </span>
                    </div>

                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemoveComplicationIncident(inc.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Hapus</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                        PILIHAN KOMPLIKASI <span className="text-rose-600">*</span>
                      </label>
                      <select
                        value={inc.type}
                        onChange={(e) =>
                          handleUpdateComplicationIncident(inc.id, 'type', e.target.value)
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                      >
                        {INTRA_COMPLICATION_TYPES.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                        {!INTRA_COMPLICATION_TYPES.includes(inc.type) && inc.type && (
                          <option value={inc.type}>{inc.type}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          JAM KEJADIAN
                        </label>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateComplicationIncident(
                                inc.id,
                                'time',
                                getCurrentTimeHHmm()
                              )
                            }
                            className="text-[11px] font-semibold text-[#0e4e78] hover:underline"
                          >
                            Sekarang
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={inc.time}
                          onChange={(e) =>
                            handleUpdateComplicationIncident(inc.id, 'time', e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-8 py-2 font-mono text-xs font-semibold text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                        />
                        <Clock className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                        {inputMeta.label}
                        {inputMeta.unit && (
                          <span className="normal-case font-normal"> {inputMeta.unit}</span>
                        )}{' '}
                        {inputMeta.required && <span className="text-rose-600">*</span>}
                      </label>
                      <input
                        type="text"
                        value={detailValue}
                        onChange={(e) =>
                          handleUpdateComplicationIncident(
                            inc.id,
                            inputMeta.field,
                            e.target.value
                          )
                        }
                        placeholder={inputMeta.placeholder}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">
                        KOLOM ADVIS DOKTER (TBAK)
                      </label>
                      <input
                        type="text"
                        value={inc.doctorAdvice}
                        onChange={(e) =>
                          handleUpdateComplicationIncident(inc.id, 'doctorAdvice', e.target.value)
                        }
                        placeholder={inputMeta.advicePlaceholder}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );

      case '6.3':
        return (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  Tekanan Darah Post HD{' '}
                  <span className="text-slate-400 font-normal">(mmHg)</span>
                </label>
                <input
                  type="text"
                  value={postBp}
                  onChange={(e) => updatePostHdEvaluation(e.target.value, ufAchieved, ktv)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                />
              </div>

              <div>
                <label className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-semibold text-slate-600 mb-1.5">
                  <span>
                    Nilai UFG Tercapai <span className="text-slate-400 font-normal">(mL)</span>
                  </span>
                  <span className="text-[10px] font-semibold text-[#0e4e78]">
                    Target UFG: {ufGoal.trim() ? `${ufGoal.trim()} mL` : '-'}
                  </span>
                </label>
                <input
                  type="number"
                  value={ufAchieved}
                  onChange={(e) => updatePostHdEvaluation(postBp, e.target.value, ktv)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                  KT/V <span className="text-slate-400 font-normal">(Adekuasi HD)</span>
                </label>
                <input
                  type="text"
                  value={ktv}
                  onChange={(e) => updatePostHdEvaluation(postBp, ufAchieved, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                />
              </div>
            </div>

            {(!postBp.trim() || !ufAchieved.trim() || !ktv.trim()) && (
              <p className="text-[11px] font-medium text-amber-600">
                Wajib mengisi semua kolom (Tekanan Darah Post HD, Nilai UFG Tercapai, dan KT/V) agar status logbook Poin 6.3 dikerjakan.
              </p>
            )}
          </div>
        );

      default:
        return undefined;
    }
  };

  const renderSpoPointCard = (
    pointId: string,
    children?: React.ReactNode,
    inlineFooter?: React.ReactNode
  ) => {
    const meta = pointTemplateMap.get(pointId) || SPO_POINT_MAP.get(pointId);
    if (!meta) return null;
    const status = spoChecklist[pointId] || 'TIDAK DIKERJAKAN';
    const isDone = status === 'DIKERJAKAN';
    const customBlocks = renderTtvAndCustomFields(
      pointId,
      'enableTtv' in meta ? (meta as LogbookPointTemplate) : undefined
    );

    return (
      <div
        key={pointId}
        className={`rounded-xl border bg-white transition-colors ${
          isDone
            ? 'border-emerald-300 ring-1 ring-emerald-500/15'
            : 'border-slate-200/90 hover:border-slate-300'
        }`}
      >
        {/* SPO Indicator Header + Checklist */}
        <div className={children ? 'p-4' : 'px-5 py-4'}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-bold text-slate-800">Poin {meta.id}</span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="font-semibold text-[#0e4e78]">{meta.category}</span>
              </div>
              <h5 className="text-[13px] font-bold text-slate-900 leading-snug">
                {meta.statement}
              </h5>
              {meta.description && (
                <p className="text-[11px] text-slate-500 leading-relaxed">{meta.description}</p>
              )}
              {meta.standard && (
                <p className="text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-500">Standar:</span> {meta.standard}
                </p>
              )}
            </div>

            {children ? (
              /* Kolom Checklist: TIDAK DIKERJAKAN / DIKERJAKAN */
              <div className="shrink-0 lg:border-l lg:border-slate-100 lg:pl-4 flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 lg:text-right">
                  Checklist SPO
                </span>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => setSpoPointStatus(pointId, 'TIDAK DIKERJAKAN')}
                    aria-pressed={!isDone}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap ${
                      !isDone
                        ? 'bg-white text-slate-700 shadow-xs ring-1 ring-slate-300/70'
                        : 'text-slate-500 hover:text-slate-700'
                    } ${readOnly ? 'cursor-default' : ''}`}
                  >
                    <Square className="h-3.5 w-3.5 text-slate-400" />
                    TIDAK DIKERJAKAN
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => setSpoPointStatus(pointId, 'DIKERJAKAN')}
                    aria-pressed={isDone}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap ${
                      isDone
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-emerald-700'
                    } ${readOnly ? 'cursor-default' : ''}`}
                  >
                    <CheckSquare
                      className={`h-3.5 w-3.5 ${isDone ? 'text-white' : 'text-slate-400'}`}
                    />
                    DIKERJAKAN
                  </button>
                </div>
              </div>
            ) : (
              /* Single Checklist Toggle Button */
              <div className="shrink-0">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    setSpoPointStatus(pointId, isDone ? 'TIDAK DIKERJAKAN' : 'DIKERJAKAN')
                  }
                  aria-pressed={isDone}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                    isDone
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-slate-300 bg-slate-50/70 text-slate-600 hover:bg-slate-100'
                  } ${readOnly ? 'cursor-default hover:bg-opacity-100' : ''}`}
                >
                  {isDone ? (
                    <CheckSquare className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4 text-slate-400" />
                  )}
                  <span>{isDone ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN'}</span>
                </button>
              </div>
            )}
          </div>

          {(inlineFooter || customBlocks) && (
            <div className="mt-3.5 space-y-3">
              {inlineFooter}
              {customBlocks}
            </div>
          )}
        </div>

        {/* Clinical Inputs Body (rendered when children provided) */}
        {children && (
          <div className="border-t border-slate-100 bg-slate-50/45 p-4 text-xs space-y-3 rounded-b-xl">
            {children}
          </div>
        )}
      </div>
    );
  };

  const activeStepMeta = activeSections[step - 1] || STEPS[step - 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Formulir Asuhan Keperawatan Hemodialisa"
    >
      <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Top Navy Header Bar Matching Mockup */}
        <div className="flex flex-col gap-3 bg-[#0e4e78] px-4 py-3.5 text-white sm:px-6 lg:flex-row lg:items-center lg:justify-between shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {readOnly ? 'Tutup Detail' : isVerifierEdit ? 'Kembali ke Verifikasi' : 'Daftar Pasien'}
            </button>

            <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/15">
              <Droplets className="h-4 w-4 text-sky-100" />
            </div>

            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-sky-100/90">
                {readOnly
                  ? `Detail Lengkap Logbook Hemodialisa · Bagian ${step} dari 8`
                  : isVerifierEdit
                  ? `Ubah Logbook Sebelum Verifikasi (${userProfile?.role || 'Verifikator'}) · Bagian ${step} dari 8`
                  : `${resolvedTemplate.formTitle} · Bagian ${step} dari 8`}
                <span className="mx-1.5 opacity-60" aria-hidden="true">·</span>
                <span className="font-semibold text-white">
                  {selectedPatient ? `${selectedPatient.fullName} (${selectedPatient.mrn})` : 'Pilih Pasien'} ·{' '}
                  {selectedMachine?.machineNumber || 'Mesin HD'}
                </span>
                <span className="mx-1.5 opacity-60" aria-hidden="true">·</span>
                <span>{formatFullDayDateId(date)}</span>
                <span className="mx-1.5 opacity-60" aria-hidden="true">·</span>
                <span>Shift {shift}</span>
              </p>
              <div className="flex items-center gap-2">
                <h3 className="truncate font-display text-sm sm:text-base font-bold text-white">
                  {activeStepMeta.title}
                </h3>
                {activeEntry && (
                  <VerificationBadge status={activeEntry.verificationStatus} />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            {/* Shift Switcher */}
            <div className="inline-flex items-center rounded-lg bg-[#093857] p-0.5 border border-white/10">
              {(
                [
                  { value: 'Pagi', icon: Sun },
                  { value: 'Siang', icon: Sunset },
                  { value: 'Malam', icon: Moon },
                ] as const
              ).map(({ value, icon: Icon }) => {
                const active = shift === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={readOnly}
                    onClick={() => !readOnly && setShift(value)}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-white text-[#0e4e78] shadow-xs'
                        : 'text-sky-100 hover:text-white'
                    } ${readOnly ? 'cursor-default' : ''}`}
                  >
                    <Icon className="h-3 w-3" />
                    {value}
                  </button>
                );
              })}
            </div>

            {!readOnly && (
              <button
                type="button"
                onClick={resetAllChecklist}
                title="Reset seluruh checklist SPO Bagian 1–6 menjadi TIDAK DIKERJAKAN"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset SPO
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/15 p-1.5 text-white hover:bg-white/25 transition-colors"
              aria-label="Tutup Formulir"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 8-Tab Navigation Strip (Bagian 1 - Bagian 8) */}
        <div className="border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {activeSections.map((s) => {
                const isActive = step === s.num;
                const ptsInStep = activeSpoPoints.filter((p) => p.step === s.num);
                const stepAllDone =
                  ptsInStep.length > 0 &&
                  ptsInStep.every((p) => spoChecklist[p.id] === 'DIKERJAKAN');
                return (
                  <button
                    key={s.num}
                    type="button"
                    disabled={saving}
                    title={s.title}
                    onClick={() => {
                      void handleSwitchStep(s.num);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                      isActive
                        ? 'border-[#0e4e78] bg-[#0e4e78] text-white shadow-xs'
                        : stepAllDone
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                        isActive
                          ? 'bg-white text-[#0e4e78]'
                          : stepAllDone
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {stepAllDone ? <Check className="h-2.5 w-2.5" /> : s.num}
                    </span>
                    <span>{s.short}</span>
                  </button>
                );
              })}
            </div>

            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 tabular-nums shrink-0">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>
                {doneSpoCount}/{totalSpoCount} SPO Unit
              </span>
            </div>
          </div>
        </div>

        {/* Active Patient Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/90 px-4 py-2 sm:px-6 shrink-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-slate-600">Pasien Logbook:</span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#0e4e78] px-3 py-1 text-[11px] font-bold text-white tabular-nums">
              <span>#1</span>
              <span>{selectedMachine?.machineNumber || 'BED HD'}</span>
              <span aria-hidden="true">·</span>
              <span>{selectedPatient ? selectedPatient.fullName.toUpperCase() : 'BELUM DIPILIH'}</span>
              <span>
                ({doneSpoCount}/{totalSpoCount})
              </span>
            </span>
            {selectedPatient && (
              <span className="font-mono text-[11px] text-slate-500">
                RM: {selectedPatient.mrn}
              </span>
            )}
            {!readOnly && !isVerifierEdit && autoSaveInfo.status === 'saving' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
                <Clock className="h-3 w-3 animate-spin" />
                Menyimpan otomatis...
              </span>
            )}
            {!readOnly && !isVerifierEdit && autoSaveInfo.status === 'saved' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 tabular-nums">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {autoSaveInfo.docStatus === 'Revision'
                  ? `Revisi tersimpan otomatis (${autoSaveInfo.timeLabel})`
                  : `Draft tersimpan otomatis (${autoSaveInfo.timeLabel})`}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {readOnly ? 'Tutup' : 'Daftar Pasien'}
          </button>
        </div>

        {/* Main Scrollable Body */}
        <div
          ref={bodyScrollRef}
          className="flex-1 overflow-y-auto bg-slate-50/60 px-4 py-4 sm:px-6 sm:py-5 space-y-4"
        >
          {/* Step Action Bar (Bagian 1 - 6) */}
          {step <= 6 && (
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900">
                  Daftar Indikator Standar Prosedur Operasional (SPO)
                </h4>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span className="text-xs font-semibold text-slate-600 tabular-nums mr-1">
                  {stepDoneCount}/{stepPoints.length} Dikerjakan
                </span>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => markStepAllDone(step)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      Semua Dikerjakan
                    </button>
                    <button
                      type="button"
                      onClick={() => resetStepChecklist(step)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Bagian
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {verifierReview?.editSuccessMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{verifierReview.editSuccessMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <fieldset disabled={readOnly} className="contents">
          {/* BAGIAN 1–6: Indikator SPO Dinamis sesuai Template */}
          {step >= 1 && step <= 6 && (
            <div className="space-y-3.5">
              {stepPoints.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
                  Tidak ada poin indikator SPO aktif pada bagian ini.
                </div>
              ) : (
                stepPoints.map((pt) =>
                  renderSpoPointCard(pt.id, undefined, renderBuiltInPointFooter(pt.id))
                )
              )}
            </div>
          )}

          {/* BAGIAN 7: Transfusi Darah & Pemberian EPO */}
          {step === 7 && (() => {
            const pt71 = pointTemplateMap.get('7.1');
            const pt72 = pointTemplateMap.get('7.2');
            const show71 = pt71 ? pt71.visible !== false : true;
            const show72 = pt72 ? pt72.visible !== false : true;
            const extra71Blocks = renderTtvAndCustomFields('7.1', pt71);
            const extra72Blocks = renderTtvAndCustomFields('7.2', pt72);
            const sec7Blocks = renderTtvAndCustomFields('__sec7', {
              enableTtv: false,
              customFields: section7CustomFields,
            });

            return (
              <div className="space-y-4">
                {show71 && (
                  <div className="rounded-xl border border-slate-200/90 bg-white overflow-hidden">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-500">
                          <Droplets className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <h5 className="text-[13px] font-bold text-slate-900">
                            {pt71?.statement || '7.1 Keterangan Transfusi Darah'}
                          </h5>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {pt71?.description ||
                              'Catat apakah pasien mendapatkan transfusi darah (PRC / WB / komponen lain) selama atau pasca tindakan HD.'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`self-start sm:self-center shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                          transfusionGiven
                            ? 'border-rose-200 bg-rose-50 text-rose-600'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}
                      >
                        {transfusionGiven ? 'DILAKUKAN TRANSFUSI' : 'TIDAK TRANSFUSI'}
                      </span>
                    </div>

                    <div className="p-5 space-y-4 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            setTransfusionGiven(false);
                            setErrorMsg(null);
                          }}
                          className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-all ${
                            !transfusionGiven
                              ? 'border-[#0e4e78] bg-sky-50/40 ring-1 ring-[#0e4e78]'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${
                              !transfusionGiven ? 'text-[#0e4e78]' : 'text-slate-300'
                            }`}
                          />
                          <div>
                            <p className="font-bold text-slate-900">Tidak Dilakukan Transfusi</p>
                            <p className="text-[11px] text-slate-500">
                              Pasien tidak menerima produk darah pada sesi HD ini.
                            </p>
                          </div>
                        </button>

                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            setTransfusionGiven(true);
                            setErrorMsg(null);
                          }}
                          className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-all ${
                            transfusionGiven
                              ? 'border-rose-500 bg-rose-50/30 ring-1 ring-rose-500'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${
                              transfusionGiven ? 'text-rose-500' : 'text-slate-300'
                            }`}
                          />
                          <div>
                            <p className="font-bold text-slate-900">Dilakukan Transfusi Darah</p>
                            <p className="text-[11px] text-slate-500">
                              Pasien menerima transfusi darah sesuai advis dokter DPJP.
                            </p>
                          </div>
                        </button>
                      </div>

                      {transfusionGiven && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 space-y-3.5">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Komponen Darah <span className="text-rose-500">*</span>
                              </label>
                              <select
                                value={transfusionComponent}
                                onChange={(e) => setTransfusionComponent(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-rose-500 focus:outline-none"
                              >
                                <option value="PRC (Packed Red Cell)">PRC (Packed Red Cell)</option>
                                <option value="WB (Whole Blood)">WB (Whole Blood)</option>
                                <option value="TC (Thrombocyte Concentrate)">TC (Thrombocyte Concentrate)</option>
                                <option value="FFP (Fresh Frozen Plasma)">FFP (Fresh Frozen Plasma)</option>
                                <option value="WE (Washed Erythrocyte)">WE (Washed Erythrocyte)</option>
                                <option value="Lainnya">Lainnya</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Golongan Darah &amp; Rhesus
                              </label>
                              <select
                                value={transfusionBloodGroup}
                                onChange={(e) => setTransfusionBloodGroup(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-rose-500 focus:outline-none"
                              >
                                <option value="">-- Pilih Gol. Darah --</option>
                                <option value="A+">A+</option>
                                <option value="A-">A-</option>
                                <option value="B+">B+</option>
                                <option value="B-">B-</option>
                                <option value="AB+">AB+</option>
                                <option value="AB-">AB-</option>
                                <option value="O+">O+</option>
                                <option value="O-">O-</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Jumlah Kantong <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={transfusionBagCount}
                                onChange={(e) => setTransfusionBagCount(e.target.value)}
                                placeholder="1"
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Volume Total (mL)
                              </label>
                              <input
                                type="text"
                                value={transfusionVolumeMl}
                                onChange={(e) => setTransfusionVolumeMl(e.target.value)}
                                placeholder="cth: 250 mL"
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Nomor Kantong / Label Crossmatch
                              </label>
                              <input
                                type="text"
                                value={transfusionBagNumber}
                                onChange={(e) => setTransfusionBagNumber(e.target.value)}
                                placeholder="Nomor kantong PMI / BDRS"
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Reaksi Transfusi
                              </label>
                              <select
                                value={transfusionReaction}
                                onChange={(e) => setTransfusionReaction(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-rose-500 focus:outline-none"
                              >
                                <option value="Tidak Ada Reaksi">Tidak Ada Reaksi</option>
                                <option value="Demam / Menggigil">Demam / Menggigil</option>
                                <option value="Urtikaria / Alergi">Urtikaria / Alergi</option>
                                <option value="Sesak / Fluid Overload">Sesak / Fluid Overload</option>
                                <option value="Reaksi Hemolitik">Reaksi Hemolitik</option>
                                <option value="Lainnya">Lainnya</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                              Keterangan / Catatan Transfusi
                            </label>
                            <textarea
                              rows={2}
                              value={transfusionNote}
                              onChange={(e) => setTransfusionNote(e.target.value)}
                              placeholder="Jam mulai & selesai transfusi, kadar Hb pre-transfusi, premedikasi, atau respon pasien..."
                              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {extra71Blocks}
                    </div>
                  </div>
                )}

                {show72 && (
                  <div className="rounded-xl border border-slate-200/90 bg-white overflow-hidden">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-[#0e4e78]">
                          <Syringe className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <h5 className="text-[13px] font-bold text-slate-900">
                            {pt72?.statement || '7.2 Keterangan Pemberian EPO (Eritropoietin)'}
                          </h5>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {pt72?.description ||
                              'Catat apakah pasien diberikan injeksi EPO (Epoetin Alfa/Beta atau sejenisnya) pada sesi HD ini.'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`self-start sm:self-center shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                          epoGiven
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}
                      >
                        {epoGiven ? 'DIBERIKAN EPO' : 'TIDAK DIBERIKAN EPO'}
                      </span>
                    </div>

                    <div className="p-5 space-y-4 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            setEpoGiven(false);
                            setErrorMsg(null);
                          }}
                          className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-all ${
                            !epoGiven
                              ? 'border-[#0e4e78] bg-sky-50/40 ring-1 ring-[#0e4e78]'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${
                              !epoGiven ? 'text-[#0e4e78]' : 'text-slate-300'
                            }`}
                          />
                          <div>
                            <p className="font-bold text-slate-900">Tidak Diberikan EPO</p>
                            <p className="text-[11px] text-slate-500">
                              Tidak ada injeksi EPO yang diberikan pada sesi HD ini.
                            </p>
                          </div>
                        </button>

                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            setEpoGiven(true);
                            setErrorMsg(null);
                          }}
                          className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-all ${
                            epoGiven
                              ? 'border-emerald-500 bg-emerald-50/30 ring-1 ring-emerald-500'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${
                              epoGiven ? 'text-emerald-600' : 'text-slate-300'
                            }`}
                          />
                          <div>
                            <p className="font-bold text-slate-900">Diberikan EPO</p>
                            <p className="text-[11px] text-slate-500">
                              Pasien mendapatkan terapi injeksi Eritropoietin (EPO).
                            </p>
                          </div>
                        </button>
                      </div>

                      {epoGiven && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3.5">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Jenis / Nama Preparat EPO <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                list="epo-preparations-list"
                                value={epoPreparation}
                                onChange={(e) => setEpoPreparation(e.target.value)}
                                placeholder="cth: Epoetin Alfa"
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                              />
                              <datalist id="epo-preparations-list">
                                <option value="Epoetin Alfa" />
                                <option value="Epoetin Beta" />
                                <option value="Darbepoetin Alfa" />
                                <option value="Methoxy Polyethylene Glycol-Epoetin Beta" />
                              </datalist>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Dosis Pemberian <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={epoDose}
                                onChange={(e) => setEpoDose(e.target.value)}
                                placeholder="cth: 3000 IU"
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                                Rute Pemberian
                              </label>
                              <select
                                value={epoRoute}
                                onChange={(e) => setEpoRoute(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-emerald-500 focus:outline-none"
                              >
                                <option value="Subkutan (SC)">Subkutan (SC)</option>
                                <option value="Intravena (IV)">Intravena (IV)</option>
                                <option value="Intra-Dialyzer / Venous Line">
                                  Intra-Dialyzer / Venous Line
                                </option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                              Keterangan / Catatan Pemberian EPO
                            </label>
                            <textarea
                              rows={2}
                              value={epoNote}
                              onChange={(e) => setEpoNote(e.target.value)}
                              placeholder="Jam injeksi, lokasi penyuntikan, atau catatan respon pasien..."
                              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {extra72Blocks}
                    </div>
                  </div>
                )}

                {extraStep7Points.map((pt) => {
                  const ptBlocks = renderTtvAndCustomFields(pt.id, pt);
                  return (
                    <div
                      key={pt.id}
                      className="rounded-xl border border-slate-200/90 bg-white overflow-hidden"
                    >
                      <div className="border-b border-slate-100 px-5 py-4 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="font-bold text-slate-800">Poin {pt.id}</span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="font-semibold text-[#0e4e78]">{pt.category}</span>
                        </div>
                        <h5 className="text-[13px] font-bold text-slate-900 leading-snug">
                          {pt.statement}
                        </h5>
                        {pt.description && (
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            {pt.description}
                          </p>
                        )}
                        {pt.standard && (
                          <p className="text-[11px] text-slate-400">
                            <span className="font-semibold text-slate-500">Standar:</span>{' '}
                            {pt.standard}
                          </p>
                        )}
                      </div>
                      {ptBlocks && <div className="p-5 text-xs">{ptBlocks}</div>}
                    </div>
                  );
                })}

                {sec7Blocks && (
                  <div className="rounded-xl border border-slate-200/90 bg-white overflow-hidden">
                    <div className="border-b border-slate-100 px-5 py-3.5">
                      <h5 className="text-[13px] font-bold text-slate-900">
                        Kolom Tambahan Bagian 7
                      </h5>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Kolom penginputan khusus yang dikonfigurasi pada Master Logbook untuk Bagian 7.
                      </p>
                    </div>
                    <div className="p-5 text-xs">{sec7Blocks}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* BAGIAN 8: Pengajuan Verifikasi */}
          {step === 8 && (
            <div className="space-y-4">
              {/* Card 1: Rekapitulasi Kelengkapan Logbook Pasien */}
              <div className="rounded-xl border border-slate-200/90 bg-white overflow-hidden">
                <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between border-b border-slate-100">
                  <div>
                    <h4 className="text-[13px] font-bold text-slate-900">
                      Rekapitulasi Kelengkapan Logbook Pasien:{' '}
                      {selectedPatient ? selectedPatient.fullName.toUpperCase() : 'BELUM DIPILIH'}{' '}
                      ({selectedMachine?.machineNumber || 'BED HD'})
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Klik tombol Tinjau untuk memeriksa atau melengkapi indikator SPO dan data Bagian I - VII pasien ini sebelum pengajuan verifikasi.
                    </p>
                  </div>

                  <div className="text-xs font-bold text-slate-800 tabular-nums shrink-0">
                    Total Pasien Ini: {doneSpoCount}/{totalSpoCount} (
                    {totalSpoCount > 0 ? Math.round((doneSpoCount / totalSpoCount) * 100) : 0}%)
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-slate-50/60 text-[11px] font-medium text-slate-500">
                        <th className="px-5 py-2.5 font-medium">Bagian Logbook</th>
                        <th className="px-4 py-2.5 font-medium">Cakupan Standar SPO / Data</th>
                        <th className="px-4 py-2.5 text-right font-medium">Capaian / Status</th>
                        <th className="px-5 py-2.5 text-right font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {activeSections
                        .filter((s) => s.num >= 1 && s.num <= 6 && s.visible !== false)
                        .map((sec) => {
                          const pts = activeSpoPoints.filter((p) => p.step === sec.num);
                          const doneCount = pts.filter(
                            (p) => spoChecklist[p.id] === 'DIKERJAKAN'
                          ).length;
                          const totalCount = pts.length;
                          const pct =
                            totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                          const allDone = totalCount > 0 && doneCount === totalCount;

                          return (
                            <tr key={sec.num} className="hover:bg-slate-50/70 transition-colors">
                              <td className="px-5 py-3 font-bold text-[#0e4e78] text-[11px] whitespace-nowrap">
                                {sec.roman}
                              </td>
                              <td className="px-4 py-3 text-slate-700">{sec.scope}</td>
                              <td
                                className={`px-4 py-3 text-right font-mono text-[11px] font-bold tabular-nums whitespace-nowrap ${
                                  allDone ? 'text-emerald-600' : 'text-amber-600'
                                }`}
                              >
                                {doneCount}/{totalCount} SPO ({pct}%)
                              </td>
                              <td className="px-5 py-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setErrorMsg(null);
                                    setStep(sec.num);
                                  }}
                                  className="text-[11px] font-semibold text-[#0e4e78] hover:underline"
                                >
                                  Tinjau
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      {(() => {
                        const sec7 = activeSections.find((s) => s.num === 7);
                        if (sec7 && sec7.visible === false) return null;
                        return (
                          <tr className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-5 py-3 font-bold text-[#0e4e78] text-[11px] whitespace-nowrap">
                              {sec7?.roman || 'BAGIAN VII'}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {sec7?.scope || 'Pemberian Transfusi Darah & Terapi EPO'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[11px] font-bold text-emerald-600 whitespace-nowrap">
                              Transfusi:{' '}
                              {transfusionGiven
                                ? `${transfusionBagCount || '1'} kolf ${transfusionComponent.split(' ')[0]}`
                                : 'Tidak'}{' '}
                              · EPO:{' '}
                              {epoGiven ? epoDose.trim() || epoPreparation || 'Ya' : 'Tidak'}
                            </td>
                            <td className="px-5 py-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setErrorMsg(null);
                                  setStep(7);
                                }}
                                className="text-[11px] font-semibold text-[#0e4e78] hover:underline"
                              >
                                Tinjau
                              </button>
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Card 2: Formulir Pengajuan Verifikasi Logbook Pasien */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-4">
                <div>
                  <h4 className="text-[13px] font-bold text-slate-900">
                    Formulir Pengajuan Verifikasi Logbook Pasien (
                    {selectedPatient ? selectedPatient.fullName.toUpperCase() : '-'})
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {isSubmitterKaru
                      ? 'Logbook yang diinputkan oleh Kepala Ruang diajukan untuk diverifikasi oleh PJ Shift yang bertugas.'
                      : 'PJ Shift dan Perawat Pelaksana dapat mengajukan verifikasi logbook pasien ini kepada Kepala Ruang atau PJ Shift lainnya.'}
                  </p>
                </div>

                {/* Inner Box: Pilih Tujuan Pengajuan Verifikasi */}
                {isSubmitterKaru ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[#0e4e78]" />
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          Tujuan Pengajuan Verifikasi: PJ Shift
                        </p>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                          Sebagai Kepala Ruang penginput logbook, pengajuan verifikasi otomatis diarahkan ke halaman Verifikasi PJ Shift tujuan.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <p className="text-[11px] font-bold text-slate-800">
                      Pilih Tujuan Pengajuan Verifikasi Logbook:
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTargetVerifierRole('Kepala Ruang');
                          setTargetVerifierId('');
                        }}
                        className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-left transition-all ${
                          targetVerifierRole === 'Kepala Ruang'
                            ? 'border-[#0e4e78] bg-white ring-1 ring-[#0e4e78]'
                            : 'border-slate-200 bg-white/80 hover:border-slate-300'
                        }`}
                      >
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            targetVerifierRole === 'Kepala Ruang'
                              ? 'text-[#0e4e78]'
                              : 'text-slate-300'
                          }`}
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Ajukan kepada Kepala Ruang
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                            Masuk ke halaman Verifikasi Kepala Ruang untuk diverifikasi oleh Kepala Ruang.
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setTargetVerifierRole('PJ Shift');
                          setTargetVerifierId('');
                        }}
                        className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-left transition-all ${
                          targetVerifierRole === 'PJ Shift'
                            ? 'border-[#0e4e78] bg-white ring-1 ring-[#0e4e78]'
                            : 'border-slate-200 bg-white/80 hover:border-slate-300'
                        }`}
                      >
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            targetVerifierRole === 'PJ Shift'
                              ? 'text-[#0e4e78]'
                              : 'text-slate-300'
                          }`}
                        />
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Ajukan kepada PJ Shift Lainnya
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                            Masuk ke halaman Verifikasi PJ Shift tujuan (rekan PJ Shift lain) untuk diverifikasi.
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {/* Submitter & Target Verifier Dropdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                      {readOnly || isVerifierEdit
                        ? 'Perawat Pengaju'
                        : userProfile?.role === 'Kepala Ruang'
                        ? 'Kepala Ruang Pengaju'
                        : userProfile?.role === 'PJ Shift'
                        ? 'PJ Shift Pengaju'
                        : 'Perawat Pengaju'}
                    </label>
                    <div className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs font-bold text-slate-800">
                      {(readOnly || isVerifierEdit) && editingEntry
                        ? editingEntry.nurseName.toUpperCase()
                        : userProfile?.fullName?.toUpperCase() || '-'}
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                      NIP/NIRA:{' '}
                      {(readOnly || isVerifierEdit) && editingEntry
                        ? editingEntry.nurseNip || '-'
                        : userProfile?.nip || '-'}{' '}
                      {!readOnly && !isVerifierEdit && `· Role: ${userProfile?.role || 'Perawat Pelaksana'}`}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                      {targetVerifierRole === 'Kepala Ruang'
                        ? 'Kepala Ruang Tujuan Verifikasi'
                        : 'PJ Shift Tujuan Verifikasi'}
                    </label>
                    <select
                      value={resolvedVerifierId}
                      onChange={(e) => setTargetVerifierId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                    >
                      {verifierCandidates.length === 0 ? (
                        <option value="">
                          {readOnly && editingEntry?.targetVerifierName
                            ? editingEntry.targetVerifierName.toUpperCase()
                            : `Semua ${targetVerifierRole} Bertugas`}
                        </option>
                      ) : (
                        verifierCandidates.map((c) => {
                          const isDesignatedPj =
                            targetVerifierRole === 'PJ Shift' &&
                            assignedPjForSlot?.pjNurseId === c.uid;
                          return (
                            <option key={c.uid} value={c.uid}>
                              {c.fullName.toUpperCase()}
                              {isDesignatedPj ? ' (PJ SHIFT BERTUGAS)' : ''}
                            </option>
                          );
                        })
                      )}
                    </select>
                    <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                      NIP/NIRA: {selectedVerifierObj?.nip || '-'} · Shift {shift}
                    </p>
                  </div>
                </div>

                {/* Catatan Pengajuan / Operan Verifikasi Pasien Ini */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                    Catatan Pengajuan / Operan Verifikasi Pasien Ini (Opsional)
                  </label>
                  <textarea
                    rows={3}
                    value={submissionNote}
                    onChange={(e) => setSubmissionNote(e.target.value)}
                    placeholder={`Catatan tambahan terkait asuhan HD pasien ${
                      selectedPatient ? selectedPatient.fullName.toUpperCase() : 'INI'
                    } (jika ada)...`}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>

                {/* Konfirmasi Pengajuan Checkbox */}
                <label
                  className={`flex items-start sm:items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                    submissionConfirmed
                      ? 'border-[#0e4e78]/40 bg-sky-50/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={submissionConfirmed}
                    onChange={(e) => {
                      setSubmissionConfirmed(e.target.checked);
                      if (e.target.checked) setErrorMsg(null);
                    }}
                    className="mt-0.5 sm:mt-0 h-4 w-4 shrink-0 rounded border-slate-300 text-[#0e4e78] focus:ring-[#0e4e78]"
                  />
                  <span className="text-xs font-medium text-slate-700 leading-snug">
                    Seluruh pengisian indikator SPO dan data asuhan Bagian I–VII untuk pasien{' '}
                    {selectedPatient ? selectedPatient.fullName.toUpperCase() : '-'} telah diperiksa dan siap diajukan untuk diverifikasi oleh{' '}
                    {targetVerifierRole === 'Kepala Ruang' ? 'Kepala Ruang' : 'PJ Shift'}.
                  </span>
                </label>

                {!readOnly && !isVerifierEdit && (() => {
                  const step8Access = getLogbookSubmissionAccess(
                    date,
                    shift,
                    activeEntry || editingEntry || null,
                    nowMs
                  );
                  if (step8Access.isRevisionGrace) {
                    return (
                      <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                        <Clock className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                        <span>
                          <strong>Masa Perbaikan Revisi Ekstra (1 Jam):</strong> Di luar jam pengajuan Shift {shift}, Anda memiliki sisa waktu{' '}
                          <strong>{step8Access.remainingRevisionMinutes} menit</strong> (hingga{' '}
                          <strong>{step8Access.deadlineWibLabel}</strong>) untuk mengubah dan mengajukan ulang logbook ini.
                        </span>
                      </div>
                    );
                  }
                  if (!step8Access.canSubmitPending && step8Access.reason) {
                    return (
                      <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                        <span>
                          <strong>Pengajuan Verifikasi Ditutup:</strong> {step8Access.reason}
                          {!step8Access.revisionExpired && ' Anda masih dapat menyimpan isian sebagai Draft.'}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-[11px] text-emerald-900">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>
                        Jam pengajuan Shift {shift} aktif ({step8Access.windowLabel}) · Sekarang {wibTimeLabel}
                      </span>
                    </div>
                  );
                })()}
                {readOnly && editingEntry && (editingEntry.verifiedByName || editingEntry.verificationNote) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950 space-y-1">
                    {editingEntry.verifiedByName && (
                      <p className="font-semibold">
                        Diverifikasi oleh: {editingEntry.verifiedByName}
                      </p>
                    )}
                    {editingEntry.verificationNote && (
                      <p>
                        <span className="font-semibold">Catatan Verifikator: </span>
                        {editingEntry.verificationNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          </fieldset>

          {readOnly &&
            verifierReview &&
            step === 8 &&
            editingEntry?.verificationStatus !== 'Approved' && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Catatan Verifikator (Wajib jika meminta Revisi)
                </label>
                <textarea
                  rows={2}
                  value={verifierReview.note}
                  onChange={(e) => verifierReview.onNoteChange(e.target.value)}
                  placeholder="Tuliskan catatan validasi atau poin yang perlu direvisi perawat..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
                />
              </div>
            )}
        </div>

        {/* Bottom Sticky Footer Matching Mockup */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 shrink-0">
          <div>
            {readOnly && verifierReview?.canEdit && (
              <button
                type="button"
                disabled={verifierReview.processing}
                onClick={verifierReview.onSwitchToEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-60"
              >
                <Pencil className="h-3.5 w-3.5" />
                Ubah Data Logbook
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {step > 1 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void handleSwitchStep(Math.max(1, step - 1));
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                <ChevronLeft className="h-4 w-4" />
                Sebelumnya
              </button>
            )}

            {readOnly ? (
              verifierReview && editingEntry?.verificationStatus !== 'Approved' ? (
                (() => {
                  const verAccess = getLogbookVerificationAccess(
                    editingEntry!,
                    userProfile,
                    nowMs
                  );
                  return (
                    <>
                      {!verAccess.allowed && verAccess.reason && (
                        <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
                          {verAccess.reason}
                        </span>
                      )}
                      {step < 8 && (
                        <button
                          type="button"
                          onClick={() => setStep((s) => Math.min(8, s + 1))}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors"
                        >
                          Bagian {step + 1}
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={verifierReview.processing || !verAccess.allowed}
                        title={!verAccess.allowed ? verAccess.reason || undefined : undefined}
                        onClick={verifierReview.onRequestRevision}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        Minta Revisi
                      </button>
                      <button
                        type="button"
                        disabled={verifierReview.processing || !verAccess.allowed}
                        title={!verAccess.allowed ? verAccess.reason || undefined : undefined}
                        onClick={verifierReview.onApprove}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Setujui &amp; Validasi
                      </button>
                    </>
                  );
                })()
              ) : step < 8 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(8, s + 1))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors"
                >
                  Bagian {step + 1}
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors"
                >
                  Tutup Detail
                </button>
              )
            ) : isVerifierEdit ? (
              (() => {
                const verAccess = editingEntry
                  ? getLogbookVerificationAccess(editingEntry, userProfile, nowMs)
                  : { allowed: false, reason: 'Data logbook tidak ditemukan.' };
                return (
                  <>
                    <button
                      type="button"
                      disabled={saving || !verAccess.allowed}
                      title={!verAccess.allowed ? verAccess.reason || undefined : undefined}
                      onClick={() =>
                        handleSave(
                          editingEntry?.verificationStatus === 'Revision' ? 'Revision' : 'Pending'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Menyimpan Perubahan...' : 'Simpan Perubahan Logbook'}
                    </button>

                    {step < 8 && (
                      <button
                        type="button"
                        onClick={handleNextStep}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors"
                      >
                        Lanjut Bagian {step + 1}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </>
                );
              })()
            ) : (
              (() => {
                const footerSubAccess = getLogbookSubmissionAccess(
                  date,
                  shift,
                  activeEntry || editingEntry || null,
                  nowMs
                );
                const isRevisionLocked =
                  (activeEntry?.verificationStatus === 'Revision' ||
                    editingEntry?.verificationStatus === 'Revision') &&
                  !footerSubAccess.canEditRevision;

                return (
                  <>
                    <button
                      type="button"
                      disabled={saving || isRevisionLocked}
                      title={isRevisionLocked ? footerSubAccess.reason || undefined : undefined}
                      onClick={() => {
                        void handleSave(getAutoDraftStatus());
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save className="h-4 w-4 text-slate-500" />
                      {saving
                        ? 'Menyimpan...'
                        : getAutoDraftStatus() === 'Revision'
                        ? 'Simpan Revisi'
                        : 'Simpan sebagai Draft'}
                    </button>

                    {step < 8 ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          void handleSwitchStep(Math.min(8, step + 1), { validateCurrent: true });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors disabled:opacity-60"
                      >
                        <Save className="h-3.5 w-3.5 opacity-80" />
                        {saving
                          ? 'Menyimpan...'
                          : isRevisionLocked
                          ? `Lanjut Bagian ${step + 1}`
                          : `Simpan & Lanjut Bagian ${step + 1}`}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={saving || !footerSubAccess.canSubmitPending}
                        title={
                          !footerSubAccess.canSubmitPending
                            ? footerSubAccess.reason || undefined
                            : undefined
                        }
                        onClick={() => handleSave('Pending')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {step === 8 ? (
                          <Send className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {saving ? 'Mengajukan...' : 'Ajukan Verifikasi'}
                      </button>
                    )}
                  </>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useMemo, useRef, useState } from 'react';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
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
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  clampString,
  extractShiftFromSchedule,
  formatFullDayDateId,
  getDayNameId,
  getTodayDateStr,
  isPatientScheduledOnDay,
} from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import type {
  ActionCategory,
  Doctor,
  IntraObservationRow,
  IntraTtvObservationItem,
  LogbookEntry,
  LogbookLock,
  LogbookWizardDetails,
  Machine,
  MachineLock,
  Patient,
  PjShiftAssignmentEntry,
  ShiftType,
  StaffDirectoryEntry,
  VascularAccessType,
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
  { num: 7, short: 'Verifikasi', title: 'Bagian 7: Pengajuan Verifikasi' },
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
    placeholder: 'Cth: 180/100',
    required: true,
    summaryPrefix: 'TD',
    summaryUnit: 'mmHg',
    advicePlaceholder: 'Evaluasi obat antihipertensi, istirahatkan pasien',
  },
  Hipotensi: {
    field: 'bp',
    label: 'TEKANAN DARAH',
    unit: '(mmHg)',
    placeholder: 'Cth: 85/55',
    required: true,
    summaryPrefix: 'TD',
    summaryUnit: 'mmHg',
    advicePlaceholder: 'Posisi Trendelenburg, stop/turunkan UFR, bolus NaCl 0.9%',
  },
  Hipoglikemi: {
    field: 'clinicalDetail',
    label: 'KADAR GULA DARAH / GDS',
    unit: '(mg/dL)',
    placeholder: 'Cth: 54',
    required: true,
    summaryPrefix: 'GDS',
    summaryUnit: 'mg/dL',
    advicePlaceholder: 'Berikan D40% IV / asupan glukosa oral, cek GDS ulang',
  },
  Hipertermi: {
    field: 'clinicalDetail',
    label: 'SUHU TUBUH',
    unit: '(°C)',
    placeholder: 'Cth: 38.6',
    required: true,
    summaryPrefix: 'Suhu',
    summaryUnit: '°C',
    advicePlaceholder: 'Kompres hangat, antipiretik / kultur darah sesuai advis',
  },
  'Kram Otot': {
    field: 'clinicalDetail',
    label: 'LOKASI KRAM & TINDAKAN',
    placeholder: 'Cth: Betis kanan/kiri, turunkan UFR',
    required: false,
    advicePlaceholder: 'Peregangan otot, turunkan UFR, bolus NaCl 0.9%',
  },
  Mual: {
    field: 'clinicalDetail',
    label: 'KELUHAN & TTV TERKAIT',
    placeholder: 'Cth: Mual sedang, TD 110/70 mmHg',
    required: false,
    advicePlaceholder: 'Posisi nyaman, antiemetik sesuai advis dokter',
  },
  Muntah: {
    field: 'clinicalDetail',
    label: 'FREKUENSI & VOLUME MUNTAH',
    placeholder: 'Cth: Muntah 1x ±100 mL, bersihkan jalan napas',
    required: false,
    advicePlaceholder: 'Miringkan kepala, antiemetik IV, pantau hemodinamik',
  },
  Clotting: {
    field: 'clinicalDetail',
    label: 'LOKASI CLOTTING & TINDAKAN',
    placeholder: 'Cth: Dialiser / venous chamber, bilas NaCl 0.9%',
    required: false,
    advicePlaceholder: 'Evaluasi dosis heparin, ganti bloodline/dialiser bila perlu',
  },
  'Akses Bleeding': {
    field: 'clinicalDetail',
    label: 'LOKASI PERDARAHAN & TINDAKAN',
    placeholder: 'Cth: Rembesan jarum AVF / exit-site CDL, balut tekan',
    required: false,
    advicePlaceholder: 'Penekanan steril titik akses, evaluasi dosis heparin',
  },
  'First-Use Syndrome': {
    field: 'clinicalDetail',
    label: 'GEJALA REAKSI & TTV (TD / SpO₂)',
    placeholder: 'Cth: Sesak napas, gatal, SpO₂ 93%',
    required: false,
    advicePlaceholder: 'Hentikan pompa darah, oksigenasi, antihistamin/steroid',
  },
  'Penurunan Kesadaran': {
    field: 'clinicalDetail',
    label: 'SKOR GCS / KESADARAN & TTV',
    placeholder: 'Cth: GCS E3V4M5 (Somnolen), TD 90/60',
    required: true,
    advicePlaceholder: 'Amankan ABC, cek TD & GDS cito, lapor DPJP/Dokter Jaga',
  },
  'Komplikasi Lainnya': {
    field: 'clinicalDetail',
    label: 'DETAIL KOMPLIKASI & PARAMETER KLINIS',
    placeholder: 'Tuliskan jenis komplikasi & hasil pemeriksaan',
    required: true,
    advicePlaceholder: 'Tatalaksana sesuai keluhan klinis & instruksi dokter',
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
    placeholder: 'Tuliskan parameter / kondisi klinis terkait',
    required: false,
    advicePlaceholder: 'Tatalaksana sesuai advis DPJP / Dokter Jaga',
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
  { hourLabel: 'Jam ke-1', bp: '140/90', pulse: '82', bfr: '250', ufr: '600', arterialPressure: '-120', venousPressure: '130', tmp: '85' },
  { hourLabel: 'Jam ke-2', bp: '135/85', pulse: '80', bfr: '250', ufr: '600', arterialPressure: '-125', venousPressure: '135', tmp: '90' },
  { hourLabel: 'Jam ke-3', bp: '130/80', pulse: '78', bfr: '250', ufr: '600', arterialPressure: '-125', venousPressure: '135', tmp: '90' },
  { hourLabel: 'Jam ke-4', bp: '130/80', pulse: '78', bfr: '250', ufr: '600', arterialPressure: '-120', venousPressure: '130', tmp: '85' },
];

function buildInitialSpoChecklist(
  saved?: Record<string, SpoCheckStatus>
): Record<string, SpoCheckStatus> {
  const result: Record<string, SpoCheckStatus> = {};
  for (const pt of SPO_POINTS) {
    result[pt.id] = saved?.[pt.id] === 'DIKERJAKAN' ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN';
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
  verifierReview,
  onClose,
  onSaved,
}: LogbookWizardModalProps) {
  const { userProfile } = useAuth();
  const isVerifierEdit = Boolean(verifierEditMode && editingEntry && !readOnly);
  const activePatients = useMemo(() => patients.filter((p) => p.status === 'Aktif'), [patients]);
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

  const initialScheduledList = activePatients.filter((p) =>
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
    ? isPatientScheduledOnDay(resolvedInitialPatient.routineSchedule, startDayName)
    : initialUnlockedScheduled.length > 0;

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [onlyScheduledForDay, setOnlyScheduledForDay] = useState<boolean>(
    editingEntry ? false : initialIsScheduled
  );

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

  // SPO Checklist state ("TIDAK DIKERJAKAN" / "DIKERJAKAN") for every point 1.1 - 7.2
  const [spoChecklist, setSpoChecklist] = useState<Record<string, SpoCheckStatus>>(() =>
    buildInitialSpoChecklist(initialDetails?.spoChecklist)
  );

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
  const [arterialPressure] = useState(initialDetails?.section4.arterialPressure || '-120');
  const [venousPressure] = useState(initialDetails?.section4.venousPressure || '130');
  const [tmp] = useState(initialDetails?.section4.tmp || '85');
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
  const [educationNotes] = useState(
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
  const [bleedingStopMinutes] = useState(
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
  const [postPulse] = useState(initialDetails?.section6.postPulse || '80');
  const [postResp] = useState(initialDetails?.section6.postResp || '18');
  const [postTemp] = useState(initialDetails?.section6.postTemp || '36.5');
  const [postSpo2] = useState(initialDetails?.section6.postSpo2 || '99');
  const [wasteDecontaminated, setWasteDecontaminated] = useState(
    initialDetails?.section6.wasteDecontaminated ?? true
  );
  const [machineDisinfectionType] = useState<'Heat Disinfection' | 'Chemical Disinfection'>(
    initialDetails?.section6.machineDisinfectionType || 'Heat Disinfection'
  );
  const [nursingNotes] = useState(editingEntry?.nursingNotes || '');
  const [handoverSummary] = useState(
    initialDetails?.section6.handoverSummary || 'Kondisi stabil pasca dialisis, siap pulang / timbang terima.'
  );

  // Section 7: Submission Target
  const [targetVerifierRole, setTargetVerifierRole] = useState<'PJ Shift' | 'Kepala Ruang'>(
    editingEntry?.targetVerifierRole || 'Kepala Ruang'
  );
  const [targetVerifierId, setTargetVerifierId] = useState(editingEntry?.targetVerifierId || '');
  const [submissionNote, setSubmissionNote] = useState(
    editingEntry ? initialDetails?.section6.handoverSummary || '' : ''
  );
  const [submissionConfirmed, setSubmissionConfirmed] = useState(
    Boolean(editingEntry && editingEntry.verificationStatus !== 'Draft')
  );

  // Computed SPO counts
  const totalSpoCount = SPO_POINTS.length;
  const doneSpoCount = useMemo(
    () => SPO_POINTS.filter((p) => spoChecklist[p.id] === 'DIKERJAKAN').length,
    [spoChecklist]
  );

  const stepPoints = useMemo(
    () => SPO_POINTS.filter((p) => p.step === step),
    [step]
  );

  const stepDoneCount = useMemo(
    () => stepPoints.filter((p) => spoChecklist[p.id] === 'DIKERJAKAN').length,
    [stepPoints, spoChecklist]
  );

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
    const pts = SPO_POINTS.filter((p) => p.step === targetStep);
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
    const pts = SPO_POINTS.filter((p) => p.step === targetStep);
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
  };

  const resetAllChecklist = () => {
    setSpoChecklist(buildInitialSpoChecklist());
    for (const pt of SPO_POINTS) {
      syncBooleanSubChecks(pt.id, false);
    }
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
      activePatients.filter((p) =>
        isPatientScheduledOnDay(p.routineSchedule, currentDayName)
      ),
    [activePatients, currentDayName]
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
      ? activePatients.filter((p) => isPatientScheduledOnDay(p.routineSchedule, nextDay))
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
      if (onlyScheduledForDay && !isPatientScheduledOnDay(exact.routineSchedule, currentDayName)) {
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
          pulse: '80',
          bfr: bfr || '250',
          ufr: '600',
          arterialPressure,
          venousPressure,
          tmp,
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
    if (targetStep === 1) {
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
      if (!dialysateTemp.trim()) return 'Isi suhu dialisat pada Bagian 2.';
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
      if (serviceStatus === 'Rawat Inap' && !inpatientWard) {
        return 'Wajib memilih Nama Bangsal / Ruang Rawat Inap (CAMELIA, DAHLIA, atau ICU) pada Poin 3.1 (Bagian 3).';
      }
      if (!preWeight.trim()) {
        return 'Lengkapi Berat Badan Datang (Pre-HD) pada Poin 3.2 (Bagian 3).';
      }
      if (!systolicBp.trim() || !diastolicBp.trim()) {
        return 'Wajib mengisi kedua kolom Sistolik dan Diastolik pada Poin 3.3 (Bagian 3).';
      }
      if (!informedConsent) return 'Persetujuan tindakan (Informed Consent) harus terverifikasi.';
    }
    if (targetStep === 6) {
      if (!postBp.trim() || !ufAchieved.trim() || !ktv.trim()) {
        return 'Wajib mengisi semua kolom (Tekanan Darah Post HD, Nilai UFG Tercapai, dan KT/V) pada Poin 6.3 (Bagian 6).';
      }
      if (!postWeight.trim()) {
        return 'Lengkapi Berat Badan Pulang (Post-HD) pada Poin 3.2 (Bagian 3).';
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
    setStep((s) => Math.min(7, s + 1));
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

    if (submitStatus === 'Pending' || isVerifierEdit) {
      for (const s of [1, 2, 3, 6]) {
        const err = validateStep(s);
        if (err) {
          setStep(s);
          setErrorMsg(err);
          return 'error';
        }
      }
      if (submitStatus === 'Pending' && !isVerifierEdit && !submissionConfirmed) {
        setStep(7);
        setErrorMsg(
          'Centang pernyataan konfirmasi bahwa seluruh indikator SPO Bagian I–VI telah diperiksa sebelum mengajukan verifikasi.'
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
        : preBp.trim() || '120/80';
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
        loadingDose: clampString(loadingDose || '2000 IU', 40),
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
        bfr: clampString(bfr || '220', 20),
        dfr: clampString(dfr || '500', 20),
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
      spoChecklist,
    };

    const derivedCategory =
      patientCategory && patientCategory !== 'Reguler'
        ? patientCategory
        : actionCategory || 'HD Reguler';

    const resolvedHandover = submissionNote.trim() || handoverSummary;
    const safeStartTime = clampString(startTime.trim() || '07:30', 10) || '07:30';
    const safeEndTime = clampString(endTime.trim() || '12:00', 10) || '12:00';
    const safePreBp = clampString(resolvedPreBp.length >= 3 ? resolvedPreBp : '120/80', 20);
    const safePostBp = clampString(postBp.trim().length >= 3 ? postBp.trim() : '120/80', 20);

    const normalizedSpoChecklist: Record<string, SpoCheckStatus> = {};
    for (const pt of SPO_POINTS) {
      normalizedSpoChecklist[pt.id] =
        spoChecklist[pt.id] === 'DIKERJAKAN' ? 'DIKERJAKAN' : 'TIDAK DIKERJAKAN';
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
    const safeTargetVerifierRole: 'PJ Shift' | 'Kepala Ruang' =
      targetVerifierRole === 'PJ Shift' ? 'PJ Shift' : 'Kepala Ruang';

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
      updatedAt: serverTimestamp(),
    };

    setSaving(true);
    if (keepOpen) {
      setAutoSaveInfo((prev) => ({ ...prev, status: 'saving' }));
    }
    let txOp: OperationType = currentEntry ? OperationType.UPDATE : OperationType.CREATE;
    let txPath = currentEntry ? `logbook/${currentEntry.id}` : 'logbook';
    try {
      const monthKey = safeDate.slice(0, 7);
      const newMachineLockId = `${safeDate}_${safeShift}_${mach.id}`;
      const oldMachineLockId = currentEntry
        ? `${currentEntry.date}_${currentEntry.shift}_${currentEntry.machineId}`
        : '';
      const isAdminRole = userProfile.role === 'Administrator';
      const isVerifierRole =
        isAdminRole ||
        userProfile.role === 'Kepala Ruang' ||
        userProfile.role === 'PJ Shift';
      const safeLockPatientName = clampString(pat.fullName, 120) || 'Pasien HD';
      const safeLockNurseName = clampString(userProfile.fullName, 120) || 'Perawat HD';
      const existingLogbookIds = new Set(logbooks.map((lb) => lb.id));
      let savedDocId = currentEntry?.id || '';
      let savedOwnerId = userProfile.uid;
      let savedOwnerName = safeLockNurseName;

      await runTransaction(db, async (tx) => {
        const targetLogRef = currentEntry
          ? doc(db, 'logbook', currentEntry.id)
          : doc(collection(db, 'logbook'));
        savedDocId = targetLogRef.id;

        let existingLogSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
        if (currentEntry) {
          txOp = OperationType.GET;
          txPath = targetLogRef.path;
          existingLogSnap = await tx.get(targetLogRef);
        }

        const newMachineLockRef = doc(db, 'machine_locks', newMachineLockId);
        txOp = OperationType.GET;
        txPath = newMachineLockRef.path;
        const newMachineLockSnap = await tx.get(newMachineLockRef);

        const oldMachineLockRef =
          oldMachineLockId && oldMachineLockId !== newMachineLockId
            ? doc(db, 'machine_locks', oldMachineLockId)
            : null;
        let oldMachineLockSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
        if (oldMachineLockRef) {
          txOp = OperationType.GET;
          txPath = oldMachineLockRef.path;
          oldMachineLockSnap = await tx.get(oldMachineLockRef);
        }

        let newPatientLockRef: ReturnType<typeof doc> | null = null;
        let newPatientLockSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
        let oldPatientLockRef: ReturnType<typeof doc> | null = null;
        let oldPatientLockSnap: Awaited<ReturnType<typeof tx.get>> | null = null;

        if (currentEntry) {
          const oldLockId = `${currentEntry.date}_${currentEntry.patientId}`;
          const newLockId = `${safeDate}_${pat.id}`;
          if (oldLockId !== newLockId) {
            newPatientLockRef = doc(db, 'logbook_locks', newLockId);
            txOp = OperationType.GET;
            txPath = newPatientLockRef.path;
            newPatientLockSnap = await tx.get(newPatientLockRef);
            oldPatientLockRef = doc(db, 'logbook_locks', oldLockId);
            txOp = OperationType.GET;
            txPath = oldPatientLockRef.path;
            oldPatientLockSnap = await tx.get(oldPatientLockRef);
          }
        } else {
          newPatientLockRef = doc(db, 'logbook_locks', `${safeDate}_${pat.id}`);
          txOp = OperationType.GET;
          txPath = newPatientLockRef.path;
          newPatientLockSnap = await tx.get(newPatientLockRef);
        }

        let entryOwnerId = userProfile.uid;
        let entryOwnerName = safeLockNurseName;
        let canVerifierEditCurrent = false;

        if (currentEntry) {
          if (!existingLogSnap || !existingLogSnap.exists()) {
            throw new Error('LOGBOOK_MISSING');
          }
          const currentLogData = existingLogSnap.data() as Partial<LogbookEntry>;
          const currentStatus = currentLogData.verificationStatus;
          canVerifierEditCurrent =
            isVerifierRole &&
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
        }
        savedOwnerId = entryOwnerId;
        savedOwnerName = entryOwnerName;

        if (newPatientLockSnap && newPatientLockSnap.exists()) {
          const plData = newPatientLockSnap.data() as Partial<LogbookLock>;
          const sameEntry = Boolean(currentEntry && plData.logbookId === currentEntry.id);
          const knownOrphan = Boolean(
            (isAdminRole || plData.nurseId === userProfile.uid || canVerifierEditCurrent) &&
              plData.logbookId &&
              !existingLogbookIds.has(plData.logbookId)
          );
          if (!sameEntry && !knownOrphan) {
            throw new Error(`PATIENT_LOCKED:${plData.nurseName || 'staf lain'}`);
          }
        }

        if (newMachineLockSnap.exists()) {
          const lockData = newMachineLockSnap.data() as MachineLock;
          const ownedByCurrent = lockData.nurseId === userProfile.uid;
          const matchesThisSlot =
            (currentEntry && lockData.logbookId === currentEntry.id) ||
            (!lockData.logbookId && lockData.patientId === pat.id);
          const knownOrphan = Boolean(
            (isAdminRole || ownedByCurrent || canVerifierEditCurrent) &&
              lockData.logbookId &&
              !existingLogbookIds.has(lockData.logbookId)
          );
          if (
            !(ownedByCurrent && matchesThisSlot) &&
            !((isAdminRole || canVerifierEditCurrent) && currentEntry && lockData.logbookId === currentEntry.id) &&
            !knownOrphan
          ) {
            throw new Error(
              `MACHINE_LOCKED:${lockData.nurseName || 'staf lain'}`
            );
          }
        }

        const isFirestoreTimestamp = (val: unknown): boolean =>
          Boolean(val && typeof (val as { toMillis?: unknown }).toMillis === 'function');

        txOp = currentEntry ? OperationType.UPDATE : OperationType.CREATE;
        txPath = `logbook/${targetLogRef.id}`;
        if (currentEntry && existingLogSnap?.exists()) {
          const currentLogData = existingLogSnap.data() as Partial<LogbookEntry>;
          const updatePayload: Record<string, unknown> = { ...payload };
          if (!isFirestoreTimestamp(currentLogData.createdAt)) {
            updatePayload.createdAt = serverTimestamp();
          }
          if (typeof currentLogData.nurseNip !== 'string' || currentLogData.nurseNip.length > 40) {
            updatePayload.nurseNip = clampString(
              typeof currentLogData.nurseNip === 'string'
                ? currentLogData.nurseNip
                : currentLogData.nurseId === userProfile.uid
                ? userProfile.nip
                : '',
              40
            );
          }
          if (
            typeof currentLogData.nurseName !== 'string' ||
            currentLogData.nurseName.trim().length === 0 ||
            currentLogData.nurseName.length > 120
          ) {
            updatePayload.nurseName = entryOwnerName;
          }
          tx.update(targetLogRef, updatePayload);
        } else {
          tx.set(targetLogRef, {
            ...payload,
            nurseId: userProfile.uid,
            nurseName: safeLockNurseName,
            nurseNip: clampString(userProfile.nip, 40),
            createdAt: serverTimestamp(),
          });
        }

        if (oldPatientLockRef && oldPatientLockSnap?.exists()) {
          const oldPL = oldPatientLockSnap.data() as Partial<LogbookLock>;
          if (isAdminRole || canVerifierEditCurrent || oldPL.nurseId === userProfile.uid) {
            txOp = OperationType.DELETE;
            txPath = oldPatientLockRef.path;
            tx.delete(oldPatientLockRef);
          }
        }
        if (newPatientLockRef) {
          const existingPL = newPatientLockSnap?.exists()
            ? (newPatientLockSnap.data() as Partial<LogbookLock>)
            : null;
          txOp = existingPL ? OperationType.UPDATE : OperationType.CREATE;
          txPath = newPatientLockRef.path;
          const keepExistingCreatedAt = Boolean(
            existingPL &&
              existingPL.logbookId === targetLogRef.id &&
              existingPL.nurseId === entryOwnerId &&
              isFirestoreTimestamp(existingPL.createdAt)
          );
          tx.set(newPatientLockRef, {
            id: `${safeDate}_${pat.id}`,
            date: safeDate,
            monthKey,
            patientId: pat.id,
            patientName: safeLockPatientName,
            nurseId: entryOwnerId,
            nurseName: entryOwnerName,
            logbookId: targetLogRef.id,
            createdAt: keepExistingCreatedAt ? existingPL!.createdAt : serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (oldMachineLockRef && oldMachineLockSnap?.exists()) {
          const oldML = oldMachineLockSnap.data() as MachineLock;
          if (isAdminRole || canVerifierEditCurrent || oldML.nurseId === userProfile.uid) {
            txOp = OperationType.DELETE;
            txPath = oldMachineLockRef.path;
            tx.delete(oldMachineLockRef);
          }
        }

        const safeMachineNumber = clampString(mach.machineNumber, 40) || 'HD';
        if (newMachineLockSnap.exists()) {
          const existingML = newMachineLockSnap.data() as Partial<MachineLock>;
          const sameOwner = existingML.nurseId === entryOwnerId;
          const isOrphanReclaim =
            Boolean(existingML.logbookId) &&
            !existingLogbookIds.has(existingML.logbookId as string);
          const preserveOtherOwner =
            !sameOwner && (isAdminRole || canVerifierEditCurrent) && !isOrphanReclaim;
          const targetLockNurseId =
            preserveOtherOwner && existingML.nurseId ? existingML.nurseId : entryOwnerId;
          const targetLockNurseName =
            preserveOtherOwner && existingML.nurseName
              ? clampString(existingML.nurseName, 120) || entryOwnerName
              : entryOwnerName;
          const hasValidTimestamps =
            isFirestoreTimestamp(existingML.createdAt) &&
            isFirestoreTimestamp(existingML.updatedAt);

          const lockAlreadyMatches =
            hasValidTimestamps &&
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
            existingML.logbookId === targetLogRef.id;

          if (!lockAlreadyMatches) {
            txOp = OperationType.UPDATE;
            txPath = newMachineLockRef.path;
            tx.set(newMachineLockRef, {
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
              logbookId: targetLogRef.id,
              createdAt:
                (sameOwner || preserveOtherOwner) && isFirestoreTimestamp(existingML.createdAt)
                  ? existingML.createdAt
                  : serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          txOp = OperationType.CREATE;
          txPath = newMachineLockRef.path;
          tx.set(newMachineLockRef, {
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
            logbookId: targetLogRef.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
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
      } else {
        handleFirestoreError(err, txOp, txPath);
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
      const result = await handleSave(getAutoDraftStatus(), {
        keepOpen: true,
        silentIfNotReady: true,
      });
      if (result === 'error') {
        return;
      }
    }

    setStep(targetStep);
  };

  const renderSpoPointCard = (
    pointId: string,
    children?: React.ReactNode,
    inlineFooter?: React.ReactNode
  ) => {
    const meta = SPO_POINT_MAP.get(pointId);
    if (!meta) return null;
    const status = spoChecklist[pointId] || 'TIDAK DIKERJAKAN';
    const isDone = status === 'DIKERJAKAN';

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
              <p className="text-[11px] text-slate-500 leading-relaxed">{meta.description}</p>
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
              /* Single Checklist Toggle Button Matching Screenshot for Bagian 1 & 2 */
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

          {inlineFooter && <div className="mt-3.5">{inlineFooter}</div>}
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

  const activeStepMeta = STEPS[step - 1];

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
                  ? `Detail Lengkap Logbook Hemodialisa · Bagian ${step} dari 7`
                  : isVerifierEdit
                  ? `Ubah Logbook Sebelum Verifikasi (${userProfile?.role || 'Verifikator'}) · Bagian ${step} dari 7`
                  : `Formulir Asuhan Keperawatan Hemodialisa · Bagian ${step} dari 7`}
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
                title="Reset seluruh checklist SPO Bagian 1–7 menjadi TIDAK DIKERJAKAN"
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

        {/* 7-Tab Navigation Strip (Bagian 1 - Bagian 7) */}
        <div className="border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {STEPS.map((s) => {
                const isActive = step === s.num;
                const ptsInStep = SPO_POINTS.filter((p) => p.step === s.num);
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
        <div className="flex-1 overflow-y-auto bg-slate-50/60 px-4 py-4 sm:px-6 sm:py-5 space-y-4">
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
          {/* BAGIAN 1: Kesiapan Ruangan dan Air RO */}
          {step === 1 && (
            <div className="space-y-3.5">
              {renderSpoPointCard('1.1')}
              {renderSpoPointCard('1.2')}
              {renderSpoPointCard('1.3')}
            </div>
          )}

          {/* BAGIAN 2: PPI, Mesin dan BHP */}
          {step === 2 && (
            <div className="space-y-3.5">
              {renderSpoPointCard(
                '2.1',
                undefined,
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
              )}
              {renderSpoPointCard('2.2')}
              {renderSpoPointCard('2.3')}
              {renderSpoPointCard('2.4')}
              {renderSpoPointCard('2.5')}
              {renderSpoPointCard('2.6')}
            </div>
          )}

          {/* BAGIAN 3: PRE HD (Pengkajian Sebelum Tindakan) */}
          {step === 3 && (
            <div className="space-y-3.5">
              {/* Poin 3.1 */}
              {renderSpoPointCard(
                '3.1',
                undefined,
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
                          {/* Pemilihan Bangsal Rawat Inap */}
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

                          {/* Status CITO / Urgensi Pasien */}
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
                              <span className="text-[11px] font-normal text-slate-400">
                                {cat.hint}
                              </span>
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
              )}

              {/* Poin 3.2 */}
              {renderSpoPointCard(
                '3.2',
                undefined,
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
                          placeholder="Contoh: 64.2"
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
                          placeholder="Contoh: 61.6"
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
                          placeholder="Contoh: 61.5"
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
                        <span className="text-[11px] text-slate-500">
                          (BB Datang − BB Kering)
                        </span>
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
              )}

              {/* Poin 3.3 */}
              {renderSpoPointCard(
                '3.3',
                undefined,
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
                      placeholder="Sistolik (140)"
                      className="w-36 sm:w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                    />
                    <span className="text-sm font-semibold text-slate-400">/</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={diastolicBp}
                      onChange={(e) => updateSystolicDiastolic(systolicBp, e.target.value)}
                      placeholder="Diastolik (85)"
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
              )}

              {/* Poin 3.4 */}
              {renderSpoPointCard('3.4')}

              {/* Poin 3.5 */}
              {renderSpoPointCard(
                '3.5',
                undefined,
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
                          placeholder="4.5"
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
                          placeholder="2500"
                          className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                          mL
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                        QB
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={bfr}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBfr(val);
                            syncPoint35Checklist(dialysisDurationHours, ufGoal, val, dfr, loadingDose);
                          }}
                          placeholder="220"
                          className="w-full rounded-lg border border-slate-300 bg-white pl-3 pr-16 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0e4e78]">
                          mL/mnt
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                        QD
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={dfr}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDfr(val);
                            syncPoint35Checklist(dialysisDurationHours, ufGoal, bfr, val, loadingDose);
                          }}
                          placeholder="500"
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
                        placeholder="2000 IU / Free"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                  </div>
                  {!isPoint35Complete(dialysisDurationHours, ufGoal, bfr, dfr, loadingDose) && (
                    <p className="text-[11px] font-medium text-amber-600">
                      Wajib mengisi kolom Waktu Dialisis / Time, Target UFG, QB, QD, dan Dosis Heparin agar Poin 3.5 bernilai DIKERJAKAN.
                    </p>
                  )}
                </div>
              )}

              {/* Poin 3.6 */}
              {renderSpoPointCard(
                '3.6',
                undefined,
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
                    {/* CIMINO */}
                    <div
                      className={`rounded-lg border p-3 transition-colors ${
                        selectedAccessOption === 'CIMINO'
                          ? 'border-[#0e4e78] bg-[#0e4e78]/[0.03]'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <label className="flex items-center justify-between gap-2 mb-2.5 cursor-pointer">
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
                      <input
                        type="text"
                        value={ciminoNote}
                        onChange={(e) => {
                          setCiminoNote(e.target.value);
                          if (e.target.value && selectedAccessOption !== 'CIMINO') {
                            handleSelectVascularOption('CIMINO');
                          }
                        }}
                        placeholder="Contoh: Sinistra, thrill (+) kuat"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>

                    {/* CDL */}
                    <div
                      className={`rounded-lg border p-3 transition-colors ${
                        selectedAccessOption === 'CDL'
                          ? 'border-[#0e4e78] bg-[#0e4e78]/[0.03]'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <label className="flex items-center justify-between gap-2 mb-2.5 cursor-pointer">
                        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-800">
                          <input
                            type="checkbox"
                            checked={selectedAccessOption === 'CDL'}
                            onChange={() =>
                              handleSelectVascularOption(
                                selectedAccessOption === 'CDL' ? '' : 'CDL'
                              )
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78] focus:ring-[#0e4e78]"
                          />
                          <span>CDL</span>
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">
                          Catheter Double Lumen
                        </span>
                      </label>
                      <input
                        type="text"
                        value={cdlNote}
                        onChange={(e) => {
                          setCdlNote(e.target.value);
                          if (e.target.value && selectedAccessOption !== 'CDL') {
                            handleSelectVascularOption('CDL');
                          }
                        }}
                        placeholder="Contoh: Jugularis Dextra, bersih"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>

                    {/* FEMORAL */}
                    <div
                      className={`rounded-lg border p-3 transition-colors ${
                        selectedAccessOption === 'FEMORAL'
                          ? 'border-[#0e4e78] bg-[#0e4e78]/[0.03]'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <label className="flex items-center justify-between gap-2 mb-2.5 cursor-pointer">
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
                      <input
                        type="text"
                        value={femoralNote}
                        onChange={(e) => {
                          setFemoralNote(e.target.value);
                          if (e.target.value && selectedAccessOption !== 'FEMORAL') {
                            handleSelectVascularOption('FEMORAL');
                          }
                        }}
                        placeholder="Contoh: Femoralis Dextra, lancar"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                  </div>
                  {!selectedAccessOption && (
                    <p className="text-[11px] font-medium text-amber-600">
                      Wajib mencentang salah satu kolom akses vaskular (CIMINO, CDL, atau FEMORAL) agar Poin 3.6 bernilai DIKERJAKAN.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* BAGIAN 4: Intra HD (Monitoring Selama Tindakan) */}
          {step === 4 && (
            <div className="space-y-3.5">
              {/* Poin 4.1 */}
              {renderSpoPointCard(
                '4.1',
                undefined,
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
                          <span className="font-bold text-slate-800">
                            Observasi TTV #{idx + 1}
                          </span>
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
                              placeholder="Contoh: 10:00"
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
                              placeholder="Sistolik (130)"
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
                              placeholder="Diastolik (80)"
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
                            placeholder="82"
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
                            placeholder="20"
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
                            placeholder="36.6"
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
                            placeholder="99"
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
              )}

              {/* Poin 4.2 */}
              {renderSpoPointCard('4.2')}

              {/* Poin 4.3 */}
              {renderSpoPointCard(
                '4.3',
                undefined,
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
                    const detailValue =
                      inputMeta.field === 'bp' ? inc.bp : inc.clinicalDetail || '';
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
                                placeholder="22:39"
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
                                handleUpdateComplicationIncident(
                                  inc.id,
                                  'doctorAdvice',
                                  e.target.value
                                )
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
              )}

              {/* Poin 4.4 */}
              {renderSpoPointCard('4.4')}
            </div>
          )}

          {/* BAGIAN 5: Edukasi Pasien & Keluarga */}
          {step === 5 && (
            <div className="space-y-3.5">
              {renderSpoPointCard('5.1')}
              {renderSpoPointCard('5.2')}
              {renderSpoPointCard('5.3')}
              {renderSpoPointCard('5.4')}
              {renderSpoPointCard('5.5')}
            </div>
          )}

          {/* BAGIAN 6: Post HD (Pengakhiran & Evaluasi) */}
          {step === 6 && (
            <div className="space-y-3.5">
              {/* Poin 6.1 */}
              {renderSpoPointCard('6.1')}

              {/* Poin 6.2 */}
              {renderSpoPointCard('6.2')}

              {/* Poin 6.3 */}
              {renderSpoPointCard(
                '6.3',
                undefined,
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                        Tekanan Darah Post HD <span className="text-slate-400 font-normal">(mmHg)</span>
                      </label>
                      <input
                        type="text"
                        value={postBp}
                        onChange={(e) => updatePostHdEvaluation(e.target.value, ufAchieved, ktv)}
                        placeholder="Contoh: 120/80"
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
                        placeholder="Contoh: 2500"
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
                        placeholder="Contoh: 1.8 atau 1.2"
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
              )}

              {/* Poin 6.4 */}
              {renderSpoPointCard('6.4')}

              {/* Poin 6.5 */}
              {renderSpoPointCard('6.5')}
            </div>
          )}

          {/* BAGIAN 7: Pengajuan Verifikasi */}
          {step === 7 && (
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
                      Klik tombol Tinjau untuk memeriksa atau melengkapi indikator SPO Bagian I - VI pasien ini sebelum pengajuan verifikasi.
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
                        <th className="px-4 py-2.5 font-medium">Cakupan Standar SPO</th>
                        <th className="px-4 py-2.5 text-right font-medium">Capaian SPO</th>
                        <th className="px-5 py-2.5 text-right font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {[
                        {
                          stepNum: 1,
                          roman: 'BAGIAN I',
                          scope: 'Kesiapan Fasilitas Ruangan & Water Treatment (RO)',
                        },
                        {
                          stepNum: 2,
                          roman: 'BAGIAN II',
                          scope: 'Persiapan Perawat, Mesin HD & Alkes (Pre-HD)',
                        },
                        {
                          stepNum: 3,
                          roman: 'BAGIAN III',
                          scope: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan',
                        },
                        {
                          stepNum: 4,
                          roman: 'BAGIAN IV',
                          scope: 'Monitoring Intra-HD & Pencegahan IKP',
                        },
                        {
                          stepNum: 5,
                          roman: 'BAGIAN V',
                          scope: 'Edukasi Terstruktur Pasien & Keluarga',
                        },
                        {
                          stepNum: 6,
                          roman: 'BAGIAN VI',
                          scope: 'Terminasi Aman, Evaluasi Post-HD & Dokumentasi',
                        },
                      ].map((row) => {
                        const pts = SPO_POINTS.filter((p) => p.step === row.stepNum);
                        const doneCount = pts.filter(
                          (p) => spoChecklist[p.id] === 'DIKERJAKAN'
                        ).length;
                        const totalCount = pts.length;
                        const pct =
                          totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                        const allDone = totalCount > 0 && doneCount === totalCount;

                        return (
                          <tr key={row.stepNum} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-5 py-3 font-bold text-[#0e4e78] text-[11px] whitespace-nowrap">
                              {row.roman}
                            </td>
                            <td className="px-4 py-3 text-slate-700">{row.scope}</td>
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
                                  setStep(row.stepNum);
                                }}
                                className="text-[11px] font-semibold text-[#0e4e78] hover:underline"
                              >
                                Tinjau
                              </button>
                            </td>
                          </tr>
                        );
                      })}
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
                    PJ Shift dapat mengajukan verifikasi logbook pasien ini kepada Kepala Ruang atau kepada PJ Shift lainnya. Setelah diverifikasi, data pasien ini tercatat pada halaman Riwayat &amp; Laporan Harian.
                  </p>
                </div>

                {/* Inner Box: Pilih Tujuan Pengajuan Verifikasi */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <p className="text-[11px] font-bold text-slate-800">
                    Pilih Tujuan Pengajuan Verifikasi Logbook PJ Shift:
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
                    Seluruh pengisian indikator SPO Bagian I–VI untuk pasien{' '}
                    {selectedPatient ? selectedPatient.fullName.toUpperCase() : '-'} telah diperiksa dan siap diajukan untuk diverifikasi oleh{' '}
                    {targetVerifierRole === 'Kepala Ruang' ? 'Kepala Ruang' : 'PJ Shift'}.
                  </span>
                </label>
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
            step === 7 &&
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
                <>
                  {step < 7 && (
                    <button
                      type="button"
                      onClick={() => setStep((s) => Math.min(7, s + 1))}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors"
                    >
                      Bagian {step + 1}
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={verifierReview.processing}
                    onClick={verifierReview.onRequestRevision}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Minta Revisi
                  </button>
                  <button
                    type="button"
                    disabled={verifierReview.processing}
                    onClick={verifierReview.onApprove}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Setujui &amp; Validasi
                  </button>
                </>
              ) : step < 7 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(7, s + 1))}
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
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handleSave(
                      editingEntry?.verificationStatus === 'Revision' ? 'Revision' : 'Pending'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Menyimpan Perubahan...' : 'Simpan Perubahan Logbook'}
                </button>

                {step < 7 && (
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
            ) : (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void handleSave(getAutoDraftStatus());
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  <Save className="h-4 w-4 text-slate-500" />
                  {saving
                    ? 'Menyimpan...'
                    : getAutoDraftStatus() === 'Revision'
                    ? 'Simpan Revisi'
                    : 'Simpan sebagai Draft'}
                </button>

                {step < 7 ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      void handleSwitchStep(Math.min(7, step + 1), { validateCurrent: true });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-semibold text-white hover:bg-[#093b5c] transition-colors disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5 opacity-80" />
                    {saving ? 'Menyimpan...' : `Simpan & Lanjut Bagian ${step + 1}`}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSave('Pending')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    {step === 7 ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    {saving ? 'Mengajukan...' : 'Ajukan Verifikasi'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

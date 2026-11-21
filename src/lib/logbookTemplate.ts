import { clampString } from './formatters';
import type {
  CustomLogbookField,
  LogbookFormTemplate,
  LogbookPointTemplate,
  LogbookSectionTemplate,
  TtvSubFieldsConfig,
  TtvValue,
  WizardCustomPointResponse,
} from '../types';

export const LOGBOOK_TEMPLATE_DOC_ID = 'logbook_hd';

export const DEFAULT_TTV_CONFIG: Required<TtvSubFieldsConfig> = {
  td: true,
  nadi: true,
  rr: true,
  suhu: true,
  spo2: true,
};

export const DEFAULT_LOGBOOK_SECTIONS: LogbookSectionTemplate[] = [
  {
    num: 1,
    short: 'Ruang & RO',
    title: 'Bagian 1: Kesiapan Ruangan dan Air RO',
    roman: 'BAGIAN I',
    scope: 'Kesiapan Fasilitas Ruangan & Water Treatment (RO)',
    monthlyTitle:
      'BAGIAN I: KESIAPAN FASILITAS RUANGAN HEMODIALISIS & SISTEM WATER TREATMENT (RO) — [NILAI MAKS. 1 / HARI]',
    monthlyMaxMode: 'daily_cap_1',
    visible: true,
  },
  {
    num: 2,
    short: 'PPI & Mesin',
    title: 'Bagian 2: PPI, Mesin dan BHP',
    roman: 'BAGIAN II',
    scope: 'Persiapan Perawat, Mesin HD & Alkes (Pre-HD)',
    monthlyTitle:
      'BAGIAN II: PERSIAPAN PERAWAT, PERALATAN, MESIN HD & ALAT KESEHATAN (PRE-HD) — [NILAI SESUAI PASIEN KELOLAAN]',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
  {
    num: 3,
    short: 'Pre HD',
    title: 'Bagian 3: PRE HD (Pengkajian Sebelum Tindakan)',
    roman: 'BAGIAN III',
    scope: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan',
    monthlyTitle:
      'BAGIAN III: IDENTIFIKASI PASIEN, PENGKAJIAN PRE-HD & KESELAMATAN PASIEN (PATIENT SAFETY) — [NILAI SESUAI PASIEN KELOLAAN]',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
  {
    num: 4,
    short: 'Intra HD',
    title: 'Bagian 4: Intra HD (Monitoring Selama Tindakan)',
    roman: 'BAGIAN IV',
    scope: 'Monitoring Intra-HD & Pencegahan IKP',
    monthlyTitle:
      'BAGIAN IV: MONITORING INTRA-HD & PENCEGAHAN INSIDEN KESELAMATAN PASIEN (IKP) — [NILAI SESUAI PASIEN KELOLAAN]',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
  {
    num: 5,
    short: 'Edukasi',
    title: 'Bagian 5: Edukasi Pasien & Keluarga',
    roman: 'BAGIAN V',
    scope: 'Edukasi Terstruktur Pasien & Keluarga',
    monthlyTitle:
      'BAGIAN V: EDUKASI TERSTRUKTUR KEPADA PASIEN & KELUARGA (DIET, CAIRAN, KEBERSIHAN DIRI) — [NILAI SESUAI PASIEN KELOLAAN]',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
  {
    num: 6,
    short: 'Post HD',
    title: 'Bagian 6: Post HD (Pengakhiran & Evaluasi)',
    roman: 'BAGIAN VI',
    scope: 'Terminasi Aman, Evaluasi Post-HD & Dokumentasi',
    monthlyTitle:
      'BAGIAN VI: TERMINASI AMAN, EVALUASI POST-HD, DISINFEKSI MESIN & PENDOKUMENTASIAN — [NILAI SESUAI PASIEN KELOLAAN]',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
  {
    num: 7,
    short: 'Transfusi & EPO',
    title: 'Bagian 7: Transfusi Darah & Pemberian EPO',
    roman: 'BAGIAN VII',
    scope: 'Pemberian Transfusi Darah & Terapi EPO',
    monthlyTitle: 'BAGIAN VII: TRANSFUSI DARAH & PEMBERIAN EPO (CATATAN TAMBAHAN)',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
  {
    num: 8,
    short: 'Verifikasi',
    title: 'Bagian 8: Pengajuan Verifikasi',
    roman: 'BAGIAN VIII',
    scope: 'Pengajuan Verifikasi Logbook',
    monthlyTitle: '',
    monthlyMaxMode: 'per_patient',
    visible: true,
  },
];

export const DEFAULT_LOGBOOK_POINTS: LogbookPointTemplate[] = [
  // Bagian 1
  {
    id: '1.1',
    step: 1,
    order: 1,
    visible: true,
    category: 'Water Treatment & Mutu Air RO',
    statement:
      'Memastikan kesiapan sistem Water Treatment (Reverse Osmosis / RO), uji konduktivitas, tekanan sirkulasi, serta kualitas air dialisis sesuai baku mutu AAMI/PERNEFRI.',
    description:
      'Periksa konduktivitas air RO (< 10 µS/cm), tekanan pompa distribusi, level garam softner, dan bebas klorin/kloramin sebelum shift dimulai.',
    standard: 'TDS / Konduktivitas RO < 10 µS/cm · Total Chlorine < 0.1 mg/L · Tekanan Loop RO Stabil',
    monthlyStandard: 'SPO-HD-01: Mutu Air RO & Pre-Treatment Harian',
  },
  {
    id: '1.2',
    step: 1,
    order: 2,
    visible: true,
    category: 'Kesiapan Ruangan & Zonasi Infeksi',
    statement:
      'Memastikan kesiapan ruangan hemodialisis, suhu dan kelembaban lingkungan, sanitasi permukaan tempat tidur, serta kepatuhan pemisahan area infeksius (Hepatitis B/C).',
    description:
      'Pastikan suhu ruangan 20–24°C, kelembaban 40–60%, pencahayaan cukup, kebersihan bed, serta pemisahan tegas zona Reguler dan Isolasi Hep B / Hep C.',
    standard: 'Suhu 20–24°C · Zonasi Reguler & Isolasi Terpisah · Linen & Bed Siap Pakai',
    monthlyStandard: 'SPO-HD-02: Kesiapan Lingkungan & PPI Unit Dialisis',
  },
  {
    id: '1.3',
    step: 1,
    order: 3,
    visible: true,
    category: 'Emergency Room & Troli Emergensi',
    statement:
      'Memastikan kesiapan fasilitas kegawatdaruratan (Emergency Trolley, obat-obatan emergensi, defibrilator, oksigen sentral, dan suction) sebelum pelayanan dimulai.',
    description:
      'Periksa segel troli emergensi, kelengkapan obat life-saving (Epinefrin, Sulfas Atropin, Dextrose 40%, NaCl 0,9%), defibrilator, ambubag, dan oksigen sentral.',
    standard: 'Troli Emergensi Terkunci/Lengkap · Oksigen & Suction Siap · Defibrilator Ready',
    monthlyStandard: 'SPO-HD-03: Pemeriksaan Troli & Peralatan Emergensi HD',
  },
  // Bagian 2
  {
    id: '2.1',
    step: 2,
    order: 1,
    visible: true,
    category: 'PPI & Keselamatan Petugas',
    statement:
      'Melaksanakan kepatuhan kebersihan tangan (5 Moments for Hand Hygiene) dan pemakaian Alat Pelindung Diri (APD) standar dialisis sebelum kontak pasien/mesin.',
    description:
      'Lakukan hand hygiene 6 langkah pada 5 momen WHO dan gunakan APD lengkap (masker medis, apron/gown kedap air, goggle/faceshield, sarung tangan bersih/steril).',
    standard: '',
    monthlyStandard: 'SPO-PPI-01: Hand Hygiene & Penggunaan APD Dialisis',
  },
  {
    id: '2.2',
    step: 2,
    order: 2,
    visible: true,
    category: 'Kalibrasi & Uji Fungsi Mesin',
    statement:
      'Menjalankan pengujian fungsi otomatis (Automated Self-Test / T1 Test) pada mesin hemodialisis hingga seluruh modul hidrolik dan elektrikal dinyatakan layak pakai.',
    description:
      'Nyalakan mesin HD dan pastikan seluruh tahapan automated self-test (T1 test: hidrolik, pompa darah, UF module, bypass) lulus tanpa kode error.',
    standard: 'T1 / Self-Test Passed · Bebas Kode Alarm Teknis',
    monthlyStandard: 'SPO-HD-04: Pengoperasian & Self-Test Mesin HD',
  },
  {
    id: '2.3',
    step: 2,
    order: 3,
    visible: true,
    category: 'Keamanan Sirkuit Ekstrakorporeal',
    statement:
      'Memverifikasi kepekaan sensor keamanan utama mesin meliputi Blood Leak Detector (BLD), Air Bubble Detector, dan klem pengaman vena otomatis.',
    description:
      'Pastikan sensor kebocoran darah (BLD) dan detektor gelembung udara (ultrasonic air detector + venous clamp) aktif dan merespons dengan akurat.',
    standard: 'Sensor BLD Aktif · Air Detector & Venous Clamp Aktif',
    monthlyStandard: 'SPO-HD-05: Verifikasi Sistem Alarm Keamanan Mesin',
  },
  {
    id: '2.4',
    step: 2,
    order: 4,
    visible: true,
    category: 'Komposisi & Suhu Dialisat',
    statement:
      'Memeriksa ketepatan komposisi cairan konsentrat (Acid & Bicarbonate), kestabilan konduktivitas (13.5–14.5 mS/cm), serta suhu cairan dialisat (36.0–37.0°C).',
    description:
      'Pastikan konsentrat Acid & Bikarbonat terpasang benar, konduktivitas dialisat stabil di 13.5–14.5 mS/cm, dan suhu dialisat 36.0–37.0°C.',
    standard: 'Konduktivitas 13.5–14.5 mS/cm · Suhu Dialisat 36.0–37.0°C',
    monthlyStandard: 'SPO-HD-06: Persiapan Konsentrat & Parameter Dialisat',
  },
  {
    id: '2.5',
    step: 2,
    order: 5,
    visible: true,
    category: 'Pemasangan Sirkuit & Priming',
    statement:
      'Memasang dialyzer dan blood tubing set secara aseptik serta melakukan priming menggunakan NaCl 0,9% hingga seluruh udara dan partikel residu terbilas bersih.',
    description:
      'Pasang dialyzer dan bloodline secara aseptik, lakukan pembilasan (priming) dengan NaCl 0,9% minimal 500–1000 mL hingga sirkuit bebas udara dan residu.',
    standard: 'Teknik Aseptik · Sirkuit Bebas Gelembung Udara',
    monthlyStandard: 'SPO-HD-07: Pemasangan Sirkuit & Priming Dialyzer',
  },
  {
    id: '2.6',
    step: 2,
    order: 6,
    visible: true,
    category: 'Antikoagulasi & Kit Kanulasi',
    statement:
      'Menyiapkan spuit antikoagulan (Heparin/LMWH atau program Free Heparin) pada syringe pump serta kelengkapan set steril kanulasi AVF atau perawatan kateter CDL.',
    description:
      'Siapkan spuit heparin sesuai dosis resep (Standar/Minimal/Free Heparin) pada syringe pump serta siapkan set dressing/kanulasi AV Fistula atau perawatan CDL steril.',
    standard: 'Dosis Heparin Terverifikasi · Set Kanulasi / Dressing Steril',
    monthlyStandard: 'SPO-HD-08: Persiapan Antikoagulasi & Alat Akses Vaskular',
  },
  // Bagian 3
  {
    id: '3.1',
    step: 3,
    order: 1,
    visible: true,
    category: 'Sasaran Keselamatan Pasien (SKP 1)',
    statement:
      'Melakukan identifikasi aktif pasien menggunakan minimal 2 penanda resmi (Nama Lengkap, Tanggal Lahir, Nomor RM) serta memvalidasi status rawat dan ruang zonasi infeksi.',
    description:
      'Cocokkan minimal 2 identitas (Nama Lengkap & Tanggal Lahir / No. RM) secara verbal dan gelang/kartu RM, serta pastikan status/Rawat Jalan/Inap & kategori zonasi.',
    standard: '2 Identitas Cocok (SKP 1) · Status Rawat & Zona Tepat',
    monthlyStandard: 'SPO-SKP-01: Ketepatan Identifikasi Pasien Pre-Tindakan',
  },
  {
    id: '3.2',
    step: 3,
    order: 2,
    visible: true,
    category: 'Evaluasi Cairan & Berat Badan',
    statement:
      'Menimbang Berat Badan Pre-HD, membandingkannya dengan Berat Badan Kering (Dry Weight), menghitung Interdialytic Weight Gain (IDWG), dan mengkaji status hidrasi/edema.',
    description:
      'Timbang BB Pre-HD secara akurat, bandingkan terhadap BB Kering (Dry Weight), hitung kenaikan berat badan interdialitik (IDWG), dan evaluasi tanda overload cairan.',
    standard: 'BB Pre-HD & BB Kering Tercatat · IDWG Terhitung Akurat',
    monthlyStandard: 'SPO-HD-09: Pengkajian Status Cairan & Penetapan UF',
  },
  {
    id: '3.3',
    step: 3,
    order: 3,
    visible: true,
    category: 'Pengkajian Hemodinamik Awal',
    statement:
      'Melakukan pengukuran lengkap tanda-tanda vital (Tekanan Darah, Nadi, Pernapasan, Suhu, dan SpO₂) serta keluhan subjektif pasien sebelum inisiasi hemodialisis.',
    description:
      'Ukur Tekanan Darah (duduk/berbaring), frekuensi nadi, laju pernapasan, suhu tubuh, dan saturasi oksigen (SpO2) sebelum memulai kanulasi/sirkulasi darah.',
    standard: 'TD, Nadi, RR, Suhu & SpO2 Tercatat · Hemodinamik Layak HD',
    monthlyStandard: 'SPO-HD-10: Pengkajian Keperawatan & Hemodinamik Pre-HD',
  },
  {
    id: '3.4',
    step: 3,
    order: 4,
    visible: true,
    category: 'Skrining Risiko Jatuh & Persetujuan Tindakan',
    statement:
      'Melaksanakan pengkajian risiko jatuh (SKP 6: penguncian roda bed, pemasangan pengaman sisi tempat tidur) dan memverifikasi kelengkapan Informed Consent tindakan HD.',
    description:
      'Lakukan asesmen risiko jatuh (pasang penanda kuning & kunci roda bed bila berisiko) serta pastikan dokumen Informed Consent tindakan HD masih berlaku dan lengkap.',
    standard: 'Risiko Jatuh Terkaji & Roda Bed Terkunci · Informed Consent Lengkap',
    monthlyStandard: 'SPO-SKP-06: Pencegahan Risiko Jatuh & Informed Consent HD',
  },
  {
    id: '3.5',
    step: 3,
    order: 5,
    visible: true,
    category: 'Verifikasi Preskripsi Dialisis',
    statement:
      'Memverifikasi dan memprogram parameter resep hemodialisis dari DPJP ke mesin meliputi durasi tindakan (Time), Target UFG, QB, QD, serta dosis antikoagulan.',
    description:
      'Konfirmasi preskripsi DPJP meliputi durasi jam HD, Target Ultrafiltrasi (UFG), kecepatan aliran darah (QB), aliran dialisat (QD), dan regimen heparinisasi.',
    standard: 'Time, Target UFG, QB, QD & Heparin Sesuai Advis DPJP',
    monthlyStandard: 'SPO-HD-11: Verifikasi Preskripsi Medis Hemodialisis',
  },
  {
    id: '3.6',
    step: 3,
    order: 6,
    visible: true,
    category: 'Manajemen Akses Vaskular & Inisiasi',
    statement:
      'Mengkaji patensi akses vaskular (bruit/thrill AVF atau kepatenan dan exit-site CDL/Femoral) serta melakukan kanulasi atau penyambungan sirkuit dengan teknik aseptik.',
    description:
      'Inspeksi/palpasi/auskultasi bruit & thrill pada AVF Cimino atau evaluasi exit-site CDL/Femoral, lakukan antisepsis CHG 2%/alkohol, kanulasi/koneksi sesuai aseptik & fiksasi aman.',
    standard: 'Bruit/Thrill AVF Baik atau Lumen CDL Lancar · Teknik Aseptik & Fiksasi Aman',
    monthlyStandard: 'SPO-HD-12: Kanulasi AV Fistula & Perawatan Kateter CDL',
  },
  // Bagian 4
  {
    id: '4.1',
    step: 4,
    order: 1,
    visible: true,
    category: 'Observasi Berkala Hemodinamik',
    statement:
      'Melakukan pemantauan berkala dan pencatatan pada lembar observasi Intra-HD setiap jam meliputi Tekanan Darah, Nadi, kesadaran, QB, UF Rate, dan volume UF tercapai.',
    description:
      'Pantau dan dokumentasikan TD, Nadi, RR, kesadaran, QB, QD, UF Rate, dan kumulatif UF setiap 60 menit (atau tiap 15 - 30 menit pada pasien kritis/tidak stabil).',
    standard: 'Flowsheet TTV Per Jam Lengkap · Respon Cepat Perubahan Hemodinamik',
    monthlyStandard: 'SPO-HD-13: Monitoring Intra-Hemodialisis Terpadu',
  },
  {
    id: '4.2',
    step: 4,
    order: 2,
    visible: true,
    category: 'Keamanan Sirkuit & Tekanan Ekstrakorporeal',
    statement:
      'Memantau indikator tekanan ekstrakorporeal (Arterial Pressure, Venous Pressure, TMP), keamanan fiksasi jarum/kateter dari risiko venous needle dislodgement, dan tanda clotting.',
    description:
      'Awasi tren Arterial Pressure, Venous Pressure, dan Transmembrane Pressure (TMP), pastikan posisi jarum/kateter tidak tertekuk/dislodgement, dan cegah pembekuan sirkuit.',
    standard: 'AP, VP & TMP Dalam Batas Aman · Akses Terlihat (Uncovered) & Bebas Clotting',
    monthlyStandard: 'SPO-HD-14: Pemantauan Sirkuit Ekstrakorporeal & Pencegahan IKP',
  },
  {
    id: '4.3',
    step: 4,
    order: 3,
    visible: true,
    category: 'Deteksi & Tata Laksana Komplikasi Akut',
    statement:
      'Mendeteksi secara dini dan melaksanakan intervensi keperawatan cepat terhadap komplikasi akut Intra-HD (hipotensi, kram otot, mual/muntah, menggigil, clotting, perdarahan akses).',
    description:
      'Identifikasi segera gejala hipotensi intradialitik, hipertensi, kram otot, mual/muntah, nyeri dada, atau reaksi pirogenik, serta lakukan intervensi keperawatan darurat sesuai SPO.',
    standard: 'Deteksi Dini Komplikasi · Tindakan Korektif Cepat & Terukur',
    monthlyStandard: 'SPO-HD-15: Penanganan Komplikasi Akut Intra-Hemodialisis',
  },
  {
    id: '4.4',
    step: 4,
    order: 4,
    visible: true,
    category: 'Komunikasi Efektif SBAR / TBAK Medis',
    statement:
      'Melaksanakan kolaborasi medis serta pelaporan perubahan kondisi klinis pasien kepada Dokter Jaga Ruangan atau DPJP menggunakan komunikasi efektif SBAR dan verifikasi TBAK.',
    description:
      'Laporkan perubahan klinis bermakna kepada Dokter Jaga / DPJP dengan metode SBAR dan dokumentasikan instruksi terapi/modifikasi resep menggunakan prinsip TBAK.',
    standard: 'Komunikasi SBAR Efektif · Advis DPJP / Dokter Jaga Terdokumentasi',
    monthlyStandard: 'SPO-SKP-02: Komunikasi Efektif SBAR & TBAK di Unit HD',
  },
  // Bagian 5
  {
    id: '5.1',
    step: 5,
    order: 1,
    visible: true,
    category: 'Manajemen Cairan & Pembatasan IDWG',
    statement:
      'Memberikan edukasi terstruktur kepada pasien dan keluarga mengenai perhitungan batas asupan cairan harian dan pengendalian kenaikan berat badan interdialitik (IDWG).',
    description:
      'Edukasi takaran minum harian (volume urin 24 jam + 500 mL IWL), tips mengatasi haus, serta target kenaikan BB antar-dialisis tidak melebihi 3 - 4% dari BB kering.',
    standard: 'Target IDWG < 3–4% BB Kering · Takaran Cairan Harian Dipahami',
    monthlyStandard: 'SPO-KIE-01: Edukasi Manajemen Cairan Pasien Hemodialisis',
  },
  {
    id: '5.2',
    step: 5,
    order: 2,
    visible: true,
    category: 'Nutrisi & Diet Ginjal Kronik',
    statement:
      'Memberikan penyuluhan gizi dialisis terkait pembatasan kalium, natrium, dan fosfat serta pemenuhan protein bernilai biologis tinggi guna mencegah hiperkalemia dan malnutrisi.',
    description:
      'Jelaskan pemilihan makanan rendah kalium (hindari pisang/air kelapa berlebih), rendah garam/natrium, batasi fosfat, serta kecukupan protein (putih telur, ikan) agar tidak malnutrisi.',
    standard: 'Diet Rendah Kalium, Natrium & Fosfat · Asupan Protein Adekuat',
    monthlyStandard: 'SPO-KIE-02: Edukasi Nutrisi & Diet Pasien Dialisis',
  },
  {
    id: '5.3',
    step: 5,
    order: 3,
    visible: true,
    category: 'Perawatan Mandiri Akses Vaskular',
    statement:
      'Mengedukasi pasien dan keluarga tentang cara menjaga kebersihan dan patensi akses vaskular (AVF/CDL) di rumah serta penanganan darurat bila terjadi perdarahan atau tanda infeksi.',
    description:
      'Ajarkan menjaga balutan CDL tetap kering/bersih, larangan tensi/angkat beban pada lengan AV Shunt, raba getaran thrill tiap hari, dan tanda bahaya perdarahan/infeksi.',
    standard: 'Cek Thrill Mandiri / Balutan CDL Kering · Kenali Tanda Perdarahan & Infeksi',
    monthlyStandard: 'SPO-KIE-03: Edukasi Perawatan Mandiri Akses Vaskular',
  },
  {
    id: '5.4',
    step: 5,
    order: 4,
    visible: true,
    category: 'Kepatuhan Obat & Jadwal HD',
    statement:
      'Mengedukasi ketepatan waktu konsumsi obat-obatan rutin pasien dialisis (antihipertensi, pengikat fosfat, suplementasi zat besi/EPO) dan pentingnya kepatuhan jadwal HD.',
    description:
      'Ingatkan aturan minum obat antihipertensi (sebelum/sesudah HD sesuai instruksi dokter), cara konsumsi CaCO3 bersama makan, terapi eritropoietin, dan disiplin jadwal HD.',
    standard: 'Kepatuhan Regimen Obat · Disiplin Kehadiran Jadwal HD',
    monthlyStandard: 'SPO-KIE-04: Edukasi Rekonsiliasi Obat & Kepatuhan Terapi HD',
  },
  {
    id: '5.5',
    step: 5,
    order: 5,
    visible: true,
    category: 'Verifikasi Pemahaman (Teach-Back)',
    statement:
      'Memvalidasi tingkat pemahaman pasien dan keluarga terhadap materi edukasi melalui metode Teach-Back serta mendokumentasikannya pada rekam edukasi terintegrasi.',
    description:
      'Minta pasien/pendamping mengulangi poin kunci edukasi dengan bahasa sendiri (Teach-Back) dan lengkapi pencatatan pada formulir edukasi terintegrasi.',
    standard: 'Evaluasi Teach-Back Tervalidasi · Formulir KIE Terdokumentasi',
    monthlyStandard: 'SPO-KIE-05: Evaluasi Edukasi Pasien Metode Teach-Back',
  },
  // Bagian 6
  {
    id: '6.1',
    step: 6,
    order: 1,
    visible: true,
    category: 'Prosedur Terminasi & Re-infusi',
    statement: 'Terminasi HD Aman (Washback)',
    description:
      'Kembalikan darah dari sirkuit ekstrakorporeal ke tubuh pasien dengan bilasan NaCl 0,9% kecepatan rendah secara tertutup (closed system) tanpa risiko emboli udara.',
    standard: 'Closed-System Re-infusion · Bebas Emboli Udara & Sisa Clotting',
    monthlyStandard: 'SPO-HD-16: Prosedur Terminasi & Re-infusi Aman',
  },
  {
    id: '6.2',
    step: 6,
    order: 2,
    visible: true,
    category: 'Hemostasis & Penutupan Akses Vaskular',
    statement: 'Hemostasis & Balut Tekan Akses',
    description:
      'Cabut jarum AVF dengan sudut tepat dan tekan titik punksi 10 - 15 menit hingga hemostasis sempurna (bruit tetap teraba), atau lakukan flushing NaCl & heparin/citrate lock steril pada CDL.',
    standard: 'Hemostasis Sempurna Tanpa Perdarahan · Heparin Lock & Dressing CDL Steril',
    monthlyStandard: 'SPO-HD-17: Hemostasis Pasca-Kanulasi & Locking CDL',
  },
  {
    id: '6.3',
    step: 6,
    order: 3,
    visible: true,
    category: 'Evaluasi Klinis Pasca-Dialisis',
    statement: 'Evaluasi TTV & Berat Badan Post-HD',
    description:
      'Ukur TD & Nadi Post-HD (pastikan bebas hipotensi ortostatik sebelum pasien berdiri/pulang), timbang BB Post-HD, catat total capaian UF aktual, dan nilai adekuasi Kt/V.',
    standard: 'TTV & BB Post-HD Tercatat · Capaian UF & Kt/V Terevaluasi',
    monthlyStandard: 'SPO-HD-18: Evaluasi Keperawatan Pasca-Hemodialisis & Pemulangan',
  },
  {
    id: '6.4',
    step: 6,
    order: 4,
    visible: true,
    category: 'Dekontaminasi Limbah & Disinfeksi Mesin',
    statement: 'Disinfeksi Mesin HD (Heat / Chemical)',
    description:
      'Buang jarum ke safety box dan bloodline/dialyzer ke limbah infeksius kuning, dekontaminasi permukaan luar mesin/bed, dan jalankan siklus Heat/Citric/Chemical Disinfection.',
    standard: 'Safety Box & Limbah B3 Sesuai PPI · Siklus Heat / Chemical Clean Aktif',
    monthlyStandard: 'SPO-HD-19: Manajemen Limbah B3 & Disinfeksi Mesin HD',
  },
  {
    id: '6.5',
    step: 6,
    order: 5,
    visible: true,
    category: 'Dokumentasi Rekam Medis & Timbang Terima',
    statement: 'Dokumentasi Asuhan & Rekam Medis (CPPT)',
    description:
      'Lengkapi seluruh dokumentasi asuhan keperawatan HD pada CPPT/rekam medis dan sistem logbook digital, lalu laksanakan timbang terima pasien/alat kepada PJ Shift.',
    standard: 'Dokumentasi CPPT & Logbook 100% Lengkap · Serah Terima Shift Terverifikasi',
    monthlyStandard: 'SPO-HD-20: Dokumentasi Keperawatan Dialisis & Handover',
  },
];

export const DEFAULT_LOGBOOK_TEMPLATE: LogbookFormTemplate = {
  id: LOGBOOK_TEMPLATE_DOC_ID,
  formTitle: 'Formulir Asuhan Keperawatan Hemodialisa',
  monthlyReportTitle:
    'LAPORAN BULANAN REKAPITULASI LOGBOOK ASUHAN KEPERAWATAN HEMODIALISIS',
  sections: DEFAULT_LOGBOOK_SECTIONS,
  points: DEFAULT_LOGBOOK_POINTS,
  sectionCustomFields: {},
};

function sanitizeCustomField(f: Partial<CustomLogbookField>, idx: number): CustomLogbookField {
  const allowedTypes: CustomLogbookField['type'][] = [
    'text',
    'textarea',
    'number',
    'select',
    'checkbox',
  ];
  const type = allowedTypes.includes(f.type as CustomLogbookField['type'])
    ? (f.type as CustomLogbookField['type'])
    : 'text';
  const rawOptions = Array.isArray(f.options)
    ? f.options.map((o) => clampString(String(o || ''), 80).trim()).filter(Boolean)
    : [];

  return {
    id: clampString(f.id || `fld_${idx + 1}`, 48).replace(/[^a-zA-Z0-9_-]/g, '_') || `fld_${idx + 1}`,
    label: clampString(f.label || `Kolom ${idx + 1}`, 100) || `Kolom ${idx + 1}`,
    type,
    unit: f.unit ? clampString(f.unit, 24) : '',
    placeholder: f.placeholder ? clampString(f.placeholder, 100) : '',
    options: type === 'select' ? rawOptions : [],
    required: Boolean(f.required),
    includeInMonthlyReport: f.includeInMonthlyReport !== false,
    monthlyAggregation:
      f.monthlyAggregation || (type === 'number' ? 'average' : 'count'),
  };
}

export function mergeWithDefaultTemplate(
  raw?: Partial<LogbookFormTemplate> | null
): LogbookFormTemplate {
  if (!raw) {
    return {
      ...DEFAULT_LOGBOOK_TEMPLATE,
      sections: DEFAULT_LOGBOOK_SECTIONS.map((s) => ({ ...s })),
      points: DEFAULT_LOGBOOK_POINTS.map((p) => ({ ...p })),
      sectionCustomFields: {},
    };
  }

  const rawSectionMap = new Map<number, Partial<LogbookSectionTemplate>>();
  if (Array.isArray(raw.sections)) {
    for (const s of raw.sections) {
      if (s && typeof s.num === 'number') {
        rawSectionMap.set(s.num, s);
      }
    }
  }

  const sections: LogbookSectionTemplate[] = DEFAULT_LOGBOOK_SECTIONS.map((defSec) => {
    const override = rawSectionMap.get(defSec.num);
    if (!override) return { ...defSec };
    return {
      num: defSec.num,
      short: clampString(override.short || defSec.short, 40) || defSec.short,
      title: clampString(override.title || defSec.title, 140) || defSec.title,
      roman: clampString(override.roman || defSec.roman, 30) || defSec.roman,
      scope: clampString(override.scope || defSec.scope, 160) || defSec.scope,
      monthlyTitle:
        override.monthlyTitle !== undefined
          ? clampString(override.monthlyTitle, 220)
          : defSec.monthlyTitle,
      monthlyMaxMode:
        override.monthlyMaxMode === 'daily_cap_1' || override.monthlyMaxMode === 'per_patient'
          ? override.monthlyMaxMode
          : defSec.monthlyMaxMode,
      visible: override.visible !== false,
    };
  });

  const defaultPointIds = new Set(DEFAULT_LOGBOOK_POINTS.map((p) => p.id));
  const points: LogbookPointTemplate[] = [];

  if (Array.isArray(raw.points) && raw.points.length > 0) {
    const seenIds = new Set<string>();
    raw.points.forEach((p, idx) => {
      if (!p || !p.id) return;
      const pid = clampString(String(p.id), 32);
      if (!pid || seenIds.has(pid)) return;
      seenIds.add(pid);
      const defMatch = DEFAULT_LOGBOOK_POINTS.find((d) => d.id === pid);
      points.push({
        id: pid,
        step: typeof p.step === 'number' && p.step >= 1 && p.step <= 7 ? p.step : defMatch?.step || 1,
        order: typeof p.order === 'number' ? p.order : idx + 1,
        visible: p.visible !== false,
        isCustom: p.isCustom ?? !defaultPointIds.has(pid),
        category: clampString(p.category || defMatch?.category || 'Kategori Tambahan', 120),
        statement: clampString(p.statement || defMatch?.statement || 'Poin Asuhan HD', 400),
        description: clampString(p.description ?? defMatch?.description ?? '', 500),
        standard: clampString(p.standard ?? defMatch?.standard ?? '', 240),
        monthlyDescription: p.monthlyDescription
          ? clampString(p.monthlyDescription, 400)
          : undefined,
        monthlyStandard: p.monthlyStandard
          ? clampString(p.monthlyStandard, 240)
          : defMatch?.monthlyStandard,
        enableTtv: Boolean(p.enableTtv),
        ttvConfig: {
          td: p.ttvConfig?.td ?? true,
          nadi: p.ttvConfig?.nadi ?? true,
          rr: p.ttvConfig?.rr ?? true,
          suhu: p.ttvConfig?.suhu ?? true,
          spo2: p.ttvConfig?.spo2 ?? true,
        },
        includeTtvInMonthly: p.includeTtvInMonthly !== false,
        customFields: Array.isArray(p.customFields)
          ? p.customFields.slice(0, 15).map((f, fIdx) => sanitizeCustomField(f, fIdx))
          : [],
      });
    });

    // Ensure any built-in point accidentally absent from saved list is restored cleanly
    for (const defPt of DEFAULT_LOGBOOK_POINTS) {
      if (!seenIds.has(defPt.id)) {
        points.push({ ...defPt });
      }
    }
  } else {
    for (const defPt of DEFAULT_LOGBOOK_POINTS) {
      points.push({ ...defPt });
    }
  }

  points.sort((a, b) => {
    if (a.step !== b.step) return a.step - b.step;
    return a.order - b.order;
  });

  const sectionCustomFields: Record<string, CustomLogbookField[]> = {};
  if (raw.sectionCustomFields && typeof raw.sectionCustomFields === 'object') {
    for (const [secKey, fields] of Object.entries(raw.sectionCustomFields)) {
      if (Array.isArray(fields) && fields.length > 0) {
        sectionCustomFields[clampString(secKey, 16)] = fields
          .slice(0, 15)
          .map((f, fIdx) => sanitizeCustomField(f, fIdx));
      }
    }
  }

  return {
    id: LOGBOOK_TEMPLATE_DOC_ID,
    formTitle:
      clampString(raw.formTitle || DEFAULT_LOGBOOK_TEMPLATE.formTitle, 160) ||
      DEFAULT_LOGBOOK_TEMPLATE.formTitle,
    monthlyReportTitle:
      clampString(raw.monthlyReportTitle || DEFAULT_LOGBOOK_TEMPLATE.monthlyReportTitle, 240) ||
      DEFAULT_LOGBOOK_TEMPLATE.monthlyReportTitle,
    sections,
    points,
    sectionCustomFields,
    updatedBy: raw.updatedBy,
    updatedByName: raw.updatedByName,
    updatedAt: raw.updatedAt,
  };
}

export function sanitizeTemplateForSave(
  template: LogbookFormTemplate
): Omit<LogbookFormTemplate, 'updatedAt'> {
  const merged = mergeWithDefaultTemplate(template);
  const cleanSectionFields: Record<string, CustomLogbookField[]> = {};
  if (merged.sectionCustomFields) {
    for (const [key, list] of Object.entries(merged.sectionCustomFields)) {
      if (list && list.length > 0) {
        cleanSectionFields[key] = list.map((f, idx) => sanitizeCustomField(f, idx));
      }
    }
  }

  const normalizedPoints: LogbookPointTemplate[] = [];
  for (let step = 1; step <= 7; step += 1) {
    const stepPts = merged.points
      .filter((p) => p.step === step)
      .sort((a, b) => a.order - b.order);
    stepPts.forEach((p, idx) => {
      const cleanPt: LogbookPointTemplate = {
        id: clampString(p.id, 32),
        step: p.step,
        order: idx + 1,
        visible: p.visible !== false,
        isCustom: Boolean(p.isCustom),
        category: clampString(p.category, 120) || 'Kategori Asuhan HD',
        statement: clampString(p.statement, 400) || 'Poin Asuhan HD',
        description: clampString(p.description || '', 500),
        standard: clampString(p.standard || '', 240),
        enableTtv: Boolean(p.enableTtv),
        includeTtvInMonthly: p.includeTtvInMonthly !== false,
      };
      if (p.monthlyDescription) {
        cleanPt.monthlyDescription = clampString(p.monthlyDescription, 400);
      }
      if (p.monthlyStandard) {
        cleanPt.monthlyStandard = clampString(p.monthlyStandard, 240);
      }
      if (p.enableTtv) {
        cleanPt.ttvConfig = {
          td: p.ttvConfig?.td !== false,
          nadi: p.ttvConfig?.nadi !== false,
          rr: p.ttvConfig?.rr !== false,
          suhu: p.ttvConfig?.suhu !== false,
          spo2: p.ttvConfig?.spo2 !== false,
        };
      }
      if (p.customFields && p.customFields.length > 0) {
        cleanPt.customFields = p.customFields.slice(0, 15).map((f, fIdx) => sanitizeCustomField(f, fIdx));
      }
      normalizedPoints.push(cleanPt);
    });
  }

  return {
    id: LOGBOOK_TEMPLATE_DOC_ID,
    formTitle: clampString(merged.formTitle, 160),
    monthlyReportTitle: clampString(merged.monthlyReportTitle, 240),
    sections: merged.sections.map((s) => ({
      num: s.num,
      short: clampString(s.short, 40),
      title: clampString(s.title, 140),
      roman: clampString(s.roman, 30),
      scope: clampString(s.scope, 160),
      monthlyTitle: clampString(s.monthlyTitle, 220),
      monthlyMaxMode: s.monthlyMaxMode,
      visible: s.visible !== false,
    })),
    points: normalizedPoints,
    sectionCustomFields: cleanSectionFields,
  };
}

export function generateNextPointId(step: number, existingPoints: LogbookPointTemplate[]): string {
  const stepPrefix = `${step}.`;
  let maxSub = 0;
  for (const pt of existingPoints) {
    if (pt.id.startsWith(stepPrefix)) {
      const rest = Number(pt.id.slice(stepPrefix.length));
      if (!Number.isNaN(rest) && Number.isFinite(rest)) {
        maxSub = Math.max(maxSub, Math.floor(rest));
      }
    }
  }
  let nextNum = step === 7 && maxSub < 2 ? 3 : maxSub + 1;
  let candidate = `${step}.${nextNum}`;
  const used = new Set(existingPoints.map((p) => p.id));
  while (used.has(candidate)) {
    nextNum += 1;
    candidate = `${step}.${nextNum}`;
  }
  return candidate;
}

export function sanitizeCustomResponses(
  raw?: Record<string, WizardCustomPointResponse> | null
): Record<string, WizardCustomPointResponse> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, WizardCustomPointResponse> = {};
  const entries = Object.entries(raw).slice(0, 120);
  for (const [pointId, resp] of entries) {
    if (!resp || typeof resp !== 'object') continue;
    const cleanKey = clampString(pointId, 32);
    if (!cleanKey) continue;
    const cleanEntry: WizardCustomPointResponse = {};

    if (resp.ttv && typeof resp.ttv === 'object') {
      const cleanTtv: TtvValue = {};
      if (resp.ttv.td) cleanTtv.td = clampString(String(resp.ttv.td), 24);
      if (resp.ttv.nadi) cleanTtv.nadi = clampString(String(resp.ttv.nadi), 16);
      if (resp.ttv.rr) cleanTtv.rr = clampString(String(resp.ttv.rr), 16);
      if (resp.ttv.suhu) cleanTtv.suhu = clampString(String(resp.ttv.suhu), 16);
      if (resp.ttv.spo2) cleanTtv.spo2 = clampString(String(resp.ttv.spo2), 16);
      if (Object.keys(cleanTtv).length > 0) {
        cleanEntry.ttv = cleanTtv;
      }
    }

    if (resp.fields && typeof resp.fields === 'object') {
      const cleanFields: Record<string, string | number | boolean> = {};
      for (const [fKey, fVal] of Object.entries(resp.fields).slice(0, 20)) {
        const cleanFKey = clampString(fKey, 48);
        if (!cleanFKey) continue;
        if (typeof fVal === 'boolean') {
          if (fVal) cleanFields[cleanFKey] = true;
        } else if (typeof fVal === 'number' && !Number.isNaN(fVal)) {
          cleanFields[cleanFKey] = fVal;
        } else if (typeof fVal === 'string') {
          const trimmed = clampString(fVal, 400);
          if (trimmed.trim()) cleanFields[cleanFKey] = trimmed;
        }
      }
      if (Object.keys(cleanFields).length > 0) {
        cleanEntry.fields = cleanFields;
      }
    }

    if (cleanEntry.ttv || cleanEntry.fields) {
      result[cleanKey] = cleanEntry;
    }
  }
  return result;
}

export function hasAnyTtvValue(ttv?: TtvValue, config?: TtvSubFieldsConfig): boolean {
  if (!ttv) return false;
  const cfg = { ...DEFAULT_TTV_CONFIG, ...(config || {}) };
  return Boolean(
    (cfg.td && ttv.td?.trim()) ||
      (cfg.nadi && ttv.nadi?.trim()) ||
      (cfg.rr && ttv.rr?.trim()) ||
      (cfg.suhu && ttv.suhu?.trim()) ||
      (cfg.spo2 && ttv.spo2?.trim())
  );
}

export function formatTtvSummary(ttv?: TtvValue, config?: TtvSubFieldsConfig): string {
  if (!ttv) return '';
  const cfg = { ...DEFAULT_TTV_CONFIG, ...(config || {}) };
  const parts: string[] = [];
  if (cfg.td && ttv.td?.trim()) parts.push(`TD ${ttv.td.trim()}`);
  if (cfg.nadi && ttv.nadi?.trim()) parts.push(`N ${ttv.nadi.trim()}`);
  if (cfg.rr && ttv.rr?.trim()) parts.push(`RR ${ttv.rr.trim()}`);
  if (cfg.suhu && ttv.suhu?.trim()) parts.push(`S ${ttv.suhu.trim()}°C`);
  if (cfg.spo2 && ttv.spo2?.trim()) parts.push(`SpO2 ${ttv.spo2.trim()}%`);
  return parts.join(' · ');
}

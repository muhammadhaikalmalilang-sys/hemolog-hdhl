export type UserRole =
  | 'Administrator'
  | 'Managerial'
  | 'Kepala Ruang'
  | 'PJ Shift'
  | 'Perawat Pelaksana';

export const USER_ROLES: UserRole[] = [
  'Kepala Ruang',
  'PJ Shift',
  'Perawat Pelaksana',
  'Managerial',
  'Administrator',
];

export const ROLE_SORT_ORDER: Record<UserRole, number> = {
  'Kepala Ruang': 0,
  'PJ Shift': 1,
  'Perawat Pelaksana': 2,
  Managerial: 3,
  Administrator: 4,
};

export type MenuId =
  | 'dashboard'
  | 'logbook'
  | 'master_logbook'
  | 'laporan_pasien'
  | 'laporan_pj_shift'
  | 'laporan_bulanan'
  | 'verifikasi'
  | 'riwayat'
  | 'jadwal_dinas'
  | 'data_dokter'
  | 'data_akun'
  | 'data_pasien'
  | 'data_mesin'
  | 'my_account';

export interface MenuItemConfig {
  id: MenuId;
  label: string;
  description: string;
}

export const ROLE_MENUS: Record<UserRole, MenuItemConfig[]> = {
  Administrator: [
    { id: 'dashboard', label: 'Dashboard', description: 'Statistik umum sistem unit HD' },
    { id: 'master_logbook', label: 'Master Logbook', description: 'Kelola semua logbook & kategori tindakan' },
    { id: 'laporan_pj_shift', label: 'Laporan PJ Shift', description: 'Monitoring & manajemen pengesahan laporan shift' },
    { id: 'laporan_bulanan', label: 'Laporan Bulanan', description: 'Rekap performa perawat & unit HD' },
    { id: 'data_dokter', label: 'Data Dokter', description: 'Kelola dokter penanggung jawab' },
    { id: 'data_akun', label: 'Data Akun', description: 'Manajemen akun, role & aktivasi staf' },
    { id: 'jadwal_dinas', label: 'Jadwal Dinas', description: 'Input & kelola jadwal shift perawat' },
    { id: 'data_pasien', label: 'Data Pasien', description: 'Kelola data pasien hemodialisa' },
    { id: 'data_mesin', label: 'Data Mesin', description: 'Monitoring & status mesin HD' },
    { id: 'my_account', label: 'My Account', description: 'Profil pribadi & ubah password' },
  ],
  Managerial: [
    { id: 'dashboard', label: 'Dashboard', description: 'Statistik eksekutif & performa unit' },
    { id: 'laporan_pasien', label: 'Laporan Pasien', description: 'Detail pelayanan asuhan keperawatan & medis' },
    { id: 'laporan_pj_shift', label: 'Laporan PJ Shift', description: 'Evaluasi jalannya shift oleh PJ' },
    { id: 'laporan_bulanan', label: 'Laporan Bulanan', description: 'Rekap performa perawat & unit HD' },
    { id: 'my_account', label: 'My Account', description: 'Profil pribadi & ubah password' },
  ],
  'Kepala Ruang': [
    { id: 'dashboard', label: 'Dashboard', description: 'Treatment pribadi, unit & grafik tahunan' },
    { id: 'logbook', label: 'Logbook', description: 'Input & pantau logbook tindakan HD' },
    { id: 'laporan_pasien', label: 'Laporan Pasien', description: 'Detail pelayanan asuhan keperawatan & medis' },
    { id: 'laporan_pj_shift', label: 'Laporan PJ Shift', description: 'Review laporan dari PJ Shift' },
    { id: 'laporan_bulanan', label: 'Laporan Bulanan', description: 'Rekapitulasi bulanan ruangan' },
    { id: 'verifikasi', label: 'Verifikasi', description: 'Approval logbook perawat & PJ Shift' },
    { id: 'riwayat', label: 'Riwayat', description: 'Riwayat logbook pribadi & status verifikasi' },
    { id: 'jadwal_dinas', label: 'Jadwal Dinas', description: 'Lihat & validasi jadwal dinas ruangan' },
    { id: 'my_account', label: 'My Account', description: 'Profil pribadi & ubah password' },
  ],
  'PJ Shift': [
    { id: 'dashboard', label: 'Dashboard', description: 'Treatment pribadi, unit & grafik tahunan' },
    { id: 'logbook', label: 'Logbook', description: 'Input logbook mandiri & supervisi shift' },
    { id: 'laporan_pasien', label: 'Laporan Pasien', description: 'Detail pelayanan asuhan keperawatan & medis' },
    { id: 'laporan_pj_shift', label: 'Laporan PJ Shift', description: 'Form pengisian & submit laporan shift' },
    { id: 'laporan_bulanan', label: 'Laporan Bulanan', description: 'Rekapitulasi bulanan shift' },
    { id: 'verifikasi', label: 'Verifikasi', description: 'Validasi logbook perawat pelaksana' },
    { id: 'riwayat', label: 'Riwayat', description: 'Riwayat logbook pribadi & laporan shift' },
    { id: 'jadwal_dinas', label: 'Jadwal Dinas', description: 'Jadwal dinas pribadi & tim shift' },
    { id: 'my_account', label: 'My Account', description: 'Profil pribadi & ubah password' },
  ],
  'Perawat Pelaksana': [
    { id: 'dashboard', label: 'Dashboard', description: 'Treatment pribadi, unit & grafik tahunan' },
    { id: 'logbook', label: 'Logbook', description: 'Input tindakan hemodialisa harian' },
    { id: 'laporan_pasien', label: 'Laporan Pasien', description: 'Catatan perkembangan pasien harian' },
    { id: 'laporan_bulanan', label: 'Laporan Bulanan', description: 'Rekapitulasi logbook pribadi per bulan' },
    { id: 'riwayat', label: 'Riwayat', description: 'Riwayat logbook & status verifikasi' },
    { id: 'jadwal_dinas', label: 'Jadwal Dinas', description: 'Jadwal dinas pribadi' },
    { id: 'my_account', label: 'My Account', description: 'Profil pribadi & ubah password' },
  ],
};

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  nip: string;
  role: UserRole;
  isActive: boolean;
  phone?: string;
  specialization?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StaffDirectoryEntry {
  uid: string;
  fullName: string;
  nip?: string;
  role: UserRole;
  isActive: boolean;
  updatedAt?: unknown;
}

export type ShiftType = 'Pagi' | 'Siang' | 'Malam';
export type ScheduleShiftType = ShiftType | 'Libur' | 'Cuti';
export type VerificationStatus = 'Draft' | 'Pending' | 'Approved' | 'Revision';
export type VascularAccessType = 'AV Shunt' | 'AV Fistula' | 'CDL' | 'Femoral' | 'AVG' | 'CVC';
export type HeparinType = 'Standar' | 'Minimal' | 'Bebas Heparin' | 'Heparin' | 'LMWH';

export interface IntraObservationRow {
  hourLabel: string;
  bp: string;
  pulse: string;
  bfr: string;
  ufr: string;
  arterialPressure: string;
  venousPressure: string;
  tmp: string;
}

export interface IntraTtvObservationItem {
  id: string;
  time: string;
  systolic: string;
  diastolic: string;
  pulse?: string;
  resp?: string;
  temp?: string;
  spo2?: string;
}

export interface LogbookWizardDetails {
  section1: {
    roStatus: 'Baik' | 'Perlu Perhatian' | 'Gangguan';
    roAdequate: boolean;
    roTds: string;
    roConductivity: string;
    roNotes: string;
    infectionZoneStatus: 'Sesuai' | 'Tidak';
    infectionZoneChecked: boolean;
    emergencyStatus: 'Lengkap' | 'Ada yang Kurang';
    aedReady: boolean;
    oxygenReady: boolean;
    emergencyDrugsReady: boolean;
    emergencyNotes: string;
  };
  section2: {
    apdMask: boolean;
    apdGoggles: boolean;
    apdGloves: boolean;
    apdApron: boolean;
    machineConductivity: string;
    machinePh: string;
    leakTestPassed: boolean;
    bloodlineIntegrity: boolean;
    dialysateTemp: string;
    dialysateType: 'Bikarbonat' | 'Asetat';
    primingDone: boolean;
    primingVolume: string;
    anticoagulantType: 'Heparin' | 'LMWH' | 'Bebas Heparin';
    loadingDose: string;
    maintenanceDose: string;
    fistulaNeedleSize: '15G' | '16G' | '17G' | 'CDL / Non-Fistula';
  };
  section3: {
    serviceStatus?: 'Rawat Jalan' | 'Rawat Inap' | '';
    inpatientWard?: 'CAMELIA' | 'DAHLIA' | 'ICU' | '';
    citoStatus?: 'Tidak' | 'Ya' | '';
    patientCategory?: 'Reguler' | 'Isolasi Hepatitis B' | 'Isolasi Hepatitis C/HIV' | '';
    dryWeight: number;
    idwg: number;
    prePulse: string;
    preResp: string;
    preTemp: string;
    preSpo2: string;
    fallRiskScale: 'Morse' | 'Edmonson';
    fallRiskLevel: 'Risiko Rendah' | 'Risiko Sedang' | 'Risiko Tinggi';
    informedConsent: boolean;
    dialyzerType: string;
    dialysisDurationHours?: string;
    bfr: string;
    dfr: string;
    cannulationDone: boolean;
    vascularNurseId?: string;
    vascularNurseName?: string;
    accessDetailNote?: string;
    ciminoNote?: string;
    cdlNote?: string;
    femoralNote?: string;
  };
  section4: {
    observations: IntraObservationRow[];
    arterialPressure: string;
    venousPressure: string;
    tmp: string;
    complicationFlags: string[];
    effectiveCommunicationNotes: string;
    intraObsTime?: string;
    intraSystolicBp?: string;
    intraDiastolicBp?: string;
    intraObservations?: IntraTtvObservationItem[];
    noComplication?: boolean;
    complicationIncidents?: {
      id: string;
      type: string;
      time: string;
      bp: string;
      clinicalDetail?: string;
      doctorAdvice: string;
    }[];
  };
  section5: {
    eduFluidManagement: boolean;
    eduNutrition: boolean;
    eduVascularCare: boolean;
    eduMedicationSchedule: boolean;
    teachBackStatus: 'Baik' | 'Perlu Pengulangan';
    educationNotes: string;
  };
  section6: {
    reinfusionDone: boolean;
    hemostasisDone: boolean;
    bleedingStopMinutes: string;
    postPulse: string;
    postResp: string;
    postTemp: string;
    postSpo2: string;
    wasteDecontaminated: boolean;
    machineDisinfectionType: 'Heat Disinfection' | 'Chemical Disinfection';
    handoverSummary: string;
    ktv?: string;
  };
  section7?: {
    transfusionGiven: boolean;
    transfusionComponent?: string;
    transfusionBloodGroup?: string;
    transfusionBagCount?: string;
    transfusionVolumeMl?: string;
    transfusionBagNumber?: string;
    transfusionReaction?: string;
    transfusionNote: string;
    epoGiven: boolean;
    epoPreparation?: string;
    epoDose?: string;
    epoRoute?: string;
    epoNote: string;
  };
  spoChecklist?: Record<string, 'DIKERJAKAN' | 'TIDAK DIKERJAKAN'>;
  customResponses?: Record<string, WizardCustomPointResponse>;
}

export interface LogbookEntry {
  id: string;
  nurseId: string;
  nurseName: string;
  nurseNip: string;
  patientId: string;
  patientName: string;
  patientRm: string;
  machineId: string;
  machineNumber: string;
  doctorId: string;
  doctorName: string;
  dutyDoctorId?: string;
  dutyDoctorName?: string;
  actionCategory: string;
  date: string;
  monthKey: string;
  shift: ShiftType;
  startTime: string;
  endTime: string;
  preWeight: number;
  postWeight: number;
  preBp: string;
  postBp: string;
  ufGoal: number;
  ufAchieved: number;
  vascularAccess: VascularAccessType;
  heparinType: HeparinType;
  complications: string;
  nursingNotes: string;
  verificationStatus: VerificationStatus;
  targetVerifierRole?: 'PJ Shift' | 'Kepala Ruang';
  targetVerifierId?: string;
  targetVerifierName?: string;
  verifiedBy?: string;
  verifiedByName?: string;
  verificationNote?: string;
  verifiedAt?: unknown;
  wizardDetails?: LogbookWizardDetails;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LogbookLock {
  id: string;
  date: string;
  monthKey: string;
  patientId: string;
  patientName: string;
  nurseId: string;
  nurseName: string;
  logbookId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MachineLock {
  id: string;
  date: string;
  monthKey: string;
  shift: ShiftType;
  machineId: string;
  machineNumber: string;
  patientId: string;
  patientName: string;
  nurseId: string;
  nurseName: string;
  logbookId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PatientStatus = 'Aktif' | 'Rujuk' | 'Meninggal' | 'Nonaktif';
export type PatientType = 'Reguler' | 'Non-Reguler';

export interface Patient {
  id: string;
  mrn: string;
  fullName: string;
  gender: 'L' | 'P';
  birthYear: number;
  vascularAccess: VascularAccessType;
  diagnosis: string;
  dpjpId?: string;
  dpjpName?: string;
  routineSchedule: string;
  status: PatientStatus;
  patientType?: PatientType;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DoctorStatus = 'Aktif' | 'Cuti' | 'Nonaktif';

export interface Doctor {
  id: string;
  fullName: string;
  sipNumber: string;
  specialization: string;
  phone?: string;
  status: DoctorStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MachineStatus = 'Ready' | 'In Use' | 'Maintenance' | 'Sterilisasi';

export interface Machine {
  id: string;
  machineNumber: string;
  brand: string;
  serialNumber?: string;
  roomZone?: string;
  status: MachineStatus;
  lastMaintenanceDate?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ScheduleEntry {
  id: string;
  nurseId: string;
  nurseName: string;
  date: string;
  monthKey: string;
  shift: ScheduleShiftType;
  validationStatus: 'Draft' | 'Validated';
  validatedBy?: string;
  validatedByName?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DoctorScheduleEntry {
  id: string;
  date: string;
  monthKey: string;
  shift: ShiftType;
  dpjpDoctorId: string;
  dpjpDoctorName: string;
  dutyDoctorId: string;
  dutyDoctorName: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PjShiftAssignmentEntry {
  id: string;
  date: string;
  monthKey: string;
  shift: ShiftType;
  pjNurseId: string;
  pjNurseName: string;
  pjNurseRole: UserRole;
  notes?: string;
  assignedBy?: string;
  assignedByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ReportType = 'pj_shift' | 'patient_care' | 'monthly_unit';

export interface ReportSectionDItem {
  item: string;
  parameter: string;
  result: string;
  status: string;
}

export interface ReportEntry {
  id: string;
  reportType: ReportType;
  date: string;
  monthKey: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  // pj_shift
  shift?: ShiftType;
  totalPatients?: number;
  activeMachines?: number;
  nursesOnDuty?: string;
  incidents?: string;
  handoverNotes?: string;
  sectionDItems?: ReportSectionDItem[];
  sbarSituation?: string;
  sbarBackground?: string;
  sbarAssessment?: string;
  sbarRecommendation?: string;
  handoverSignedBy?: string;
  handoverSignedByName?: string;
  handoverSignedShift?: ShiftType;
  handoverSignedAt?: unknown;
  receivedSignedBy?: string;
  receivedSignedByName?: string;
  receivedSignedShift?: ShiftType;
  receivedSignedDate?: string;
  receivedSignedAt?: unknown;
  reviewStatus?: 'Submitted' | 'Reviewed';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewNote?: string;
  reviewedAt?: unknown;
  // patient_care
  patientId?: string;
  patientName?: string;
  patientRm?: string;
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  medicalOrder?: string;
  // monthly_unit
  totalTreatments?: number;
  approvedTreatments?: number;
  summaryNotes?: string;
  status?: 'Draft' | 'Final';
  targetNurseId?: string;
  targetNurseName?: string;
  targetNurseNip?: string;
  targetNurseRole?: string;
  nurseSignedBy?: string;
  nurseSignedByName?: string;
  nurseSignedRole?: string;
  nurseSignedAt?: unknown;
  karuSignedBy?: string;
  karuSignedByName?: string;
  karuSignedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActionCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox';

export interface TtvSubFieldsConfig {
  td?: boolean;
  nadi?: boolean;
  rr?: boolean;
  suhu?: boolean;
  spo2?: boolean;
}

export interface TtvValue {
  td?: string;
  nadi?: string;
  rr?: string;
  suhu?: string;
  spo2?: string;
}

export interface WizardCustomPointResponse {
  ttv?: TtvValue;
  fields?: Record<string, string | number | boolean>;
}

export interface CustomLogbookField {
  id: string;
  label: string;
  type: CustomFieldType;
  unit?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  includeInMonthlyReport?: boolean;
  monthlyAggregation?: 'count' | 'sum' | 'average' | 'latest';
}

export interface LogbookPointTemplate {
  id: string;
  step: number;
  category: string;
  statement: string;
  description: string;
  standard: string;
  monthlyDescription?: string;
  monthlyStandard?: string;
  visible: boolean;
  order: number;
  isCustom?: boolean;
  enableTtv?: boolean;
  ttvConfig?: TtvSubFieldsConfig;
  includeTtvInMonthly?: boolean;
  customFields?: CustomLogbookField[];
}

export interface LogbookSectionTemplate {
  num: number;
  short: string;
  title: string;
  roman: string;
  scope: string;
  monthlyTitle: string;
  monthlyMaxMode: 'daily_cap_1' | 'per_patient';
  visible: boolean;
}

export interface LogbookFormTemplate {
  id: string;
  formTitle: string;
  monthlyReportTitle: string;
  sections: LogbookSectionTemplate[];
  points: LogbookPointTemplate[];
  sectionCustomFields?: Record<string, CustomLogbookField[]>;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: unknown;
}

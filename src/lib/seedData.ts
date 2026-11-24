import { getCurrentMonthKey, getTodayDateStr } from './formatters';
import {
  toActionCategoryRow,
  toDoctorRow,
  toDoctorScheduleRow,
  toMachineRow,
  toPatientRow,
  toScheduleRow,
  upsertRows,
} from './db';

export async function seedInitialUnitData(params: {
  machinesCount: number;
  doctorsCount: number;
  patientsCount: number;
  categoriesCount: number;
  userId: string;
  userName: string;
}) {
  if (
    params.machinesCount > 0 ||
    params.doctorsCount > 0 ||
    params.patientsCount > 0 ||
    params.categoriesCount > 0
  ) {
    return;
  }

  const today = getTodayDateStr();
  const monthKey = getCurrentMonthKey();

  const categories = [
    {
      id: 'cat_hd_reguler',
      name: 'HD Reguler',
      code: 'HDR',
      description: 'Hemodialisa rutin reguler 4–5 jam',
      isActive: true,
    },
    {
      id: 'cat_hd_cito',
      name: 'HD Cito / Akut',
      code: 'HDC',
      description: 'Tindakan hemodialisa emergensi / akut',
      isActive: true,
    },
    {
      id: 'cat_sled',
      name: 'SLED / Extended',
      code: 'SLED',
      description: 'Sustained Low Efficiency Dialysis 6–8 jam',
      isActive: true,
    },
    {
      id: 'cat_isolasi',
      name: 'HD Isolasi HBsAg/HCV',
      code: 'HDI',
      description: 'Tindakan HD khusus pasien infeksius',
      isActive: true,
    },
  ];

  const doctors = [
    {
      id: 'doc_ahmad_kgh',
      fullName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
      sipNumber: '503/SIP-KGH/2023/118',
      specialization: 'DOKTER DPJP',
      phone: '0812-3344-5501',
      status: 'Aktif' as const,
    },
    {
      id: 'doc_maya_sppd',
      fullName: 'dr. Maya Kusuma, Sp.PD',
      sipNumber: '503/SIP-PD/2024/042',
      specialization: 'DOKTER UMUM',
      phone: '0813-9900-1122',
      status: 'Aktif' as const,
    },
  ];

  const machines = [
    {
      id: 'mach_hd_01',
      machineNumber: 'HD-01',
      brand: 'Fresenius 4008S',
      serialNumber: 'FR-4008S-9821',
      roomZone: 'Ruang A (Reguler)',
      status: 'Ready' as const,
      lastMaintenanceDate: today,
      notes: 'Kalibrasi normal, siap pakai',
    },
    {
      id: 'mach_hd_02',
      machineNumber: 'HD-02',
      brand: 'Nipro Surdial X',
      serialNumber: 'NP-SX-4410',
      roomZone: 'Ruang A (Reguler)',
      status: 'Ready' as const,
      lastMaintenanceDate: today,
      notes: 'Unit reguler zona A',
    },
    {
      id: 'mach_hd_03',
      machineNumber: 'HD-03',
      brand: 'B.Braun Dialog+',
      serialNumber: 'BB-DLG-7723',
      roomZone: 'Ruang B (Reguler)',
      status: 'Ready' as const,
      lastMaintenanceDate: today,
      notes: 'Zona reguler B',
    },
    {
      id: 'mach_hd_04',
      machineNumber: 'HD-04 (Isolasi)',
      brand: 'Fresenius 5008S CorDiax',
      serialNumber: 'FR-5008S-1120',
      roomZone: 'Ruang Isolasi',
      status: 'Ready' as const,
      lastMaintenanceDate: today,
      notes: 'Khusus ruang isolasi HBsAg+',
    },
  ];

  const patients = [
    {
      id: 'pat_budi_s',
      mrn: 'RM-240101',
      fullName: 'Tn. Budi Santoso',
      gender: 'L' as const,
      birthYear: 1965,
      vascularAccess: 'AV Shunt' as const,
      diagnosis: 'PGK Stage V',
      dpjpId: 'doc_ahmad_kgh',
      dpjpName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
      routineSchedule: 'Senin & Kamis (Pagi)',
      status: 'Aktif' as const,
      patientType: 'Reguler' as const,
      notes: 'Pasien reguler HD',
    },
    {
      id: 'pat_siti_r',
      mrn: 'RM-240102',
      fullName: 'Ny. Siti Rahayu',
      gender: 'P' as const,
      birthYear: 1972,
      vascularAccess: 'AV Fistula' as const,
      diagnosis: 'PGK Stage V',
      dpjpId: 'doc_ahmad_kgh',
      dpjpName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
      routineSchedule: 'Selasa & Jumat (Pagi)',
      status: 'Aktif' as const,
      patientType: 'Reguler' as const,
      notes: 'Pasien reguler HD',
    },
    {
      id: 'pat_hendra_w',
      mrn: 'RM-240103',
      fullName: 'Tn. Hendra Wijaya',
      gender: 'L' as const,
      birthYear: 1958,
      vascularAccess: 'CDL' as const,
      diagnosis: 'PGK Stage V',
      dpjpId: 'doc_ahmad_kgh',
      dpjpName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
      routineSchedule: 'Rabu & Sabtu (Siang)',
      status: 'Aktif' as const,
      patientType: 'Reguler' as const,
      notes: 'Akses CDL kanan',
    },
  ];

  await Promise.all([
    upsertRows('action_categories', categories.map(toActionCategoryRow)),
    upsertRows('doctors', doctors.map(toDoctorRow)),
    upsertRows('machines', machines.map(toMachineRow)),
    upsertRows('patients', patients.map(toPatientRow)),
    upsertRows('schedules', [
      toScheduleRow({
        id: `${params.userId}_${today}`,
        nurseId: params.userId,
        nurseName: params.userName,
        date: today,
        monthKey,
        shift: 'Pagi',
        validationStatus: 'Draft',
        notes: 'Jadwal operasional awal unit HD',
      }),
    ]),
    upsertRows('doctor_schedules', [
      toDoctorScheduleRow({
        id: `${today}_Pagi`,
        date: today,
        monthKey,
        shift: 'Pagi',
        dpjpDoctorId: 'doc_ahmad_kgh',
        dpjpDoctorName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
        dutyDoctorId: 'doc_maya_sppd',
        dutyDoctorName: 'dr. Maya Kusuma, Sp.PD',
        notes: 'Jadwal dokter unit HD shift pagi',
      }),
    ]),
  ]);
}

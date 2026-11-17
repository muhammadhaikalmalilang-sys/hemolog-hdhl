import { doc, setDoc, serverTimestamp, collection, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

export async function seedInitialMasterData(): Promise<void> {
  try {
    const categories = [
      { id: 'cat_hd_reguler', name: 'HD Reguler', code: 'HDR-01', description: 'Hemodialisis rutin terjadwal 4-5 jam', isActive: true },
      { id: 'cat_hd_cito', name: 'HD Cito / Emergensi', code: 'HDC-02', description: 'Hemodialisis darurat indikasi klinis akut', isActive: true },
      { id: 'cat_hd_bebas_heparin', name: 'HD Bebas Heparin', code: 'HDB-03', description: 'Hemodialisis tanpa antikoagulan (risiko perdarahan)', isActive: true },
      { id: 'cat_hd_sled', name: 'SLED (Sustained Low-Efficiency Dialysis)', code: 'SLED-04', description: 'Dialisis durasi panjang untuk pasien hemodinamik tidak stabil', isActive: true },
      { id: 'cat_rawat_cdl', name: 'Perawatan Akses CDL / AV Shunt', code: 'AKS-05', description: 'Ganti balutan steril & evaluasi patensi akses vaskular', isActive: true },
    ];

    for (const cat of categories) {
      await setDoc(doc(db, 'action_categories', cat.id), {
        name: cat.name,
        code: cat.code,
        description: cat.description,
        isActive: cat.isActive,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const doctors = [
      {
        id: 'doc_ahmad_kgh',
        fullName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
        sipNumber: '503/SIP-DS/0142/2025',
        specialization: 'Konsultan Ginjal Hipertensi',
        phone: '0812-3400-1122',
        status: 'Aktif',
      },
      {
        id: 'doc_ratna_kgh',
        fullName: 'dr. Ratna Kusuma, Sp.PD-KGH, FINASIM',
        sipNumber: '503/SIP-DS/0289/2025',
        specialization: 'Konsultan Ginjal Hipertensi',
        phone: '0813-9900-4455',
        status: 'Aktif',
      },
      {
        id: 'doc_budi_sppd',
        fullName: 'dr. Budi Santoso, Sp.PD',
        sipNumber: '503/SIP-DS/0317/2025',
        specialization: 'Penyakit Dalam (HD Certified)',
        phone: '0811-7788-2233',
        status: 'Aktif',
      },
    ];

    for (const d of doctors) {
      await setDoc(doc(db, 'doctors', d.id), {
        fullName: d.fullName,
        sipNumber: d.sipNumber,
        specialization: d.specialization,
        phone: d.phone,
        status: d.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const machines = [
      { id: 'hd_01', machineNumber: 'HD-01', brand: 'Fresenius 4008S', serialNumber: 'FR-4008-9011', roomZone: 'Ruang A (Infeksius Negatif)', status: 'Ready', lastMaintenanceDate: '2026-10-15', notes: 'Kalibrasi rutin tervalidasi' },
      { id: 'hd_02', machineNumber: 'HD-02', brand: 'Fresenius 4008S', serialNumber: 'FR-4008-9012', roomZone: 'Ruang A (Reguler)', status: 'Ready', lastMaintenanceDate: '2026-10-15', notes: 'Siap operasional' },
      { id: 'hd_03', machineNumber: 'HD-03', brand: 'Nipro Surdial X', serialNumber: 'NP-SDX-3301', roomZone: 'Ruang A (Reguler)', status: 'In Use', lastMaintenanceDate: '2026-10-20', notes: 'Digunakan shift berjalan' },
      { id: 'hd_04', machineNumber: 'HD-04', brand: 'Nipro Surdial X', serialNumber: 'NP-SDX-3302', roomZone: 'Ruang B (Reguler)', status: 'Ready', lastMaintenanceDate: '2026-10-20', notes: 'Siap operasional' },
      { id: 'hd_05', machineNumber: 'HD-05', brand: 'B.Braun Dialog+', serialNumber: 'BB-DLG-7710', roomZone: 'Ruang B (Reguler)', status: 'Sterilisasi', lastMaintenanceDate: '2026-11-01', notes: 'Proses desinfeksi termal pasca sesi' },
      { id: 'hd_06', machineNumber: 'HD-06', brand: 'B.Braun Dialog+', serialNumber: 'BB-DLG-7711', roomZone: 'Ruang Isolasi', status: 'Maintenance', lastMaintenanceDate: '2026-11-05', notes: 'Pengecekan sensor konduktivitas teknisi' },
    ];

    for (const m of machines) {
      await setDoc(doc(db, 'machines', m.id), {
        machineNumber: m.machineNumber,
        brand: m.brand,
        serialNumber: m.serialNumber,
        roomZone: m.roomZone,
        status: m.status,
        lastMaintenanceDate: m.lastMaintenanceDate,
        notes: m.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const patients = [
      {
        id: 'pat_001',
        mrn: 'RM-004182',
        fullName: 'Tn. Hendra Wijaya',
        gender: 'L',
        birthYear: 1968,
        vascularAccess: 'AV Shunt',
        diagnosis: 'PGK Stage V ec. Nefropati Diabetikum',
        dpjpId: '-',
        dpjpName: '-',
        routineSchedule: 'Senin & Kamis (Pagi)',
        status: 'Aktif',
        notes: 'Target BB Kering 62.5 kg',
      },
      {
        id: 'pat_002',
        mrn: 'RM-004219',
        fullName: 'Ny. Siti Aminah',
        gender: 'P',
        birthYear: 1974,
        vascularAccess: 'AV Shunt',
        diagnosis: 'PGK Stage V ec. Hipertensi Kronis',
        dpjpId: '-',
        dpjpName: '-',
        routineSchedule: 'Selasa & Jumat (Pagi)',
        status: 'Aktif',
        notes: 'Observasi hipotensi intradialitik',
      },
      {
        id: 'pat_003',
        mrn: 'RM-004305',
        fullName: 'Tn. Slamet Riyadi',
        gender: 'L',
        birthYear: 1961,
        vascularAccess: 'CDL',
        diagnosis: 'ESRD ec. Glomerulonefritis Kronis',
        dpjpId: '-',
        dpjpName: '-',
        routineSchedule: 'Rabu & Sabtu (Siang)',
        status: 'Aktif',
        notes: 'CDL jugularis kanan, rawat exit site tiap sesi',
      },
      {
        id: 'pat_004',
        mrn: 'RM-004411',
        fullName: 'Ny. Dewi Lestari',
        gender: 'P',
        birthYear: 1980,
        vascularAccess: 'AVG',
        diagnosis: 'PGK Stage V ec. Lupus Nefritis',
        dpjpId: '-',
        dpjpName: '-',
        routineSchedule: 'Senin & Kamis (Siang)',
        status: 'Aktif',
        notes: 'Heparinisasi minimal',
      },
    ];

    for (const p of patients) {
      await setDoc(doc(db, 'patients', p.id), {
        mrn: p.mrn,
        fullName: p.fullName,
        gender: p.gender,
        birthYear: p.birthYear,
        vascularAccess: p.vascularAccess,
        diagnosis: p.diagnosis,
        dpjpId: p.dpjpId,
        dpjpName: p.dpjpName,
        routineSchedule: p.routineSchedule,
        status: p.status,
        notes: p.notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed_master_data');
  }
}

export async function seedSampleLogbookForUser(user: {
  uid: string;
  fullName: string;
  nip: string;
}) {
  try {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const monthKey = `${y}-${m}`;

    const batch = writeBatch(db);
    const logRef = doc(collection(db, 'logbook'));
    const lockId = `${dateStr}_pat_001`;
    const lockRef = doc(db, 'logbook_locks', lockId);

    batch.set(logRef, {
      nurseId: user.uid,
      nurseName: user.fullName,
      nurseNip: user.nip,
      patientId: 'pat_001',
      patientName: 'Tn. Hendra Wijaya',
      patientRm: 'RM-004182',
      machineId: 'hd_02',
      machineNumber: 'HD-02',
      doctorId: 'doc_ahmad_kgh',
      doctorName: 'dr. Ahmad Fauzi, Sp.PD-KGH',
      dutyDoctorId: 'doc_budi_sppd',
      dutyDoctorName: 'dr. Budi Santoso, Sp.PD',
      actionCategory: 'HD Reguler',
      date: dateStr,
      monthKey,
      shift: 'Pagi',
      startTime: '07:30',
      endTime: '12:00',
      preWeight: 65.2,
      postWeight: 62.7,
      preBp: '150/90',
      postBp: '130/80',
      ufGoal: 2500,
      ufAchieved: 2500,
      vascularAccess: 'AV Shunt',
      heparinType: 'Standar',
      complications: 'Tidak ada',
      nursingNotes: 'Tindakan HD reguler berlangsung lancar, thrill AV Shunt (+) kuat, tidak ada keluhan pusing atau kram.',
      verificationStatus: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(lockRef, {
      id: lockId,
      date: dateStr,
      monthKey,
      patientId: 'pat_001',
      patientName: 'Tn. Hendra Wijaya',
      nurseId: user.uid,
      nurseName: user.fullName,
      logbookId: logRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'logbook');
  }
}

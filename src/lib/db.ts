import {
  handleDbError,
  OperationType,
  requireSupabase,
} from './supabase';
import type {
  ActionCategory,
  Doctor,
  DoctorScheduleEntry,
  LogbookEntry,
  LogbookFormTemplate,
  LogbookLock,
  Machine,
  MachineLock,
  Patient,
  PjShiftAssignmentEntry,
  ReportEntry,
  ScheduleEntry,
  StaffDirectoryEntry,
  UserProfile,
} from '../types';

type DbRow = Record<string, any>;

export function generateRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// ROW MAPPERS (snake_case PostgreSQL <-> camelCase TypeScript)
// ============================================================================

export function mapUserRow(r: DbRow): UserProfile {
  return {
    uid: r.uid,
    email: r.email || '',
    fullName: r.full_name || '',
    nip: r.nip || '',
    role: r.role,
    isActive: r.is_active !== false,
    phone: r.phone || '',
    specialization: r.specialization || 'Perawat Hemodialisa',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toUserRow(data: Partial<UserProfile>): DbRow {
  const row: DbRow = {};
  if (data.uid !== undefined) row.uid = data.uid;
  if (data.email !== undefined) row.email = data.email;
  if (data.fullName !== undefined) row.full_name = data.fullName;
  if (data.nip !== undefined) row.nip = data.nip;
  if (data.role !== undefined) row.role = data.role;
  if (data.isActive !== undefined) row.is_active = data.isActive;
  if (data.phone !== undefined) row.phone = data.phone;
  if (data.specialization !== undefined) row.specialization = data.specialization;
  if (data.createdAt !== undefined) row.created_at = data.createdAt;
  if (data.updatedAt !== undefined) row.updated_at = data.updatedAt;
  return row;
}

export function mapStaffDirectoryRow(r: DbRow): StaffDirectoryEntry {
  return {
    uid: r.uid,
    fullName: r.full_name || '',
    nip: r.nip || undefined,
    role: r.role,
    isActive: r.is_active !== false,
    updatedAt: r.updated_at,
  };
}

export function toStaffDirectoryRow(data: Partial<StaffDirectoryEntry>): DbRow {
  const row: DbRow = {};
  if (data.uid !== undefined) row.uid = data.uid;
  if (data.fullName !== undefined) row.full_name = data.fullName;
  if (data.nip !== undefined) row.nip = data.nip;
  if (data.role !== undefined) row.role = data.role;
  if (data.isActive !== undefined) row.is_active = data.isActive;
  if (data.updatedAt !== undefined) row.updated_at = data.updatedAt;
  return row;
}

export function mapPatientRow(r: DbRow): Patient {
  return {
    id: r.id,
    mrn: r.mrn || '',
    fullName: r.full_name || '',
    gender: r.gender,
    birthYear: Number(r.birth_year ?? 1970),
    vascularAccess: r.vascular_access,
    diagnosis: r.diagnosis || '',
    dpjpId: r.dpjp_id ?? '-',
    dpjpName: r.dpjp_name ?? '-',
    routineSchedule: r.routine_schedule || '',
    status: r.status || 'Aktif',
    patientType: r.patient_type || undefined,
    notes: r.notes || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toPatientRow(data: Partial<Patient>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.mrn !== undefined) row.mrn = data.mrn;
  if (data.fullName !== undefined) row.full_name = data.fullName;
  if (data.gender !== undefined) row.gender = data.gender;
  if (data.birthYear !== undefined) row.birth_year = Number(data.birthYear) || 1970;
  if (data.vascularAccess !== undefined) row.vascular_access = data.vascularAccess;
  if (data.diagnosis !== undefined) row.diagnosis = data.diagnosis;
  if ('dpjpId' in data) row.dpjp_id = data.dpjpId ?? '-';
  if ('dpjpName' in data) row.dpjp_name = data.dpjpName ?? '-';
  if (data.routineSchedule !== undefined) row.routine_schedule = data.routineSchedule;
  if (data.status !== undefined) row.status = data.status;
  if ('patientType' in data) row.patient_type = data.patientType ?? null;
  if (data.notes !== undefined) row.notes = data.notes;
  return row;
}

export function mapDoctorRow(r: DbRow): Doctor {
  return {
    id: r.id,
    fullName: r.full_name || '',
    sipNumber: r.sip_number || '',
    specialization: r.specialization || '',
    phone: r.phone || '',
    status: r.status || 'Aktif',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toDoctorRow(data: Partial<Doctor>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.fullName !== undefined) row.full_name = data.fullName;
  if (data.sipNumber !== undefined) row.sip_number = data.sipNumber;
  if (data.specialization !== undefined) row.specialization = data.specialization;
  if (data.phone !== undefined) row.phone = data.phone;
  if (data.status !== undefined) row.status = data.status;
  return row;
}

export function mapMachineRow(r: DbRow): Machine {
  return {
    id: r.id,
    machineNumber: r.machine_number || '',
    brand: r.brand || '',
    serialNumber: r.serial_number || '',
    roomZone: r.room_zone || '',
    status: r.status || 'Ready',
    lastMaintenanceDate: r.last_maintenance_date || '',
    notes: r.notes || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toMachineRow(data: Partial<Machine>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.machineNumber !== undefined) row.machine_number = data.machineNumber;
  if (data.brand !== undefined) row.brand = data.brand;
  if (data.serialNumber !== undefined) row.serial_number = data.serialNumber;
  if (data.roomZone !== undefined) row.room_zone = data.roomZone;
  if (data.status !== undefined) row.status = data.status;
  if (data.lastMaintenanceDate !== undefined) row.last_maintenance_date = data.lastMaintenanceDate;
  if (data.notes !== undefined) row.notes = data.notes;
  return row;
}

export function mapActionCategoryRow(r: DbRow): ActionCategory {
  return {
    id: r.id,
    name: r.name || '',
    code: r.code || '',
    description: r.description || '',
    isActive: r.is_active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toActionCategoryRow(data: Partial<ActionCategory>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.name !== undefined) row.name = data.name;
  if (data.code !== undefined) row.code = data.code;
  if (data.description !== undefined) row.description = data.description;
  if (data.isActive !== undefined) row.is_active = data.isActive;
  return row;
}

export function mapScheduleRow(r: DbRow): ScheduleEntry {
  return {
    id: r.id,
    nurseId: r.nurse_id,
    nurseName: r.nurse_name || '',
    date: r.date,
    monthKey: r.month_key,
    shift: r.shift,
    validationStatus: r.validation_status || 'Draft',
    validatedBy: r.validated_by ?? undefined,
    validatedByName: r.validated_by_name ?? undefined,
    notes: r.notes || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toScheduleRow(data: Partial<ScheduleEntry>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.nurseId !== undefined) row.nurse_id = data.nurseId;
  if (data.nurseName !== undefined) row.nurse_name = data.nurseName;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.shift !== undefined) row.shift = data.shift;
  if (data.validationStatus !== undefined) row.validation_status = data.validationStatus;
  if ('validatedBy' in data) row.validated_by = data.validatedBy ?? null;
  if ('validatedByName' in data) row.validated_by_name = data.validatedByName ?? null;
  if (data.notes !== undefined) row.notes = data.notes;
  return row;
}

export function mapDoctorScheduleRow(r: DbRow): DoctorScheduleEntry {
  return {
    id: r.id,
    date: r.date,
    monthKey: r.month_key,
    shift: r.shift,
    dpjpDoctorId: r.dpjp_doctor_id || '',
    dpjpDoctorName: r.dpjp_doctor_name || '',
    dutyDoctorId: r.duty_doctor_id || '',
    dutyDoctorName: r.duty_doctor_name || '',
    notes: r.notes || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toDoctorScheduleRow(data: Partial<DoctorScheduleEntry>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.shift !== undefined) row.shift = data.shift;
  if (data.dpjpDoctorId !== undefined) row.dpjp_doctor_id = data.dpjpDoctorId;
  if (data.dpjpDoctorName !== undefined) row.dpjp_doctor_name = data.dpjpDoctorName;
  if (data.dutyDoctorId !== undefined) row.duty_doctor_id = data.dutyDoctorId;
  if (data.dutyDoctorName !== undefined) row.duty_doctor_name = data.dutyDoctorName;
  if (data.notes !== undefined) row.notes = data.notes;
  return row;
}

export function mapPjShiftAssignmentRow(r: DbRow): PjShiftAssignmentEntry {
  return {
    id: r.id,
    date: r.date,
    monthKey: r.month_key,
    shift: r.shift,
    pjNurseId: r.pj_nurse_id || '',
    pjNurseName: r.pj_nurse_name || '',
    pjNurseRole: r.pj_nurse_role || 'PJ Shift',
    notes: r.notes || '',
    assignedBy: r.assigned_by ?? undefined,
    assignedByName: r.assigned_by_name ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toPjShiftAssignmentRow(data: Partial<PjShiftAssignmentEntry>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.shift !== undefined) row.shift = data.shift;
  if (data.pjNurseId !== undefined) row.pj_nurse_id = data.pjNurseId;
  if (data.pjNurseName !== undefined) row.pj_nurse_name = data.pjNurseName;
  if (data.pjNurseRole !== undefined) row.pj_nurse_role = data.pjNurseRole;
  if (data.notes !== undefined) row.notes = data.notes;
  if ('assignedBy' in data) row.assigned_by = data.assignedBy ?? null;
  if ('assignedByName' in data) row.assigned_by_name = data.assignedByName ?? null;
  return row;
}

export function mapLogbookRow(r: DbRow): LogbookEntry {
  return {
    id: r.id,
    nurseId: r.nurse_id,
    nurseName: r.nurse_name || '',
    nurseNip: r.nurse_nip || '',
    patientId: r.patient_id,
    patientName: r.patient_name || '',
    patientRm: r.patient_rm || '',
    machineId: r.machine_id,
    machineNumber: r.machine_number || '',
    doctorId: r.doctor_id,
    doctorName: r.doctor_name || '',
    dutyDoctorId: r.duty_doctor_id || '',
    dutyDoctorName: r.duty_doctor_name || '',
    actionCategory: r.action_category || 'HD Reguler',
    date: r.date,
    monthKey: r.month_key,
    shift: r.shift,
    startTime: r.start_time || '',
    endTime: r.end_time || '',
    preWeight: Number(r.pre_weight ?? 0),
    postWeight: Number(r.post_weight ?? 0),
    preBp: r.pre_bp || '',
    postBp: r.post_bp || '',
    ufGoal: Number(r.uf_goal ?? 0),
    ufAchieved: Number(r.uf_achieved ?? 0),
    vascularAccess: r.vascular_access,
    heparinType: r.heparin_type,
    complications: r.complications || 'Tidak ada',
    nursingNotes: r.nursing_notes || '',
    verificationStatus: r.verification_status,
    targetVerifierRole: r.target_verifier_role ?? undefined,
    targetVerifierId: r.target_verifier_id || undefined,
    targetVerifierName: r.target_verifier_name || undefined,
    verifiedBy: r.verified_by ?? undefined,
    verifiedByName: r.verified_by_name ?? undefined,
    verificationNote: r.verification_note ?? undefined,
    verifiedAt: r.verified_at ?? undefined,
    wizardDetails: r.wizard_details ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toLogbookRow(data: Partial<LogbookEntry>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.nurseId !== undefined) row.nurse_id = data.nurseId;
  if (data.nurseName !== undefined) row.nurse_name = data.nurseName;
  if (data.nurseNip !== undefined) row.nurse_nip = data.nurseNip;
  if (data.patientId !== undefined) row.patient_id = data.patientId;
  if (data.patientName !== undefined) row.patient_name = data.patientName;
  if (data.patientRm !== undefined) row.patient_rm = data.patientRm;
  if (data.machineId !== undefined) row.machine_id = data.machineId;
  if (data.machineNumber !== undefined) row.machine_number = data.machineNumber;
  if (data.doctorId !== undefined) row.doctor_id = data.doctorId;
  if (data.doctorName !== undefined) row.doctor_name = data.doctorName;
  if ('dutyDoctorId' in data) row.duty_doctor_id = data.dutyDoctorId ?? '';
  if ('dutyDoctorName' in data) row.duty_doctor_name = data.dutyDoctorName ?? '';
  if (data.actionCategory !== undefined) row.action_category = data.actionCategory;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.shift !== undefined) row.shift = data.shift;
  if (data.startTime !== undefined) row.start_time = data.startTime;
  if (data.endTime !== undefined) row.end_time = data.endTime;
  if (data.preWeight !== undefined) row.pre_weight = Number(data.preWeight) || 0;
  if (data.postWeight !== undefined) row.post_weight = Number(data.postWeight) || 0;
  if (data.preBp !== undefined) row.pre_bp = data.preBp;
  if (data.postBp !== undefined) row.post_bp = data.postBp;
  if (data.ufGoal !== undefined) row.uf_goal = Number(data.ufGoal) || 0;
  if (data.ufAchieved !== undefined) row.uf_achieved = Number(data.ufAchieved) || 0;
  if (data.vascularAccess !== undefined) row.vascular_access = data.vascularAccess;
  if (data.heparinType !== undefined) row.heparin_type = data.heparinType;
  if (data.complications !== undefined) row.complications = data.complications;
  if (data.nursingNotes !== undefined) row.nursing_notes = data.nursingNotes;
  if (data.verificationStatus !== undefined) row.verification_status = data.verificationStatus;
  if ('targetVerifierRole' in data) row.target_verifier_role = data.targetVerifierRole ?? null;
  if ('targetVerifierId' in data) row.target_verifier_id = data.targetVerifierId ?? '';
  if ('targetVerifierName' in data) row.target_verifier_name = data.targetVerifierName ?? '';
  if ('verifiedBy' in data) row.verified_by = data.verifiedBy ?? null;
  if ('verifiedByName' in data) row.verified_by_name = data.verifiedByName ?? null;
  if ('verificationNote' in data) row.verification_note = data.verificationNote ?? null;
  if ('verifiedAt' in data) row.verified_at = data.verifiedAt ?? null;
  if ('wizardDetails' in data) row.wizard_details = data.wizardDetails ?? null;
  return row;
}

export function mapLogbookLockRow(r: DbRow): LogbookLock {
  return {
    id: r.id,
    date: r.date,
    monthKey: r.month_key,
    patientId: r.patient_id,
    patientName: r.patient_name || '',
    nurseId: r.nurse_id,
    nurseName: r.nurse_name || '',
    logbookId: r.logbook_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toLogbookLockRow(data: Partial<LogbookLock>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.patientId !== undefined) row.patient_id = data.patientId;
  if (data.patientName !== undefined) row.patient_name = data.patientName;
  if (data.nurseId !== undefined) row.nurse_id = data.nurseId;
  if (data.nurseName !== undefined) row.nurse_name = data.nurseName;
  if (data.logbookId !== undefined) row.logbook_id = data.logbookId;
  return row;
}

export function mapMachineLockRow(r: DbRow): MachineLock {
  return {
    id: r.id,
    date: r.date,
    monthKey: r.month_key,
    shift: r.shift,
    machineId: r.machine_id,
    machineNumber: r.machine_number || '',
    patientId: r.patient_id,
    patientName: r.patient_name || '',
    nurseId: r.nurse_id,
    nurseName: r.nurse_name || '',
    logbookId: r.logbook_id || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toMachineLockRow(data: Partial<MachineLock>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.shift !== undefined) row.shift = data.shift;
  if (data.machineId !== undefined) row.machine_id = data.machineId;
  if (data.machineNumber !== undefined) row.machine_number = data.machineNumber;
  if (data.patientId !== undefined) row.patient_id = data.patientId;
  if (data.patientName !== undefined) row.patient_name = data.patientName;
  if (data.nurseId !== undefined) row.nurse_id = data.nurseId;
  if (data.nurseName !== undefined) row.nurse_name = data.nurseName;
  if (data.logbookId !== undefined) row.logbook_id = data.logbookId;
  return row;
}

export function mapReportRow(r: DbRow): ReportEntry {
  return {
    id: r.id,
    reportType: r.report_type,
    date: r.date || '',
    monthKey: r.month_key || '',
    authorId: r.author_id || '',
    authorName: r.author_name || '',
    authorRole: r.author_role || '',
    shift: r.shift ?? undefined,
    totalPatients: r.total_patients ?? undefined,
    activeMachines: r.active_machines ?? undefined,
    nursesOnDuty: r.nurses_on_duty ?? undefined,
    incidents: r.incidents ?? undefined,
    handoverNotes: r.handover_notes ?? undefined,
    sectionDItems: r.section_d_items ?? undefined,
    sbarSituation: r.sbar_situation ?? undefined,
    sbarBackground: r.sbar_background ?? undefined,
    sbarAssessment: r.sbar_assessment ?? undefined,
    sbarRecommendation: r.sbar_recommendation ?? undefined,
    handoverSignedBy: r.handover_signed_by ?? undefined,
    handoverSignedByName: r.handover_signed_by_name ?? undefined,
    handoverSignedShift: r.handover_signed_shift ?? undefined,
    handoverSignedAt: r.handover_signed_at ?? undefined,
    receivedSignedBy: r.received_signed_by ?? undefined,
    receivedSignedByName: r.received_signed_by_name ?? undefined,
    receivedSignedShift: r.received_signed_shift ?? undefined,
    receivedSignedDate: r.received_signed_date ?? undefined,
    receivedSignedAt: r.received_signed_at ?? undefined,
    reviewStatus: r.review_status ?? undefined,
    reviewedBy: r.reviewed_by ?? undefined,
    reviewedByName: r.reviewed_by_name ?? undefined,
    reviewNote: r.review_note ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
    patientId: r.patient_id ?? undefined,
    patientName: r.patient_name ?? undefined,
    patientRm: r.patient_rm ?? undefined,
    soapSubjective: r.soap_subjective ?? undefined,
    soapObjective: r.soap_objective ?? undefined,
    soapAssessment: r.soap_assessment ?? undefined,
    soapPlan: r.soap_plan ?? undefined,
    medicalOrder: r.medical_order ?? undefined,
    totalTreatments: r.total_treatments ?? undefined,
    approvedTreatments: r.approved_treatments ?? undefined,
    summaryNotes: r.summary_notes ?? undefined,
    status: r.status ?? undefined,
    targetNurseId: r.target_nurse_id ?? undefined,
    targetNurseName: r.target_nurse_name ?? undefined,
    targetNurseNip: r.target_nurse_nip ?? undefined,
    targetNurseRole: r.target_nurse_role ?? undefined,
    nurseSignedBy: r.nurse_signed_by ?? undefined,
    nurseSignedByName: r.nurse_signed_by_name ?? undefined,
    nurseSignedRole: r.nurse_signed_role ?? undefined,
    nurseSignedAt: r.nurse_signed_at ?? undefined,
    karuSignedBy: r.karu_signed_by ?? undefined,
    karuSignedByName: r.karu_signed_by_name ?? undefined,
    karuSignedAt: r.karu_signed_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toReportRow(data: Partial<ReportEntry>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.reportType !== undefined) row.report_type = data.reportType;
  if (data.date !== undefined) row.date = data.date;
  if (data.monthKey !== undefined) row.month_key = data.monthKey;
  if (data.authorId !== undefined) row.author_id = data.authorId;
  if (data.authorName !== undefined) row.author_name = data.authorName;
  if (data.authorRole !== undefined) row.author_role = data.authorRole;
  if ('shift' in data) row.shift = data.shift ?? null;
  if ('totalPatients' in data) row.total_patients = data.totalPatients ?? null;
  if ('activeMachines' in data) row.active_machines = data.activeMachines ?? null;
  if ('nursesOnDuty' in data) row.nurses_on_duty = data.nursesOnDuty ?? null;
  if ('incidents' in data) row.incidents = data.incidents ?? null;
  if ('handoverNotes' in data) row.handover_notes = data.handoverNotes ?? null;
  if ('sectionDItems' in data) row.section_d_items = data.sectionDItems ?? null;
  if ('sbarSituation' in data) row.sbar_situation = data.sbarSituation ?? null;
  if ('sbarBackground' in data) row.sbar_background = data.sbarBackground ?? null;
  if ('sbarAssessment' in data) row.sbar_assessment = data.sbarAssessment ?? null;
  if ('sbarRecommendation' in data) row.sbar_recommendation = data.sbarRecommendation ?? null;
  if ('handoverSignedBy' in data) row.handover_signed_by = data.handoverSignedBy ?? null;
  if ('handoverSignedByName' in data) row.handover_signed_by_name = data.handoverSignedByName ?? null;
  if ('handoverSignedShift' in data) row.handover_signed_shift = data.handoverSignedShift ?? null;
  if ('handoverSignedAt' in data) row.handover_signed_at = data.handoverSignedAt ?? null;
  if ('receivedSignedBy' in data) row.received_signed_by = data.receivedSignedBy ?? null;
  if ('receivedSignedByName' in data) row.received_signed_by_name = data.receivedSignedByName ?? null;
  if ('receivedSignedShift' in data) row.received_signed_shift = data.receivedSignedShift ?? null;
  if ('receivedSignedDate' in data) row.received_signed_date = data.receivedSignedDate ?? null;
  if ('receivedSignedAt' in data) row.received_signed_at = data.receivedSignedAt ?? null;
  if ('reviewStatus' in data) row.review_status = data.reviewStatus ?? null;
  if ('reviewedBy' in data) row.reviewed_by = data.reviewedBy ?? null;
  if ('reviewedByName' in data) row.reviewed_by_name = data.reviewedByName ?? null;
  if ('reviewNote' in data) row.review_note = data.reviewNote ?? null;
  if ('reviewedAt' in data) row.reviewed_at = data.reviewedAt ?? null;
  if ('patientId' in data) row.patient_id = data.patientId ?? null;
  if ('patientName' in data) row.patient_name = data.patientName ?? null;
  if ('patientRm' in data) row.patient_rm = data.patientRm ?? null;
  if ('soapSubjective' in data) row.soap_subjective = data.soapSubjective ?? null;
  if ('soapObjective' in data) row.soap_objective = data.soapObjective ?? null;
  if ('soapAssessment' in data) row.soap_assessment = data.soapAssessment ?? null;
  if ('soapPlan' in data) row.soap_plan = data.soapPlan ?? null;
  if ('medicalOrder' in data) row.medical_order = data.medicalOrder ?? null;
  if ('totalTreatments' in data) row.total_treatments = data.totalTreatments ?? null;
  if ('approvedTreatments' in data) row.approved_treatments = data.approvedTreatments ?? null;
  if ('summaryNotes' in data) row.summary_notes = data.summaryNotes ?? null;
  if ('status' in data) row.status = data.status ?? null;
  if ('targetNurseId' in data) row.target_nurse_id = data.targetNurseId ?? null;
  if ('targetNurseName' in data) row.target_nurse_name = data.targetNurseName ?? null;
  if ('targetNurseNip' in data) row.target_nurse_nip = data.targetNurseNip ?? null;
  if ('targetNurseRole' in data) row.target_nurse_role = data.targetNurseRole ?? null;
  if ('nurseSignedBy' in data) row.nurse_signed_by = data.nurseSignedBy ?? null;
  if ('nurseSignedByName' in data) row.nurse_signed_by_name = data.nurseSignedByName ?? null;
  if ('nurseSignedRole' in data) row.nurse_signed_role = data.nurseSignedRole ?? null;
  if ('nurseSignedAt' in data) row.nurse_signed_at = data.nurseSignedAt ?? null;
  if ('karuSignedBy' in data) row.karu_signed_by = data.karuSignedBy ?? null;
  if ('karuSignedByName' in data) row.karu_signed_by_name = data.karuSignedByName ?? null;
  if ('karuSignedAt' in data) row.karu_signed_at = data.karuSignedAt ?? null;
  return row;
}

export function mapFormTemplateRow(r: DbRow): Partial<LogbookFormTemplate> {
  return {
    id: r.id,
    formTitle: r.form_title,
    monthlyReportTitle: r.monthly_report_title,
    sections: r.sections,
    points: r.points,
    sectionCustomFields: r.section_custom_fields,
    updatedBy: r.updated_by ?? undefined,
    updatedByName: r.updated_by_name ?? undefined,
    updatedAt: r.updated_at,
  };
}

export function toFormTemplateRow(data: Partial<LogbookFormTemplate>): DbRow {
  const row: DbRow = {};
  if (data.id !== undefined) row.id = data.id;
  if (data.formTitle !== undefined) row.form_title = data.formTitle;
  if (data.monthlyReportTitle !== undefined) row.monthly_report_title = data.monthlyReportTitle;
  if (data.sections !== undefined) row.sections = data.sections;
  if (data.points !== undefined) row.points = data.points;
  if (data.sectionCustomFields !== undefined) row.section_custom_fields = data.sectionCustomFields;
  if ('updatedBy' in data) row.updated_by = data.updatedBy ?? null;
  if ('updatedByName' in data) row.updated_by_name = data.updatedByName ?? null;
  return row;
}

// ============================================================================
// GENERIC CRUD HELPERS (PARAMETERIZED POSTGREST) & PAGINATION
// ============================================================================

export interface DbMutationEvent {
  table: string;
  op: 'insert' | 'upsert' | 'update' | 'delete';
  col?: string;
  value?: string;
  values?: string[];
  row?: DbRow;
  rows?: DbRow[];
}

type DbMutationListener = (event: DbMutationEvent) => void;
const dbMutationListeners = new Set<DbMutationListener>();

export function onDbMutation(listener: DbMutationListener): () => void {
  dbMutationListeners.add(listener);
  return () => {
    dbMutationListeners.delete(listener);
  };
}

function emitDbMutation(event: DbMutationEvent) {
  dbMutationListeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Ignore subscriber errors so DB writes never fail
    }
  });
}

export const DEFAULT_PAGE_SIZE = 800;

/**
 * Fetch all matching rows from Supabase in deterministic chunks (< 1,000 PostgREST limit).
 * Always pair with a deterministic `.order(...)` inside `configure` when querying large tables.
 */
export async function fetchRowsPaginated<T>(
  table: string,
  mapper: (row: DbRow) => T,
  configure?: (query: any) => any,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const sb = requireSupabase();
  const safePageSize = Math.max(50, Math.min(pageSize, 1000));
  const results: T[] = [];
  let from = 0;

  while (true) {
    let query: any = sb.from(table).select('*');
    if (configure) {
      query = configure(query);
    }
    const to = from + safePageSize - 1;
    const { data, error } = await query.range(from, to);
    if (error) {
      throw error;
    }
    const rows = (data as DbRow[] | null) ?? [];
    for (const row of rows) {
      results.push(mapper(row));
    }
    if (rows.length < safePageSize) {
      break;
    }
    from += safePageSize;
  }

  return results;
}

export async function insertRow(table: string, row: DbRow): Promise<DbRow> {
  const sb = requireSupabase();
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) {
    handleDbError(error, OperationType.CREATE, table);
  }
  const inserted = data as DbRow;
  emitDbMutation({ table, op: 'insert', row: inserted });
  return inserted;
}

export async function insertRows(table: string, rows: DbRow[]): Promise<void> {
  if (rows.length === 0) return;
  const sb = requireSupabase();
  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from(table).insert(chunk);
    if (error) {
      handleDbError(error, OperationType.CREATE, table);
    }
  }
  emitDbMutation({ table, op: 'insert', rows });
}

export async function upsertRow(
  table: string,
  row: DbRow,
  onConflict = 'id'
): Promise<DbRow> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from(table)
    .upsert(row, { onConflict })
    .select()
    .single();
  if (error) {
    handleDbError(error, OperationType.WRITE, `${table}/${row[onConflict] ?? ''}`);
  }
  const saved = data as DbRow;
  emitDbMutation({ table, op: 'upsert', row: saved });
  return saved;
}

export async function upsertRows(
  table: string,
  rows: DbRow[],
  onConflict = 'id'
): Promise<void> {
  if (rows.length === 0) return;
  const sb = requireSupabase();
  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from(table).upsert(chunk, { onConflict });
    if (error) {
      handleDbError(error, OperationType.WRITE, table);
    }
  }
  emitDbMutation({ table, op: 'upsert', rows });
}

export async function updateRowByColumn(
  table: string,
  col: string,
  value: string,
  patch: DbRow
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from(table).update(patch).eq(col, value);
  if (error) {
    handleDbError(error, OperationType.UPDATE, `${table}/${value}`);
  }
  emitDbMutation({ table, op: 'update', col, value });
}

export async function updateRowsByColumnValues(
  table: string,
  col: string,
  values: string[],
  patch: DbRow
): Promise<void> {
  if (values.length === 0) return;
  const sb = requireSupabase();
  const chunkSize = 200;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const { error } = await sb.from(table).update(patch).in(col, chunk);
    if (error) {
      handleDbError(error, OperationType.UPDATE, table);
    }
  }
  emitDbMutation({ table, op: 'update', col, values });
}

export async function deleteRowByColumn(
  table: string,
  col: string,
  value: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from(table).delete().eq(col, value);
  if (error) {
    handleDbError(error, OperationType.DELETE, `${table}/${value}`);
  }
  emitDbMutation({ table, op: 'delete', col, value });
}

export async function deleteRowsByColumnValues(
  table: string,
  col: string,
  values: string[]
): Promise<void> {
  if (values.length === 0) return;
  const sb = requireSupabase();
  const chunkSize = 200;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    const { error } = await sb.from(table).delete().in(col, chunk);
    if (error) {
      handleDbError(error, OperationType.DELETE, table);
    }
  }
  emitDbMutation({ table, op: 'delete', col, values });
}

export async function getRowByColumn(
  table: string,
  col: string,
  value: string
): Promise<DbRow | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.from(table).select('*').eq(col, value).maybeSingle();
  if (error) {
    handleDbError(error, OperationType.GET, `${table}/${value}`);
  }
  return (data as DbRow | null) ?? null;
}

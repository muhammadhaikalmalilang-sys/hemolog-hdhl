import { LogbookWizardModal } from './LogbookWizardModal';
import type {
  ActionCategory,
  Doctor,
  LogbookEntry,
  LogbookFormTemplate,
  LogbookLock,
  Machine,
  MachineLock,
  Patient,
  StaffDirectoryEntry,
} from '../../types';

interface LogbookDetailModalProps {
  entry: LogbookEntry;
  onClose: () => void;
  logbooks?: LogbookEntry[];
  logbookLocks?: LogbookLock[];
  machineLocks?: MachineLock[];
  patients?: Patient[];
  doctors?: Doctor[];
  machines?: Machine[];
  actionCategories?: ActionCategory[];
  staffDirectory?: StaffDirectoryEntry[];
  formTemplate?: LogbookFormTemplate;
}

export function LogbookDetailModal({
  entry,
  onClose,
  logbooks = [],
  logbookLocks = [],
  machineLocks = [],
  patients = [],
  doctors = [],
  machines = [],
  actionCategories = [],
  staffDirectory = [],
  formTemplate,
}: LogbookDetailModalProps) {
  return (
    <LogbookWizardModal
      editingEntry={entry}
      readOnly
      initialPatientId={entry.patientId}
      initialMachineId={entry.machineId}
      initialDate={entry.date}
      initialShift={entry.shift}
      initialDoctorId={entry.doctorId}
      initialDutyDoctorId={entry.dutyDoctorId}
      initialDutyDoctorName={entry.dutyDoctorName}
      logbooks={logbooks}
      logbookLocks={logbookLocks}
      machineLocks={machineLocks}
      patients={patients}
      doctors={doctors}
      machines={machines}
      actionCategories={actionCategories}
      staffDirectory={staffDirectory}
      formTemplate={formTemplate}
      onClose={onClose}
    />
  );
}

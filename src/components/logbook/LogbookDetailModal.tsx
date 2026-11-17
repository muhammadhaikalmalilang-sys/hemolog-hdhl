import { LogbookWizardModal } from './LogbookWizardModal';
import type {
  ActionCategory,
  Doctor,
  LogbookEntry,
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
      onClose={onClose}
    />
  );
}

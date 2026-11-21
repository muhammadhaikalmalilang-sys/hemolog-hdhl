import React, { Suspense, lazy } from 'react';
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

const LazyLogbookWizardModal = lazy(() =>
  import('./LogbookWizardModal').then((m) => ({ default: m.LogbookWizardModal }))
);

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
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-xs font-semibold text-slate-700 shadow-lg">
            Memuat detail logbook...
          </div>
        </div>
      }
    >
      <LazyLogbookWizardModal
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
    </Suspense>
  );
}

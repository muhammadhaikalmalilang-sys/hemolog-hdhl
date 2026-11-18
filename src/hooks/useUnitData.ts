import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  db,
  formatFirestoreError,
  isTransientFirestoreError,
  onFirestoreReconnect,
  OperationType,
  reconnectFirestore,
} from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import type {
  ActionCategory,
  Doctor,
  DoctorScheduleEntry,
  LogbookEntry,
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

export function useUnitData() {
  const { authReady, firebaseUser, userProfile } = useAuth();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [actionCategories, setActionCategories] = useState<ActionCategory[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryEntry[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  const [ownLogbooks, setOwnLogbooks] = useState<LogbookEntry[]>([]);
  const [approvedLogbooks, setApprovedLogbooks] = useState<LogbookEntry[]>([]);
  const [supervisorPendingLogbooks, setSupervisorPendingLogbooks] = useState<LogbookEntry[]>([]);
  const [logbookLocks, setLogbookLocks] = useState<LogbookLock[]>([]);
  const [machineLocks, setMachineLocks] = useState<MachineLock[]>([]);

  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [pjShiftAssignments, setPjShiftAssignments] = useState<PjShiftAssignmentEntry[]>([]);
  const [doctorSchedules, setDoctorSchedules] = useState<DoctorScheduleEntry[]>([]);
  const [patientReports, setPatientReports] = useState<ReportEntry[]>([]);
  const [unitReports, setUnitReports] = useState<ReportEntry[]>([]);
  const [nurseMonthlyReports, setNurseMonthlyReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [approvedReady, setApprovedReady] = useState(false);
  const [ownReady, setOwnReady] = useState(false);
  const [supervisorReady, setSupervisorReady] = useState(false);
  const [locksReady, setLocksReady] = useState(false);
  const [machineLocksReady, setMachineLocksReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [resubscribeEpoch, setResubscribeEpoch] = useState(0);
  const prunedLockIdsRef = useRef<Set<string>>(new Set());
  const prunedMachineLockIdsRef = useRef<Set<string>>(new Set());

  const isLeaderOrAdmin =
    userProfile?.role === 'Administrator' ||
    userProfile?.role === 'Managerial' ||
    userProfile?.role === 'Kepala Ruang' ||
    userProfile?.role === 'PJ Shift';

  const isAdmin = userProfile?.role === 'Administrator';

  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile?.isActive) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setFatalError(null);
    setApprovedReady(false);
    setOwnReady(false);
    setSupervisorReady(false);
    setLocksReady(false);
    setMachineLocksReady(false);
    prunedLockIdsRef.current.clear();
    prunedMachineLockIdsRef.current.clear();
    const unsubs: (() => void)[] = [];
    let needsResubscribe = false;
    let retryTimer: number | null = null;
    let cancelled = false;

    const handleSnapshotError = (err: unknown, path: string) => {
      if (cancelled) return;
      if (isTransientFirestoreError(err)) {
        needsResubscribe = true;
        setLoading(false);
        console.warn(`Sinkronisasi ${path} terputus sementara, menyambungkan ulang...`);
        void reconnectFirestore();
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (!cancelled && (typeof navigator === 'undefined' || navigator.onLine)) {
            setResubscribeEpoch((e) => e + 1);
          }
        }, 3000);
        return;
      }
      setFatalError(formatFirestoreError(err, OperationType.LIST, path));
    };

    const unsubReconnect = onFirestoreReconnect(() => {
      if (needsResubscribe && !cancelled) {
        needsResubscribe = false;
        setResubscribeEpoch((e) => e + 1);
      }
    });

    // 1. Patients
    unsubs.push(
      onSnapshot(
        query(collection(db, 'patients'), where('status', 'in', ['Aktif', 'Rujuk', 'Meninggal', 'Nonaktif'])),
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Patient));
          items.sort((a, b) => a.fullName.localeCompare(b.fullName));
          setPatients(items);
        },
        (err) => handleSnapshotError(err, 'patients')
      )
    );

    // 2. Doctors
    unsubs.push(
      onSnapshot(
        query(collection(db, 'doctors'), where('status', 'in', ['Aktif', 'Cuti', 'Nonaktif'])),
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Doctor));
          items.sort((a, b) => a.fullName.localeCompare(b.fullName));
          setDoctors(items);
        },
        (err) => handleSnapshotError(err, 'doctors')
      )
    );

    // 3. Machines
    unsubs.push(
      onSnapshot(
        query(collection(db, 'machines'), where('status', 'in', ['Ready', 'In Use', 'Maintenance', 'Sterilisasi'])),
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Machine));
          items.sort((a, b) => a.machineNumber.localeCompare(b.machineNumber));
          setMachines(items);
        },
        (err) => handleSnapshotError(err, 'machines')
      )
    );

    // 4. Action Categories
    unsubs.push(
      onSnapshot(
        query(collection(db, 'action_categories'), where('isActive', 'in', [true, false])),
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionCategory));
          items.sort((a, b) => a.name.localeCompare(b.name));
          setActionCategories(items);
        },
        (err) => handleSnapshotError(err, 'action_categories')
      )
    );

    // 5. Staff Directory (Non-PII)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'staff_directory'), where('isActive', 'in', [true, false])),
        (snap) => {
          const items = snap.docs.map((d) => d.data() as StaffDirectoryEntry);
          items.sort((a, b) => a.fullName.localeCompare(b.fullName));
          setStaffDirectory(items);
        },
        (err) => handleSnapshotError(err, 'staff_directory')
      )
    );

    // 6. All Users (Administrator only)
    if (isAdmin) {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            const items = snap.docs.map((d) => d.data() as UserProfile);
            items.sort((a, b) => a.fullName.localeCompare(b.fullName));
            setAllUsers(items);
          },
          (err) => handleSnapshotError(err, 'users')
        )
      );
    } else {
      setAllUsers([]);
    }

    // 7. Logbook: Approved unit logbooks (accessible to all active staff for unit metrics)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'logbook'), where('verificationStatus', '==', 'Approved')),
        (snap) => {
          setApprovedLogbooks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LogbookEntry)));
          setApprovedReady(true);
          setLoading(false);
        },
        (err) => handleSnapshotError(err, 'logbook')
      )
    );

    // 8. Logbook: Own logbooks (for nurse's pending/revision/approved history)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'logbook'), where('nurseId', '==', firebaseUser.uid)),
        (snap) => {
          const items = snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as LogbookEntry))
            .sort((a, b) => {
              const dateCmp = b.date.localeCompare(a.date);
              if (dateCmp !== 0) return dateCmp;
              return b.startTime.localeCompare(a.startTime);
            });
          setOwnLogbooks(items);
          setOwnReady(true);
        },
        (err) => handleSnapshotError(err, 'logbook')
      )
    );

    // 9. Logbook: Draft, Pending & Revision unit logbooks so all active staff see all nurses' entries (Draft remains read-only for non-owners)
    const targetStatuses = ['Draft', 'Pending', 'Revision'];
    unsubs.push(
      onSnapshot(
        query(collection(db, 'logbook'), where('verificationStatus', 'in', targetStatuses)),
        (snap) => {
          setSupervisorPendingLogbooks(
            snap.docs.map((d) => ({ id: d.id, ...d.data() } as LogbookEntry))
          );
          setSupervisorReady(true);
        },
        (err) => handleSnapshotError(err, 'logbook')
      )
    );

    // 9b. Logbook Locks (cross-account daily patient lock visibility for all active staff)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'logbook_locks'), where('date', '>=', '2000-01-01')),
        (snap) => {
          setLogbookLocks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LogbookLock)));
          setLocksReady(true);
        },
        (err) => handleSnapshotError(err, 'logbook_locks')
      )
    );

    // 9c. Machine Locks (cross-account shift machine/bed lock visibility for all active staff)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'machine_locks'), where('date', '>=', '2000-01-01')),
        (snap) => {
          setMachineLocks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MachineLock)));
          setMachineLocksReady(true);
        },
        (err) => handleSnapshotError(err, 'machine_locks')
      )
    );

    // 10. Schedules
    if (isLeaderOrAdmin) {
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'schedules'),
            where('shift', 'in', ['Pagi', 'Siang', 'Malam', 'Libur', 'Cuti'])
          ),
          (snap) => {
            setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScheduleEntry)));
          },
          (err) => handleSnapshotError(err, 'schedules')
        )
      );
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schedules'), where('nurseId', '==', firebaseUser.uid)),
          (snap) => {
            setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScheduleEntry)));
          },
          (err) => handleSnapshotError(err, 'schedules')
        )
      );
    }

    // 10b. Doctor Schedules (DPJP & Duty Doctor per date and shift)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'doctor_schedules'), where('shift', 'in', ['Pagi', 'Siang', 'Malam'])),
        (snap) => {
          setDoctorSchedules(
            snap.docs.map((d) => ({ id: d.id, ...d.data() } as DoctorScheduleEntry))
          );
        },
        (err) => handleSnapshotError(err, 'doctor_schedules')
      )
    );

    // 10c. PJ Shift Assignments (1 designated PJ Shift per date and shift)
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'pj_shift_assignments'),
          where('shift', 'in', ['Pagi', 'Siang', 'Malam'])
        ),
        (snap) => {
          setPjShiftAssignments(
            snap.docs.map((d) => ({ id: d.id, ...d.data() } as PjShiftAssignmentEntry))
          );
        },
        (err) => handleSnapshotError(err, 'pj_shift_assignments')
      )
    );

    // 11. Reports: Patient care
    unsubs.push(
      onSnapshot(
        query(collection(db, 'reports'), where('reportType', '==', 'patient_care')),
        (snap) => {
          setPatientReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportEntry)));
        },
        (err) => handleSnapshotError(err, 'reports')
      )
    );

    // 12. Reports: PJ Shift & Monthly Unit (supervisors/admin/managerial) vs own + targeted monthly report
    if (isLeaderOrAdmin) {
      setNurseMonthlyReports([]);
      unsubs.push(
        onSnapshot(
          query(collection(db, 'reports'), where('reportType', 'in', ['pj_shift', 'monthly_unit'])),
          (snap) => {
            setUnitReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportEntry)));
          },
          (err) => handleSnapshotError(err, 'reports')
        )
      );
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'reports'), where('authorId', '==', firebaseUser.uid)),
          (snap) => {
            setUnitReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportEntry)));
          },
          (err) => handleSnapshotError(err, 'reports')
        )
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'reports'),
            where('reportType', '==', 'monthly_unit'),
            where('targetNurseId', '==', firebaseUser.uid)
          ),
          (snap) => {
            setNurseMonthlyReports(
              snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportEntry))
            );
          },
          (err) => handleSnapshotError(err, 'reports')
        )
      );
    }

    return () => {
      cancelled = true;
      unsubReconnect();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, firebaseUser?.uid, userProfile?.role, userProfile?.isActive, isLeaderOrAdmin, isAdmin, resubscribeEpoch]);

  if (fatalError) {
    throw new Error(fatalError);
  }

  const allLogbooks = useMemo(() => {
    const map = new Map<string, LogbookEntry>();
    for (const item of approvedLogbooks) map.set(item.id, item);
    for (const item of ownLogbooks) map.set(item.id, item);
    for (const item of supervisorPendingLogbooks) map.set(item.id, item);
    return Array.from(map.values()).sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return b.startTime.localeCompare(a.startTime);
    });
  }, [approvedLogbooks, ownLogbooks, supervisorPendingLogbooks]);

  // Automatically prune orphaned logbook_locks whose referenced logbook was already deleted
  useEffect(() => {
    if (!firebaseUser || !userProfile?.isActive) return;
    if (!locksReady || !ownReady || !approvedReady || !supervisorReady) return;

    const existingLogbookIds = new Set(allLogbooks.map((lb) => lb.id));
    for (const lk of logbookLocks) {
      const pruneKey = `${lk.id}::${lk.logbookId}`;
      if (prunedLockIdsRef.current.has(pruneKey) || existingLogbookIds.has(lk.logbookId)) {
        continue;
      }
      prunedLockIdsRef.current.add(pruneKey);

      if (isAdmin || lk.nurseId === firebaseUser.uid) {
        deleteDoc(doc(db, 'logbook_locks', lk.id)).catch(() => {
          prunedLockIdsRef.current.delete(pruneKey);
        });
      } else {
        getDoc(doc(db, 'logbook', lk.logbookId))
          .then((snap) => {
            if (!snap.exists()) {
              return deleteDoc(doc(db, 'logbook_locks', lk.id));
            }
          })
          .catch(() => {
            // Permission denied on non-approved entry of another nurse means logbook still exists
          });
      }
    }
  }, [
    firebaseUser,
    userProfile?.isActive,
    isAdmin,
    locksReady,
    ownReady,
    approvedReady,
    supervisorReady,
    allLogbooks,
    logbookLocks,
  ]);

  // Automatically prune orphaned machine_locks whose referenced non-empty logbook was deleted
  useEffect(() => {
    if (!firebaseUser || !userProfile?.isActive) return;
    if (!machineLocksReady || !ownReady || !approvedReady || !supervisorReady) return;

    const existingLogbookIds = new Set(allLogbooks.map((lb) => lb.id));
    for (const lk of machineLocks) {
      const pruneKey = `${lk.id}::${lk.logbookId || ''}`;
      if (
        !lk.logbookId ||
        prunedMachineLockIdsRef.current.has(pruneKey) ||
        existingLogbookIds.has(lk.logbookId)
      ) {
        continue;
      }
      prunedMachineLockIdsRef.current.add(pruneKey);

      if (isAdmin || lk.nurseId === firebaseUser.uid) {
        deleteDoc(doc(db, 'machine_locks', lk.id)).catch(() => {
          prunedMachineLockIdsRef.current.delete(pruneKey);
        });
      } else {
        getDoc(doc(db, 'logbook', lk.logbookId))
          .then((snap) => {
            if (!snap.exists()) {
              return deleteDoc(doc(db, 'machine_locks', lk.id));
            }
          })
          .catch(() => {
            // Permission denied on non-approved entry of another nurse means logbook still exists
          });
      }
    }
  }, [
    firebaseUser,
    userProfile?.isActive,
    isAdmin,
    machineLocksReady,
    ownReady,
    approvedReady,
    supervisorReady,
    allLogbooks,
    machineLocks,
  ]);

  const allReports = useMemo(() => {
    const map = new Map<string, ReportEntry>();
    for (const r of patientReports) map.set(r.id, r);
    for (const r of unitReports) map.set(r.id, r);
    for (const r of nurseMonthlyReports) map.set(r.id, r);
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [patientReports, unitReports, nurseMonthlyReports]);

  return {
    loading,
    patients,
    doctors,
    machines,
    actionCategories,
    staffDirectory,
    allUsers,
    ownLogbooks,
    approvedLogbooks,
    allLogbooks,
    logbookLocks,
    machineLocks,
    schedules,
    pjShiftAssignments,
    doctorSchedules,
    allReports,
  };
}

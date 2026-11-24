import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDbError,
  isTransientDbError,
  onSupabaseReconnect,
  OperationType,
  supabase,
} from '../lib/supabase';
import {
  deleteRowByColumn,
  getRowByColumn,
  mapActionCategoryRow,
  mapDoctorRow,
  mapDoctorScheduleRow,
  mapFormTemplateRow,
  mapLogbookLockRow,
  mapLogbookRow,
  mapMachineLockRow,
  mapMachineRow,
  mapPatientRow,
  mapPjShiftAssignmentRow,
  mapReportRow,
  mapScheduleRow,
  mapStaffDirectoryRow,
  mapUserRow,
} from '../lib/db';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_LOGBOOK_TEMPLATE,
  LOGBOOK_TEMPLATE_DOC_ID,
  mergeWithDefaultTemplate,
} from '../lib/logbookTemplate';
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

function mergeListByKey<T>(
  prev: T[],
  nextItem: T,
  getKey: (item: T) => string,
  sortFn?: (a: T, b: T) => number
): T[] {
  const key = getKey(nextItem);
  const idx = prev.findIndex((item) => getKey(item) === key);
  const next = idx >= 0 ? prev.map((item, i) => (i === idx ? nextItem : item)) : [...prev, nextItem];
  if (sortFn) {
    next.sort(sortFn);
  }
  return next;
}

export function useUnitData() {
  const { authReady, authUser, userProfile } = useAuth();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [actionCategories, setActionCategories] = useState<ActionCategory[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryEntry[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  const [allLogbooksRaw, setAllLogbooksRaw] = useState<LogbookEntry[]>([]);
  const [logbookLocks, setLogbookLocks] = useState<LogbookLock[]>([]);
  const [machineLocks, setMachineLocks] = useState<MachineLock[]>([]);

  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [pjShiftAssignments, setPjShiftAssignments] = useState<PjShiftAssignmentEntry[]>([]);
  const [doctorSchedules, setDoctorSchedules] = useState<DoctorScheduleEntry[]>([]);
  const [allReportsRaw, setAllReportsRaw] = useState<ReportEntry[]>([]);
  const [formTemplate, setFormTemplate] = useState<LogbookFormTemplate>(DEFAULT_LOGBOOK_TEMPLATE);
  const [loading, setLoading] = useState(true);

  const [dataReady, setDataReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [resubscribeEpoch, setResubscribeEpoch] = useState(0);
  const hydratedSessionKeyRef = useRef<string | null>(null);
  const prunedLockIdsRef = useRef<Set<string>>(new Set());
  const prunedMachineLockIdsRef = useRef<Set<string>>(new Set());

  const isLeaderOrAdmin =
    userProfile?.role === 'Administrator' ||
    userProfile?.role === 'Managerial' ||
    userProfile?.role === 'Kepala Ruang' ||
    userProfile?.role === 'PJ Shift';

  const isAdmin = userProfile?.role === 'Administrator';

  useEffect(() => {
    if (!supabase || !authReady || !authUser || !userProfile?.isActive) {
      hydratedSessionKeyRef.current = null;
      setLoading(false);
      return;
    }

    const sb = supabase;
    const sessionKey = `${authUser.uid}:${userProfile.role}`;
    const isInitialSessionLoad = hydratedSessionKeyRef.current !== sessionKey;
    hydratedSessionKeyRef.current = sessionKey;

    setFatalError(null);
    if (isInitialSessionLoad) {
      setLoading(true);
      setDataReady(false);
      prunedLockIdsRef.current.clear();
      prunedMachineLockIdsRef.current.clear();
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const loadAllTables = async () => {
      try {
        const [
          patRes,
          docRes,
          machRes,
          catRes,
          staffRes,
          usersRes,
          lbRes,
          plRes,
          mlRes,
          schedRes,
          docSchedRes,
          pjRes,
          repRes,
          tplRes,
        ] = await Promise.all([
          sb.from('patients').select('*').order('full_name', { ascending: true }),
          sb.from('doctors').select('*').order('full_name', { ascending: true }),
          sb.from('machines').select('*').order('machine_number', { ascending: true }),
          sb.from('action_categories').select('*').order('name', { ascending: true }),
          sb.from('staff_directory').select('*').order('full_name', { ascending: true }),
          isAdmin
            ? sb.from('users').select('*').order('full_name', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          sb.from('logbook').select('*').order('date', { ascending: false }),
          sb.from('logbook_locks').select('*'),
          sb.from('machine_locks').select('*'),
          isLeaderOrAdmin
            ? sb.from('schedules').select('*')
            : sb.from('schedules').select('*').eq('nurse_id', authUser.uid),
          sb.from('doctor_schedules').select('*'),
          sb.from('pj_shift_assignments').select('*'),
          sb.from('reports').select('*').order('date', { ascending: false }),
          sb.from('form_templates').select('*').eq('id', LOGBOOK_TEMPLATE_DOC_ID).maybeSingle(),
        ]);

        if (cancelled) return;

        const firstErr =
          patRes.error ||
          docRes.error ||
          machRes.error ||
          catRes.error ||
          staffRes.error ||
          usersRes.error ||
          lbRes.error ||
          plRes.error ||
          mlRes.error ||
          schedRes.error ||
          docSchedRes.error ||
          pjRes.error ||
          repRes.error;

        if (firstErr) {
          if (isTransientDbError(firstErr)) {
            console.warn('Sinkronisasi awal Supabase terganggu sementara, mencoba ulang...');
            setLoading(false);
            retryTimer = window.setTimeout(() => {
              if (!cancelled) setResubscribeEpoch((e) => e + 1);
            }, 3000);
            return;
          }
          setFatalError(formatDbError(firstErr, OperationType.LIST, 'supabase_unit_data'));
          return;
        }

        setPatients((patRes.data || []).map(mapPatientRow));
        setDoctors((docRes.data || []).map(mapDoctorRow));
        setMachines((machRes.data || []).map(mapMachineRow));
        setActionCategories((catRes.data || []).map(mapActionCategoryRow));
        setStaffDirectory((staffRes.data || []).map(mapStaffDirectoryRow));
        setAllUsers(isAdmin ? (usersRes.data || []).map(mapUserRow) : []);
        setAllLogbooksRaw((lbRes.data || []).map(mapLogbookRow));
        setLogbookLocks((plRes.data || []).map(mapLogbookLockRow));
        setMachineLocks((mlRes.data || []).map(mapMachineLockRow));
        setSchedules((schedRes.data || []).map(mapScheduleRow));
        setDoctorSchedules((docSchedRes.data || []).map(mapDoctorScheduleRow));
        setPjShiftAssignments((pjRes.data || []).map(mapPjShiftAssignmentRow));
        setAllReportsRaw((repRes.data || []).map(mapReportRow));

        if (!tplRes.error && tplRes.data) {
          setFormTemplate(mergeWithDefaultTemplate(mapFormTemplateRow(tplRes.data)));
        } else {
          setFormTemplate(DEFAULT_LOGBOOK_TEMPLATE);
        }

        setDataReady(true);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (isTransientDbError(err)) {
          setLoading(false);
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setResubscribeEpoch((e) => e + 1);
          }, 3000);
          return;
        }
        setFatalError(formatDbError(err, OperationType.LIST, 'supabase_unit_data'));
      }
    };

    void loadAllTables();

    const ch = sb
      .channel(`hemolog-unit-${authUser.uid}-${resubscribeEpoch}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patients' },
        (payload) => {
          if (cancelled) return;
          const sortFn = (a: Patient, b: Patient) => a.fullName.localeCompare(b.fullName);
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setPatients((prev) => prev.filter((p) => p.id !== oldId));
          } else if (payload.new) {
            setPatients((prev) =>
              mergeListByKey(prev, mapPatientRow(payload.new), (p) => p.id, sortFn)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'doctors' },
        (payload) => {
          if (cancelled) return;
          const sortFn = (a: Doctor, b: Doctor) => a.fullName.localeCompare(b.fullName);
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setDoctors((prev) => prev.filter((d) => d.id !== oldId));
          } else if (payload.new) {
            setDoctors((prev) =>
              mergeListByKey(prev, mapDoctorRow(payload.new), (d) => d.id, sortFn)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'machines' },
        (payload) => {
          if (cancelled) return;
          const sortFn = (a: Machine, b: Machine) => a.machineNumber.localeCompare(b.machineNumber);
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setMachines((prev) => prev.filter((m) => m.id !== oldId));
          } else if (payload.new) {
            setMachines((prev) =>
              mergeListByKey(prev, mapMachineRow(payload.new), (m) => m.id, sortFn)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'action_categories' },
        (payload) => {
          if (cancelled) return;
          const sortFn = (a: ActionCategory, b: ActionCategory) => a.name.localeCompare(b.name);
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setActionCategories((prev) => prev.filter((c) => c.id !== oldId));
          } else if (payload.new) {
            setActionCategories((prev) =>
              mergeListByKey(prev, mapActionCategoryRow(payload.new), (c) => c.id, sortFn)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_directory' },
        (payload) => {
          if (cancelled) return;
          const sortFn = (a: StaffDirectoryEntry, b: StaffDirectoryEntry) =>
            a.fullName.localeCompare(b.fullName);
          if (payload.eventType === 'DELETE') {
            const oldUid = (payload.old as { uid?: string })?.uid;
            if (oldUid) setStaffDirectory((prev) => prev.filter((s) => s.uid !== oldUid));
          } else if (payload.new) {
            setStaffDirectory((prev) =>
              mergeListByKey(prev, mapStaffDirectoryRow(payload.new), (s) => s.uid, sortFn)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'logbook' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setAllLogbooksRaw((prev) => prev.filter((l) => l.id !== oldId));
          } else if (payload.new) {
            setAllLogbooksRaw((prev) =>
              mergeListByKey(prev, mapLogbookRow(payload.new), (l) => l.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'logbook_locks' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setLogbookLocks((prev) => prev.filter((l) => l.id !== oldId));
          } else if (payload.new) {
            setLogbookLocks((prev) =>
              mergeListByKey(prev, mapLogbookLockRow(payload.new), (l) => l.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'machine_locks' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setMachineLocks((prev) => prev.filter((l) => l.id !== oldId));
          } else if (payload.new) {
            setMachineLocks((prev) =>
              mergeListByKey(prev, mapMachineLockRow(payload.new), (l) => l.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedules' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setSchedules((prev) => prev.filter((s) => s.id !== oldId));
          } else if (payload.new) {
            const item = mapScheduleRow(payload.new);
            if (!isLeaderOrAdmin && item.nurseId !== authUser.uid) return;
            setSchedules((prev) => mergeListByKey(prev, item, (s) => s.id));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'doctor_schedules' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setDoctorSchedules((prev) => prev.filter((d) => d.id !== oldId));
          } else if (payload.new) {
            setDoctorSchedules((prev) =>
              mergeListByKey(prev, mapDoctorScheduleRow(payload.new), (d) => d.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pj_shift_assignments' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setPjShiftAssignments((prev) => prev.filter((p) => p.id !== oldId));
          } else if (payload.new) {
            setPjShiftAssignments((prev) =>
              mergeListByKey(prev, mapPjShiftAssignmentRow(payload.new), (p) => p.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) setAllReportsRaw((prev) => prev.filter((r) => r.id !== oldId));
          } else if (payload.new) {
            setAllReportsRaw((prev) =>
              mergeListByKey(prev, mapReportRow(payload.new), (r) => r.id)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'form_templates',
          filter: `id=eq.${LOGBOOK_TEMPLATE_DOC_ID}`,
        },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            setFormTemplate(DEFAULT_LOGBOOK_TEMPLATE);
          } else if (payload.new) {
            setFormTemplate(mergeWithDefaultTemplate(mapFormTemplateRow(payload.new)));
          }
        }
      );

    if (isAdmin) {
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users' },
        (payload) => {
          if (cancelled) return;
          const sortFn = (a: UserProfile, b: UserProfile) => a.fullName.localeCompare(b.fullName);
          if (payload.eventType === 'DELETE') {
            const oldUid = (payload.old as { uid?: string })?.uid;
            if (oldUid) setAllUsers((prev) => prev.filter((u) => u.uid !== oldUid));
          } else if (payload.new) {
            setAllUsers((prev) =>
              mergeListByKey(prev, mapUserRow(payload.new), (u) => u.uid, sortFn)
            );
          }
        }
      );
    }

    channel = ch.subscribe();

    const unsubReconnect = onSupabaseReconnect((event) => {
      if (!cancelled && event.shouldResubscribe) {
        setResubscribeEpoch((e) => e + 1);
      }
    });

    return () => {
      cancelled = true;
      unsubReconnect();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (channel) {
        void sb.removeChannel(channel);
      }
    };
  }, [authReady, authUser?.uid, userProfile?.role, userProfile?.isActive, isLeaderOrAdmin, isAdmin, resubscribeEpoch]);

  if (fatalError) {
    throw new Error(fatalError);
  }

  const allLogbooks = useMemo(() => {
    return [...allLogbooksRaw].sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return b.startTime.localeCompare(a.startTime);
    });
  }, [allLogbooksRaw]);

  const approvedLogbooks = useMemo(
    () => allLogbooks.filter((lb) => lb.verificationStatus === 'Approved'),
    [allLogbooks]
  );

  const ownLogbooks = useMemo(() => {
    const uid = authUser?.uid;
    if (!uid) return [];
    return allLogbooks.filter((item) => item.nurseId === uid);
  }, [allLogbooks, authUser?.uid]);

  // Prune orphaned logbook_locks whose referenced logbook was already deleted
  useEffect(() => {
    if (!authUser || !userProfile?.isActive || !dataReady) return;

    const timer = window.setTimeout(() => {
      const existingLogbookIds = new Set(allLogbooks.map((lb) => lb.id));
      for (const lk of logbookLocks) {
        const pruneKey = `${lk.id}::${lk.logbookId}`;
        if (prunedLockIdsRef.current.has(pruneKey) || existingLogbookIds.has(lk.logbookId)) {
          continue;
        }
        prunedLockIdsRef.current.add(pruneKey);

        if (isAdmin || lk.nurseId === authUser.uid) {
          deleteRowByColumn('logbook_locks', 'id', lk.id).catch(() => {
            prunedLockIdsRef.current.delete(pruneKey);
          });
        } else {
          getRowByColumn('logbook', 'id', lk.logbookId)
            .then((row) => {
              if (!row) {
                return deleteRowByColumn('logbook_locks', 'id', lk.id);
              }
            })
            .catch(() => {
              // Ignore RLS read/delete rejections from non-owners
            });
        }
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [authUser, userProfile?.isActive, isAdmin, dataReady, allLogbooks, logbookLocks]);

  // Prune orphaned machine_locks whose referenced non-empty logbook was deleted
  useEffect(() => {
    if (!authUser || !userProfile?.isActive || !dataReady) return;

    const timer = window.setTimeout(() => {
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

        if (isAdmin || lk.nurseId === authUser.uid) {
          deleteRowByColumn('machine_locks', 'id', lk.id).catch(() => {
            prunedMachineLockIdsRef.current.delete(pruneKey);
          });
        } else {
          getRowByColumn('logbook', 'id', lk.logbookId)
            .then((row) => {
              if (!row) {
                return deleteRowByColumn('machine_locks', 'id', lk.id);
              }
            })
            .catch(() => {
              // Ignore RLS rejections
            });
        }
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [authUser, userProfile?.isActive, isAdmin, dataReady, allLogbooks, machineLocks]);

  const allReports = useMemo(() => {
    return [...allReportsRaw].sort((a, b) => b.date.localeCompare(a.date));
  }, [allReportsRaw]);

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
    formTemplate,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDbError,
  isTransientDbError,
  onSupabaseReconnect,
  OperationType,
  supabase,
} from '../lib/supabase';
import {
  deleteRowByColumn,
  fetchLogbookWizardDetailsByIds,
  fetchRowsPaginated,
  getRowByColumn,
  LOGBOOK_SUMMARY_COLUMNS,
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
  onDbMutation,
} from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useLiveClock } from './useLiveClock';
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

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function shiftDateStr(dateStr: string, deltaDays: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mergeLogbooksPreservingDetails(
  prev: LogbookEntry[],
  incoming: LogbookEntry[]
): LogbookEntry[] {
  if (incoming.length === 0) return prev;
  const map = new Map<string, LogbookEntry>();
  for (const item of prev) {
    map.set(item.id, item);
  }
  for (const item of incoming) {
    const existing = map.get(item.id);
    if (existing && item.wizardDetails === undefined && existing.wizardDetails !== undefined) {
      map.set(item.id, { ...item, wizardDetails: existing.wizardDetails });
    } else {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

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

function mergeManyByKey<T>(
  prev: T[],
  incoming: T[],
  getKey: (item: T) => string,
  sortFn?: (a: T, b: T) => number
): T[] {
  if (incoming.length === 0) return prev;
  const map = new Map<string, T>();
  for (const item of prev) {
    map.set(getKey(item), item);
  }
  for (const item of incoming) {
    map.set(getKey(item), item);
  }
  const next = Array.from(map.values());
  if (sortFn) {
    next.sort(sortFn);
  }
  return next;
}

export function useUnitData() {
  const { authReady, authUser, userProfile } = useAuth();
  const { todayDate, currentMonthKey: activeMonthKey } = useLiveClock();

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
  const [archiveRequestCount, setArchiveRequestCount] = useState(0);
  const [allArchivesLoaded, setAllArchivesLoaded] = useState(false);

  const [dataReady, setDataReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [resubscribeEpoch, setResubscribeEpoch] = useState(0);

  const hydratedSessionKeyRef = useRef<string | null>(null);
  const loadedActiveMonthRef = useRef<string | null>(null);
  const loadedMonthsRef = useRef<Set<string>>(new Set());
  const inflightMonthsRef = useRef<Map<string, Promise<void>>>(new Map());
  const allArchivesLoadedRef = useRef(false);
  const inflightAllArchivesRef = useRef<Promise<void> | null>(null);
  const hydratedLogbookIdsRef = useRef<Set<string>>(new Set());
  const inflightDetailPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const allLogbooksRawRef = useRef<LogbookEntry[]>([]);

  const prunedLockIdsRef = useRef<Set<string>>(new Set());
  const prunedMachineLockIdsRef = useRef<Set<string>>(new Set());

  const isLeaderOrAdmin =
    userProfile?.role === 'Administrator' ||
    userProfile?.role === 'Managerial' ||
    userProfile?.role === 'Kepala Ruang' ||
    userProfile?.role === 'PJ Shift';

  const isAdmin = userProfile?.role === 'Administrator';

  const sessionKeyRef = useRef<string | null>(null);
  const activeMonthKeyRef = useRef(activeMonthKey);
  const todayDateRef = useRef(todayDate);
  const authUidRef = useRef<string | null>(authUser?.uid ?? null);
  const isLeaderOrAdminRef = useRef(isLeaderOrAdmin);

  activeMonthKeyRef.current = activeMonthKey;
  todayDateRef.current = todayDate;
  authUidRef.current = authUser?.uid ?? null;
  isLeaderOrAdminRef.current = isLeaderOrAdmin;
  allLogbooksRawRef.current = allLogbooksRaw;

  const loadMonthData = useCallback(async (monthKey: string, forceRefresh = false) => {
    if (!supabase || !MONTH_KEY_RE.test(monthKey)) return;
    const uid = authUidRef.current;
    const leaderOrAdmin = isLeaderOrAdminRef.current;
    const capturedSessionKey = sessionKeyRef.current;
    if (!uid || !capturedSessionKey) return;

    const task = (async () => {
      setArchiveRequestCount((n) => n + 1);
      try {
        const [lbRows, repRows, schedRows, docSchedRows, pjRows] = await Promise.all([
          fetchRowsPaginated(
            'logbook',
            mapLogbookRow,
            (q) =>
              q
                .eq('month_key', monthKey)
                .order('date', { ascending: false })
                .order('id', { ascending: true }),
            { columns: LOGBOOK_SUMMARY_COLUMNS }
          ),
          fetchRowsPaginated('reports', mapReportRow, (q) =>
            q
              .eq('month_key', monthKey)
              .order('date', { ascending: false })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('schedules', mapScheduleRow, (q) => {
            const scoped = leaderOrAdmin ? q : q.eq('nurse_id', uid);
            return scoped
              .eq('month_key', monthKey)
              .order('date', { ascending: true })
              .order('id', { ascending: true });
          }),
          fetchRowsPaginated('doctor_schedules', mapDoctorScheduleRow, (q) =>
            q
              .eq('month_key', monthKey)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('pj_shift_assignments', mapPjShiftAssignmentRow, (q) =>
            q
              .eq('month_key', monthKey)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
          ),
        ]);

        if (sessionKeyRef.current !== capturedSessionKey) return;

        if (forceRefresh) {
          setAllLogbooksRaw((prev) => {
            const existingDetailMap = new Map<string, LogbookEntry['wizardDetails']>();
            for (const item of prev) {
              if (item.monthKey === monthKey && item.wizardDetails !== undefined) {
                existingDetailMap.set(item.id, item.wizardDetails);
              }
            }
            const preservedLbRows = lbRows.map((item) =>
              item.wizardDetails === undefined && existingDetailMap.has(item.id)
                ? { ...item, wizardDetails: existingDetailMap.get(item.id) }
                : item
            );
            return mergeLogbooksPreservingDetails(
              prev.filter((item) => item.monthKey !== monthKey),
              preservedLbRows
            );
          });
          setAllReportsRaw((prev) =>
            mergeManyByKey(
              prev.filter((item) => item.monthKey !== monthKey),
              repRows,
              (r) => r.id
            )
          );
          setSchedules((prev) =>
            mergeManyByKey(
              prev.filter((item) => item.monthKey !== monthKey),
              schedRows,
              (s) => s.id
            )
          );
          setDoctorSchedules((prev) =>
            mergeManyByKey(
              prev.filter((item) => item.monthKey !== monthKey),
              docSchedRows,
              (d) => d.id
            )
          );
          setPjShiftAssignments((prev) =>
            mergeManyByKey(
              prev.filter((item) => item.monthKey !== monthKey),
              pjRows,
              (p) => p.id
            )
          );
        } else {
          setAllLogbooksRaw((prev) => mergeLogbooksPreservingDetails(prev, lbRows));
          setAllReportsRaw((prev) => mergeManyByKey(prev, repRows, (r) => r.id));
          setSchedules((prev) => mergeManyByKey(prev, schedRows, (s) => s.id));
          setDoctorSchedules((prev) => mergeManyByKey(prev, docSchedRows, (d) => d.id));
          setPjShiftAssignments((prev) => mergeManyByKey(prev, pjRows, (p) => p.id));
        }

        loadedMonthsRef.current.add(monthKey);
      } catch (err) {
        if (!isTransientDbError(err)) {
          console.warn(`Gagal memuat arsip periode ${monthKey}:`, err);
        }
      } finally {
        setArchiveRequestCount((n) => Math.max(0, n - 1));
        inflightMonthsRef.current.delete(monthKey);
      }
    })();

    inflightMonthsRef.current.set(monthKey, task);
    return task;
  }, []);

  const ensureMonthLoaded = useCallback(
    async (monthKey: string) => {
      if (!supabase || !MONTH_KEY_RE.test(monthKey)) return;
      const uid = authUidRef.current;
      if (!uid) return;
      if (monthKey === activeMonthKeyRef.current && loadedMonthsRef.current.has(monthKey)) {
        return;
      }
      if (loadedMonthsRef.current.has(monthKey)) {
        return;
      }
      if (allArchivesLoadedRef.current && monthKey < activeMonthKeyRef.current) {
        return;
      }
      const existing = inflightMonthsRef.current.get(monthKey);
      if (existing) {
        return existing;
      }
      return loadMonthData(monthKey, false);
    },
    [loadMonthData]
  );

  const ensureAllArchivesLoaded = useCallback(async () => {
    if (!supabase) return;
    const uid = authUidRef.current;
    const leaderOrAdmin = isLeaderOrAdminRef.current;
    const capturedSessionKey = sessionKeyRef.current;
    const currentActiveMonth = activeMonthKeyRef.current;
    if (!uid || !capturedSessionKey || allArchivesLoadedRef.current) return;

    if (inflightAllArchivesRef.current) {
      return inflightAllArchivesRef.current;
    }

    const task = (async () => {
      setArchiveRequestCount((n) => n + 1);
      try {
        const [lbRows, repRows, schedRows, docSchedRows, pjRows] = await Promise.all([
          fetchRowsPaginated(
            'logbook',
            mapLogbookRow,
            (q) =>
              q
                .neq('month_key', currentActiveMonth)
                .order('date', { ascending: false })
                .order('id', { ascending: true }),
            { columns: LOGBOOK_SUMMARY_COLUMNS }
          ),
          fetchRowsPaginated('reports', mapReportRow, (q) =>
            q
              .neq('month_key', currentActiveMonth)
              .order('date', { ascending: false })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('schedules', mapScheduleRow, (q) => {
            const scoped = leaderOrAdmin ? q : q.eq('nurse_id', uid);
            return scoped
              .neq('month_key', currentActiveMonth)
              .order('date', { ascending: true })
              .order('id', { ascending: true });
          }),
          fetchRowsPaginated('doctor_schedules', mapDoctorScheduleRow, (q) =>
            q
              .neq('month_key', currentActiveMonth)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('pj_shift_assignments', mapPjShiftAssignmentRow, (q) =>
            q
              .neq('month_key', currentActiveMonth)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
          ),
        ]);

        if (sessionKeyRef.current !== capturedSessionKey) return;

        setAllLogbooksRaw((prev) => mergeLogbooksPreservingDetails(prev, lbRows));
        setAllReportsRaw((prev) => mergeManyByKey(prev, repRows, (r) => r.id));
        setSchedules((prev) => mergeManyByKey(prev, schedRows, (s) => s.id));
        setDoctorSchedules((prev) => mergeManyByKey(prev, docSchedRows, (d) => d.id));
        setPjShiftAssignments((prev) => mergeManyByKey(prev, pjRows, (p) => p.id));

        for (const r of lbRows) loadedMonthsRef.current.add(r.monthKey);
        for (const r of repRows) loadedMonthsRef.current.add(r.monthKey);
        for (const r of schedRows) loadedMonthsRef.current.add(r.monthKey);
        for (const r of docSchedRows) loadedMonthsRef.current.add(r.monthKey);
        for (const r of pjRows) loadedMonthsRef.current.add(r.monthKey);

        allArchivesLoadedRef.current = true;
        setAllArchivesLoaded(true);
      } catch (err) {
        if (!isTransientDbError(err)) {
          console.warn('Gagal memuat seluruh arsip riwayat/laporan:', err);
        }
      } finally {
        setArchiveRequestCount((n) => Math.max(0, n - 1));
        inflightAllArchivesRef.current = null;
      }
    })();

    inflightAllArchivesRef.current = task;
    return task;
  }, []);

  const ensureLogbookDetailsByIds = useCallback(async (ids: string[]) => {
    if (!supabase || ids.length === 0) return;
    const uid = authUidRef.current;
    const capturedSessionKey = sessionKeyRef.current;
    if (!uid || !capturedSessionKey) return;

    const pendingPromises: Promise<void>[] = [];
    const missingIds: string[] = [];
    for (const id of ids) {
      if (!id || hydratedLogbookIdsRef.current.has(id)) continue;
      const inflight = inflightDetailPromisesRef.current.get(id);
      if (inflight) {
        pendingPromises.push(inflight);
      } else if (!missingIds.includes(id)) {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) {
      if (pendingPromises.length > 0) {
        await Promise.all(pendingPromises);
      }
      return;
    }

    const fetchTask = (async () => {
      setArchiveRequestCount((n) => n + 1);
      try {
        const detailsMap = await fetchLogbookWizardDetailsByIds(missingIds);
        if (sessionKeyRef.current !== capturedSessionKey) return;

        for (const id of missingIds) {
          hydratedLogbookIdsRef.current.add(id);
        }

        if (detailsMap.size > 0) {
          setAllLogbooksRaw((prev) =>
            prev.map((lb) =>
              detailsMap.has(lb.id) ? { ...lb, wizardDetails: detailsMap.get(lb.id) } : lb
            )
          );
        }
      } catch (err) {
        if (!isTransientDbError(err)) {
          console.warn('Gagal memuat detail SPO logbook:', err);
        }
      } finally {
        setArchiveRequestCount((n) => Math.max(0, n - 1));
        for (const id of missingIds) {
          inflightDetailPromisesRef.current.delete(id);
        }
      }
    })();

    for (const id of missingIds) {
      inflightDetailPromisesRef.current.set(id, fetchTask);
    }

    await Promise.all([...pendingPromises, fetchTask]);
  }, []);

  const ensureMonthDetailsLoaded = useCallback(
    async (monthKey: string) => {
      await ensureMonthLoaded(monthKey);
      const ids = allLogbooksRawRef.current
        .filter((lb) => lb.monthKey === monthKey && !hydratedLogbookIdsRef.current.has(lb.id))
        .map((lb) => lb.id);
      if (ids.length > 0) {
        await ensureLogbookDetailsByIds(ids);
      }
    },
    [ensureMonthLoaded, ensureLogbookDetailsByIds]
  );

  const ensureAllArchiveDetailsLoaded = useCallback(async () => {
    await ensureAllArchivesLoaded();
    const ids = allLogbooksRawRef.current
      .filter((lb) => !hydratedLogbookIdsRef.current.has(lb.id))
      .map((lb) => lb.id);
    if (ids.length > 0) {
      await ensureLogbookDetailsByIds(ids);
    }
  }, [ensureAllArchivesLoaded, ensureLogbookDetailsByIds]);

  // Keep cross-month local mutations (e.g. approving yesterday's carry-over or signing last month's report) synced immediately
  useEffect(() => {
    if (!supabase || !authReady || !authUser || !userProfile?.isActive) return;
    const sb = supabase;
    const trackedTables = new Set([
      'logbook',
      'reports',
      'schedules',
      'doctor_schedules',
      'pj_shift_assignments',
      'logbook_locks',
      'machine_locks',
    ]);

    return onDbMutation((event) => {
      if (!trackedTables.has(event.table)) return;

      if (event.op === 'delete' && event.col === 'id') {
        const idsToDelete = new Set(
          event.value ? [event.value] : event.values ? event.values : []
        );
        if (idsToDelete.size === 0) return;
        if (event.table === 'logbook') {
          setAllLogbooksRaw((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        } else if (event.table === 'reports') {
          setAllReportsRaw((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        } else if (event.table === 'schedules') {
          setSchedules((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        } else if (event.table === 'doctor_schedules') {
          setDoctorSchedules((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        } else if (event.table === 'pj_shift_assignments') {
          setPjShiftAssignments((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        } else if (event.table === 'logbook_locks') {
          setLogbookLocks((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        } else if (event.table === 'machine_locks') {
          setMachineLocks((prev) => prev.filter((item) => !idsToDelete.has(item.id)));
        }
        return;
      }

      if ((event.op === 'insert' || event.op === 'upsert') && event.row) {
        const row = event.row;
        if (event.table === 'logbook') {
          const mapped = mapLogbookRow(row);
          if ('wizard_details' in row) {
            hydratedLogbookIdsRef.current.add(mapped.id);
          }
          setAllLogbooksRaw((prev) => mergeLogbooksPreservingDetails(prev, [mapped]));
        } else if (event.table === 'reports') {
          setAllReportsRaw((prev) => mergeListByKey(prev, mapReportRow(row), (r) => r.id));
        } else if (event.table === 'schedules') {
          const mapped = mapScheduleRow(row);
          if (isLeaderOrAdminRef.current || mapped.nurseId === authUidRef.current) {
            setSchedules((prev) => mergeListByKey(prev, mapped, (s) => s.id));
          }
        } else if (event.table === 'doctor_schedules') {
          setDoctorSchedules((prev) =>
            mergeListByKey(prev, mapDoctorScheduleRow(row), (d) => d.id)
          );
        } else if (event.table === 'pj_shift_assignments') {
          setPjShiftAssignments((prev) =>
            mergeListByKey(prev, mapPjShiftAssignmentRow(row), (p) => p.id)
          );
        } else if (event.table === 'logbook_locks' && row.month_key === activeMonthKeyRef.current) {
          setLogbookLocks((prev) => mergeListByKey(prev, mapLogbookLockRow(row), (l) => l.id));
        } else if (event.table === 'machine_locks' && row.month_key === activeMonthKeyRef.current) {
          setMachineLocks((prev) => mergeListByKey(prev, mapMachineLockRow(row), (l) => l.id));
        }
        return;
      }

      if ((event.op === 'insert' || event.op === 'upsert') && event.rows && event.rows.length > 0) {
        const affectedMonths = new Set<string>();
        for (const r of event.rows) {
          if (typeof r.month_key === 'string' && MONTH_KEY_RE.test(r.month_key)) {
            affectedMonths.add(r.month_key);
          }
        }
        affectedMonths.forEach((mk) => {
          if (mk === activeMonthKeyRef.current || loadedMonthsRef.current.has(mk)) {
            void loadMonthData(mk, true);
          }
        });
        return;
      }

      if (event.op === 'update' && event.col) {
        const targetValues = event.value ? [event.value] : event.values || [];
        if (targetValues.length === 0) return;

        void (async () => {
          try {
            const cols =
              event.table === 'logbook' && targetValues.length > 1
                ? LOGBOOK_SUMMARY_COLUMNS
                : '*';
            const query = sb.from(event.table).select(cols);
            const { data, error } =
              targetValues.length === 1
                ? await query.eq(event.col!, targetValues[0])
                : await query.in(event.col!, targetValues);
            if (error || !data || data.length === 0) return;

            if (event.table === 'logbook') {
              const mapped = data.map(mapLogbookRow);
              if (cols === '*') {
                for (const lb of mapped) {
                  hydratedLogbookIdsRef.current.add(lb.id);
                }
              }
              setAllLogbooksRaw((prev) => mergeLogbooksPreservingDetails(prev, mapped));
            } else if (event.table === 'reports') {
              setAllReportsRaw((prev) =>
                mergeManyByKey(prev, data.map(mapReportRow), (r) => r.id)
              );
            } else if (event.table === 'schedules') {
              const mapped = data
                .map(mapScheduleRow)
                .filter((s) => isLeaderOrAdminRef.current || s.nurseId === authUidRef.current);
              setSchedules((prev) => mergeManyByKey(prev, mapped, (s) => s.id));
            } else if (event.table === 'doctor_schedules') {
              setDoctorSchedules((prev) =>
                mergeManyByKey(prev, data.map(mapDoctorScheduleRow), (d) => d.id)
              );
            } else if (event.table === 'pj_shift_assignments') {
              setPjShiftAssignments((prev) =>
                mergeManyByKey(prev, data.map(mapPjShiftAssignmentRow), (p) => p.id)
              );
            }
          } catch {
            // Realtime or next sync will reconcile
          }
        })();
      }
    });
  }, [authReady, authUser?.uid, userProfile?.isActive, loadMonthData]);

  useEffect(() => {
    if (!supabase || !authReady || !authUser || !userProfile?.isActive) {
      hydratedSessionKeyRef.current = null;
      sessionKeyRef.current = null;
      loadedActiveMonthRef.current = null;
      loadedMonthsRef.current.clear();
      inflightMonthsRef.current.clear();
      inflightAllArchivesRef.current = null;
      allArchivesLoadedRef.current = false;
      hydratedLogbookIdsRef.current.clear();
      inflightDetailPromisesRef.current.clear();
      setAllArchivesLoaded(false);
      setLoading(false);
      return;
    }

    const sb = supabase;
    const sessionKey = `${authUser.uid}:${userProfile.role}`;
    const isInitialSessionLoad = hydratedSessionKeyRef.current !== sessionKey;
    hydratedSessionKeyRef.current = sessionKey;
    sessionKeyRef.current = sessionKey;

    setFatalError(null);
    if (isInitialSessionLoad) {
      setLoading(true);
      setDataReady(false);
      loadedActiveMonthRef.current = null;
      loadedMonthsRef.current.clear();
      inflightMonthsRef.current.clear();
      inflightAllArchivesRef.current = null;
      allArchivesLoadedRef.current = false;
      hydratedLogbookIdsRef.current.clear();
      inflightDetailPromisesRef.current.clear();
      setAllArchivesLoaded(false);
      prunedLockIdsRef.current.clear();
      prunedMachineLockIdsRef.current.clear();
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const loadActiveTables = async () => {
      try {
        const recentStartDate = shiftDateStr(todayDateRef.current, -1);
        const [
          patRows,
          docRows,
          machRows,
          catRows,
          staffRows,
          userRows,
          recentAndOpenLbRows,
          olderApprovedLbRows,
          carryOverLbRows,
          plRows,
          mlRows,
          schedRows,
          docSchedRows,
          pjRows,
          repRows,
          tplRes,
        ] = await Promise.all([
          fetchRowsPaginated('patients', mapPatientRow, (q) =>
            q.order('full_name', { ascending: true }).order('id', { ascending: true })
          ),
          fetchRowsPaginated('doctors', mapDoctorRow, (q) =>
            q.order('full_name', { ascending: true }).order('id', { ascending: true })
          ),
          fetchRowsPaginated('machines', mapMachineRow, (q) =>
            q.order('machine_number', { ascending: true }).order('id', { ascending: true })
          ),
          fetchRowsPaginated('action_categories', mapActionCategoryRow, (q) =>
            q.order('name', { ascending: true }).order('id', { ascending: true })
          ),
          fetchRowsPaginated('staff_directory', mapStaffDirectoryRow, (q) =>
            q.order('full_name', { ascending: true }).order('uid', { ascending: true })
          ),
          isAdmin
            ? fetchRowsPaginated('users', mapUserRow, (q) =>
                q.order('full_name', { ascending: true }).order('uid', { ascending: true })
              )
            : Promise.resolve([] as UserProfile[]),
          // Active window (hari ini + kemarin + seluruh Draft/Pending/Revision bulan berjalan) dengan detail SPO lengkap
          fetchRowsPaginated('logbook', mapLogbookRow, (q) =>
            q
              .eq('month_key', activeMonthKey)
              .or(`date.gte.${recentStartDate},verification_status.in.(Draft,Pending,Revision)`)
              .order('date', { ascending: false })
              .order('id', { ascending: true })
          ),
          // Hari-hari sebelumnya di bulan berjalan yang sudah Approved: hanya kolom ringkasan (tanpa wizard_details)
          fetchRowsPaginated(
            'logbook',
            mapLogbookRow,
            (q) =>
              q
                .eq('month_key', activeMonthKey)
                .lt('date', recentStartDate)
                .eq('verification_status', 'Approved')
                .order('date', { ascending: false })
                .order('id', { ascending: true }),
            { columns: LOGBOOK_SUMMARY_COLUMNS }
          ),
          fetchRowsPaginated('logbook', mapLogbookRow, (q) =>
            q
              .lt('month_key', activeMonthKey)
              .in('verification_status', ['Draft', 'Pending', 'Revision'])
              .order('date', { ascending: false })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('logbook_locks', mapLogbookLockRow, (q) =>
            q.eq('month_key', activeMonthKey).order('id', { ascending: true })
          ),
          fetchRowsPaginated('machine_locks', mapMachineLockRow, (q) =>
            q.eq('month_key', activeMonthKey).order('id', { ascending: true })
          ),
          fetchRowsPaginated('schedules', mapScheduleRow, (q) => {
            const scoped = isLeaderOrAdmin ? q : q.eq('nurse_id', authUser.uid);
            return scoped
              .eq('month_key', activeMonthKey)
              .order('date', { ascending: true })
              .order('id', { ascending: true });
          }),
          fetchRowsPaginated('doctor_schedules', mapDoctorScheduleRow, (q) =>
            q
              .eq('month_key', activeMonthKey)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('pj_shift_assignments', mapPjShiftAssignmentRow, (q) =>
            q
              .eq('month_key', activeMonthKey)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
          ),
          fetchRowsPaginated('reports', mapReportRow, (q) =>
            q
              .eq('month_key', activeMonthKey)
              .order('date', { ascending: false })
              .order('id', { ascending: true })
          ),
          sb.from('form_templates').select('*').eq('id', LOGBOOK_TEMPLATE_DOC_ID).maybeSingle(),
        ]);

        if (cancelled) return;

        for (const item of recentAndOpenLbRows) {
          hydratedLogbookIdsRef.current.add(item.id);
        }
        for (const item of carryOverLbRows) {
          hydratedLogbookIdsRef.current.add(item.id);
        }

        setPatients(patRows);
        setDoctors(docRows);
        setMachines(machRows);
        setActionCategories(catRows);
        setStaffDirectory(staffRows);
        setAllUsers(isAdmin ? userRows : []);

        const freshLogbooks = mergeLogbooksPreservingDetails(
          olderApprovedLbRows,
          mergeLogbooksPreservingDetails(recentAndOpenLbRows, carryOverLbRows)
        );
        if (isInitialSessionLoad) {
          setAllLogbooksRaw(freshLogbooks);
          setSchedules(schedRows);
          setDoctorSchedules(docSchedRows);
          setPjShiftAssignments(pjRows);
          setAllReportsRaw(repRows);
        } else {
          // Preserve already-loaded archive months & hydrated details across reconnects or month rollovers
          setAllLogbooksRaw((prev) =>
            mergeLogbooksPreservingDetails(
              prev.filter(
                (lb) =>
                  (lb.monthKey !== activeMonthKey &&
                    lb.verificationStatus === 'Approved' &&
                    loadedMonthsRef.current.has(lb.monthKey)) ||
                  (lb.monthKey === activeMonthKey && lb.wizardDetails !== undefined)
              ),
              freshLogbooks
            )
          );
          setSchedules((prev) =>
            mergeManyByKey(
              prev.filter(
                (s) => s.monthKey !== activeMonthKey && loadedMonthsRef.current.has(s.monthKey)
              ),
              schedRows,
              (s) => s.id
            )
          );
          setDoctorSchedules((prev) =>
            mergeManyByKey(
              prev.filter(
                (d) => d.monthKey !== activeMonthKey && loadedMonthsRef.current.has(d.monthKey)
              ),
              docSchedRows,
              (d) => d.id
            )
          );
          setPjShiftAssignments((prev) =>
            mergeManyByKey(
              prev.filter(
                (p) => p.monthKey !== activeMonthKey && loadedMonthsRef.current.has(p.monthKey)
              ),
              pjRows,
              (p) => p.id
            )
          );
          setAllReportsRaw((prev) =>
            mergeManyByKey(
              prev.filter(
                (r) => r.monthKey !== activeMonthKey && loadedMonthsRef.current.has(r.monthKey)
              ),
              repRows,
              (r) => r.id
            )
          );
        }

        setLogbookLocks(plRows);
        setMachineLocks(mlRows);

        if (!tplRes.error && tplRes.data) {
          setFormTemplate(mergeWithDefaultTemplate(mapFormTemplateRow(tplRes.data)));
        } else {
          setFormTemplate(DEFAULT_LOGBOOK_TEMPLATE);
        }

        loadedMonthsRef.current.add(activeMonthKey);
        loadedActiveMonthRef.current = activeMonthKey;
        setDataReady(true);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (isTransientDbError(err)) {
          console.warn('Sinkronisasi awal Supabase terganggu sementara, mencoba ulang...');
          setLoading(false);
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setResubscribeEpoch((e) => e + 1);
          }, 3000);
          return;
        }
        setFatalError(formatDbError(err, OperationType.LIST, 'supabase_unit_data'));
      }
    };

    void loadActiveTables();

    const activeMonthFilter = `month_key=eq.${activeMonthKey}`;
    const ch = sb
      .channel(`hemolog-unit-${authUser.uid}-${activeMonthKey}-${resubscribeEpoch}`)
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
      // Scoped active-month realtime for clinical transactional tables (INSERT/UPDATE filtered by month_key, DELETE unfiltered for REPLICA IDENTITY DEFAULT safety)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'logbook', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          const mapped = mapLogbookRow(payload.new);
          if ('wizard_details' in payload.new) {
            hydratedLogbookIdsRef.current.add(mapped.id);
          }
          setAllLogbooksRaw((prev) => mergeLogbooksPreservingDetails(prev, [mapped]));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'logbook', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          const mapped = mapLogbookRow(payload.new);
          if ('wizard_details' in payload.new) {
            hydratedLogbookIdsRef.current.add(mapped.id);
          }
          setAllLogbooksRaw((prev) => mergeLogbooksPreservingDetails(prev, [mapped]));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'logbook' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setAllLogbooksRaw((prev) => prev.filter((l) => l.id !== oldId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'logbook_locks', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          setLogbookLocks((prev) =>
            mergeListByKey(prev, mapLogbookLockRow(payload.new), (l) => l.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'logbook_locks', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          setLogbookLocks((prev) =>
            mergeListByKey(prev, mapLogbookLockRow(payload.new), (l) => l.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'logbook_locks' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setLogbookLocks((prev) => prev.filter((l) => l.id !== oldId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'machine_locks', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          setMachineLocks((prev) =>
            mergeListByKey(prev, mapMachineLockRow(payload.new), (l) => l.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'machine_locks', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          setMachineLocks((prev) =>
            mergeListByKey(prev, mapMachineLockRow(payload.new), (l) => l.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'machine_locks' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setMachineLocks((prev) => prev.filter((l) => l.id !== oldId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'schedules', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          const item = mapScheduleRow(payload.new);
          if (!isLeaderOrAdmin && item.nurseId !== authUser.uid) return;
          setSchedules((prev) => mergeListByKey(prev, item, (s) => s.id));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'schedules', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          const item = mapScheduleRow(payload.new);
          if (!isLeaderOrAdmin && item.nurseId !== authUser.uid) return;
          setSchedules((prev) => mergeListByKey(prev, item, (s) => s.id));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'schedules' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setSchedules((prev) => prev.filter((s) => s.id !== oldId));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'doctor_schedules',
          filter: activeMonthFilter,
        },
        (payload) => {
          if (cancelled || !payload.new) return;
          setDoctorSchedules((prev) =>
            mergeListByKey(prev, mapDoctorScheduleRow(payload.new), (d) => d.id)
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'doctor_schedules',
          filter: activeMonthFilter,
        },
        (payload) => {
          if (cancelled || !payload.new) return;
          setDoctorSchedules((prev) =>
            mergeListByKey(prev, mapDoctorScheduleRow(payload.new), (d) => d.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'doctor_schedules' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setDoctorSchedules((prev) => prev.filter((d) => d.id !== oldId));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pj_shift_assignments',
          filter: activeMonthFilter,
        },
        (payload) => {
          if (cancelled || !payload.new) return;
          setPjShiftAssignments((prev) =>
            mergeListByKey(prev, mapPjShiftAssignmentRow(payload.new), (p) => p.id)
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pj_shift_assignments',
          filter: activeMonthFilter,
        },
        (payload) => {
          if (cancelled || !payload.new) return;
          setPjShiftAssignments((prev) =>
            mergeListByKey(prev, mapPjShiftAssignmentRow(payload.new), (p) => p.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'pj_shift_assignments' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setPjShiftAssignments((prev) => prev.filter((p) => p.id !== oldId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reports', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          setAllReportsRaw((prev) =>
            mergeListByKey(prev, mapReportRow(payload.new), (r) => r.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'reports', filter: activeMonthFilter },
        (payload) => {
          if (cancelled || !payload.new) return;
          setAllReportsRaw((prev) =>
            mergeListByKey(prev, mapReportRow(payload.new), (r) => r.id)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'reports' },
        (payload) => {
          if (cancelled) return;
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setAllReportsRaw((prev) => prev.filter((r) => r.id !== oldId));
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
  }, [
    authReady,
    authUser?.uid,
    userProfile?.role,
    userProfile?.isActive,
    isLeaderOrAdmin,
    isAdmin,
    activeMonthKey,
    resubscribeEpoch,
  ]);

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

  // Prune orphaned logbook_locks ONLY within the loaded active month
  useEffect(() => {
    if (!authUser || !userProfile?.isActive || !dataReady) return;
    if (loadedActiveMonthRef.current !== activeMonthKey) return;

    const timer = window.setTimeout(() => {
      const existingLogbookIds = new Set(allLogbooks.map((lb) => lb.id));
      for (const lk of logbookLocks) {
        if (lk.monthKey !== activeMonthKey) continue;
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
  }, [authUser, userProfile?.isActive, isAdmin, dataReady, activeMonthKey, allLogbooks, logbookLocks]);

  // Prune orphaned machine_locks ONLY within the loaded active month
  useEffect(() => {
    if (!authUser || !userProfile?.isActive || !dataReady) return;
    if (loadedActiveMonthRef.current !== activeMonthKey) return;

    const timer = window.setTimeout(() => {
      const existingLogbookIds = new Set(allLogbooks.map((lb) => lb.id));
      for (const lk of machineLocks) {
        if (lk.monthKey !== activeMonthKey) continue;
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
  }, [authUser, userProfile?.isActive, isAdmin, dataReady, activeMonthKey, allLogbooks, machineLocks]);

  const allReports = useMemo(() => {
    return [...allReportsRaw].sort((a, b) => b.date.localeCompare(a.date));
  }, [allReportsRaw]);

  return {
    loading,
    archiveLoading: archiveRequestCount > 0,
    allArchivesLoaded,
    ensureMonthLoaded,
    ensureAllArchivesLoaded,
    ensureLogbookDetailsByIds,
    ensureMonthDetailsLoaded,
    ensureAllArchiveDetailsLoaded,
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

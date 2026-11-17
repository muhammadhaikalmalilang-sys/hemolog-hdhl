import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { CheckCircle2, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BulkAddPatientsModal } from '../components/patients/BulkAddPatientsModal';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { clampString } from '../lib/formatters';
import type { Patient, PatientStatus, VascularAccessType } from '../types';

interface PatientsPageProps {
  patients: Patient[];
}

export function PatientsPage({ patients }: PatientsPageProps) {
  const { userProfile } = useAuth();
  const isAdministrator = userProfile?.role === 'Administrator';

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSuccessCount, setBulkSuccessCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null);

  const [mrn, setMrn] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'L' | 'P'>('L');
  const [birthYear, setBirthYear] = useState('1970');
  const [vascularAccess, setVascularAccess] = useState<VascularAccessType>('AV Shunt');
  const [diagnosis, setDiagnosis] = useState('');
  const [routineSchedule, setRoutineSchedule] = useState('Senin & Kamis (Pagi)');
  const [status, setStatus] = useState<PatientStatus>('Aktif');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    return patients.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        if (
          !p.fullName.toLowerCase().includes(q) &&
          !p.mrn.toLowerCase().includes(q) &&
          !p.diagnosis.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [patients, statusFilter, searchTerm]);

  const openCreate = () => {
    setEditing(null);
    setMrn('');
    setFullName('');
    setGender('L');
    setBirthYear('1970');
    setVascularAccess('AV Shunt');
    setDiagnosis('PGK Stage V');
    setRoutineSchedule('Senin & Kamis (Pagi)');
    setStatus('Aktif');
    setNotes('');
    setShowModal(true);
  };

  const openEdit = (p: Patient) => {
    setEditing(p);
    setMrn(p.mrn);
    setFullName(p.fullName);
    setGender(p.gender);
    setBirthYear(String(p.birthYear));
    setVascularAccess(p.vascularAccess);
    setDiagnosis(p.diagnosis);
    setRoutineSchedule(p.routineSchedule);
    setStatus(p.status);
    setNotes(p.notes || '');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        mrn: clampString(mrn, 40),
        fullName: clampString(fullName, 120),
        gender,
        birthYear: Math.min(2030, Math.max(1900, Number(birthYear) || 1970)),
        vascularAccess,
        diagnosis: clampString(diagnosis, 200),
        dpjpId: '-',
        dpjpName: '-',
        routineSchedule: clampString(routineSchedule, 80),
        status,
        notes: clampString(notes, 500),
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'patients', editing.id), payload);
      } else {
        await addDoc(collection(db, 'patients'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setShowModal(false);
    } catch (err) {
      handleFirestoreError(err, editing ? OperationType.UPDATE : OperationType.CREATE, 'patients');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'patients', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `patients/${deleteTarget.id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">Data Pasien Hemodialisa</h2>
          <p className="text-xs text-slate-500">
            Master data pasien HD rutin, akses vaskular, diagnosa, dan jadwal rutin (DPJP mengikuti jadwal dokter saat tindakan).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdministrator && (
            <button
              type="button"
              onClick={() => {
                setBulkSuccessCount(null);
                setShowBulkModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 bg-white px-4 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
            >
              <Users className="h-4 w-4" />
              Tambah Banyak Pasien
            </button>
          )}
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            Tambah Pasien HD
          </button>
        </div>
      </div>

      {bulkSuccessCount !== null && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              Berhasil menambahkan <strong>{bulkSuccessCount}</strong> pasien hemodialisa baru ke master data.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBulkSuccessCount(null)}
            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari nama pasien, No. RM, atau diagnosa..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-teal-600 focus:outline-none"
        >
          <option value="ALL">Semua Status Pasien</option>
          <option value="Aktif">Aktif</option>
          <option value="Rujuk">Rujuk</option>
          <option value="Nonaktif">Nonaktif</option>
          <option value="Meninggal">Meninggal</option>
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Belum ada data pasien yang sesuai filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">No. RM</th>
                  <th className="px-4 py-3 font-semibold">Nama Pasien</th>
                  <th className="px-4 py-3 font-semibold">Akses & Jadwal</th>
                  <th className="px-4 py-3 font-semibold">Diagnosa & Catatan</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{p.mrn}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{p.fullName}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.gender === 'L' ? 'Laki-laki' : 'Perempuan'} · Lahir {p.birthYear}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-teal-700">{p.vascularAccess}</div>
                      <div className="text-[11px] text-slate-500">{p.routineSchedule}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 max-w-xs truncate">{p.diagnosis}</div>
                      {p.notes ? (
                        <div className="text-[11px] text-slate-500 max-w-xs truncate">{p.notes}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                          p.status === 'Aktif'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(p)}
                          className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editing ? 'Edit Data Pasien HD' : 'Tambah Pasien Hemodialisa'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nomor Rekam Medis</label>
                  <input
                    type="text"
                    required
                    value={mrn}
                    onChange={(e) => setMrn(e.target.value)}
                    placeholder="RM-004501"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama Lengkap Pasien</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Jenis Kelamin</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as 'L' | 'P')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tahun Lahir</label>
                  <input
                    type="number"
                    required
                    value={birthYear}
                    onChange={(e) => setBirthYear(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Akses Vaskular</label>
                  <select
                    value={vascularAccess}
                    onChange={(e) => setVascularAccess(e.target.value as VascularAccessType)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    <option value="AV Shunt">AV Shunt</option>
                    <option value="CDL">CDL</option>
                    <option value="Femoral">Femoral</option>
                    <option value="AVG">AVG</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Jadwal HD Rutin</label>
                  <input
                    type="text"
                    required
                    list="hd-routine-schedule-presets"
                    value={routineSchedule}
                    onChange={(e) => setRoutineSchedule(e.target.value)}
                    placeholder="Contoh: Selasa & Jumat (Pagi)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                  <datalist id="hd-routine-schedule-presets">
                    <option value="SENIN-KAMIS" />
                    <option value="SELASA-JUMAT" />
                    <option value="RABU-SABTU" />
                    <option value="SENIN" />
                    <option value="KAMIS" />
                    <option value="Senin & Kamis (Pagi)" />
                    <option value="Senin & Kamis (Siang)" />
                    <option value="Selasa & Jumat (Pagi)" />
                    <option value="Selasa & Jumat (Siang)" />
                    <option value="Rabu & Sabtu (Pagi)" />
                    <option value="Rabu & Sabtu (Siang)" />
                  </datalist>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PatientStatus)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    <option value="Aktif">Aktif</option>
                    <option value="Rujuk">Rujuk</option>
                    <option value="Nonaktif">Nonaktif</option>
                    <option value="Meninggal">Meninggal</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Diagnosa Medis</label>
                <input
                  type="text"
                  required
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Catatan Klinis</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-teal-600 px-5 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Data Pasien'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900">Hapus Data Pasien?</h3>
            <p className="mt-2 text-xs text-slate-600">
              Pasien <strong>{deleteTarget.fullName}</strong> ({deleteTarget.mrn}) akan dihapus dari master data.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Hapus Pasien
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bulk Add Modal (Administrator only) */}
      {showBulkModal && isAdministrator && (
        <BulkAddPatientsModal
          existingPatients={patients}
          onClose={() => setShowBulkModal(false)}
          onSuccess={(addedCount) => {
            setShowBulkModal(false);
            setBulkSuccessCount(addedCount);
          }}
        />
      )}
    </div>
  );
}

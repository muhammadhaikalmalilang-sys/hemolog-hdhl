import React, { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { clampString, getTodayDateStr } from '../lib/formatters';
import { MachineStatusBadge } from '../components/ui/StatusBadge';
import { BulkAddMachinesModal } from '../components/machines/BulkAddMachinesModal';
import type { Machine, MachineStatus } from '../types';

interface MachinesPageProps {
  machines: Machine[];
}

export function MachinesPage({ machines }: MachinesPageProps) {
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSuccessCount, setBulkSuccessCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Machine | null>(null);

  const [machineNumber, setMachineNumber] = useState('');
  const [brand, setBrand] = useState('Fresenius 4008S');
  const [serialNumber, setSerialNumber] = useState('');
  const [roomZone, setRoomZone] = useState('Ruang A (Reguler)');
  const [status, setStatus] = useState<MachineStatus>('Ready');
  const [lastMaintenanceDate, setLastMaintenanceDate] = useState(getTodayDateStr());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setMachineNumber('');
    setBrand('Fresenius 4008S');
    setSerialNumber('');
    setRoomZone('Ruang A (Reguler)');
    setStatus('Ready');
    setLastMaintenanceDate(getTodayDateStr());
    setNotes('');
    setShowModal(true);
  };

  const openEdit = (m: Machine) => {
    setEditing(m);
    setMachineNumber(m.machineNumber);
    setBrand(m.brand);
    setSerialNumber(m.serialNumber || '');
    setRoomZone(m.roomZone || '');
    setStatus(m.status);
    setLastMaintenanceDate(m.lastMaintenanceDate || '');
    setNotes(m.notes || '');
    setShowModal(true);
  };

  const handleQuickStatus = async (m: Machine, nextStatus: MachineStatus) => {
    try {
      await updateDoc(doc(db, 'machines', m.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `machines/${m.id}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        machineNumber: clampString(machineNumber, 40),
        brand: clampString(brand, 80),
        serialNumber: clampString(serialNumber, 80),
        roomZone: clampString(roomZone, 60),
        status,
        lastMaintenanceDate: clampString(lastMaintenanceDate, 20),
        notes: clampString(notes, 500),
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'machines', editing.id), payload);
      } else {
        await addDoc(collection(db, 'machines'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setShowModal(false);
    } catch (err) {
      handleFirestoreError(err, editing ? OperationType.UPDATE : OperationType.CREATE, 'machines');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'machines', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `machines/${deleteTarget.id}`);
    }
  };

  const statusCounts = {
    Ready: machines.filter((m) => m.status === 'Ready').length,
    'In Use': machines.filter((m) => m.status === 'In Use').length,
    Sterilisasi: machines.filter((m) => m.status === 'Sterilisasi').length,
    Maintenance: machines.filter((m) => m.status === 'Maintenance').length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Monitoring & Manajemen Mesin Hemodialisa
          </h2>
          <p className="text-xs text-slate-500">
            Pantau kesiapan unit mesin HD, status penggunaan, sterilisasi, dan jadwal kalibrasi teknis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBulkSuccessCount(null);
              setShowBulkModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 bg-white px-4 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
          >
            <Layers className="h-4 w-4" />
            Tambah Banyak Mesin
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            Tambah Mesin HD
          </button>
        </div>
      </div>

      {bulkSuccessCount !== null && (
        <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-medium text-teal-800">
          <span>{bulkSuccessCount} data mesin HD berhasil ditambahkan secara massal ke Firestore.</span>
          <button
            type="button"
            onClick={() => setBulkSuccessCount(null)}
            className="text-teal-700 hover:text-teal-900 font-semibold"
          >
            Tutup
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(['Ready', 'In Use', 'Sterilisasi', 'Maintenance'] as MachineStatus[]).map((st) => (
          <div key={st} className="rounded-xl border border-slate-200 bg-white p-4">
            <MachineStatusBadge status={st} />
            <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {statusCounts[st]} <span className="text-xs font-normal text-slate-500">unit</span>
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {machines.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-base font-bold text-slate-900">
                    {m.machineNumber}
                  </span>
                  <p className="text-xs font-medium text-slate-600">{m.brand}</p>
                </div>
                <MachineStatusBadge status={m.status} />
              </div>

              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <p>Zona: <strong className="text-slate-700">{m.roomZone || '-'}</strong></p>
                <p>No. Seri: <span className="font-mono text-slate-700">{m.serialNumber || '-'}</span></p>
                <p>Kalibrasi Terakhir: <span className="font-mono text-slate-700">{m.lastMaintenanceDate || '-'}</span></p>
                {m.notes && <p className="pt-1 text-slate-600">{m.notes}</p>}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <select
                aria-label={`Ubah status ${m.machineNumber}`}
                value={m.status}
                onChange={(e) => handleQuickStatus(m, e.target.value as MachineStatus)}
                className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-teal-600 focus:outline-none"
              >
                <option value="Ready">Set Ready</option>
                <option value="In Use">Set In Use</option>
                <option value="Sterilisasi">Set Sterilisasi</option>
                <option value="Maintenance">Set Maintenance</option>
              </select>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(m)}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(m)}
                  className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editing ? 'Edit Mesin HD' : 'Tambah Mesin HD'}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nomor Mesin</label>
                  <input
                    type="text"
                    required
                    value={machineNumber}
                    onChange={(e) => setMachineNumber(e.target.value)}
                    placeholder="HD-07"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as MachineStatus)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    <option value="Ready">Ready</option>
                    <option value="In Use">In Use</option>
                    <option value="Sterilisasi">Sterilisasi</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Merek / Tipe</label>
                <input
                  type="text"
                  required
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nomor Seri</label>
                  <input
                    type="text"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Maintenance Terakhir</label>
                  <input
                    type="date"
                    value={lastMaintenanceDate}
                    onChange={(e) => setLastMaintenanceDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Zona / Ruangan</label>
                <input
                  type="text"
                  value={roomZone}
                  onChange={(e) => setRoomZone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Catatan Teknis</label>
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
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-teal-600 px-5 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Mesin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900">Hapus Mesin HD?</h3>
            <p className="mt-2 text-xs text-slate-600">
              Mesin <strong>{deleteTarget.machineNumber}</strong> ({deleteTarget.brand}) akan dihapus.
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
                Hapus Mesin
              </button>
            </div>
          </div>
        </div>
      )}
      {showBulkModal && (
        <BulkAddMachinesModal
          existingMachines={machines}
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

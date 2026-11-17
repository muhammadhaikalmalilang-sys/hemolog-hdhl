import React, { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { clampString } from '../lib/formatters';
import { BulkAddDoctorsModal } from '../components/doctors/BulkAddDoctorsModal';
import type { Doctor, DoctorStatus } from '../types';

interface DoctorsPageProps {
  doctors: Doctor[];
}

export function DoctorsPage({ doctors }: DoctorsPageProps) {
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSuccessCount, setBulkSuccessCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doctor | null>(null);

  const [fullName, setFullName] = useState('');
  const [sipNumber, setSipNumber] = useState('');
  const [specialization, setSpecialization] = useState('DOKTER DPJP');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<DoctorStatus>('Aktif');
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFullName('');
    setSipNumber('');
    setSpecialization('DOKTER DPJP');
    setPhone('');
    setStatus('Aktif');
    setShowModal(true);
  };

  const openEdit = (d: Doctor) => {
    setEditing(d);
    setFullName(d.fullName);
    setSipNumber(d.sipNumber);
    setSpecialization(d.specialization);
    setPhone(d.phone || '');
    setStatus(d.status);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        fullName: clampString(fullName, 120),
        sipNumber: clampString(sipNumber, 60),
        specialization: clampString(specialization, 80),
        phone: clampString(phone, 30),
        status,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'doctors', editing.id), payload);
      } else {
        await addDoc(collection(db, 'doctors'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setShowModal(false);
    } catch (err) {
      handleFirestoreError(err, editing ? OperationType.UPDATE : OperationType.CREATE, 'doctors');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'doctors', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `doctors/${deleteTarget.id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Data Dokter Penanggung Jawab (DPJP)
          </h2>
          <p className="text-xs text-slate-500">
            Daftar dokter nefrologi dan dokter penanggung jawab pelayanan unit hemodialisa.
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
            <Users className="h-4 w-4" />
            Tambah Banyak Dokter
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            Tambah Dokter
          </button>
        </div>
      </div>

      {bulkSuccessCount !== null && (
        <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-xs font-medium text-teal-800">
          <span>{bulkSuccessCount} data dokter berhasil ditambahkan secara massal ke Firestore.</span>
          <button
            type="button"
            onClick={() => setBulkSuccessCount(null)}
            className="text-teal-700 hover:text-teal-900 font-semibold"
          >
            Tutup
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {doctors.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            Belum ada data dokter terdaftar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama Dokter & Gelar</th>
                  <th className="px-4 py-3 font-semibold">Nomor SIP</th>
                  <th className="px-4 py-3 font-semibold">Spesialisasi</th>
                  <th className="px-4 py-3 font-semibold">Kontak</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {doctors.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{d.fullName}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{d.sipNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{d.specialization}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{d.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                          d.status === 'Aktif'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : d.status === 'Cuti'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(d)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(d)}
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editing ? 'Edit Data Dokter' : 'Tambah Dokter'}
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
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nama Lengkap & Gelar</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="dr. Ahmad Fauzi, Sp.PD-KGH"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nomor SIP</label>
                <input
                  type="text"
                  required
                  value={sipNumber}
                  onChange={(e) => setSipNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Kategori Dokter</label>
                <select
                  required
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                >
                  <option value="DOKTER DPJP">DOKTER DPJP</option>
                  <option value="DOKTER UMUM">DOKTER UMUM</option>
                  {specialization &&
                    specialization !== 'DOKTER DPJP' &&
                    specialization !== 'DOKTER UMUM' && (
                      <option value={specialization}>{specialization}</option>
                    )}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">No. Telepon</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as DoctorStatus)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    <option value="Aktif">Aktif</option>
                    <option value="Cuti">Cuti</option>
                    <option value="Nonaktif">Nonaktif</option>
                  </select>
                </div>
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
                  {saving ? 'Menyimpan...' : 'Simpan Dokter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900">Hapus Data Dokter?</h3>
            <p className="mt-2 text-xs text-slate-600">
              Dokter <strong>{deleteTarget.fullName}</strong> akan dihapus dari master data.
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
                Hapus Dokter
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkModal && (
        <BulkAddDoctorsModal
          existingDoctors={doctors}
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

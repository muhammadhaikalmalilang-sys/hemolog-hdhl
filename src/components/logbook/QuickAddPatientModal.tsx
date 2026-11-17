import React, { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { AlertCircle, UserPlus, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { clampString } from '../../lib/formatters';
import type { Patient, PatientStatus, ShiftType, VascularAccessType } from '../../types';

interface QuickAddPatientModalProps {
  patients: Patient[];
  defaultDayName?: string;
  defaultShift?: ShiftType;
  defaultName?: string;
  defaultMrn?: string;
  onClose: () => void;
  onCreated: (created: {
    id: string;
    mrn: string;
    fullName: string;
    routineSchedule: string;
    status: PatientStatus;
  }) => void;
}

function getDefaultScheduleForDay(dayName?: string, shift: ShiftType = 'Pagi'): string {
  switch (dayName) {
    case 'Senin':
    case 'Kamis':
      return `Senin & Kamis (${shift})`;
    case 'Selasa':
    case 'Jumat':
      return `Selasa & Jumat (${shift})`;
    case 'Rabu':
    case 'Sabtu':
      return `Rabu & Sabtu (${shift})`;
    case 'Minggu':
      return `Minggu (${shift})`;
    default:
      return `Senin & Kamis (${shift})`;
  }
}

export function QuickAddPatientModal({
  patients,
  defaultDayName,
  defaultShift,
  defaultName,
  defaultMrn,
  onClose,
  onCreated,
}: QuickAddPatientModalProps) {
  const [mrn, setMrn] = useState(defaultMrn || '');
  const [fullName, setFullName] = useState(defaultName || '');
  const [gender, setGender] = useState<'L' | 'P'>('L');
  const [birthYear, setBirthYear] = useState('1970');
  const [vascularAccess, setVascularAccess] = useState<VascularAccessType>('AV Shunt');
  const [diagnosis, setDiagnosis] = useState('PGK Stage V');
  const [routineSchedule, setRoutineSchedule] = useState(
    getDefaultScheduleForDay(defaultDayName, defaultShift || 'Pagi')
  );
  const [status, setStatus] = useState<PatientStatus>('Aktif');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanMrn = clampString(mrn, 40);
    const cleanName = clampString(fullName, 120);
    const cleanSchedule = clampString(routineSchedule, 80);

    if (cleanMrn.length < 2) {
      setErrorMsg('Nomor Rekam Medis minimal 2 karakter.');
      return;
    }
    if (cleanName.length < 2) {
      setErrorMsg('Nama lengkap pasien minimal 2 karakter.');
      return;
    }

    const existing = patients.find(
      (p) => p.mrn.trim().toLowerCase() === cleanMrn.toLowerCase()
    );
    if (existing) {
      setErrorMsg(
        `Nomor Rekam Medis "${cleanMrn}" sudah terdaftar atas nama ${existing.fullName}.`
      );
      return;
    }

    setSaving(true);
    try {
      const payload = {
        mrn: cleanMrn,
        fullName: cleanName,
        gender,
        birthYear: Math.min(2030, Math.max(1900, Number(birthYear) || 1970)),
        vascularAccess,
        diagnosis: clampString(diagnosis || 'PGK Stage V', 200),
        dpjpId: '-',
        dpjpName: '-',
        routineSchedule: cleanSchedule,
        status,
        notes: clampString(notes, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'patients'), payload);
      onCreated({
        id: docRef.id,
        mrn: cleanMrn,
        fullName: cleanName,
        routineSchedule: cleanSchedule,
        status,
      });
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'patients');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl my-8">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <UserPlus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Penambahan Pasien Baru
              </h3>
              <p className="text-[11px] text-slate-500">
                Pasien baru akan langsung tersimpan ke master data dan dipilih di form Logbook.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

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
                placeholder="Nama lengkap pasien"
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
                min={1900}
                max={2030}
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Akses Vaskular</label>
              <select
                value={vascularAccess}
                onChange={(e) => setVascularAccess(e.target.value as 'AV Shunt' | 'CDL' | 'Femoral' | 'AVG')}
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
                list="quick-add-hd-schedule-presets"
                value={routineSchedule}
                onChange={(e) => setRoutineSchedule(e.target.value)}
                placeholder="Contoh: Selasa & Jumat (Pagi)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
              <datalist id="quick-add-hd-schedule-presets">
                <option value="Senin & Kamis (Pagi)" />
                <option value="Senin & Kamis (Siang)" />
                <option value="Selasa & Jumat (Pagi)" />
                <option value="Selasa & Jumat (Siang)" />
                <option value="Rabu & Sabtu (Pagi)" />
                <option value="Rabu & Sabtu (Siang)" />
                <option value="Cito / Setiap Hari" />
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
              placeholder="Riwayat akses, alergi, atau catatan khusus pasien..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-5 py-2 font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" />
              {saving ? 'Menyimpan...' : 'Simpan Pasien Baru'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

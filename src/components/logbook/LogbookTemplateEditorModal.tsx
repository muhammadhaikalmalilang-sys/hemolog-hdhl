import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { handleDbError, OperationType } from '../../lib/supabase';
import { toFormTemplateRow, upsertRow } from '../../lib/db';
import { clampString } from '../../lib/formatters';
import {
  DEFAULT_LOGBOOK_TEMPLATE,
  DEFAULT_TTV_CONFIG,
  LOGBOOK_TEMPLATE_DOC_ID,
  generateNextPointId,
  mergeWithDefaultTemplate,
  sanitizeTemplateForSave,
} from '../../lib/logbookTemplate';
import { useAuth } from '../../context/AuthContext';
import type {
  CustomFieldType,
  CustomLogbookField,
  LogbookFormTemplate,
  LogbookPointTemplate,
  LogbookSectionTemplate,
  TtvSubFieldsConfig,
} from '../../types';

interface LogbookTemplateEditorModalProps {
  currentTemplate: LogbookFormTemplate;
  onClose: () => void;
}

export function LogbookTemplateEditorModal({
  currentTemplate,
  onClose,
}: LogbookTemplateEditorModalProps) {
  const { userProfile } = useAuth();
  const [draft, setDraft] = useState<LogbookFormTemplate>(() =>
    mergeWithDefaultTemplate(currentTemplate)
  );
  const [activeTab, setActiveTab] = useState<'general' | number>(1);
  const [expandedPointId, setExpandedPointId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const activeSection = useMemo(
    () =>
      typeof activeTab === 'number'
        ? draft.sections.find((s) => s.num === activeTab) || draft.sections[0]
        : null,
    [draft.sections, activeTab]
  );

  const pointsInActiveSection = useMemo(() => {
    if (typeof activeTab !== 'number') return [];
    return draft.points
      .filter((p) => p.step === activeTab)
      .sort((a, b) => a.order - b.order);
  }, [draft.points, activeTab]);

  const stats = useMemo(() => {
    const visibleSpoPoints = draft.points.filter((p) => p.step <= 6 && p.visible !== false);
    const customPoints = draft.points.filter((p) => p.isCustom && p.visible !== false);
    const ttvPoints = draft.points.filter((p) => p.visible !== false && p.enableTtv);
    const customFieldCount =
      draft.points.reduce((acc, p) => acc + (p.customFields?.length || 0), 0) +
      Object.values(draft.sectionCustomFields || {}).reduce((acc, arr) => acc + arr.length, 0);
    return {
      visibleSpoCount: visibleSpoPoints.length,
      customPointCount: customPoints.length,
      ttvPointCount: ttvPoints.length,
      customFieldCount,
    };
  }, [draft]);

  const updateSection = (num: number, patch: Partial<LogbookSectionTemplate>) => {
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.num === num ? { ...s, ...patch } : s)),
    }));
  };

  const updatePoint = (pointId: string, patch: Partial<LogbookPointTemplate>) => {
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      points: prev.points.map((p) => (p.id === pointId ? { ...p, ...patch } : p)),
    }));
  };

  const renamePointId = (oldId: string, rawNewId: string) => {
    const cleanNewId = clampString(rawNewId.trim(), 24);
    if (!cleanNewId || cleanNewId === oldId) return;
    if (draft.points.some((p) => p.id === cleanNewId)) {
      setFeedback({
        type: 'error',
        message: `Kode poin "${cleanNewId}" sudah digunakan. Pilih kode lain yang unik.`,
      });
      return;
    }
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      points: prev.points.map((p) => (p.id === oldId ? { ...p, id: cleanNewId } : p)),
    }));
    if (expandedPointId === oldId) {
      setExpandedPointId(cleanNewId);
    }
  };

  const movePoint = (pointId: string, direction: 'up' | 'down') => {
    if (typeof activeTab !== 'number') return;
    const list = [...pointsInActiveSection];
    const idx = list.findIndex((p) => p.id === pointId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;
    const reorderedMap = new Map<string, number>();
    list.forEach((p, index) => reorderedMap.set(p.id, index + 1));
    setDraft((prev) => ({
      ...prev,
      points: prev.points.map((p) =>
        reorderedMap.has(p.id) ? { ...p, order: reorderedMap.get(p.id)! } : p
      ),
    }));
  };

  const handleAddPoint = (stepNum: number) => {
    const nextId = generateNextPointId(stepNum, draft.points);
    const maxOrder = pointsInActiveSection.reduce((m, p) => Math.max(m, p.order), 0);
    const newPoint: LogbookPointTemplate = {
      id: nextId,
      step: stepNum,
      order: maxOrder + 1,
      visible: true,
      isCustom: true,
      category: `Indikator Tambahan Bagian ${stepNum}`,
      statement: `Poin Asuhan Baru (${nextId})`,
      description: 'Tuliskan panduan pelaksanaan atau catatan poin asuhan keperawatan HD ini.',
      standard: `SPO-HD-TAMBAHAN-${nextId}`,
      monthlyStandard: `SPO-HD-TAMBAHAN-${nextId}`,
      enableTtv: false,
      ttvConfig: { ...DEFAULT_TTV_CONFIG },
      includeTtvInMonthly: true,
      customFields: [],
    };
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      points: [...prev.points, newPoint],
    }));
    setExpandedPointId(nextId);
  };

  const handleDeleteCustomPoint = (pointId: string) => {
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      points: prev.points.filter((p) => p.id !== pointId),
    }));
    if (expandedPointId === pointId) {
      setExpandedPointId(null);
    }
  };

  const handleAddCustomFieldToPoint = (pointId: string) => {
    const pt = draft.points.find((p) => p.id === pointId);
    if (!pt) return;
    const existing = pt.customFields || [];
    if (existing.length >= 15) {
      setFeedback({
        type: 'error',
        message: 'Maksimal 15 kolom tambahan per poin.',
      });
      return;
    }
    const newField: CustomLogbookField = {
      id: `col_${Date.now().toString(36)}_${existing.length + 1}`,
      label: `Kolom Tambahan ${existing.length + 1}`,
      type: 'text',
      unit: '',
      placeholder: '',
      options: [],
      required: false,
      includeInMonthlyReport: true,
      monthlyAggregation: 'count',
    };
    updatePoint(pointId, { customFields: [...existing, newField] });
  };

  const handleUpdateCustomFieldOnPoint = (
    pointId: string,
    fieldId: string,
    patch: Partial<CustomLogbookField>
  ) => {
    const pt = draft.points.find((p) => p.id === pointId);
    if (!pt) return;
    const nextFields = (pt.customFields || []).map((f) => {
      if (f.id !== fieldId) return f;
      const merged = { ...f, ...patch };
      if (patch.type === 'number' && !patch.monthlyAggregation && f.monthlyAggregation === 'count') {
        merged.monthlyAggregation = 'average';
      }
      return merged;
    });
    updatePoint(pointId, { customFields: nextFields });
  };

  const handleRemoveCustomFieldOnPoint = (pointId: string, fieldId: string) => {
    const pt = draft.points.find((p) => p.id === pointId);
    if (!pt) return;
    updatePoint(pointId, {
      customFields: (pt.customFields || []).filter((f) => f.id !== fieldId),
    });
  };

  const section7CustomFields = draft.sectionCustomFields?.['7'] || [];

  const handleAddSection7Field = () => {
    if (section7CustomFields.length >= 15) {
      setFeedback({ type: 'error', message: 'Maksimal 15 kolom tambahan pada Bagian 7.' });
      return;
    }
    const newField: CustomLogbookField = {
      id: `s7_${Date.now().toString(36)}_${section7CustomFields.length + 1}`,
      label: `Kolom Tambahan Bagian 7 (${section7CustomFields.length + 1})`,
      type: 'text',
      unit: '',
      placeholder: '',
      options: [],
      required: false,
      includeInMonthlyReport: true,
      monthlyAggregation: 'count',
    };
    setDraft((prev) => ({
      ...prev,
      sectionCustomFields: {
        ...(prev.sectionCustomFields || {}),
        '7': [...section7CustomFields, newField],
      },
    }));
  };

  const handleUpdateSection7Field = (fieldId: string, patch: Partial<CustomLogbookField>) => {
    setDraft((prev) => ({
      ...prev,
      sectionCustomFields: {
        ...(prev.sectionCustomFields || {}),
        '7': (prev.sectionCustomFields?.['7'] || []).map((f) =>
          f.id === fieldId ? { ...f, ...patch } : f
        ),
      },
    }));
  };

  const handleRemoveSection7Field = (fieldId: string) => {
    setDraft((prev) => ({
      ...prev,
      sectionCustomFields: {
        ...(prev.sectionCustomFields || {}),
        '7': (prev.sectionCustomFields?.['7'] || []).filter((f) => f.id !== fieldId),
      },
    }));
  };

  const handleResetToDefault = () => {
    setDraft(mergeWithDefaultTemplate(DEFAULT_LOGBOOK_TEMPLATE));
    setExpandedPointId(null);
    setConfirmReset(false);
    setFeedback({
      type: 'success',
      message: 'Konfigurasi dikembalikan ke standar default. Klik "Simpan Template" untuk menerapkan.',
    });
  };

  const handleSave = async () => {
    if (!userProfile || userProfile.role !== 'Administrator') return;
    if (!draft.formTitle.trim() || !draft.monthlyReportTitle.trim()) {
      setFeedback({
        type: 'error',
        message: 'Judul Formulir Logbook dan Judul Laporan Bulanan tidak boleh kosong.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const sanitized = sanitizeTemplateForSave(draft);
      const templateRow = toFormTemplateRow({
        ...sanitized,
        updatedBy: userProfile.uid,
        updatedByName: clampString(userProfile.fullName, 120),
      });
      templateRow.id = LOGBOOK_TEMPLATE_DOC_ID;
      await upsertRow('form_templates', templateRow, 'id');
      setFeedback({
        type: 'success',
        message:
          'Template Formulir Logbook berhasil disimpan! Seluruh Formulir Asuhan & Laporan Bulanan kini mengikuti pengaturan terbaru.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: 'Gagal menyimpan konfigurasi logbook. Periksa koneksi atau izin akses.',
      });
      handleDbError(err, OperationType.WRITE, `form_templates/${LOGBOOK_TEMPLATE_DOC_ID}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Editor Konfigurasi Formulir Logbook HD"
    >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Top Navy Header */}
        <div className="flex flex-col gap-3 bg-[#0e4e78] px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div className="min-w-0">
            <h3 className="font-display text-base sm:text-lg font-bold text-white truncate">
              Edit Formulir Logbook Asuhan Keperawatan Hemodialisa
            </h3>
            <p className="text-xs text-sky-100/90 mt-0.5">
              Ubah teks bagian/poin, tambah poin baru, aktifkan penginputan TTV, atau tambah kolom khusus — otomatis memengaruhi Formulir &amp; Laporan Bulanan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-[11px] text-sky-100 mr-2 tabular-nums">
              <span>{stats.visibleSpoCount} Poin SPO</span>
              <span aria-hidden="true">·</span>
              <span>{stats.ttvPointCount} Poin TTV</span>
              <span aria-hidden="true">·</span>
              <span>{stats.customFieldCount} Kolom Tambahan</span>
            </div>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Default
              </button>
            ) : (
              <div className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-300/40 px-2 py-1">
                <span className="text-[11px] font-medium text-amber-100 px-1">Yakin reset?</span>
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="rounded bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-slate-900 hover:bg-amber-300"
                >
                  Ya
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-white/25"
                >
                  Batal
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Menyimpan...' : 'Simpan Template'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/15 p-1.5 text-white hover:bg-white/25 transition-colors"
              aria-label="Tutup Editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation Strip */}
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 min-w-max">
            <button
              type="button"
              onClick={() => {
                setActiveTab('general');
                setExpandedPointId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'general'
                  ? 'border-[#0e4e78] bg-[#0e4e78] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Umum &amp; Judul
            </button>

            {draft.sections.map((sec) => {
              const secPointCount = draft.points.filter(
                (p) => p.step === sec.num && p.visible !== false
              ).length;
              return (
                <button
                  key={sec.num}
                  type="button"
                  onClick={() => {
                    setActiveTab(sec.num);
                    setExpandedPointId(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeTab === sec.num
                      ? 'border-[#0e4e78] bg-[#0e4e78] text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>
                    {sec.num}. {sec.short}
                  </span>
                  {sec.num <= 6 && (
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        activeTab === sec.num ? 'text-sky-100' : 'text-slate-400'
                      }`}
                    >
                      ({secPointCount})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/40">
          {feedback && (
            <div
              className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs font-medium ${
                feedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {activeTab === 'general' ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 max-w-4xl">
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900">
                  Pengaturan Judul Formulir &amp; Laporan Bulanan
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Perubahan judul di sini tampil pada header formulir input perawat dan kop cetak Laporan Bulanan.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Judul Formulir Asuhan Keperawatan (Wizard)
                  </label>
                  <input
                    type="text"
                    value={draft.formTitle}
                    onChange={(e) => {
                      setFeedback(null);
                      setDraft((prev) => ({ ...prev, formTitle: e.target.value }));
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Judul Utama Laporan Bulanan (Header Cetak &amp; Layar)
                  </label>
                  <input
                    type="text"
                    value={draft.monthlyReportTitle}
                    onChange={(e) => {
                      setFeedback(null);
                      setDraft((prev) => ({ ...prev, monthlyReportTitle: e.target.value }));
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Total Poin SPO Aktif</p>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {stats.visibleSpoCount} Poin
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Poin Dengan Input TTV</p>
                  <p className="mt-1 font-mono text-lg font-bold text-[#0e4e78] tabular-nums">
                    {stats.ttvPointCount} Poin
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                  <p className="text-[11px] font-medium text-slate-500">Kolom Penginputan Tambahan</p>
                  <p className="mt-1 font-mono text-lg font-bold text-emerald-700 tabular-nums">
                    {stats.customFieldCount} Kolom
                  </p>
                </div>
              </div>
            </div>
          ) : (
            activeSection && (
              <div className="space-y-5">
                {/* Section Header & Monthly Report Config */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="font-display text-sm font-bold text-slate-900">
                        Pengaturan {activeSection.roman} ({activeSection.short})
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Ubah label tab, judul bagian, serta judul &amp; metode skor pada Laporan Bulanan.
                      </p>
                    </div>
                    {activeSection.num <= 7 && (
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activeSection.visible !== false}
                          onChange={(e) =>
                            updateSection(activeSection.num, { visible: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-[#0e4e78]"
                        />
                        <span>Tampilkan Bagian Ini di Formulir &amp; Laporan</span>
                      </label>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Nama Tab Singkat
                      </label>
                      <input
                        type="text"
                        value={activeSection.short}
                        onChange={(e) =>
                          updateSection(activeSection.num, { short: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Judul Lengkap Bagian di Formulir
                      </label>
                      <input
                        type="text"
                        value={activeSection.title}
                        onChange={(e) =>
                          updateSection(activeSection.num, { title: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Label Ringkas Step Verifikasi
                      </label>
                      <input
                        type="text"
                        value={activeSection.roman}
                        onChange={(e) =>
                          updateSection(activeSection.num, { roman: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Cakupan Standar SPO (Ringkasan Verifikasi)
                      </label>
                      <input
                        type="text"
                        value={activeSection.scope}
                        onChange={(e) =>
                          updateSection(activeSection.num, { scope: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                      />
                    </div>
                  </div>

                  {activeSection.num <= 6 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs pt-2 border-t border-slate-100">
                      <div className="md:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Judul Seksi pada Tabel Laporan Bulanan
                        </label>
                        <input
                          type="text"
                          value={activeSection.monthlyTitle}
                          onChange={(e) =>
                            updateSection(activeSection.num, { monthlyTitle: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Mode Skor Laporan Bulanan
                        </label>
                        <select
                          value={activeSection.monthlyMaxMode}
                          onChange={(e) =>
                            updateSection(activeSection.num, {
                              monthlyMaxMode: e.target.value as 'daily_cap_1' | 'per_patient',
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                        >
                          <option value="daily_cap_1">Maks. 1 / Hari Kerja</option>
                          <option value="per_patient">Sesuai Pasien Kelolaan</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 7 custom fields panel */}
                {activeSection.num === 7 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-display text-sm font-bold text-slate-900">
                          Kolom Penginputan Tambahan Bagian 7 (Transfusi &amp; EPO)
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Tambahkan kolom penginputan baru pada Bagian 7 selain Transfusi Darah &amp; EPO (otomatis direkap ke Laporan Bulanan bila diaktifkan).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddSection7Field}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0b3f61]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Kolom Bagian 7
                      </button>
                    </div>

                    {section7CustomFields.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        Belum ada kolom tambahan pada Bagian 7. Klik tombol di atas untuk menambah kolom baru.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                        {section7CustomFields.map((fld) => (
                          <CustomFieldEditorRow
                            key={fld.id}
                            field={fld}
                            onChange={(patch) => handleUpdateSection7Field(fld.id, patch)}
                            onRemove={() => handleRemoveSection7Field(fld.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Points List for Sections 1..7 */}
                {activeSection.num <= 7 && (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
                      <div>
                        <h4 className="font-display text-sm font-bold text-slate-900">
                          Daftar Poin &amp; Komponen ({pointsInActiveSection.length} Poin)
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Klik <strong>Ubah Poin</strong> untuk mengedit teks, mengaktifkan input TTV, atau menambah kolom penginputan khusus pada poin tersebut.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddPoint(activeSection.num)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-700 transition-colors whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Poin Baru
                      </button>
                    </div>

                    {pointsInActiveSection.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Belum ada poin pada bagian ini. Klik <strong>Tambah Poin Baru</strong> untuk menambahkan poin.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {pointsInActiveSection.map((pt, idx) => {
                          const isExpanded = expandedPointId === pt.id;
                          const isVisible = pt.visible !== false;
                          const customCount = pt.customFields?.length || 0;
                          return (
                            <div
                              key={pt.id}
                              className={!isVisible ? 'bg-slate-50/80 opacity-75' : 'bg-white'}
                            >
                              {/* Point Summary Header */}
                              <div className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                    <span className="font-mono font-bold text-slate-900">
                                      Poin {pt.id}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-[#0e4e78]">
                                      {pt.category}
                                    </span>
                                    {pt.isCustom && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-semibold text-teal-700">
                                          Poin Tambahan
                                        </span>
                                      </>
                                    )}
                                    {pt.enableTtv && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-semibold text-sky-700">
                                          Input TTV Aktif
                                        </span>
                                      </>
                                    )}
                                    {customCount > 0 && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-semibold text-indigo-700">
                                          {customCount} Kolom Tambahan
                                        </span>
                                      </>
                                    )}
                                    {!isVisible && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-semibold text-rose-600">
                                          Disembunyikan
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <p className="text-xs font-semibold text-slate-900 leading-snug">
                                    {pt.statement}
                                  </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => movePoint(pt.id, 'up')}
                                    title="Geser ke atas"
                                    className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === pointsInActiveSection.length - 1}
                                    onClick={() => movePoint(pt.id, 'down')}
                                    title="Geser ke bawah"
                                    className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updatePoint(pt.id, { visible: !isVisible })
                                    }
                                    title={isVisible ? 'Sembunyikan poin' : 'Tampilkan poin'}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    {isVisible ? (
                                      <Eye className="h-3.5 w-3.5 text-emerald-600" />
                                    ) : (
                                      <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                                    )}
                                    <span>{isVisible ? 'Tampil' : 'Tersembunyi'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedPointId(isExpanded ? null : pt.id)
                                    }
                                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                                      isExpanded
                                        ? 'border-[#0e4e78] bg-[#0e4e78] text-white'
                                        : 'border-sky-200 bg-sky-50 text-[#0e4e78] hover:bg-sky-100'
                                    }`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    <span>{isExpanded ? 'Tutup Editor' : 'Ubah Poin'}</span>
                                  </button>
                                  {pt.isCustom && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCustomPoint(pt.id)}
                                      title="Hapus poin tambahan"
                                      className="rounded-md border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Expanded Point Editor */}
                              {isExpanded && (
                                <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-4 space-y-5 text-xs">
                                  {/* 1. Text & Standard Editor */}
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#0e4e78]">
                                      <FileText className="h-3.5 w-3.5" />
                                      <span>Teks Poin &amp; Standar Mutu (Sinkron dengan Laporan Bulanan)</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                      <div>
                                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                          Nomor / Kode Poin
                                        </label>
                                        <input
                                          type="text"
                                          defaultValue={pt.id}
                                          disabled={!pt.isCustom}
                                          onBlur={(e) => renamePointId(pt.id, e.target.value)}
                                          title={
                                            pt.isCustom
                                              ? 'Ubah nomor poin'
                                              : 'Kode poin bawaan dikunci untuk menjaga kompatibilitas data lama'
                                          }
                                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#0e4e78] focus:outline-none"
                                        />
                                      </div>

                                      <div className="sm:col-span-3">
                                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                          Kategori Fase Asuhan (Tampil di Formulir &amp; Laporan Bulanan)
                                        </label>
                                        <input
                                          type="text"
                                          value={pt.category}
                                          onChange={(e) =>
                                            updatePoint(pt.id, { category: e.target.value })
                                          }
                                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                                        />
                                      </div>
                                    </div>

                                    <div>
                                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                        Uraian / Pernyataan Utama Poin (Tampil di Formulir &amp; Laporan Bulanan)
                                      </label>
                                      <textarea
                                        rows={2}
                                        value={pt.statement}
                                        onChange={(e) =>
                                          updatePoint(pt.id, { statement: e.target.value })
                                        }
                                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0e4e78] focus:outline-none"
                                      />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      <div>
                                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                          Deskripsi / Panduan Pengisian di Formulir
                                        </label>
                                        <textarea
                                          rows={2}
                                          value={pt.description}
                                          onChange={(e) =>
                                            updatePoint(pt.id, { description: e.target.value })
                                          }
                                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                                        />
                                      </div>

                                      <div className="space-y-2">
                                        <div>
                                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                            Standar Tampil di Formulir
                                          </label>
                                          <input
                                            type="text"
                                            value={pt.standard}
                                            onChange={(e) =>
                                              updatePoint(pt.id, { standard: e.target.value })
                                            }
                                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                            Kode / Standar SPO di Laporan Bulanan
                                          </label>
                                          <input
                                            type="text"
                                            value={pt.monthlyStandard ?? pt.standard}
                                            onChange={(e) =>
                                              updatePoint(pt.id, {
                                                monthlyStandard: e.target.value,
                                              })
                                            }
                                            placeholder="cth: SPO-HD-01: Mutu Air RO..."
                                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[#0e4e78] focus:outline-none"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* 2. TTV Toggle & Config */}
                                  <div className="border-t border-slate-200 pt-4 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#0e4e78]">
                                        <Activity className="h-3.5 w-3.5" />
                                        <span>Penginputan Tanda-Tanda Vital (TTV)</span>
                                      </div>
                                      <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(pt.enableTtv)}
                                          onChange={(e) =>
                                            updatePoint(pt.id, {
                                              enableTtv: e.target.checked,
                                              ttvConfig: pt.ttvConfig || { ...DEFAULT_TTV_CONFIG },
                                            })
                                          }
                                          className="h-4 w-4 rounded border-slate-300 text-[#0e4e78]"
                                        />
                                        <span>Tambahkan Penginputan TTV pada Poin Ini</span>
                                      </label>
                                    </div>

                                    {pt.enableTtv && (
                                      <div className="rounded-lg border border-sky-200 bg-white p-3.5 space-y-2.5">
                                        <p className="text-[11px] font-semibold text-slate-700">
                                          Pilih parameter TTV yang muncul pada poin ini:
                                        </p>
                                        <div className="flex flex-wrap items-center gap-4">
                                          {(
                                            [
                                              { key: 'td', label: 'Tekanan Darah (TD - mmHg)' },
                                              { key: 'nadi', label: 'Nadi (x/mnt)' },
                                              { key: 'rr', label: 'Pernapasan / RR (x/mnt)' },
                                              { key: 'suhu', label: 'Suhu (°C)' },
                                              { key: 'spo2', label: 'SpO₂ (%)' },
                                            ] as { key: keyof TtvSubFieldsConfig; label: string }[]
                                          ).map((item) => {
                                            const cfg = pt.ttvConfig || DEFAULT_TTV_CONFIG;
                                            return (
                                              <label
                                                key={item.key}
                                                className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer"
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={cfg[item.key] !== false}
                                                  onChange={(e) =>
                                                    updatePoint(pt.id, {
                                                      ttvConfig: {
                                                        ...DEFAULT_TTV_CONFIG,
                                                        ...cfg,
                                                        [item.key]: e.target.checked,
                                                      },
                                                    })
                                                  }
                                                  className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78]"
                                                />
                                                <span>{item.label}</span>
                                              </label>
                                            );
                                          })}
                                        </div>

                                        <div className="border-t border-slate-100 pt-2">
                                          <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-teal-800 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={pt.includeTtvInMonthly !== false}
                                              onChange={(e) =>
                                                updatePoint(pt.id, {
                                                  includeTtvInMonthly: e.target.checked,
                                                })
                                              }
                                              className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600"
                                            />
                                            <span>
                                              Tampilkan rekap penginputan TTV poin ini pada Laporan Bulanan
                                            </span>
                                          </label>
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* 3. Custom Input Columns */}
                                  <div className="border-t border-slate-200 pt-4 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#0e4e78]">
                                        Kolom Penginputan Khusus pada Poin Ini ({customCount})
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleAddCustomFieldToPoint(pt.id)}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#0e4e78] bg-white px-3 py-1.5 text-[11px] font-bold text-[#0e4e78] hover:bg-sky-50"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                        Tambah Kolom Input
                                      </button>
                                    </div>

                                    {customCount === 0 ? (
                                      <p className="text-[11px] text-slate-500 italic">
                                        Belum ada kolom penginputan tambahan pada poin ini.
                                      </p>
                                    ) : (
                                      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                                        {(pt.customFields || []).map((fld) => (
                                          <CustomFieldEditorRow
                                            key={fld.id}
                                            field={fld}
                                            onChange={(patch) =>
                                              handleUpdateCustomFieldOnPoint(pt.id, fld.id, patch)
                                            }
                                            onRemove={() =>
                                              handleRemoveCustomFieldOnPoint(pt.id, fld.id)
                                            }
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3 shrink-0">
          <p className="text-[11px] text-slate-500">
            Perubahan akan langsung berlaku untuk semua perawat dan laporan bulanan setelah Anda menekan <strong>Simpan Template</strong>.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e4e78] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b3f61] disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Menyimpan...' : 'Simpan Template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomFieldEditorRow({
  field,
  onChange,
  onRemove,
}: {
  field: CustomLogbookField;
  onChange: (patch: Partial<CustomLogbookField>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="p-3.5 space-y-2.5 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
        <div className="sm:col-span-4">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Nama / Label Kolom
          </label>
          <input
            type="text"
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="cth: Skala Nyeri / Kadar Hb"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0e4e78] focus:outline-none"
          />
        </div>

        <div className="sm:col-span-3">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tipe Input</label>
          <select
            value={field.type}
            onChange={(e) =>
              onChange({ type: e.target.value as CustomFieldType })
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0e4e78] focus:outline-none"
          >
            <option value="text">Teks Singkat</option>
            <option value="textarea">Catatan Panjang</option>
            <option value="number">Angka (Numerik)</option>
            <option value="select">Pilihan Dropdown</option>
            <option value="checkbox">Checklist (Ya / Tidak)</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Satuan (Opsional)
          </label>
          <input
            type="text"
            value={field.unit || ''}
            onChange={(e) => onChange({ unit: e.target.value })}
            placeholder="g/dL / mL"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0e4e78] focus:outline-none"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Placeholder
          </label>
          <input
            type="text"
            value={field.placeholder || ''}
            onChange={(e) => onChange({ placeholder: e.target.value })}
            placeholder="Isi nilai..."
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0e4e78] focus:outline-none"
          />
        </div>

        <div className="sm:col-span-1 flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            title="Hapus kolom ini"
            className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {field.type === 'select' && (
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Opsi Pilihan Dropdown (pisahkan dengan koma)
          </label>
          <input
            type="text"
            value={(field.options || []).join(', ')}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="cth: Baik, Cukup, Perlu Observasi"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#0e4e78] focus:outline-none"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px]">
        <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(field.required)}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-[#0e4e78]"
          />
          <span>Wajib diisi</span>
        </label>

        <label className="inline-flex items-center gap-1.5 font-semibold text-teal-800 cursor-pointer">
          <input
            type="checkbox"
            checked={field.includeInMonthlyReport !== false}
            onChange={(e) => onChange({ includeInMonthlyReport: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600"
          />
          <span>Rekap di Laporan Bulanan</span>
        </label>

        {field.includeInMonthlyReport !== false && (
          <div className="inline-flex items-center gap-1.5">
            <span className="text-slate-500">Mode Rekap Bulanan:</span>
            <select
              value={field.monthlyAggregation || (field.type === 'number' ? 'average' : 'count')}
              onChange={(e) =>
                onChange({
                  monthlyAggregation: e.target.value as CustomLogbookField['monthlyAggregation'],
                })
              }
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800"
            >
              <option value="count">Jumlah Pengisian / Hari</option>
              {field.type === 'number' && <option value="sum">Total Nilai (Sum)</option>}
              {field.type === 'number' && <option value="average">Rata-rata Harian</option>}
              <option value="latest">Ringkasan Nilai / Teks</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

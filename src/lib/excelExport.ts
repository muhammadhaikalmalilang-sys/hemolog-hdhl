import ExcelJS from 'exceljs';
import { formatDateId, formatVerificationStatusLabel } from './formatters';
import type { PatientReportPdfMeta, PatientReportPdfRow, PatientReportPdfSummary } from './patientReportPdf';
import type { LogbookEntry, ReportEntry, VerificationStatus } from '../types';

/* -------------------------------------------------------------------------- */
/* Shared Excel Styling & Download Helpers                                    */
/* -------------------------------------------------------------------------- */

function sanitizeFilename(raw: string): string {
  const cleaned = (raw || 'Laporan_HD')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ');
  return cleaned.toLowerCase().endsWith('.xlsx') ? cleaned : `${cleaned}.xlsx`;
}

function sanitizeSheetName(raw: string): string {
  const cleaned = (raw || 'Sheet1').replace(/[\\/*?:[\]]+/g, ' ').trim();
  return (cleaned || 'Sheet1').slice(0, 31);
}

function solidFill(argb: string): ExcelJS.Fill {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
  };
}

function makeBorder(argb = 'CBD5E1', style: ExcelJS.BorderStyle = 'thin'): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style, color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

function estimateWrappedLines(text: string, colWidth: number): number {
  const safe = String(text || '');
  if (!safe) return 1;
  const effectiveChars = Math.max(8, Math.floor(colWidth - 2));
  return safe.split('\n').reduce((acc, paragraph) => {
    const len = paragraph.trim().length;
    return acc + Math.max(1, Math.ceil(len / effectiveChars));
  }, 0);
}

function calcRowHeight(
  cells: Array<{ text: unknown; colWidth: number }>,
  lineHeightPt = 13.5,
  minHeightPt = 20,
  padPt = 8
): number {
  let maxLines = 1;
  for (const c of cells) {
    const lines = estimateWrappedLines(String(c.text ?? ''), c.colWidth);
    if (lines > maxLines) maxLines = lines;
  }
  return Math.max(minHeightPt, Math.min(409, maxLines * lineHeightPt + padPt));
}

function getStatusColors(status: VerificationStatus | string): { bg: string; fg: string } {
  switch (status) {
    case 'Approved':
      return { bg: 'FFECFDF5', fg: 'FF047857' };
    case 'Pending':
      return { bg: 'FFFFFBEB', fg: 'FFB45309' };
    case 'Revision':
      return { bg: 'FFFFF1F2', fg: 'FFBE123C' };
    default:
      return { bg: 'FFF1F5F9', fg: 'FF475569' };
  }
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  wb.creator = 'HemoLog HDHL';
  wb.created = new Date();
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', sanitizeFilename(filename));
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* 1. DATA KOMPLIKASI INTRA-HD                                                */
/* -------------------------------------------------------------------------- */

export interface ComplicationExcelEpisode {
  entry: LogbookEntry;
  bedMachine: string;
  category: string;
  detailText: string;
  time: string;
  advice: string;
}

export interface ComplicationExcelCategoryRow {
  category: string;
  count: number;
  approvedCount: number;
  patientCount: number;
  pct: number;
}

export interface ComplicationExcelInput {
  filename: string;
  periodLabel: string;
  shiftLabel: string;
  statusLabel: string;
  categoryLabel: string;
  episodes: ComplicationExcelEpisode[];
  categoryBreakdown: ComplicationExcelCategoryRow[];
  summary: {
    totalEpisodes: number;
    affectedPatients: number;
    affectedActions: number;
    totalActionsInScope: number;
    ratePct: number;
    topCategoryLabel: string;
    topCategorySub: string;
    approvedEpisodes: number;
    totalAllStatusEpisodes: number;
    pendingOrOtherEpisodes: number;
  };
}

export async function exportComplicationsExcel(input: ComplicationExcelInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName('Data Komplikasi Intra-HD'), {
    views: [{ state: 'frozen', ySplit: 7 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colWidths = [6, 15, 11, 13, 24, 13, 22, 30, 10, 36, 22, 18];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  // Banner
  ws.mergeCells('A1:L1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'DATA KOMPLIKASI INTRA-HD UNIT HEMODIALISIS — RS HAPPY LAND MEDICAL CENTRE';
  titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = solidFill('FF0E3A53');
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells('A2:L2');
  const subCell = ws.getCell('A2');
  subCell.value = `Periode: ${input.periodLabel}  |  Shift: ${input.shiftLabel}  |  Status Logbook: ${input.statusLabel}  |  Jenis: ${input.categoryLabel}  |  Total Ditampilkan: ${input.episodes.length} Kejadian`;
  subCell.font = { name: 'Calibri', size: 10, color: { argb: 'FFE0F2FE' } };
  subCell.fill = solidFill('FF1B4F6E');
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.getRow(3).height = 8;

  // KPI Strip (Rows 4-5)
  const kpiBlocks = [
    {
      rangeCols: ['A', 'C'] as const,
      bg: 'FFFFF1F2',
      border: 'FFFECDD3',
      accent: 'FFBE123C',
      title: 'TOTAL KEJADIAN KOMPLIKASI',
      val: `${input.summary.totalEpisodes} Kejadian`,
      sub: `Dari ${input.summary.affectedActions} tindakan ber-komplikasi`,
    },
    {
      rangeCols: ['D', 'F'] as const,
      bg: 'FFF0F9FF',
      border: 'FFBAE6FD',
      accent: 'FF0B5A8E',
      title: 'PASIEN TERDAMPAK & RASIO',
      val: `${input.summary.affectedPatients} Pasien (${input.summary.ratePct}%)`,
      sub: `Dari ${input.summary.totalActionsInScope} tindakan HD`,
    },
    {
      rangeCols: ['G', 'I'] as const,
      bg: 'FFFFFBEB',
      border: 'FFFDE68A',
      accent: 'FFB45309',
      title: 'KOMPLIKASI TERBANYAK',
      val: input.summary.topCategoryLabel,
      sub: input.summary.topCategorySub,
    },
    {
      rangeCols: ['J', 'L'] as const,
      bg: 'FFECFDF5',
      border: 'FFA7F3D0',
      accent: 'FF047857',
      title: 'APPROVED VS LAINNYA',
      val: `${input.summary.approvedEpisodes} / ${input.summary.totalAllStatusEpisodes} Total`,
      sub: `Approved: ${input.summary.approvedEpisodes} · Menunggu/Lain: ${input.summary.pendingOrOtherEpisodes}`,
    },
  ];

  ws.getRow(4).height = 18;
  ws.getRow(5).height = 28;
  for (const kpi of kpiBlocks) {
    ws.mergeCells(`${kpi.rangeCols[0]}4:${kpi.rangeCols[1]}4`);
    ws.mergeCells(`${kpi.rangeCols[0]}5:${kpi.rangeCols[1]}5`);
    const topCell = ws.getCell(`${kpi.rangeCols[0]}4`);
    topCell.value = kpi.title;
    topCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
    topCell.fill = solidFill(kpi.bg);
    topCell.alignment = { vertical: 'middle', horizontal: 'center' };
    topCell.border = {
      top: { style: 'thin', color: { argb: kpi.border } },
      left: { style: 'thin', color: { argb: kpi.border } },
      right: { style: 'thin', color: { argb: kpi.border } },
    };

    const valCell = ws.getCell(`${kpi.rangeCols[0]}5`);
    valCell.value = `${kpi.val}\n${kpi.sub}`;
    valCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: kpi.accent } };
    valCell.fill = solidFill(kpi.bg);
    valCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    valCell.border = {
      bottom: { style: 'thin', color: { argb: kpi.border } },
      left: { style: 'thin', color: { argb: kpi.border } },
      right: { style: 'thin', color: { argb: kpi.border } },
    };
  }

  ws.getRow(6).height = 8;

  // Table Headers (Row 7)
  const headers = [
    'NO',
    'TANGGAL',
    'SHIFT',
    'BED / MESIN',
    'NAMA PASIEN',
    'NO. RM',
    'KATEGORI KOMPLIKASI',
    'RINCIAN KOMPLIKASI INTRA-HD',
    'JAM',
    'TINDAKAN & ADVIS MEDIS DPJP',
    'PERAWAT PELAKSANA',
    'STATUS LOGBOOK',
  ];
  const hdrRow = ws.getRow(7);
  hdrRow.height = 28;
  headers.forEach((h, idx) => {
    const cell = hdrRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF1B4F6E');
    cell.border = makeBorder('FF2D6687');
    cell.alignment = {
      vertical: 'middle',
      horizontal: idx === 0 || idx === 2 || idx === 3 || idx === 8 || idx === 11 ? 'center' : 'left',
      wrapText: true,
    };
  });

  // Body Rows
  input.episodes.forEach((ep, idx) => {
    const rowIdx = 8 + idx;
    const row = ws.getRow(rowIdx);
    const zebraBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const statusLabel = formatVerificationStatusLabel(ep.entry.verificationStatus);
    const statusStyle = getStatusColors(ep.entry.verificationStatus);

    const vals = [
      idx + 1,
      formatDateId(ep.entry.date),
      `Shift ${ep.entry.shift}`,
      ep.bedMachine,
      ep.entry.patientName,
      ep.entry.patientRm || '-',
      ep.category,
      ep.detailText,
      ep.time,
      ep.advice,
      ep.entry.nurseName,
      statusLabel,
    ];

    vals.forEach((v, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = v;
      cell.border = makeBorder('FFE2E8F0');
      cell.fill = solidFill(cIdx === 11 ? statusStyle.bg : zebraBg);
      cell.alignment = {
        vertical: 'middle',
        horizontal:
          cIdx === 0 || cIdx === 2 || cIdx === 3 || cIdx === 5 || cIdx === 8 || cIdx === 11
            ? 'center'
            : 'left',
        wrapText: true,
      };
      if (cIdx === 7) {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFBE123C' } };
      } else if (cIdx === 11) {
        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: statusStyle.fg } };
      } else if (cIdx === 4 || cIdx === 0 || cIdx === 3) {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      } else {
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
      }
    });

    row.height = calcRowHeight(
      vals.map((text, cIdx) => ({ text, colWidth: colWidths[cIdx] })),
      13.5,
      22,
      8
    );
  });

  ws.autoFilter = { from: 'A7', to: 'L7' };

  // Sheet 2: Category Breakdown
  if (input.categoryBreakdown.length > 0) {
    const ws2 = wb.addWorksheet(sanitizeSheetName('Rekap Jenis Komplikasi'), {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const w2 = [6, 30, 18, 16, 20, 18];
    w2.forEach((w, idx) => {
      ws2.getColumn(idx + 1).width = w;
    });

    ws2.mergeCells('A1:F1');
    const b1 = ws2.getCell('A1');
    b1.value = 'REKAPITULASI PER JENIS KOMPLIKASI INTRA-HD';
    b1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    b1.fill = solidFill('FF0E3A53');
    b1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws2.getRow(1).height = 24;

    ws2.mergeCells('A2:F2');
    const b2 = ws2.getCell('A2');
    b2.value = `Periode: ${input.periodLabel}  |  Shift: ${input.shiftLabel}  |  Status: ${input.statusLabel}`;
    b2.font = { name: 'Calibri', size: 10, color: { argb: 'FFE0F2FE' } };
    b2.fill = solidFill('FF1B4F6E');
    b2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws2.getRow(2).height = 19;

    const h2 = ['NO', 'JENIS KOMPLIKASI', 'JUMLAH KEJADIAN', '% DARI TOTAL', 'PASIEN TERDAMPAK', 'APPROVED'];
    const r4 = ws2.getRow(4);
    r4.height = 24;
    h2.forEach((h, idx) => {
      const c = r4.getCell(idx + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = solidFill('FF1B4F6E');
      c.border = makeBorder('FF2D6687');
      c.alignment = { vertical: 'middle', horizontal: idx === 1 ? 'left' : 'center', wrapText: true };
    });

    input.categoryBreakdown.forEach((item, idx) => {
      const r = ws2.getRow(5 + idx);
      r.height = 21;
      const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
      const rowVals = [idx + 1, item.category, item.count, `${item.pct}%`, item.patientCount, item.approvedCount];
      rowVals.forEach((val, cIdx) => {
        const c = r.getCell(cIdx + 1);
        c.value = val;
        c.fill = solidFill(bg);
        c.border = makeBorder('FFE2E8F0');
        c.font = {
          name: 'Calibri',
          size: 10,
          bold: cIdx === 1 || cIdx === 2,
          color: { argb: cIdx === 2 ? 'FFBE123C' : 'FF0F172A' },
        };
        c.alignment = { vertical: 'middle', horizontal: cIdx === 1 ? 'left' : 'center' };
      });
    });

    const totalRowIdx = 5 + input.categoryBreakdown.length;
    const totalRow = ws2.getRow(totalRowIdx);
    totalRow.height = 22;
    const totalCount = input.categoryBreakdown.reduce((s, i) => s + i.count, 0);
    const totalApproved = input.categoryBreakdown.reduce((s, i) => s + i.approvedCount, 0);
    const totVals = ['', 'TOTAL KESELURUHAN', totalCount, totalCount > 0 ? '100%' : '0%', input.summary.affectedPatients, totalApproved];
    totVals.forEach((val, cIdx) => {
      const c = totalRow.getCell(cIdx + 1);
      c.value = val;
      c.fill = solidFill('FFF1F5F9');
      c.border = makeBorder('FF94A3B8');
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      c.alignment = { vertical: 'middle', horizontal: cIdx === 1 ? 'left' : 'center' };
    });
  }

  await downloadWorkbook(wb, input.filename);
}

/* -------------------------------------------------------------------------- */
/* 2. LAPORAN PASIEN (SERVICES + KOMPLIKASI/STAFF + SOAP)                     */
/* -------------------------------------------------------------------------- */

export interface PatientServicesExcelInput {
  filename: string;
  rows: Array<
    PatientReportPdfRow & {
      vascularAccessDisplay: string;
      transfusionDisplay: string;
      epoDisplay: string;
    }
  >;
  summaryStats: PatientReportPdfSummary | null;
  meta: PatientReportPdfMeta;
  complicationRecords: Array<{
    patientName: string;
    patientRm: string;
    bedMachine: string;
    complication: string;
    time: string;
    advice: string;
  }>;
  patientClassificationCounts: {
    rawatJalan: number;
    rawatInap: number;
    isolasi: number;
  };
}

export async function exportPatientServicesExcel(input: PatientServicesExcelInput): Promise<void> {
  const wb = new ExcelJS.Workbook();

  // ---- Sheet 1: Tabel Logbook Detail Pasien (21 kolom) ----
  const ws = wb.addWorksheet(sanitizeSheetName('Logbook Pelayanan Pasien'), {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }],
    pageSetup: { paperSize: 8 as ExcelJS.PaperSize, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colWidths = [
    12, // 1: NO. BED / MESIN
    26, // 2: NAMA PASIEN / NO. RM
    8,  // 3: STATUS
    12, // 4: RUANG
    18, // 5: AKSES VASKULAR
    10, // 6: DURASI (JAM)
    10, // 7: BB PRE HD
    10, // 8: BB POST HD
    10, // 9: BB KERING
    9,  // 10: QB
    9,  // 11: QD
    17, // 12: HEPARIN
    11, // 13: TARGET UF
    9,  // 14: KT/V
    11, // 15: CAPAIAN UF
    13, // 16: TD PRE
    13, // 17: TD POST
    20, // 18: TRANSFUSI
    18, // 19: EPO
    22, // 20: PERAWAT PELAKSANA
    17, // 21: STATUS VERIFIKASI
  ];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  // Banner Rows 1-2
  ws.mergeCells('A1:U1');
  const b1 = ws.getCell('A1');
  b1.value = 'LOGBOOK DETAIL PELAYANAN ASUHAN KEPERAWATAN & MEDIS PASIEN HEMODIALISIS';
  b1.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  b1.fill = solidFill('FF0E3A53');
  b1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 25;

  ws.mergeCells('A2:U2');
  const b2 = ws.getCell('A2');
  b2.value = `Shift: ${input.meta.shiftLabel}  |  Hari/Tanggal: ${input.meta.dateLabel}  |  PJ Shift: ${input.meta.pjShift}  |  DPJP: ${input.meta.dpjpLabel}  |  Ka. Ruang: ${input.meta.kaRuang}  |  Total Logbook: ${input.rows.length} pasien (${input.meta.nurseCount} perawat)`;
  b2.font = { name: 'Calibri', size: 10, color: { argb: 'FFE0F2FE' } };
  b2.fill = solidFill('FF0E3A53');
  b2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(2).height = 22;

  ws.getRow(3).height = 6;

  // Row 4 & Row 5 Grouped Headers (exact UI structure)
  ws.getRow(4).height = 24;
  ws.getRow(5).height = 26;

  const groupDefinitions: Array<{
    label: string;
    startCol: number;
    endCol: number;
    rowSpan2?: boolean;
  }> = [
    { label: 'NO. BED / MESIN', startCol: 1, endCol: 1, rowSpan2: true },
    { label: 'NAMA PASIEN / NO. RM', startCol: 2, endCol: 2, rowSpan2: true },
    { label: 'STATUS & RUANG', startCol: 3, endCol: 4 },
    { label: 'PENGATURAN TEKNIS & PRE-HD', startCol: 5, endCol: 6 },
    { label: 'PARAMETER BERAT BADAN & ALIRAN', startCol: 7, endCol: 12 },
    { label: 'MONITORING ULTRAFILTRASI & ADEKUASI', startCol: 13, endCol: 15 },
    { label: 'TANDA VITAL (HEMODINAMIK)', startCol: 16, endCol: 17 },
    { label: 'TRANSFUSI & EPO', startCol: 18, endCol: 19 },
    { label: 'PERAWAT PELAKSANA', startCol: 20, endCol: 20, rowSpan2: true },
    { label: 'STATUS VERIFIKASI', startCol: 21, endCol: 21, rowSpan2: true },
  ];

  for (const g of groupDefinitions) {
    const startLetter = ws.getColumn(g.startCol).letter;
    const endLetter = ws.getColumn(g.endCol).letter;
    if (g.rowSpan2) {
      ws.mergeCells(`${startLetter}4:${endLetter}5`);
    } else if (g.endCol > g.startCol) {
      ws.mergeCells(`${startLetter}4:${endLetter}4`);
    }
    const cell = ws.getCell(`${startLetter}4`);
    cell.value = g.label;
    cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF1B4F6E');
    cell.border = makeBorder('FF2D6687');
    cell.alignment = {
      vertical: 'middle',
      horizontal: g.startCol === 2 ? 'left' : 'center',
      wrapText: true,
    };
  }

  const subHeaders: Array<{ col: number; label: string; align?: 'left' | 'center' }> = [
    { col: 3, label: 'STATUS' },
    { col: 4, label: 'RUANG' },
    { col: 5, label: 'AKSES VASKULAR', align: 'left' },
    { col: 6, label: 'DURASI (JAM)' },
    { col: 7, label: 'BB PRE HD (KG)' },
    { col: 8, label: 'BB POST HD (KG)' },
    { col: 9, label: 'BB KERING (KG)' },
    { col: 10, label: 'QB (ML/M)' },
    { col: 11, label: 'QD (ML/M)' },
    { col: 12, label: 'HEPARIN', align: 'left' },
    { col: 13, label: 'TARGET UF (ML)' },
    { col: 14, label: 'KT/V' },
    { col: 15, label: 'CAPAIAN UF (ML)' },
    { col: 16, label: 'TD PRE (MMHG)' },
    { col: 17, label: 'TD POST (MMHG)' },
    { col: 18, label: 'TRANSFUSI' },
    { col: 19, label: 'EPO' },
  ];

  for (const sh of subHeaders) {
    const cell = ws.getRow(5).getCell(sh.col);
    cell.value = sh.label;
    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF236084');
    cell.border = makeBorder('FF34759B');
    cell.alignment = { vertical: 'middle', horizontal: sh.align || 'center', wrapText: true };
  }

  // Body Rows
  input.rows.forEach((row, idx) => {
    const rIdx = 6 + idx;
    const xRow = ws.getRow(rIdx);
    const s = row.entry;
    const isIsolasi = /isolasi|hep/i.test(row.roomCategory);
    const zebraBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const statusLabel = formatVerificationStatusLabel(s.verificationStatus);
    const statusColors = getStatusColors(s.verificationStatus);

    const vascText = row.vascularAccessNote
      ? `${row.vascularAccessLabel}\n(${row.vascularAccessNote})`
      : row.vascularAccessLabel;

    const transfusiText =
      row.transfusionGiven === null
        ? '-'
        : row.transfusionGiven
        ? row.transfusionNote
          ? `Ya\n${row.transfusionNote}`
          : 'Ya'
        : 'Tidak';

    const epoText =
      row.epoGiven === null
        ? '-'
        : row.epoGiven
        ? row.epoNote
          ? `Ya\n${row.epoNote}`
          : 'Ya'
        : 'Tidak';

    const values: Array<string | number> = [
      row.bedMachine,
      `${s.patientName}\n${s.patientRm || '-'}`,
      row.statusRawat,
      row.roomCategory,
      vascText,
      row.durationHours !== null ? row.durationHours : '-',
      Number(s.preWeight) || 0,
      Number(s.postWeight) || 0,
      row.dryWeight !== null ? row.dryWeight : '-',
      row.qbVal !== null ? row.qbVal : '-',
      row.qdVal !== null ? row.qdVal : '-',
      row.heparinDisplay,
      Number(s.ufGoal) || 0,
      row.ktvDisplay,
      Number(s.ufAchieved) || 0,
      s.preBp || '-',
      s.postBp || '-',
      transfusiText,
      epoText,
      `${s.nurseName}\nShift ${s.shift}`,
      statusLabel,
    ];

    values.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const cell = xRow.getCell(colNum);
      cell.value = val;
      cell.border = makeBorder('FFE2E8F0');

      let bg = zebraBg;
      let fg = 'FF0F172A';
      let bold = false;

      if (colNum === 1 || colNum === 3 || colNum === 15) bold = true;
      if (colNum === 4 && isIsolasi) bold = true;
      if (colNum === 18 && row.transfusionGiven === true) {
        bg = 'FFFFF1F2';
        fg = 'FFBE123C';
        bold = true;
      } else if (colNum === 19 && row.epoGiven === true) {
        bg = 'FFF0FDFA';
        fg = 'FF0F766E';
        bold = true;
      } else if (colNum === 21) {
        bg = statusColors.bg;
        fg = statusColors.fg;
        bold = true;
      }

      cell.fill = solidFill(bg);
      cell.font = { name: 'Calibri', size: 10, bold, color: { argb: fg } };
      cell.alignment = {
        vertical: 'middle',
        horizontal:
          colNum === 2 || colNum === 5 || colNum === 12 || colNum === 20 ? 'left' : 'center',
        wrapText: true,
      };

      if (typeof val === 'number') {
        if (colNum >= 6 && colNum <= 9) cell.numFmt = '0.0';
        else cell.numFmt = '#,##0';
      }
    });

    xRow.height = calcRowHeight(
      values.map((text, cIdx) => ({ text, colWidth: colWidths[cIdx] })),
      13.5,
      24,
      8
    );
  });

  // Footer Row: TOTAL & RATA-RATA
  if (input.summaryStats) {
    const fIdx = 6 + input.rows.length;
    const fRow = ws.getRow(fIdx);
    fRow.height = 24;
    ws.mergeCells(`A${fIdx}:B${fIdx}`);
    ws.mergeCells(`C${fIdx}:E${fIdx}`);

    const st = input.summaryStats;
    const footerValues: Array<{ col: number; val: string | number; fmt?: string }> = [
      { col: 1, val: 'TOTAL & RATA-RATA' },
      { col: 3, val: 'Ringkasan Shift' },
      { col: 6, val: st.avgDurasi !== null ? Number(st.avgDurasi.toFixed(1)) : '-', fmt: '0.0' },
      { col: 7, val: st.avgPreW !== null ? Number(st.avgPreW.toFixed(1)) : '-', fmt: '0.0' },
      { col: 8, val: st.avgPostW !== null ? Number(st.avgPostW.toFixed(1)) : '-', fmt: '0.0' },
      { col: 9, val: st.avgDry !== null ? Number(st.avgDry.toFixed(1)) : '-', fmt: '0.0' },
      { col: 10, val: st.avgQb !== null ? Math.round(st.avgQb) : '-', fmt: '#,##0' },
      { col: 11, val: st.avgQd !== null ? Math.round(st.avgQd) : '-', fmt: '#,##0' },
      { col: 12, val: '-' },
      { col: 13, val: Math.round(st.totalTargetUf), fmt: '#,##0' },
      { col: 14, val: '-' },
      { col: 15, val: Math.round(st.totalAchievedUf), fmt: '#,##0' },
      { col: 16, val: '-' },
      { col: 17, val: '-' },
      { col: 18, val: st.transfusionCount > 0 ? `${st.transfusionCount} Ya` : '-' },
      { col: 19, val: st.epoCount > 0 ? `${st.epoCount} Ya` : '-' },
      { col: 20, val: '-' },
      { col: 21, val: '-' },
    ];

    for (let c = 1; c <= 21; c++) {
      const cell = fRow.getCell(c);
      cell.fill = solidFill('FFF1F5F9');
      cell.border = makeBorder('FF94A3B8');
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
    for (const fv of footerValues) {
      const cell = fRow.getCell(fv.col);
      cell.value = fv.val;
      if (typeof fv.val === 'number' && fv.fmt) cell.numFmt = fv.fmt;
      if (fv.col === 3) {
        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF475569' } };
      }
    }
  }

  // ---- Sheet 2: Komplikasi & Staff Bertugas ----
  const ws2 = wb.addWorksheet(sanitizeSheetName('Komplikasi & Staff'), {
    pageSetup: { paperSize: 8 as ExcelJS.PaperSize, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const w2 = [7, 28, 34, 12, 46];
  w2.forEach((w, idx) => {
    ws2.getColumn(idx + 1).width = w;
  });

  ws2.mergeCells('A1:E1');
  const s2b1 = ws2.getCell('A1');
  s2b1.value = 'KOMPLIKASI, TATALAKSANA & ADVIS MEDIS DPJP';
  s2b1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  s2b1.fill = solidFill('FF0E3A53');
  s2b1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws2.getRow(1).height = 25;

  ws2.mergeCells('A2:E2');
  const s2b2 = ws2.getCell('A2');
  s2b2.value = `Shift: ${input.meta.shiftLabel}  |  Hari/Tanggal: ${input.meta.dateLabel}  |  Total Kejadian: ${input.complicationRecords.length}`;
  s2b2.font = { name: 'Calibri', size: 10, color: { argb: 'FFE0F2FE' } };
  s2b2.fill = solidFill('FF1B4F6E');
  s2b2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws2.getRow(2).height = 20;

  ws2.getRow(3).height = 8;

  const compHeaders = ['NO', 'NAMA PASIEN / NO. RM & BED', 'KOMPLIKASI INTRA-HD', 'JAM', 'TINDAKAN & ADVIS MEDIS DPJP'];
  const cHdr = ws2.getRow(4);
  cHdr.height = 24;
  compHeaders.forEach((h, idx) => {
    const cell = cHdr.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF236084');
    cell.border = makeBorder('FF34759B');
    cell.alignment = { vertical: 'middle', horizontal: idx === 0 || idx === 3 ? 'center' : 'left' };
  });

  let nextRow = 5;
  if (input.complicationRecords.length === 0) {
    ws2.mergeCells('A5:E5');
    const emptyCell = ws2.getCell('A5');
    emptyCell.value = 'Tidak ada komplikasi intra-HD yang tercatat pada shift / periode yang dipilih.';
    emptyCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } };
    emptyCell.fill = solidFill('FFF8FAFC');
    emptyCell.border = makeBorder('FFE2E8F0');
    emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws2.getRow(5).height = 24;
    nextRow = 6;
  } else {
    input.complicationRecords.forEach((rec, idx) => {
      const r = ws2.getRow(5 + idx);
      const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
      const vals = [
        idx + 1,
        `${rec.patientName}\n${rec.patientRm} · Bed ${rec.bedMachine}`,
        rec.complication,
        rec.time,
        rec.advice,
      ];
      vals.forEach((v, cIdx) => {
        const cell = r.getCell(cIdx + 1);
        cell.value = v;
        cell.fill = solidFill(bg);
        cell.border = makeBorder('FFE2E8F0');
        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: cIdx === 0 || cIdx === 2 || cIdx === 3,
          color: { argb: cIdx === 2 ? 'FFBE123C' : 'FF0F172A' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: cIdx === 0 || cIdx === 3 ? 'center' : 'left',
          wrapText: true,
        };
      });
      r.height = calcRowHeight(
        vals.map((text, cIdx) => ({ text, colWidth: w2[cIdx] })),
        14,
        24,
        8
      );
      nextRow = 5 + idx + 1;
    });
  }

  // Staff Bertugas & Total Pasien block
  nextRow += 1;
  ws2.mergeCells(`A${nextRow}:E${nextRow}`);
  const stHdr = ws2.getCell(`A${nextRow}`);
  stHdr.value = 'STAFF BERTUGAS & TOTAL PASIEN';
  stHdr.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
  stHdr.fill = solidFill('FF1B4F6E');
  stHdr.border = makeBorder('FF2D6687');
  stHdr.alignment = { vertical: 'middle', horizontal: 'center' };
  ws2.getRow(nextRow).height = 24;

  const leftStaffRows = [
    ['DOKTER DPJP', input.meta.dpjpLabel],
    ['DOKTER UMUM', input.meta.dutyDoctorLabel || '-'],
    ['KEPALA RUANG', input.meta.kaRuang],
    ['PJ SHIFT', input.meta.pjShift],
  ];

  const { rawatJalan, rawatInap, isolasi } = input.patientClassificationCounts;
  const totalPasienText = [
    `${rawatJalan} PASIEN RAWAT JALAN`,
    `${rawatInap} PASIEN RAWAT INAP`,
    ...(isolasi > 0 ? [`(${isolasi} Pasien Ruang Isolasi)`] : []),
  ].join('\n');

  for (let i = 0; i < 4; i++) {
    const rIdx = nextRow + 1 + i;
    const r = ws2.getRow(rIdx);
    r.height = 27;

    ws2.mergeCells(`A${rIdx}:B${rIdx}`);
    const lLabelCell = ws2.getCell(`A${rIdx}`);
    lLabelCell.value = leftStaffRows[i][0];
    lLabelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    lLabelCell.fill = solidFill('FF236084');
    lLabelCell.border = makeBorder('FF34759B');
    lLabelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const lValCell = ws2.getCell(`C${rIdx}`);
    lValCell.value = leftStaffRows[i][1];
    lValCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    lValCell.fill = solidFill('FFFFFFFF');
    lValCell.border = makeBorder('FFCBD5E1');
    lValCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  }

  // Right block merged vertically: 2 rows for TOTAL PERAWAT, 2 rows for TOTAL PASIEN
  const rTop = nextRow + 1;
  ws2.mergeCells(`D${rTop}:D${rTop + 1}`);
  ws2.mergeCells(`E${rTop}:E${rTop + 1}`);
  const rpLbl = ws2.getCell(`D${rTop}`);
  rpLbl.value = 'TOTAL PERAWAT';
  rpLbl.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  rpLbl.fill = solidFill('FF236084');
  rpLbl.border = makeBorder('FF34759B');
  rpLbl.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  const rpVal = ws2.getCell(`E${rTop}`);
  rpVal.value = `${input.meta.nurseCount} PERAWAT`;
  rpVal.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
  rpVal.fill = solidFill('FFFFFFFF');
  rpVal.border = makeBorder('FFCBD5E1');
  rpVal.alignment = { vertical: 'middle', horizontal: 'center' };

  ws2.mergeCells(`D${rTop + 2}:D${rTop + 3}`);
  ws2.mergeCells(`E${rTop + 2}:E${rTop + 3}`);
  const tpLbl = ws2.getCell(`D${rTop + 2}`);
  tpLbl.value = 'TOTAL PASIEN';
  tpLbl.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  tpLbl.fill = solidFill('FF236084');
  tpLbl.border = makeBorder('FF34759B');
  tpLbl.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  const tpVal = ws2.getCell(`E${rTop + 2}`);
  tpVal.value = totalPasienText;
  tpVal.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
  tpVal.fill = solidFill('FFFFFFFF');
  tpVal.border = makeBorder('FFCBD5E1');
  tpVal.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  ws2.getRow(rTop + 2).height = 25;
  ws2.getRow(rTop + 3).height = 25;

  await downloadWorkbook(wb, input.filename);
}

export interface PatientSoapExcelInput {
  filename: string;
  notes: ReportEntry[];
  meta: PatientReportPdfMeta;
}

export async function exportPatientSoapExcel(input: PatientSoapExcelInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName('Catatan SOAP Pasien'), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 8 as ExcelJS.PaperSize, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colWidths = [6, 14, 24, 13, 24, 28, 28, 28, 28, 30];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  ws.mergeCells('A1:J1');
  const b1 = ws.getCell('A1');
  b1.value = 'CATATAN PERKEMBANGAN PASIEN (SOAP) — UNIT HEMODIALISIS RS HAPPY LAND MEDICAL CENTRE';
  b1.font = { name: 'Calibri', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
  b1.fill = solidFill('FF0E3A53');
  b1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 25;

  ws.mergeCells('A2:J2');
  const b2 = ws.getCell('A2');
  b2.value = `Shift: ${input.meta.shiftLabel}  |  Hari/Tanggal: ${input.meta.dateLabel}  |  Total Catatan: ${input.notes.length}`;
  b2.font = { name: 'Calibri', size: 10, color: { argb: 'FFE0F2FE' } };
  b2.fill = solidFill('FF1B4F6E');
  b2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.getRow(3).height = 6;

  const headers = [
    'NO',
    'TANGGAL',
    'NAMA PASIEN',
    'NO. RM',
    'DICATAT OLEH',
    'S (SUBJEKTIF)',
    'O (OBJEKTIF)',
    'A (ASESMEN)',
    'P (PLAN / INTERVENSI)',
    'INSTRUKSI / ORDER MEDIS DPJP',
  ];
  const hRow = ws.getRow(4);
  hRow.height = 25;
  headers.forEach((h, idx) => {
    const c = hRow.getCell(idx + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = solidFill('FF1B4F6E');
    c.border = makeBorder('FF2D6687');
    c.alignment = { vertical: 'middle', horizontal: idx === 0 || idx === 3 ? 'center' : 'left', wrapText: true };
  });

  input.notes.forEach((n, idx) => {
    const r = ws.getRow(5 + idx);
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    const vals = [
      idx + 1,
      formatDateId(n.date),
      n.patientName || '-',
      n.patientRm || '-',
      `${n.authorName} (${n.authorRole})`,
      n.soapSubjective || '-',
      n.soapObjective || '-',
      n.soapAssessment || '-',
      n.soapPlan || '-',
      n.medicalOrder || '-',
    ];
    vals.forEach((v, cIdx) => {
      const c = r.getCell(cIdx + 1);
      c.value = v;
      c.fill = solidFill(cIdx === 9 && n.medicalOrder && n.medicalOrder !== '-' ? 'FFF0F9FF' : bg);
      c.border = makeBorder('FFE2E8F0');
      c.font = {
        name: 'Calibri',
        size: 10,
        bold: cIdx === 0 || cIdx === 2,
        color: { argb: cIdx === 9 && n.medicalOrder && n.medicalOrder !== '-' ? 'FF0C4A6E' : 'FF0F172A' },
      };
      c.alignment = { vertical: 'top', horizontal: cIdx === 0 || cIdx === 3 ? 'center' : 'left', wrapText: true };
    });
    r.height = calcRowHeight(
      vals.map((text, cIdx) => ({ text, colWidth: colWidths[cIdx] })),
      14,
      24,
      8
    );
  });

  await downloadWorkbook(wb, input.filename);
}

/* -------------------------------------------------------------------------- */
/* 3. LAPORAN PJ SHIFT (SECTIONS A - F)                                       */
/* -------------------------------------------------------------------------- */

export interface PjShiftExcelInput {
  filename: string;
  sectionARows: Array<[string, string | number, string, string | number]>;
  sectionBRows: Array<{
    lLabel: string;
    lVal: string | number;
    rLabel: string;
    rVal: string | number;
  }>;
  sectionCRows: Array<{
    indicator: string;
    result: string;
    target: string;
    analysisLines: string[];
    hasCases: boolean;
  }>;
  sectionDRows: Array<{
    item: string;
    parameter: string;
    result: string;
    status: string;
  }>;
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  signatures: Array<{
    heading: string;
    roleLabel: string;
    signerName: string;
    signed: boolean;
    metaLine?: string;
    sigCode?: string;
    fallbackName: string;
  }>;
  reviewEvaluation?: { reviewerName: string; note: string } | null;
}

export async function exportPjShiftExcel(input: PjShiftExcelInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName('Laporan PJ Shift'), {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colWidths = [28, 28, 26, 48];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  // Institutional Title Block
  ws.mergeCells('A1:D1');
  const h1 = ws.getCell('A1');
  h1.value = 'INSTALASI DIALISIS RS HAPPY LAND MEDICAL CENTRE';
  h1.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF475569' } };
  h1.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 18;

  ws.mergeCells('A2:D2');
  const h2 = ws.getCell('A2');
  h2.value = 'LOGBOOK & PERTANGGUNGJAWABAN PERAWAT PENANGGUNG JAWAB (PJ) SHIFT';
  h2.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
  h2.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 24;

  ws.mergeCells('A3:D3');
  const h3 = ws.getCell('A3');
  h3.value =
    'Laporan Komprehensif Asuhan Medis, Keperawatan, Mutu Air RO, Pemeliharaan Mesin & Operasional Non-Medis | Standar Akreditasi KARS & PERNEFRI';
  h3.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF64748B' } };
  h3.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  h3.border = { bottom: { style: 'medium', color: { argb: 'FFCBD5E1' } } };
  ws.getRow(3).height = 20;

  let r = 5;
  const addSectionBanner = (title: string) => {
    ws.mergeCells(`A${r}:D${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = title;
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF1B4670');
    cell.border = makeBorder('FF1B4670');
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = 23;
    r += 1;
  };

  // SECTION A
  addSectionBanner('A. INFORMASI UMUM SHIFT & KETENAGAAN (MANPOWER)');
  for (const rowA of input.sectionARows) {
    const row = ws.getRow(r);
    rowA.forEach((val, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = val;
      const isLabel = idx === 0 || idx === 2;
      cell.fill = solidFill(isLabel ? 'FFEDF3F8' : 'FFFFFFFF');
      cell.border = makeBorder('FFCBD5E1');
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: isLabel ? 'FF1E293B' : 'FF0F172A' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    });
    row.height = calcRowHeight(
      rowA.map((text, idx) => ({ text, colWidth: colWidths[idx] })),
      13.5,
      22,
      8
    );
    r += 1;
  }

  r += 1;
  // SECTION B
  addSectionBanner('B. SENSUS PASIEN, AKSES VASKULAR & UTILISASI MESIN HEMODIALISIS');
  ws.mergeCells(`A${r}:B${r}`);
  ws.mergeCells(`C${r}:D${r}`);
  const bLeftHdr = ws.getCell(`A${r}`);
  bLeftHdr.value = 'SENSUS & KLASIFIKASI PASIEN SHIFT INI';
  bLeftHdr.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  bLeftHdr.fill = solidFill('FF2C5E8F');
  bLeftHdr.border = makeBorder('FF3B6E9E');
  bLeftHdr.alignment = { vertical: 'middle', horizontal: 'center' };

  const bRightHdr = ws.getCell(`C${r}`);
  bRightHdr.value = 'KAPASITAS MESIN, DISTRIBUSI AKSES VASKULAR & PEMELIHARAAN HB';
  bRightHdr.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  bRightHdr.fill = solidFill('FF2C5E8F');
  bRightHdr.border = makeBorder('FF3B6E9E');
  bRightHdr.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(r).height = 22;
  r += 1;

  input.sectionBRows.forEach((bRow, idx) => {
    const row = ws.getRow(r);
    const bg = idx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF';
    const vals = [bRow.lLabel, bRow.lVal, bRow.rLabel, bRow.rVal];
    vals.forEach((val, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = val;
      cell.fill = solidFill(bg);
      cell.border = makeBorder('FFCBD5E1');
      const isValCol = cIdx === 1 || cIdx === 3;
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: isValCol,
        color: { argb: 'FF0F172A' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: cIdx === 1 || (cIdx === 3 && !String(val).includes('\n')) ? 'center' : 'left',
        wrapText: true,
        indent: isValCol ? 0 : 1,
      };
    });
    row.height = calcRowHeight(
      vals.map((text, cIdx) => ({ text, colWidth: colWidths[cIdx] })),
      13.5,
      21,
      8
    );
    r += 1;
  });

  r += 1;
  // SECTION C
  addSectionBanner('C. MONITORING ASUHAN KEPERAWATAN & PELAYANAN MEDIS SHIFT');
  const cSubHeaders = [
    'Indikator Asuhan Keperawatan & Medis',
    'Hasil / Capaian Shift',
    'Standar Target',
    'Analisis & Tindak Lanjut',
  ];
  const cSubRow = ws.getRow(r);
  cSubRow.height = 22;
  cSubHeaders.forEach((h, idx) => {
    const cell = cSubRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF2C5E8F');
    cell.border = makeBorder('FF3B6E9E');
    cell.alignment = { vertical: 'middle', horizontal: idx === 1 || idx === 2 ? 'center' : 'left', indent: idx === 0 || idx === 3 ? 1 : 0 };
  });
  r += 1;

  input.sectionCRows.forEach((cRow, idx) => {
    const row = ws.getRow(r);
    const bg = cRow.hasCases ? 'FFFFF1F2' : idx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF';
    const analysisText =
      cRow.analysisLines.length > 1
        ? cRow.analysisLines.map((line, lIdx) => `${lIdx + 1}. ${line}`).join('\n')
        : cRow.analysisLines[0] || '-';
    const vals = [cRow.indicator, cRow.result, cRow.target, analysisText];
    vals.forEach((val, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = val;
      cell.fill = solidFill(bg);
      cell.border = makeBorder('FFCBD5E1');
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: cIdx === 0 || cIdx === 1,
        color: { argb: cIdx === 1 && cRow.hasCases ? 'FFBE123C' : 'FF0F172A' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: cIdx === 1 || cIdx === 2 ? 'center' : 'left',
        wrapText: true,
        indent: cIdx === 0 || cIdx === 3 ? 1 : 0,
      };
    });
    row.height = calcRowHeight(
      vals.map((text, cIdx) => ({ text, colWidth: colWidths[cIdx] })),
      13.5,
      22,
      8
    );
    r += 1;
  });

  r += 1;
  // SECTION D
  addSectionBanner('D. AKUNTABILITAS NON-MEDIS, OPERASIONAL, WATER TREATMENT & K3');
  const dSubHeaders = [
    'Item Fasilitas / Operasional',
    'Parameter Uji / Pengawasan',
    'Hasil Observasi Shift',
    'Status Kepatuhan',
  ];
  const dSubRow = ws.getRow(r);
  dSubRow.height = 22;
  dSubHeaders.forEach((h, idx) => {
    const cell = dSubRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill('FF2C5E8F');
    cell.border = makeBorder('FF3B6E9E');
    cell.alignment = { vertical: 'middle', horizontal: idx === 3 ? 'center' : 'left', indent: idx === 3 ? 0 : 1 };
  });
  r += 1;

  input.sectionDRows.forEach((dRow, idx) => {
    const row = ws.getRow(r);
    const bg = idx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF';
    const vals = [dRow.item, dRow.parameter, dRow.result, dRow.status];
    vals.forEach((val, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = val;
      cell.fill = solidFill(bg);
      cell.border = makeBorder('FFCBD5E1');
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: cIdx === 0 || cIdx === 3,
        color: { argb: 'FF0F172A' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: cIdx === 3 ? 'center' : 'left',
        wrapText: true,
        indent: cIdx === 3 ? 0 : 1,
      };
    });
    row.height = calcRowHeight(
      vals.map((text, cIdx) => ({ text, colWidth: colWidths[cIdx] })),
      13.5,
      22,
      8
    );
    r += 1;
  });

  r += 1;
  // SECTION E: SBAR
  addSectionBanner('E. SERAH TERIMA SHIFT MODEL SBAR (SITUATION, BACKGROUND, ASSESSMENT, RECOMMENDATION)');
  ws.mergeCells(`B${r}:D${r}`);
  const eSubL = ws.getCell(`A${r}`);
  eSubL.value = 'Komponen SBAR';
  eSubL.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  eSubL.fill = solidFill('FF2C5E8F');
  eSubL.border = makeBorder('FF3B6E9E');
  eSubL.alignment = { vertical: 'middle', horizontal: 'center' };

  const eSubR = ws.getCell(`B${r}`);
  eSubR.value = 'Catatan Serah Terima Shift';
  eSubR.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  eSubR.fill = solidFill('FF2C5E8F');
  eSubR.border = makeBorder('FF3B6E9E');
  eSubR.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 22;
  r += 1;

  const sbarRows: Array<[string, string]> = [
    ['SITUATION (S)', input.sbar.situation || '-'],
    ['BACKGROUND (B)', input.sbar.background || '-'],
    ['ASSESSMENT (A)', input.sbar.assessment || '-'],
    ['RECOMMENDATION (R)', input.sbar.recommendation || '-'],
  ];
  for (const [label, val] of sbarRows) {
    ws.mergeCells(`B${r}:D${r}`);
    const row = ws.getRow(r);
    const lCell = row.getCell(1);
    lCell.value = label;
    lCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1B4670' } };
    lCell.fill = solidFill('FFEDF3F8');
    lCell.border = makeBorder('FFCBD5E1');
    lCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    const vCell = row.getCell(2);
    vCell.value = val;
    vCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
    vCell.fill = solidFill('FFFFFFFF');
    vCell.border = makeBorder('FFCBD5E1');
    vCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };

    const mergedWidth = colWidths[1] + colWidths[2] + colWidths[3];
    row.height = calcRowHeight(
      [
        { text: label, colWidth: colWidths[0] },
        { text: val, colWidth: mergedWidth },
      ],
      14,
      28,
      10
    );
    r += 1;
  }

  r += 1;
  // SECTION F: PENGESAHAN DIGITAL
  addSectionBanner('F. PENGESAHAN & PERTANGGUNGJAWABAN SHIFT (PENGESAHAN DIGITAL)');
  const sigCount = input.signatures.length;
  const sigRanges =
    sigCount >= 3
      ? [
          { start: 'A', end: 'A', width: colWidths[0] },
          { start: 'B', end: 'C', width: colWidths[1] + colWidths[2] },
          { start: 'D', end: 'D', width: colWidths[3] },
        ]
      : [
          { start: 'A', end: 'B', width: colWidths[0] + colWidths[1] },
          { start: 'C', end: 'D', width: colWidths[2] + colWidths[3] },
        ];

  const sigRow = ws.getRow(r);
  const sigHeights: Array<{ text: string; colWidth: number }> = [];
  input.signatures.slice(0, sigRanges.length).forEach((sig, idx) => {
    const rng = sigRanges[idx];
    if (rng.start !== rng.end) {
      ws.mergeCells(`${rng.start}${r}:${rng.end}${r}`);
    }
    const statusText = sig.signed
      ? `[PENGESAHAN DIGITAL SAH]\n${sig.signerName}\n${sig.metaLine || ''}${sig.sigCode ? `\n${sig.sigCode}` : ''}`
      : '[Belum disahkan secara digital]';
    const fullText = `${sig.heading}\n${sig.roleLabel}\n\n${statusText}\n\n(${sig.fallbackName})`;
    const cell = ws.getCell(`${rng.start}${r}`);
    cell.value = fullText;
    cell.fill = solidFill(sig.signed ? 'FFF0FDF4' : 'FFFFFFFF');
    cell.border = makeBorder('FFCBD5E1');
    cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sigHeights.push({ text: fullText, colWidth: rng.width });
  });
  sigRow.height = calcRowHeight(sigHeights, 13.5, 96, 12);
  r += 1;

  if (input.reviewEvaluation) {
    r += 1;
    ws.mergeCells(`A${r}:D${r}`);
    const evalCell = ws.getCell(`A${r}`);
    evalCell.value = `Catatan Evaluasi Kepala Ruang (${input.reviewEvaluation.reviewerName}): ${input.reviewEvaluation.note}`;
    evalCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF065F46' } };
    evalCell.fill = solidFill('FFECFDF5');
    evalCell.border = makeBorder('FFA7F3D0');
    evalCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    ws.getRow(r).height = calcRowHeight(
      [{ text: String(evalCell.value), colWidth: colWidths.reduce((a, b) => a + b, 0) }],
      14,
      24,
      8
    );
  }

  await downloadWorkbook(wb, input.filename);
}

/* -------------------------------------------------------------------------- */
/* 4. LAPORAN BULANAN (RECAP + MATRIKS 1-31)                                  */
/* -------------------------------------------------------------------------- */

export interface MonthlyRecapExcelInput {
  filename: string;
  monthSlashLabel: string;
  rows: Array<{
    fullName: string;
    nip: string;
    roleLabel: string;
    activeDays: number;
    patientCount: number;
    grandTotal: number;
    maxGrandTotal: number;
    pct: number;
    approvalStatus: 'Sah Final' | 'Menunggu Ka. Ruang' | 'Belum Disahkan';
  }>;
}

export async function exportMonthlyRecapExcel(input: MonthlyRecapExcelInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName('Rekap Capaian Bulanan'), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colWidths = [6, 28, 16, 20, 15, 16, 12, 12, 13, 21];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  ws.mergeCells('A1:J1');
  const b1 = ws.getCell('A1');
  b1.value = `DAFTAR REKAPITULASI CAPAIAN LOGBOOK SELURUH PERAWAT (${input.monthSlashLabel.toUpperCase()})`;
  b1.font = { name: 'Calibri', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
  b1.fill = solidFill('FF164B75');
  b1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 25;

  ws.mergeCells('A2:J2');
  const b2 = ws.getCell('A2');
  b2.value = 'UNIT PELAYANAN HEMODIALISIS (DIALYSIS CENTER) — RS HAPPY LAND MEDICAL CENTRE';
  b2.font = { name: 'Calibri', size: 10, color: { argb: 'FFE0F2FE' } };
  b2.fill = solidFill('FF1E3A5F');
  b2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.getRow(3).height = 6;

  const headers = [
    'NO',
    'NAMA PERAWAT',
    'NIP / NIRA',
    'JABATAN',
    'HARI DISAHKAN',
    'PASIEN KELOLAAN',
    'NILAI SPO',
    'MAKS SPO',
    '% CAPAIAN',
    'STATUS PENGESAHAN',
  ];
  const hRow = ws.getRow(4);
  hRow.height = 26;
  headers.forEach((h, idx) => {
    const c = hRow.getCell(idx + 1);
    c.value = h;
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = solidFill('FF164B75');
    c.border = makeBorder('FF27608D');
    c.alignment = { vertical: 'middle', horizontal: idx === 1 ? 'left' : 'center', wrapText: true };
  });

  input.rows.forEach((item, idx) => {
    const r = ws.getRow(5 + idx);
    const hasScore = item.maxGrandTotal > 0;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';

    const pctBg = !hasScore
      ? bg
      : item.pct >= 90
      ? 'FFECFDF5'
      : item.pct >= 75
      ? 'FFF0F9FF'
      : 'FFFFFBEB';
    const pctFg = !hasScore
      ? 'FF94A3B8'
      : item.pct >= 90
      ? 'FF047857'
      : item.pct >= 75
      ? 'FF0B5A8E'
      : 'FFB45309';

    const appBg =
      item.approvalStatus === 'Sah Final'
        ? 'FFECFDF5'
        : item.approvalStatus === 'Menunggu Ka. Ruang'
        ? 'FFF0F9FF'
        : bg;
    const appFg =
      item.approvalStatus === 'Sah Final'
        ? 'FF047857'
        : item.approvalStatus === 'Menunggu Ka. Ruang'
        ? 'FF0B5A8E'
        : 'FF64748B';

    const vals: Array<string | number> = [
      idx + 1,
      item.fullName.toUpperCase(),
      item.nip || '-',
      item.roleLabel,
      `${item.activeDays} Hari`,
      `${item.patientCount} Pasien`,
      hasScore ? item.grandTotal : '-',
      hasScore ? item.maxGrandTotal : '-',
      hasScore ? `${item.pct}%` : '-',
      item.approvalStatus,
    ];

    vals.forEach((v, cIdx) => {
      const c = r.getCell(cIdx + 1);
      c.value = v;
      c.border = makeBorder('FFE2E8F0');
      c.fill = solidFill(cIdx === 8 ? pctBg : cIdx === 9 ? appBg : bg);
      c.font = {
        name: 'Calibri',
        size: 10,
        bold: cIdx === 1 || cIdx === 4 || cIdx === 5 || cIdx === 8 || cIdx === 9,
        color: { argb: cIdx === 8 ? pctFg : cIdx === 9 ? appFg : 'FF0F172A' },
      };
      c.alignment = { vertical: 'middle', horizontal: cIdx === 1 ? 'left' : 'center', wrapText: true };
    });
    r.height = 24;
  });

  await downloadWorkbook(wb, input.filename);
}

export interface MonthlyMatrixExcelInput {
  filename: string;
  reportTitle: string;
  staffName: string;
  staffNip: string;
  staffRoleLabel: string;
  staffRoleSignatureTitle: string;
  monthSlashLabel: string;
  monthUpperLabel: string;
  activeWorkDays: number;
  verifiedPatientCount: number;
  shiftSummaryText: string;
  daysInMonth: string[];
  dayActiveFlags: boolean[];
  dailyPatientCounts: number[];
  dailyPatientNames: string[];
  sections: Array<{
    title: string;
    items: Array<{
      id: string;
      category: string;
      description: string;
      standard: string;
      dailyValues: number[];
      total: number;
      pct: number;
      keterangan: string;
    }>;
  }>;
  customRows: Array<{
    no: string;
    category: string;
    description: string;
    standard: string;
    dailyDisplay: string[];
    totalDisplay: string;
    pctDisplay: string;
    keterangan: string;
  }>;
  dailyGrandTotals: number[];
  grandTotal: number;
  grandPct: number;
  maxGrandTotal: number;
  nurseSignature: {
    signed: boolean;
    signerName: string;
    metaLine: string;
    sigCode?: string;
    fallbackName: string;
    nip: string;
  };
  karuSignature: {
    signed: boolean;
    signerName: string;
    metaLine: string;
    sigCode?: string;
    fallbackName: string;
    nip: string;
  };
}

export async function exportMonthlyMatrixExcel(input: MonthlyMatrixExcelInput): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const dayCount = input.daysInMonth.length;
  const totalCols = 4 + dayCount + 3; // NO, CAT, DESC, SPO, 1..N, TOTAL, % CAPAIAN, KETERANGAN

  const ws = wb.addWorksheet(sanitizeSheetName(`Matriks 1-${dayCount}`), {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 10 }],
    pageSetup: { paperSize: 8 as ExcelJS.PaperSize, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colWidths: number[] = [
    6.5, // NO
    22,  // KATEGORI
    34,  // URAIAN
    24,  // STANDAR SPO
    ...new Array(dayCount).fill(4.4),
    8.5, // TOTAL
    10.5, // % CAPAIAN
    18,  // KETERANGAN
  ];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  const lastColLetter = ws.getColumn(totalCols).letter;

  // Institutional Header
  ws.mergeCells(`A1:${lastColLetter}1`);
  const t1 = ws.getCell('A1');
  t1.value = input.reportTitle.toUpperCase();
  t1.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
  t1.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 23;

  ws.mergeCells(`A2:${lastColLetter}2`);
  const t2 = ws.getCell('A2');
  t2.value = 'UNIT PELAYANAN HEMODIALISIS (DIALYSIS CENTER) - RS HAPPY LAND MEDICAL CENTRE';
  t2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
  t2.alignment = { vertical: 'middle', horizontal: 'center' };
  t2.border = { bottom: { style: 'medium', color: { argb: 'FF1E3A5F' } } };
  ws.getRow(2).height = 20;

  ws.getRow(3).height = 6;

  // Staff & Period Metadata (Rows 4-6)
  const metaRightStartCol = Math.min(totalCols - 6, 16);
  const metaRightStartLetter = ws.getColumn(metaRightStartCol).letter;
  const metaLeftEndLetter = ws.getColumn(metaRightStartCol - 1).letter;
  const metaRows = [
    [
      `Nama Staff         : ${input.staffName.toUpperCase()}`,
      `Bulan / Tahun        : ${input.monthSlashLabel}`,
    ],
    [
      `NIP / NIRA         : ${input.staffNip || '-'}`,
      `Rekap Terverifikasi  : ${input.activeWorkDays} Hari Kerja · ${input.verifiedPatientCount} Pasien Kelolaan Disahkan`,
    ],
    [
      `Jabatan / Akses    : ${input.staffRoleLabel}`,
      `Jumlah Shift         : ${input.shiftSummaryText}`,
    ],
  ];
  metaRows.forEach(([leftVal, rightVal], idx) => {
    const rIdx = 4 + idx;
    ws.mergeCells(`A${rIdx}:${metaLeftEndLetter}${rIdx}`);
    ws.mergeCells(`${metaRightStartLetter}${rIdx}:${lastColLetter}${rIdx}`);
    const lc = ws.getCell(`A${rIdx}`);
    lc.value = leftVal;
    lc.font = { name: 'Calibri', size: 10, bold: idx === 0, color: { argb: 'FF1E293B' } };
    lc.alignment = { vertical: 'middle', horizontal: 'left' };

    const rc = ws.getCell(`${metaRightStartLetter}${rIdx}`);
    rc.value = rightVal;
    rc.font = { name: 'Calibri', size: 10, bold: idx <= 1, color: { argb: 'FF1E293B' } };
    rc.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(rIdx).height = 18;
  });

  ws.getRow(7).height = 6;

  // Table Headers: Rows 8 & 9
  ws.getRow(8).height = 22;
  ws.getRow(9).height = 20;

  const fixedCols8: Array<{ col: number; label: string; align: 'left' | 'center' }> = [
    { col: 1, label: 'NO', align: 'center' },
    { col: 2, label: 'KATEGORI FASE ASUHAN', align: 'left' },
    { col: 3, label: 'URAIAN KEGIATAN SPESIFIK PERAWAT HEMODIALISIS', align: 'left' },
    { col: 4, label: 'STANDAR SPO / INDIKATOR MUTU', align: 'left' },
    { col: 4 + dayCount + 1, label: 'TOTAL', align: 'center' },
    { col: 4 + dayCount + 2, label: '% CAPAIAN', align: 'center' },
    { col: 4 + dayCount + 3, label: 'KETERANGAN', align: 'center' },
  ];

  for (const fc of fixedCols8) {
    const letter = ws.getColumn(fc.col).letter;
    ws.mergeCells(`${letter}8:${letter}9`);
    const c = ws.getCell(`${letter}8`);
    c.value = fc.label;
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = solidFill('FF1E3A5F');
    c.border = makeBorder('FF64748B');
    c.alignment = { vertical: 'middle', horizontal: fc.align, wrapText: true };
  }

  const dayStartLetter = ws.getColumn(5).letter;
  const dayEndLetter = ws.getColumn(4 + dayCount).letter;
  ws.mergeCells(`${dayStartLetter}8:${dayEndLetter}8`);
  const dayGroupCell = ws.getCell(`${dayStartLetter}8`);
  dayGroupCell.value = `TANGGAL PELAKSANAAN TERVERIFIKASI (${input.monthUpperLabel})`;
  dayGroupCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  dayGroupCell.fill = solidFill('FF1E3A5F');
  dayGroupCell.border = makeBorder('FF64748B');
  dayGroupCell.alignment = { vertical: 'middle', horizontal: 'center' };

  for (let i = 0; i < dayCount; i++) {
    const cell = ws.getRow(9).getCell(5 + i);
    cell.value = i + 1;
    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill(input.dayActiveFlags[i] ? 'FF0F6B76' : 'FF274B7A');
    cell.border = makeBorder('FF64748B');
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Row 10: Summary Sub-header (Patient counts per day)
  const r10 = ws.getRow(10);
  r10.height = 22;
  ws.mergeCells('A10:C10');
  const pSumLbl = ws.getCell('A10');
  pSumLbl.value = 'JUMLAH PASIEN KELOLAAN TERVERIFIKASI PER HARI';
  pSumLbl.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E3A5F' } };
  pSumLbl.fill = solidFill('FFEEF4FB');
  pSumLbl.border = makeBorder('FF94A3B8');
  pSumLbl.alignment = { vertical: 'middle', horizontal: 'right' };

  const pHarLbl = r10.getCell(4);
  pHarLbl.value = 'Harian';
  pHarLbl.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FF64748B' } };
  pHarLbl.fill = solidFill('FFEEF4FB');
  pHarLbl.border = makeBorder('FF94A3B8');
  pHarLbl.alignment = { vertical: 'middle', horizontal: 'center' };

  input.dailyPatientCounts.forEach((cnt, idx) => {
    const c = r10.getCell(5 + idx);
    c.value = cnt > 0 ? cnt : '';
    c.fill = solidFill(cnt > 0 ? 'FFF0FDFA' : 'FFEEF4FB');
    c.font = {
      name: 'Calibri',
      size: 9,
      bold: cnt > 0,
      color: { argb: cnt > 0 ? 'FF115E59' : 'FF1E3A5F' },
    };
    c.border = makeBorder('FF94A3B8');
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const pTot = r10.getCell(5 + dayCount);
  pTot.value = input.verifiedPatientCount;
  pTot.fill = solidFill('FFEEF4FB');
  pTot.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E3A5F' } };
  pTot.border = makeBorder('FF94A3B8');
  pTot.alignment = { vertical: 'middle', horizontal: 'center' };

  const pPct = r10.getCell(6 + dayCount);
  pPct.value = '-';
  pPct.fill = solidFill('FFEEF4FB');
  pPct.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E3A5F' } };
  pPct.border = makeBorder('FF94A3B8');
  pPct.alignment = { vertical: 'middle', horizontal: 'center' };

  const pKet = r10.getCell(7 + dayCount);
  pKet.value = 'Pasien Disahkan';
  pKet.fill = solidFill('FFEEF4FB');
  pKet.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E3A5F' } };
  pKet.border = makeBorder('FF94A3B8');
  pKet.alignment = { vertical: 'middle', horizontal: 'center' };

  // Body Sections
  let curRow = 11;
  for (const section of input.sections) {
    ws.mergeCells(`A${curRow}:${lastColLetter}${curRow}`);
    const secCell = ws.getCell(`A${curRow}`);
    secCell.value = section.title.toUpperCase();
    secCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF153152' } };
    secCell.fill = solidFill('FFE3EDF7');
    secCell.border = makeBorder('FF94A3B8');
    secCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(curRow).height = 20;
    curRow += 1;

    for (const item of section.items) {
      const row = ws.getRow(curRow);
      const fixedLeft = [item.id, item.category, item.description, item.standard];
      fixedLeft.forEach((v, idx) => {
        const c = row.getCell(idx + 1);
        c.value = v;
        c.fill = solidFill('FFFFFFFF');
        c.border = makeBorder('FFCBD5E1');
        c.font = {
          name: 'Calibri',
          size: 9,
          bold: idx <= 1,
          italic: idx === 3,
          color: { argb: idx === 3 ? 'FF64748B' : 'FF0F172A' },
        };
        c.alignment = { vertical: 'top', horizontal: idx === 0 ? 'center' : 'left', wrapText: true };
      });

      item.dailyValues.forEach((val, dIdx) => {
        const c = row.getCell(5 + dIdx);
        c.value = val > 0 ? val : '';
        c.fill = solidFill(val > 0 ? 'FFF0FDFA' : 'FFFFFFFF');
        c.border = makeBorder('FFCBD5E1');
        c.font = {
          name: 'Calibri',
          size: 9,
          bold: val > 0,
          color: { argb: val > 0 ? 'FF115E59' : 'FFCBD5E1' },
        };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      const totC = row.getCell(5 + dayCount);
      totC.value = item.total;
      totC.fill = solidFill('FFFFFFFF');
      totC.border = makeBorder('FFCBD5E1');
      totC.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      totC.alignment = { vertical: 'middle', horizontal: 'center' };

      const pctC = row.getCell(6 + dayCount);
      pctC.value = `${item.pct}%`;
      pctC.fill = solidFill('FFFFFFFF');
      pctC.border = makeBorder('FFCBD5E1');
      pctC.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E293B' } };
      pctC.alignment = { vertical: 'middle', horizontal: 'center' };

      const ketC = row.getCell(7 + dayCount);
      ketC.value = item.keterangan;
      ketC.fill = solidFill('FFFFFFFF');
      ketC.border = makeBorder('FFCBD5E1');
      ketC.font = { name: 'Calibri', size: 9, color: { argb: 'FF334155' } };
      ketC.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      row.height = calcRowHeight(
        [
          { text: item.category, colWidth: colWidths[1] },
          { text: item.description, colWidth: colWidths[2] },
          { text: item.standard, colWidth: colWidths[3] },
          { text: item.keterangan, colWidth: colWidths[totalCols - 1] },
        ],
        12.5,
        20,
        6
      );
      curRow += 1;
    }
  }

  // Custom TTV / Additional Fields Section
  if (input.customRows.length > 0) {
    ws.mergeCells(`A${curRow}:${lastColLetter}${curRow}`);
    const cSecCell = ws.getCell(`A${curRow}`);
    cSecCell.value = 'REKAPITULASI PENGINPUTAN TTV & KOLOM TAMBAHAN (SESUAI TEMPLATE LOGBOOK)';
    cSecCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF153152' } };
    cSecCell.fill = solidFill('FFE3EDF7');
    cSecCell.border = makeBorder('FF94A3B8');
    cSecCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(curRow).height = 20;
    curRow += 1;

    for (const crow of input.customRows) {
      const row = ws.getRow(curRow);
      [crow.no, crow.category, crow.description, crow.standard].forEach((v, idx) => {
        const c = row.getCell(idx + 1);
        c.value = v;
        c.fill = solidFill('FFFFFFFF');
        c.border = makeBorder('FFCBD5E1');
        c.font = {
          name: 'Calibri',
          size: 9,
          bold: idx <= 1,
          italic: idx === 3,
          color: { argb: idx === 3 ? 'FF64748B' : 'FF0F172A' },
        };
        c.alignment = { vertical: 'top', horizontal: idx === 0 ? 'center' : 'left', wrapText: true };
      });

      crow.dailyDisplay.forEach((val, dIdx) => {
        const c = row.getCell(5 + dIdx);
        c.value = val || '';
        c.fill = solidFill(val ? 'FFF0F9FF' : 'FFFFFFFF');
        c.border = makeBorder('FFCBD5E1');
        c.font = {
          name: 'Calibri',
          size: 9,
          bold: Boolean(val),
          color: { argb: val ? 'FF0E4E78' : 'FFCBD5E1' },
        };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      const totC = row.getCell(5 + dayCount);
      totC.value = crow.totalDisplay;
      totC.fill = solidFill('FFFFFFFF');
      totC.border = makeBorder('FFCBD5E1');
      totC.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      totC.alignment = { vertical: 'middle', horizontal: 'center' };

      const pctC = row.getCell(6 + dayCount);
      pctC.value = crow.pctDisplay;
      pctC.fill = solidFill('FFFFFFFF');
      pctC.border = makeBorder('FFCBD5E1');
      pctC.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E293B' } };
      pctC.alignment = { vertical: 'middle', horizontal: 'center' };

      const ketC = row.getCell(7 + dayCount);
      ketC.value = crow.keterangan;
      ketC.fill = solidFill('FFFFFFFF');
      ketC.border = makeBorder('FFCBD5E1');
      ketC.font = { name: 'Calibri', size: 9, color: { argb: 'FF334155' } };
      ketC.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      row.height = calcRowHeight(
        [
          { text: crow.category, colWidth: colWidths[1] },
          { text: crow.description, colWidth: colWidths[2] },
          { text: crow.standard, colWidth: colWidths[3] },
          { text: crow.keterangan, colWidth: colWidths[totalCols - 1] },
        ],
        12.5,
        20,
        6
      );
      curRow += 1;
    }
  }

  // Footer Row 1: TOTAL NILAI KEGIATAN TERVERIFIKASI PER HARI
  const ft1 = ws.getRow(curRow);
  ft1.height = 22;
  ws.mergeCells(`A${curRow}:C${curRow}`);
  const ft1Lbl = ws.getCell(`A${curRow}`);
  ft1Lbl.value = 'TOTAL NILAI KEGIATAN TERVERIFIKASI PER HARI';
  ft1Lbl.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F2942' } };
  ft1Lbl.fill = solidFill('FFEEF4FB');
  ft1Lbl.border = makeBorder('FF94A3B8');
  ft1Lbl.alignment = { vertical: 'middle', horizontal: 'right' };

  const ft1Ak = ft1.getCell(4);
  ft1Ak.value = 'Akumulasi';
  ft1Ak.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FF64748B' } };
  ft1Ak.fill = solidFill('FFEEF4FB');
  ft1Ak.border = makeBorder('FF94A3B8');
  ft1Ak.alignment = { vertical: 'middle', horizontal: 'center' };

  input.dailyGrandTotals.forEach((dayVal, dIdx) => {
    const c = ft1.getCell(5 + dIdx);
    c.value = dayVal > 0 ? dayVal : '';
    c.fill = solidFill(dayVal > 0 ? 'FFE0F2FE' : 'FFEEF4FB');
    c.border = makeBorder('FF94A3B8');
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0B5A8E' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const ft1Tot = ft1.getCell(5 + dayCount);
  ft1Tot.value = input.grandTotal;
  ft1Tot.fill = solidFill('FFEEF4FB');
  ft1Tot.border = makeBorder('FF94A3B8');
  ft1Tot.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F2942' } };
  ft1Tot.alignment = { vertical: 'middle', horizontal: 'center' };

  const ft1Pct = ft1.getCell(6 + dayCount);
  ft1Pct.value = `${input.grandPct}%`;
  ft1Pct.fill = solidFill('FFEEF4FB');
  ft1Pct.border = makeBorder('FF94A3B8');
  ft1Pct.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F2942' } };
  ft1Pct.alignment = { vertical: 'middle', horizontal: 'center' };

  const ft1Max = ft1.getCell(7 + dayCount);
  ft1Max.value = `Maks: ${input.maxGrandTotal}`;
  ft1Max.fill = solidFill('FFEEF4FB');
  ft1Max.border = makeBorder('FF94A3B8');
  ft1Max.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F2942' } };
  ft1Max.alignment = { vertical: 'middle', horizontal: 'center' };

  curRow += 1;

  // Footer Row 2: PASIEN KELOLAAN (NAMA PASIEN)
  const ft2 = ws.getRow(curRow);
  ws.mergeCells(`A${curRow}:C${curRow}`);
  const ft2Lbl = ws.getCell(`A${curRow}`);
  ft2Lbl.value = 'PASIEN KELOLAAN (NAMA PASIEN)';
  ft2Lbl.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1E3A5F' } };
  ft2Lbl.fill = solidFill('FFFFFAF0');
  ft2Lbl.border = makeBorder('FF94A3B8');
  ft2Lbl.alignment = { vertical: 'middle', horizontal: 'right' };

  const ft2Sub = ft2.getCell(4);
  ft2Sub.value = 'Daftar Pasien';
  ft2Sub.font = { name: 'Calibri', size: 8.5, color: { argb: 'FF64748B' } };
  ft2Sub.fill = solidFill('FFFFFAF0');
  ft2Sub.border = makeBorder('FF94A3B8');
  ft2Sub.alignment = { vertical: 'middle', horizontal: 'center' };

  const nameHeights: Array<{ text: string; colWidth: number }> = [];
  input.dailyPatientNames.forEach((namesJoined, dIdx) => {
    const c = ft2.getCell(5 + dIdx);
    c.value = namesJoined;
    c.fill = solidFill('FFFFFAF0');
    c.border = makeBorder('FF94A3B8');
    c.font = { name: 'Calibri', size: 8.5, color: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    if (namesJoined) {
      nameHeights.push({ text: namesJoined, colWidth: colWidths[4 + dIdx] });
    }
  });

  const sumStartLetter = ws.getColumn(5 + dayCount).letter;
  ws.mergeCells(`${sumStartLetter}${curRow}:${lastColLetter}${curRow}`);
  const ft2Sum = ws.getCell(`${sumStartLetter}${curRow}`);
  ft2Sum.value = `${input.verifiedPatientCount} Pasien Terverifikasi`;
  ft2Sum.fill = solidFill('FFFFFAF0');
  ft2Sum.border = makeBorder('FF94A3B8');
  ft2Sum.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E3A5F' } };
  ft2Sum.alignment = { vertical: 'middle', horizontal: 'center' };

  ft2.height = calcRowHeight(nameHeights, 11.5, 26, 8);
  curRow += 2;

  // Signature Block
  const leftSigEndCol = Math.min(12, Math.floor(totalCols / 2));
  const rightSigStartCol = leftSigEndCol + 2;
  const leftSigEndLetter = ws.getColumn(leftSigEndCol).letter;
  const rightSigStartLetter = ws.getColumn(rightSigStartCol).letter;

  const formatSigText = (
    topLine: string,
    roleTitle: string,
    sig: MonthlyMatrixExcelInput['nurseSignature'],
    signedLabel: string,
    unsignedLabel: string
  ) => {
    const badge = sig.signed
      ? `[${signedLabel}]\n${sig.signerName}\n${sig.metaLine}${sig.sigCode ? `\n${sig.sigCode}` : ''}`
      : `[${unsignedLabel}]`;
    return `${topLine}\n${roleTitle}\n\n${badge}\n\n( ${sig.fallbackName.toUpperCase()} )\nNIP/NIRA: ${sig.nip || '-'}`;
  };

  ws.mergeCells(`B${curRow}:${leftSigEndLetter}${curRow}`);
  const sLeft = ws.getCell(`B${curRow}`);
  sLeft.value = formatSigText(
    'Mengetahui & Menyatakan,',
    input.staffRoleSignatureTitle,
    input.nurseSignature,
    'PENGESAHAN DIGITAL SAH',
    'Belum disahkan secara digital'
  );
  sLeft.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
  sLeft.fill = solidFill(input.nurseSignature.signed ? 'FFF0F9FF' : 'FFFFFFFF');
  sLeft.border = makeBorder('FFCBD5E1');
  sLeft.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  ws.mergeCells(`${rightSigStartLetter}${curRow}:${lastColLetter}${curRow}`);
  const sRight = ws.getCell(`${rightSigStartLetter}${curRow}`);
  sRight.value = formatSigText(
    'Diverifikasi & Disahkan oleh,',
    'Kepala Ruang Hemodialisis',
    input.karuSignature,
    'DISETUJUI & DISAHKAN DIGITAL',
    'Belum disahkan Kepala Ruang'
  );
  sRight.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
  sRight.fill = solidFill(input.karuSignature.signed ? 'FFECFDF5' : 'FFFFFFFF');
  sRight.border = makeBorder('FFCBD5E1');
  sRight.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  ws.getRow(curRow).height = 115;

  await downloadWorkbook(wb, input.filename);
}

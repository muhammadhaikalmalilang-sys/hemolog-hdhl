import { jsPDF } from 'jspdf';
import type { LogbookEntry, ReportEntry } from '../types';
import { formatDateId } from './formatters';

const A3_LANDSCAPE_W_MM = 420;
const A3_LANDSCAPE_H_MM = 297;
const MARGIN_MM = 6;
const PRINT_W_MM = A3_LANDSCAPE_W_MM - MARGIN_MM * 2; // 408mm
const PRINT_H_MM = A3_LANDSCAPE_H_MM - MARGIN_MM * 2; // 285mm
const PT_TO_MM = 25.4 / 72;

export interface PatientReportPdfRow {
  entry: LogbookEntry;
  statusRawat: string;
  roomCategory: string;
  bedMachine: string;
  vascularAccessLabel: string;
  vascularAccessNote: string;
  durationHours: number | null;
  dryWeight: number | null;
  qbVal: number | null;
  qdVal: number | null;
  heparinDisplay: string;
  ktvDisplay: string;
  hasComplication: boolean;
  complicationLines: string[];
  compTimeLines: string[];
  dpjpAdviceLines: string[];
  transfusionGiven: boolean | null;
  transfusionNote: string;
  epoGiven: boolean | null;
  epoNote: string;
}

export interface PatientReportPdfSummary {
  avgDurasi: number | null;
  avgDry: number | null;
  avgPreW: number | null;
  avgPostW: number | null;
  avgQb: number | null;
  avgQd: number | null;
  totalTargetUf: number;
  totalAchievedUf: number;
  transfusionCount: number;
  epoCount: number;
}

export interface PatientReportPdfMeta {
  shiftLabel: string;
  dateLabel: string;
  pjShift: string;
  dpjpLabel: string;
  dutyDoctorLabel?: string;
  kaRuang: string;
  nurseCount: number;
}

function pdfSafe(text: string): string {
  return (text || '')
    .replace(/\u2192/g, '->')
    .replace(/\u2022/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\xFF\n]/g, ' ');
}

function sanitizeFilename(title: string): string {
  const cleaned = (title || 'Lap Pasien')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function applyRotateLeft270(doc: jsPDF) {
  const internal = doc.internal as typeof doc.internal & {
    write: (data: string) => void;
  };
  internal.events.subscribe('putPage', () => {
    internal.write('/Rotate 270');
  });
}

function fmtNum(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return val.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return Math.round(val).toLocaleString('id-ID');
}

function lineHeightMm(fontPt: number, mult = 1.24): number {
  return fontPt * PT_TO_MM * mult;
}

interface BuiltRowCells {
  colLines: string[][];
  colSubLines: Array<string[] | null>;
  rowHeightMm: number;
  isIsolasi: boolean;
  transfusionGiven: boolean | null;
  epoGiven: boolean | null;
}

interface LayoutPlan {
  scale: number;
  colWidths: number[];
  bannerHeightMm: number;
  bannerTitleLines: string[];
  bannerMetaLines: string[];
  hdrRow1H: number;
  hdrRow2H: number;
  hdrRow1Lines: string[][];
  hdrRow2Lines: string[][];
  rows: BuiltRowCells[];
  footerH: number;
  footerVals: string[];
  totalHeightMm: number;
  bodyPt: number;
  subPt: number;
  hdr1Pt: number;
  hdr2Pt: number;
  bannerTitlePt: number;
  bannerMetaPt: number;
  padX: number;
  padY: number;
}

// 20-column Page 1 layout (Complications moved to dedicated Page 2)
const NUM_MAIN_COLS = 20;

const SUB_HEADERS = [
  'STATUS',
  'RUANG',
  'AKSES VASKULAR',
  'DURASI (JAM)',
  'BB PRE HD (KG)',
  'BB POST HD (KG)',
  'BB KERING (KG)',
  'QB (ML/M)',
  'QD (ML/M)',
  'HEPARIN',
  'TARGET UF (ML)',
  'KT/V',
  'CAPAIAN UF (ML)',
  'TD PRE (MMHG)',
  'TD POST (MMHG)',
  'TRANSFUSI',
  'EPO',
];

const GROUP_HEADERS: Array<{ label: string; startCol: number; span: number; rowSpan2?: boolean }> = [
  { label: 'NO. BED / MESIN', startCol: 0, span: 1, rowSpan2: true },
  { label: 'NAMA PASIEN / NO. RM', startCol: 1, span: 1, rowSpan2: true },
  { label: 'STATUS & RUANG', startCol: 2, span: 2 },
  { label: 'PENGATURAN TEKNIS & PRE-HD', startCol: 4, span: 2 },
  { label: 'PARAMETER BERAT BADAN & ALIRAN', startCol: 6, span: 6 },
  { label: 'MONITORING ULTRAFILTRASI & ADEKUASI', startCol: 12, span: 3 },
  { label: 'TANDA VITAL (HEMODINAMIK)', startCol: 15, span: 2 },
  { label: 'TRANSFUSI & EPO', startCol: 17, span: 2 },
  { label: 'PERAWAT PELAKSANA', startCol: 19, span: 1, rowSpan2: true },
];

function computeAllColumnWidths(
  doc: jsPDF,
  allRows: PatientReportPdfRow[],
  summaryStats: PatientReportPdfSummary | null,
  scale: number
): number[] {
  const bodyPt = 9.0 * scale;
  const subPt = 7.6 * scale;
  const hdrPt = 7.2 * scale;
  const padX = Math.max(1.1, 1.8 * scale);

  const measureW = (txt: string, pt: number, bold = false): number => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(pt);
    return doc.getTextWidth(pdfSafe(txt));
  };

  // Fixed-fit columns (0, 2..16, 19); flexible columns: 1 (Nama), 17 (Transfusi), 18 (EPO)
  const fitIndices = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19];
  const widths = new Array<number>(NUM_MAIN_COLS).fill(14);

  const headerMinTokens: Record<number, string> = {
    0: 'MESIN',
    2: 'STATUS',
    3: 'Reguler',
    4: 'VASKULAR',
    5: 'DURASI',
    6: 'PRE HD',
    7: 'POST HD',
    8: 'KERING',
    9: '(ML/M)',
    10: '(ML/M)',
    11: 'HEPARIN',
    12: 'TARGET',
    13: 'KT/V',
    14: 'CAPAIAN',
    15: 'TD PRE',
    16: 'TD POST',
    19: 'PELAKSANA',
  };

  for (const col of fitIndices) {
    let maxW = measureW(headerMinTokens[col] || '', hdrPt, true);

    for (const r of allRows) {
      const s = r.entry;
      if (col === 0) maxW = Math.max(maxW, measureW(r.bedMachine, bodyPt, true));
      else if (col === 2) maxW = Math.max(maxW, measureW(r.statusRawat, bodyPt, true));
      else if (col === 3) maxW = Math.max(maxW, measureW(r.roomCategory, bodyPt, true));
      else if (col === 4) {
        maxW = Math.max(maxW, measureW(r.vascularAccessLabel, bodyPt, true));
        if (r.vascularAccessNote) {
          maxW = Math.max(maxW, Math.min(28 * scale, measureW(r.vascularAccessNote, subPt, false)));
        }
      } else if (col === 5) maxW = Math.max(maxW, measureW(fmtNum(r.durationHours, 1), bodyPt));
      else if (col === 6) maxW = Math.max(maxW, measureW(fmtNum(s.preWeight, 1), bodyPt));
      else if (col === 7) maxW = Math.max(maxW, measureW(fmtNum(s.postWeight, 1), bodyPt));
      else if (col === 8) maxW = Math.max(maxW, measureW(fmtNum(r.dryWeight, 1), bodyPt));
      else if (col === 9) maxW = Math.max(maxW, measureW(r.qbVal !== null ? fmtInt(r.qbVal) : '-', bodyPt));
      else if (col === 10) maxW = Math.max(maxW, measureW(r.qdVal !== null ? fmtInt(r.qdVal) : '-', bodyPt));
      else if (col === 11) maxW = Math.max(maxW, Math.min(34 * scale, measureW(r.heparinDisplay, bodyPt)));
      else if (col === 12) maxW = Math.max(maxW, measureW(fmtInt(s.ufGoal), bodyPt));
      else if (col === 13) maxW = Math.max(maxW, measureW(r.ktvDisplay, bodyPt));
      else if (col === 14) maxW = Math.max(maxW, measureW(fmtInt(s.ufAchieved), bodyPt, true));
      else if (col === 15) maxW = Math.max(maxW, measureW(s.preBp || '-', bodyPt));
      else if (col === 16) maxW = Math.max(maxW, measureW(s.postBp || '-', bodyPt));
      else if (col === 19) {
        maxW = Math.max(maxW, Math.min(44 * scale, measureW(s.nurseName, bodyPt, true)));
        maxW = Math.max(maxW, measureW(`Shift ${s.shift}`, subPt));
      }
    }

    if (summaryStats) {
      if (col === 12) maxW = Math.max(maxW, measureW(fmtInt(summaryStats.totalTargetUf), bodyPt, true));
      if (col === 14) maxW = Math.max(maxW, measureW(fmtInt(summaryStats.totalAchievedUf), bodyPt, true));
    }

    widths[col] = maxW + padX * 2 + 0.8;
  }

  // Distribute remaining A3 width (408mm total) across Col 1 (Nama Pasien), Col 17 (Transfusi), Col 18 (EPO)
  const usedFixed = fitIndices.reduce((sum, idx) => sum + widths[idx], 0);
  const remaining = Math.max(60, PRINT_W_MM - usedFixed);

  const hasTransfusionNotes = allRows.some(
    (r) => r.transfusionGiven === true && Boolean(r.transfusionNote)
  );
  const hasEpoNotes = allRows.some((r) => r.epoGiven === true && Boolean(r.epoNote));

  const minTransfusionW = Math.max(measureW('TRANSFUSI', hdrPt, true) + padX * 2 + 0.8, 17 * scale);
  const minEpoW = Math.max(measureW('EPO', hdrPt, true) + padX * 2 + 0.8, 13 * scale);

  const maxPatientNameW = Math.max(
    45 * scale,
    ...allRows.map((r) => measureW(r.entry.patientName, bodyPt, true) + padX * 2 + 1)
  );

  const targetTransfusionW = hasTransfusionNotes ? Math.max(minTransfusionW, 30 * scale) : minTransfusionW;
  const targetEpoW = hasEpoNotes ? Math.max(minEpoW, 24 * scale) : minEpoW;

  if (maxPatientNameW + targetTransfusionW + targetEpoW <= remaining) {
    // Plenty of room on A3: give Nama Pasien generous width and distribute any surplus proportionally
    const surplus = remaining - (maxPatientNameW + targetTransfusionW + targetEpoW);
    widths[1] = maxPatientNameW + surplus * 0.72;
    widths[17] = targetTransfusionW + surplus * (hasTransfusionNotes ? 0.18 : 0.14);
    widths[18] = targetEpoW + surplus * (hasTransfusionNotes ? 0.1 : 0.14);
  } else {
    const flexTotal = maxPatientNameW + targetTransfusionW + targetEpoW;
    widths[1] = Math.max(42 * scale, (remaining * maxPatientNameW) / flexTotal);
    widths[17] = Math.max(minTransfusionW, (remaining * targetTransfusionW) / flexTotal);
    widths[18] = Math.max(minEpoW, (remaining * targetEpoW) / flexTotal);
  }

  // Exact normalization to PRINT_W_MM
  const actualSum = widths.reduce((a, b) => a + b, 0);
  if (Math.abs(actualSum - PRINT_W_MM) > 0.01) {
    const flexCols = [1, 17, 18];
    const fixedSum = fitIndices.reduce((sum, idx) => sum + widths[idx], 0);
    const targetFlexSum = PRINT_W_MM - fixedSum;
    const currentFlexSum = flexCols.reduce((sum, idx) => sum + widths[idx], 0);
    if (targetFlexSum > 45 && currentFlexSum > 0) {
      const ratio = targetFlexSum / currentFlexSum;
      for (const idx of flexCols) widths[idx] *= ratio;
    } else {
      const ratio = PRINT_W_MM / actualSum;
      for (let i = 0; i < widths.length; i++) widths[i] *= ratio;
    }
  }

  return widths;
}

function buildLayoutPlan(
  doc: jsPDF,
  pageRows: PatientReportPdfRow[],
  colWidths: number[],
  summaryStats: PatientReportPdfSummary | null,
  meta: PatientReportPdfMeta,
  scale: number,
  totalShiftPatients: number,
  pageInfoLabel: string,
  bannerTitle = 'LOGBOOK DETAIL PELAYANAN ASUHAN PASIEN HEMODIALISIS'
): LayoutPlan {
  const bodyPt = 9.0 * scale;
  const subPt = 7.6 * scale;
  const hdr1Pt = 7.6 * scale;
  const hdr2Pt = 7.2 * scale;
  const bannerTitlePt = Math.max(9.5, 11.8 * Math.min(1.12, scale + 0.04));
  const bannerMetaPt = Math.max(7.5, 8.8 * Math.min(1.1, scale + 0.04));

  const padX = Math.max(1.1, 1.8 * scale);
  const padY = Math.max(0.85, 1.45 * scale);

  // Banner measurement
  const bannerPadX = 3.8;
  const bannerPadY = Math.max(2.2, 2.8 * scale);
  const bannerTextW = PRINT_W_MM - bannerPadX * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(bannerTitlePt);
  const bannerTitleLines = doc.splitTextToSize(pdfSafe(bannerTitle), bannerTextW) as string[];

  const metaLineText = pdfSafe(
    `Shift: ${meta.shiftLabel}  |  Hari/Tanggal: ${meta.dateLabel}  |  PJ Shift: ${meta.pjShift}  |  DPJP: ${meta.dpjpLabel}  |  Ka. Ruang: ${meta.kaRuang}  |  Total Logbook: ${totalShiftPatients} pasien (${meta.nurseCount} perawat)  |  ${pageInfoLabel}`
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(bannerMetaPt);
  const bannerMetaLines = doc.splitTextToSize(metaLineText, bannerTextW) as string[];

  const bannerHeightMm =
    bannerPadY * 2 +
    bannerTitleLines.length * lineHeightMm(bannerTitlePt, 1.18) +
    0.9 +
    bannerMetaLines.length * lineHeightMm(bannerMetaPt, 1.2);

  // Header Row 1 & Row 2 measurement
  const hdr1LH = lineHeightMm(hdr1Pt, 1.16);
  const hdr2LH = lineHeightMm(hdr2Pt, 1.16);
  const hdrPadY = Math.max(0.9, 1.35 * scale);

  const hdrRow1Lines: string[][] = [];
  let maxRowSpan2H = 0;
  let maxGroupHdr1H = 0;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(hdr1Pt);
  for (const grp of GROUP_HEADERS) {
    let spanW = 0;
    for (let c = grp.startCol; c < grp.startCol + grp.span; c++) spanW += colWidths[c];
    const lines = doc.splitTextToSize(grp.label, Math.max(6, spanW - padX * 2)) as string[];
    hdrRow1Lines.push(lines);
    const neededH = lines.length * hdr1LH + hdrPadY * 2;
    if (grp.rowSpan2) maxRowSpan2H = Math.max(maxRowSpan2H, neededH);
    else maxGroupHdr1H = Math.max(maxGroupHdr1H, neededH);
  }

  const hdrRow2Lines: string[][] = [];
  let maxSubHdr2H = 0;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(hdr2Pt);
  for (let i = 0; i < SUB_HEADERS.length; i++) {
    const colIdx = i + 2;
    const lines = doc.splitTextToSize(
      SUB_HEADERS[i],
      Math.max(5, colWidths[colIdx] - padX * 2)
    ) as string[];
    hdrRow2Lines.push(lines);
    maxSubHdr2H = Math.max(maxSubHdr2H, lines.length * hdr2LH + hdrPadY * 2);
  }

  let hdrRow1H = Math.max(maxGroupHdr1H, hdr1LH + hdrPadY * 2);
  let hdrRow2H = Math.max(maxSubHdr2H, hdr2LH + hdrPadY * 2);
  if (hdrRow1H + hdrRow2H < maxRowSpan2H) {
    const extra = maxRowSpan2H - (hdrRow1H + hdrRow2H);
    hdrRow1H += extra / 2;
    hdrRow2H += extra / 2;
  }

  // Body rows
  const bodyLH = lineHeightMm(bodyPt, 1.2);
  const subLH = lineHeightMm(subPt, 1.18);
  const builtRows: BuiltRowCells[] = [];

  for (const r of pageRows) {
    const s = r.entry;
    const isIsolasi = /isolasi|hep/i.test(r.roomCategory);
    const colLines: string[][] = new Array(NUM_MAIN_COLS).fill(null).map(() => []);
    const colSubLines: Array<string[] | null> = new Array(NUM_MAIN_COLS).fill(null);

    const wrapCell = (colIdx: number, txt: string, pt: number, bold = false): string[] => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(pt);
      const maxW = Math.max(4, colWidths[colIdx] - padX * 2);
      return doc.splitTextToSize(pdfSafe(txt), maxW) as string[];
    };

    colLines[0] = wrapCell(0, r.bedMachine, bodyPt, true);
    colLines[1] = wrapCell(1, s.patientName, bodyPt, true);
    colSubLines[1] = wrapCell(1, s.patientRm || '-', subPt, false);
    colLines[2] = wrapCell(2, r.statusRawat, bodyPt, true);
    colLines[3] = wrapCell(3, r.roomCategory, bodyPt, isIsolasi);
    colLines[4] = wrapCell(4, r.vascularAccessLabel, bodyPt, true);
    if (r.vascularAccessNote) {
      colSubLines[4] = wrapCell(4, r.vascularAccessNote, subPt, false);
    }
    colLines[5] = wrapCell(5, fmtNum(r.durationHours, 1), bodyPt);
    colLines[6] = wrapCell(6, fmtNum(s.preWeight, 1), bodyPt);
    colLines[7] = wrapCell(7, fmtNum(s.postWeight, 1), bodyPt);
    colLines[8] = wrapCell(8, fmtNum(r.dryWeight, 1), bodyPt);
    colLines[9] = wrapCell(9, r.qbVal !== null ? fmtInt(r.qbVal) : '-', bodyPt);
    colLines[10] = wrapCell(10, r.qdVal !== null ? fmtInt(r.qdVal) : '-', bodyPt);
    colLines[11] = wrapCell(11, r.heparinDisplay, bodyPt);
    colLines[12] = wrapCell(12, fmtInt(s.ufGoal), bodyPt);
    colLines[13] = wrapCell(13, r.ktvDisplay, bodyPt);
    colLines[14] = wrapCell(14, fmtInt(s.ufAchieved), bodyPt, true);
    colLines[15] = wrapCell(15, s.preBp || '-', bodyPt);
    colLines[16] = wrapCell(16, s.postBp || '-', bodyPt);

    if (r.transfusionGiven === null) {
      colLines[17] = ['-'];
    } else if (r.transfusionGiven) {
      colLines[17] = ['Ya'];
      if (r.transfusionNote) colSubLines[17] = wrapCell(17, r.transfusionNote, subPt, false);
    } else {
      colLines[17] = ['Tidak'];
    }

    if (r.epoGiven === null) {
      colLines[18] = ['-'];
    } else if (r.epoGiven) {
      colLines[18] = ['Ya'];
      if (r.epoNote) colSubLines[18] = wrapCell(18, r.epoNote, subPt, false);
    } else {
      colLines[18] = ['Tidak'];
    }

    colLines[19] = wrapCell(19, s.nurseName, bodyPt, true);
    colSubLines[19] = wrapCell(19, `Shift ${s.shift}`, subPt, false);

    let maxContentH = bodyLH;
    for (let c = 0; c < NUM_MAIN_COLS; c++) {
      let cellH = colLines[c].length * bodyLH;
      if (colSubLines[c] && colSubLines[c]!.length > 0) {
        cellH += 0.4 + colSubLines[c]!.length * subLH;
      }
      if (cellH > maxContentH) maxContentH = cellH;
    }

    builtRows.push({
      colLines,
      colSubLines,
      rowHeightMm: maxContentH + padY * 2,
      isIsolasi,
      transfusionGiven: r.transfusionGiven,
      epoGiven: r.epoGiven,
    });
  }

  // Footer row ("TOTAL & RATA-RATA")
  const footerVals = new Array<string>(NUM_MAIN_COLS).fill('-');
  if (summaryStats) {
    footerVals[5] = fmtNum(summaryStats.avgDurasi, 1);
    footerVals[6] = fmtNum(summaryStats.avgPreW, 1);
    footerVals[7] = fmtNum(summaryStats.avgPostW, 1);
    footerVals[8] = fmtNum(summaryStats.avgDry, 1);
    footerVals[9] = summaryStats.avgQb !== null ? fmtInt(summaryStats.avgQb) : '-';
    footerVals[10] = summaryStats.avgQd !== null ? fmtInt(summaryStats.avgQd) : '-';
    footerVals[12] = fmtInt(summaryStats.totalTargetUf);
    footerVals[14] = fmtInt(summaryStats.totalAchievedUf);
    footerVals[17] = summaryStats.transfusionCount > 0 ? `${summaryStats.transfusionCount} Ya` : '-';
    footerVals[18] = summaryStats.epoCount > 0 ? `${summaryStats.epoCount} Ya` : '-';
  }
  const footerH = summaryStats ? bodyLH + padY * 2.2 : 0;

  const totalHeightMm =
    bannerHeightMm +
    hdrRow1H +
    hdrRow2H +
    builtRows.reduce((sum, r) => sum + r.rowHeightMm, 0) +
    footerH;

  return {
    scale,
    colWidths,
    bannerHeightMm,
    bannerTitleLines,
    bannerMetaLines,
    hdrRow1H,
    hdrRow2H,
    hdrRow1Lines,
    hdrRow2Lines,
    rows: builtRows,
    footerH,
    footerVals,
    totalHeightMm,
    bodyPt,
    subPt,
    hdr1Pt,
    hdr2Pt,
    bannerTitlePt,
    bannerMetaPt,
    padX,
    padY,
  };
}

function drawBanner(doc: jsPDF, plan: LayoutPlan, startY: number): number {
  const { bannerHeightMm, bannerTitleLines, bannerMetaLines, bannerTitlePt, bannerMetaPt, scale } =
    plan;
  const padX = 3.8;
  const padY = Math.max(2.2, 2.8 * scale);

  doc.setFillColor(14, 58, 83); // #0e3a53
  doc.rect(MARGIN_MM, startY, PRINT_W_MM, bannerHeightMm, 'F');
  doc.setDrawColor(51, 65, 85);
  doc.setLineWidth(0.25);
  doc.line(MARGIN_MM, startY + bannerHeightMm, MARGIN_MM + PRINT_W_MM, startY + bannerHeightMm);

  let cy = startY + padY + bannerTitlePt * PT_TO_MM * 0.85;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(bannerTitlePt);
  doc.setTextColor(255, 255, 255);
  const titleLH = lineHeightMm(bannerTitlePt, 1.18);
  for (const line of bannerTitleLines) {
    doc.text(line, MARGIN_MM + padX, cy);
    cy += titleLH;
  }

  cy += 0.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(bannerMetaPt);
  doc.setTextColor(224, 242, 254); // sky-100
  const metaLH = lineHeightMm(bannerMetaPt, 1.2);
  for (const line of bannerMetaLines) {
    doc.text(line, MARGIN_MM + padX, cy);
    cy += metaLH;
  }

  return startY + bannerHeightMm;
}

function drawTableHeaders(doc: jsPDF, plan: LayoutPlan, startY: number): number {
  const { colWidths, hdrRow1H, hdrRow2H, hdrRow1Lines, hdrRow2Lines, hdr1Pt, hdr2Pt, padX } = plan;
  const hdr1LH = lineHeightMm(hdr1Pt, 1.16);
  const hdr2LH = lineHeightMm(hdr2Pt, 1.16);

  const colX: number[] = [];
  let cx = MARGIN_MM;
  for (const w of colWidths) {
    colX.push(cx);
    cx += w;
  }

  // Row 1 (#1b4f6e)
  doc.setLineWidth(0.18);
  GROUP_HEADERS.forEach((grp, idx) => {
    const x = colX[grp.startCol];
    let w = 0;
    for (let c = grp.startCol; c < grp.startCol + grp.span; c++) w += colWidths[c];
    const h = grp.rowSpan2 ? hdrRow1H + hdrRow2H : hdrRow1H;

    doc.setFillColor(27, 79, 110); // #1b4f6e
    doc.setDrawColor(45, 102, 135); // #2d6687
    doc.rect(x, startY, w, h, 'FD');

    const lines = hdrRow1Lines[idx];
    const totalTextH = lines.length * hdr1LH;
    let ty = startY + (h - totalTextH) / 2 + hdr1Pt * PT_TO_MM * 0.85;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hdr1Pt);
    doc.setTextColor(255, 255, 255);
    const isLeft = grp.startCol === 1;
    for (const line of lines) {
      if (isLeft) doc.text(line, x + padX, ty);
      else doc.text(line, x + w / 2, ty, { align: 'center' });
      ty += hdr1LH;
    }
  });

  // Row 2 (#236084)
  const y2 = startY + hdrRow1H;
  for (let i = 0; i < SUB_HEADERS.length; i++) {
    const colIdx = i + 2;
    const x = colX[colIdx];
    const w = colWidths[colIdx];

    doc.setFillColor(35, 96, 132); // #236084
    doc.setDrawColor(52, 117, 155); // #34759b
    doc.rect(x, y2, w, hdrRow2H, 'FD');

    const lines = hdrRow2Lines[i];
    const totalTextH = lines.length * hdr2LH;
    let ty = y2 + (hdrRow2H - totalTextH) / 2 + hdr2Pt * PT_TO_MM * 0.85;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hdr2Pt);
    doc.setTextColor(255, 255, 255);
    const isLeft = colIdx === 4 || colIdx === 11;
    for (const line of lines) {
      if (isLeft) doc.text(line, x + padX, ty);
      else doc.text(line, x + w / 2, ty, { align: 'center' });
      ty += hdr2LH;
    }
  }

  return startY + hdrRow1H + hdrRow2H;
}

function drawBodyRow(
  doc: jsPDF,
  plan: LayoutPlan,
  row: BuiltRowCells,
  rowIdx: number,
  y: number
): number {
  const { colWidths, bodyPt, subPt, padX } = plan;
  const bodyLH = lineHeightMm(bodyPt, 1.2);
  const subLH = lineHeightMm(subPt, 1.18);
  const h = row.rowHeightMm;
  const isEven = rowIdx % 2 === 0;

  let cx = MARGIN_MM;
  for (let c = 0; c < NUM_MAIN_COLS; c++) {
    const w = colWidths[c];

    if (c === 17 && row.transfusionGiven === true) {
      doc.setFillColor(254, 242, 242); // rose-50
    } else if (c === 18 && row.epoGiven === true) {
      doc.setFillColor(240, 253, 250); // teal-50
    } else if (isEven) {
      doc.setFillColor(255, 255, 255);
    } else {
      doc.setFillColor(248, 250, 252); // slate-50
    }

    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.16);
    doc.rect(cx, y, w, h, 'FD');

    const lines = row.colLines[c];
    const subLines = row.colSubLines[c];
    const isLeftAlign = c === 1 || c === 4 || c === 11 || c === 19;

    let totalContentH = lines.length * bodyLH;
    if (subLines && subLines.length > 0) {
      totalContentH += 0.4 + subLines.length * subLH;
    }
    let ty = y + (h - totalContentH) / 2 + bodyPt * PT_TO_MM * 0.85;

    const isBold =
      c === 0 ||
      c === 1 ||
      c === 2 ||
      (c === 3 && row.isIsolasi) ||
      c === 4 ||
      c === 14 ||
      (c === 17 && row.transfusionGiven === true) ||
      (c === 18 && row.epoGiven === true) ||
      c === 19;

    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(bodyPt);

    if (c === 17 && row.transfusionGiven === true) {
      doc.setTextColor(190, 18, 60); // rose-700
    } else if (c === 18 && row.epoGiven === true) {
      doc.setTextColor(15, 118, 110); // teal-700
    } else if (
      c === 13 ||
      (c === 17 && row.transfusionGiven === false) ||
      (c === 18 && row.epoGiven === false)
    ) {
      doc.setTextColor(71, 85, 105); // slate-600
    } else {
      doc.setTextColor(15, 23, 42); // slate-900
    }

    for (const l of lines) {
      if (isLeftAlign) doc.text(l, cx + padX, ty);
      else doc.text(l, cx + w / 2, ty, { align: 'center' });
      ty += bodyLH;
    }

    if (subLines && subLines.length > 0) {
      ty += 0.4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(subPt);
      doc.setTextColor(100, 116, 139); // slate-500
      for (const sl of subLines) {
        if (isLeftAlign) doc.text(sl, cx + padX, ty);
        else doc.text(sl, cx + w / 2, ty, { align: 'center' });
        ty += subLH;
      }
    }

    cx += w;
  }

  return y + h;
}

function drawFooterRow(doc: jsPDF, plan: LayoutPlan, y: number): number {
  const { colWidths, footerH, footerVals, bodyPt } = plan;
  if (footerH <= 0) return y;

  const bodyLH = lineHeightMm(bodyPt, 1.2);
  const ty = y + (footerH - bodyLH) / 2 + bodyPt * PT_TO_MM * 0.85;

  doc.setFillColor(241, 245, 249); // slate-100
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.setLineWidth(0.2);

  let cx = MARGIN_MM;
  // Merged cols 0..1: TOTAL & RATA-RATA
  const w01 = colWidths[0] + colWidths[1];
  doc.rect(cx, y, w01, footerH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(bodyPt);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL & RATA-RATA', cx + w01 / 2, ty, { align: 'center' });
  cx += w01;

  // Merged cols 2..4: Ringkasan Shift
  const w24 = colWidths[2] + colWidths[3] + colWidths[4];
  doc.rect(cx, y, w24, footerH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(6.4, bodyPt * 0.9));
  doc.setTextColor(100, 116, 139);
  doc.text('Ringkasan Shift', cx + w24 / 2, ty, { align: 'center' });
  cx += w24;

  // Individual cols 5..19
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(bodyPt);
  doc.setTextColor(15, 23, 42);
  for (let c = 5; c < NUM_MAIN_COLS; c++) {
    const w = colWidths[c];
    doc.rect(cx, y, w, footerH, 'FD');
    doc.text(footerVals[c] || '-', cx + w / 2, ty, { align: 'center' });
    cx += w;
  }

  return y + footerH;
}

interface ComplicationEpisode {
  no: number;
  patientName: string;
  patientRm: string;
  complication: string;
  time: string;
  advice: string;
}

function buildComplicationEpisodes(rows: PatientReportPdfRow[]): ComplicationEpisode[] {
  const list: ComplicationEpisode[] = [];
  let seq = 1;
  for (const r of rows) {
    if (!r.hasComplication) continue;
    const count = r.complicationLines.length;
    for (let i = 0; i < count; i++) {
      const adv =
        i === count - 1 && r.dpjpAdviceLines.length > count
          ? r.dpjpAdviceLines.slice(i).join('; ')
          : r.dpjpAdviceLines[i] || (r.dpjpAdviceLines.length === 1 ? r.dpjpAdviceLines[0] : '-');
      list.push({
        no: seq++,
        patientName: r.entry.patientName,
        patientRm: r.entry.patientRm || '-',
        complication: r.complicationLines[i] || '-',
        time: r.compTimeLines[i] || r.compTimeLines[0] || '-',
        advice: adv || '-',
      });
    }
  }
  return list;
}

function drawComplicationHeaders(
  doc: jsPDF,
  colWidths: number[],
  y: number,
  hdr1Pt: number,
  hdr2Pt: number
): number {
  const hdr1LH = lineHeightMm(hdr1Pt, 1.18);
  const hdr2LH = lineHeightMm(hdr2Pt, 1.18);
  const hdr1H = hdr1LH + 3.4;
  const hdr2H = hdr2LH + 3.2;

  doc.setLineWidth(0.2);
  doc.setFillColor(27, 79, 110); // #1b4f6e
  doc.setDrawColor(45, 102, 135);
  doc.rect(MARGIN_MM, y, PRINT_W_MM, hdr1H, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(hdr1Pt);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'KOMPLIKASI, TATALAKSANA & ADVIS DPJP',
    MARGIN_MM + PRINT_W_MM / 2,
    y + (hdr1H - hdr1LH) / 2 + hdr1Pt * PT_TO_MM * 0.85,
    { align: 'center' }
  );

  const labels = ['NO', 'NAMA', 'KOMPLIKASI INTRA-HD', 'JAM', 'TINDAKAN & ADVIS MEDIS DPJP'];
  const y2 = y + hdr1H;
  let cx = MARGIN_MM;
  for (let i = 0; i < colWidths.length; i++) {
    const w = colWidths[i];
    doc.setFillColor(35, 96, 132); // #236084
    doc.setDrawColor(52, 117, 155);
    doc.rect(cx, y2, w, hdr2H, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hdr2Pt);
    doc.setTextColor(255, 255, 255);
    const ty = y2 + (hdr2H - hdr2LH) / 2 + hdr2Pt * PT_TO_MM * 0.85;
    if (i === 1 || i === 2 || i === 4) {
      doc.text(labels[i], cx + 2.8, ty);
    } else {
      doc.text(labels[i], cx + w / 2, ty, { align: 'center' });
    }
    cx += w;
  }

  return y + hdr1H + hdr2H;
}

function drawStaffSummaryTable(
  doc: jsPDF,
  rows: PatientReportPdfRow[],
  meta: PatientReportPdfMeta,
  startY: number
): number {
  const hdrPt = 9.2;
  const labelPt = 9.2;
  const valPt = 9.6;
  const bigStatPt = 11.5;

  const hdrLH = lineHeightMm(hdrPt, 1.18);
  const hdrH = hdrLH + 3.4;

  // Compute patient classification counts
  let rawatJalanCount = 0;
  let rawatInapCount = 0;
  let isolasiCount = 0;
  for (const r of rows) {
    if (r.statusRawat === 'RI') rawatInapCount += 1;
    else rawatJalanCount += 1;
    if (/isolasi|hep/i.test(r.roomCategory)) isolasiCount += 1;
  }

  const leftColLabelW = 46;
  const leftColValW = 158;
  const rightColLabelW = 46;
  const rightColValW = PRINT_W_MM - leftColLabelW - leftColValW - rightColLabelW; // 158mm

  const padX = 3.2;
  const padY = 2.2;
  const valLH = lineHeightMm(valPt, 1.24);
  const leftEntries = [
    { label: 'DOKTER DPJP', val: meta.dpjpLabel || '-' },
    { label: 'DOKTER UMUM', val: meta.dutyDoctorLabel || '-' },
    { label: 'KEPALA RUANG', val: meta.kaRuang || '-' },
    { label: 'PJ SHIFT', val: meta.pjShift || '-' },
  ];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(valPt);
  const leftWrapped = leftEntries.map((item) => {
    const lines = doc.splitTextToSize(pdfSafe(item.val), leftColValW - padX * 2) as string[];
    const rowH = Math.max(9.2, lines.length * valLH + padY * 2);
    return { ...item, lines, rowH };
  });

  // Top Header Row
  doc.setLineWidth(0.2);
  doc.setFillColor(27, 79, 110); // #1b4f6e
  doc.setDrawColor(45, 102, 135);
  doc.rect(MARGIN_MM, startY, PRINT_W_MM, hdrH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(hdrPt);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'STAFF BERTUGAS & TOTAL PASIEN',
    MARGIN_MM + PRINT_W_MM / 2,
    startY + (hdrH - hdrLH) / 2 + hdrPt * PT_TO_MM * 0.85,
    { align: 'center' }
  );

  let cy = startY + hdrH;
  const leftX0 = MARGIN_MM;
  const leftX1 = leftX0 + leftColLabelW;
  const rightX0 = leftX1 + leftColValW;
  const rightX1 = rightX0 + rightColLabelW;

  // Draw Left 4 rows
  let rowY = cy;
  leftWrapped.forEach((item, idx) => {
    doc.setFillColor(35, 96, 132); // #236084
    doc.setDrawColor(52, 117, 155);
    doc.rect(leftX0, rowY, leftColLabelW, item.rowH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(labelPt);
    doc.setTextColor(255, 255, 255);
    const labelLH = lineHeightMm(labelPt, 1.2);
    doc.text(
      item.label,
      leftX0 + padX,
      rowY + (item.rowH - labelLH) / 2 + labelPt * PT_TO_MM * 0.85
    );

    if (idx % 2 === 0) doc.setFillColor(255, 255, 255);
    else doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.rect(leftX1, rowY, leftColValW, item.rowH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(valPt);
    doc.setTextColor(15, 23, 42);
    const totalTextH = item.lines.length * valLH;
    let ty = rowY + (item.rowH - totalTextH) / 2 + valPt * PT_TO_MM * 0.85;
    for (const line of item.lines) {
      doc.text(line, leftX1 + padX, ty);
      ty += valLH;
    }

    rowY += item.rowH;
  });

  // Draw Right 2 merged blocks (TOTAL PERAWAT spans rows 0..1; TOTAL PASIEN spans rows 2..3)
  const topBlockH = leftWrapped[0].rowH + leftWrapped[1].rowH;
  const botBlockH = leftWrapped[2].rowH + leftWrapped[3].rowH;

  // Block 1: TOTAL PERAWAT
  doc.setFillColor(35, 96, 132);
  doc.setDrawColor(52, 117, 155);
  doc.rect(rightX0, cy, rightColLabelW, topBlockH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelPt);
  doc.setTextColor(255, 255, 255);
  const lblLH = lineHeightMm(labelPt, 1.2);
  doc.text(
    'TOTAL PERAWAT',
    rightX0 + rightColLabelW / 2,
    cy + (topBlockH - lblLH) / 2 + labelPt * PT_TO_MM * 0.85,
    { align: 'center' }
  );

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.rect(rightX1, cy, rightColValW, topBlockH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(bigStatPt);
  doc.setTextColor(15, 23, 42);
  const bigLH = lineHeightMm(bigStatPt, 1.22);
  doc.text(
    `${meta.nurseCount} PERAWAT`,
    rightX1 + rightColValW / 2,
    cy + (topBlockH - bigLH) / 2 + bigStatPt * PT_TO_MM * 0.85,
    { align: 'center' }
  );

  // Block 2: TOTAL PASIEN
  const botY = cy + topBlockH;
  doc.setFillColor(35, 96, 132);
  doc.setDrawColor(52, 117, 155);
  doc.rect(rightX0, botY, rightColLabelW, botBlockH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelPt);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'TOTAL PASIEN',
    rightX0 + rightColLabelW / 2,
    botY + (botBlockH - lblLH) / 2 + labelPt * PT_TO_MM * 0.85,
    { align: 'center' }
  );

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(rightX1, botY, rightColValW, botBlockH, 'FD');

  const patientLines = [
    `${rawatJalanCount} PASIEN RAWAT JALAN`,
    `${rawatInapCount} PASIEN RAWAT INAP`,
    ...(isolasiCount > 0 ? [`(${isolasiCount} PASIEN RUANG ISOLASI)`] : []),
  ];
  const lineSpacingPt = isolasiCount > 0 ? 10.2 : 11.0;
  const pLH = lineHeightMm(lineSpacingPt, 1.28);
  const totalPH = patientLines.length * pLH;
  let py = botY + (botBlockH - totalPH) / 2 + lineSpacingPt * PT_TO_MM * 0.85;
  patientLines.forEach((pLine, pIdx) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(pIdx === 2 ? 8.8 : lineSpacingPt);
    doc.setTextColor(pIdx === 2 ? 71 : 15, pIdx === 2 ? 85 : 23, pIdx === 2 ? 105 : 42);
    doc.text(pLine, rightX1 + rightColValW / 2, py, { align: 'center' });
    py += pLH;
  });

  return botY + botBlockH;
}

function renderComplicationsAndStaffPage(
  doc: jsPDF,
  rows: PatientReportPdfRow[],
  meta: PatientReportPdfMeta
) {
  doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');

  const episodes = buildComplicationEpisodes(rows);
  const compCols = [14, 72, 145, 24, PRINT_W_MM - (14 + 72 + 145 + 24)]; // = 153mm
  const hdr1Pt = 9.4;
  const hdr2Pt = 8.4;
  const bodyPt = 9.5;
  const subPt = 8.0;
  const padX = 2.6;
  const padY = 1.9;
  const bodyLH = lineHeightMm(bodyPt, 1.24);
  const subLH = lineHeightMm(subPt, 1.18);
  const maxY = MARGIN_MM + PRINT_H_MM;

  let y = drawComplicationHeaders(doc, compCols, MARGIN_MM, hdr1Pt, hdr2Pt);

  if (episodes.length === 0) {
    const emptyH = 14;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.18);
    doc.rect(MARGIN_MM, y, PRINT_W_MM, emptyH, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.6);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Tidak ada komplikasi intra-HD yang tercatat pada shift / periode ini.',
      MARGIN_MM + PRINT_W_MM / 2,
      y + (emptyH - lineHeightMm(9.6, 1.2)) / 2 + 9.6 * PT_TO_MM * 0.85,
      { align: 'center' }
    );
    y += emptyH;
  } else {
    episodes.forEach((ep, idx) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(bodyPt);
      const nameLines = doc.splitTextToSize(pdfSafe(ep.patientName), compCols[1] - padX * 2) as string[];
      const compLines = doc.splitTextToSize(pdfSafe(ep.complication), compCols[2] - padX * 2) as string[];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(subPt);
      const rmLines = doc.splitTextToSize(pdfSafe(ep.patientRm), compCols[1] - padX * 2) as string[];
      doc.setFontSize(bodyPt);
      const timeLines = doc.splitTextToSize(pdfSafe(ep.time), compCols[3] - padX * 1.5) as string[];
      const advLines = doc.splitTextToSize(pdfSafe(ep.advice), compCols[4] - padX * 2) as string[];

      const nameBlockH = nameLines.length * bodyLH + 0.4 + rmLines.length * subLH;
      const compBlockH = compLines.length * bodyLH;
      const timeBlockH = timeLines.length * bodyLH;
      const advBlockH = advLines.length * bodyLH;
      const rowH = Math.max(nameBlockH, compBlockH, timeBlockH, advBlockH) + padY * 2;

      if (y + rowH > maxY) {
        doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');
        y = drawComplicationHeaders(doc, compCols, MARGIN_MM, hdr1Pt, hdr2Pt);
      }

      const isEven = idx % 2 === 0;
      let cx = MARGIN_MM;
      for (let c = 0; c < 5; c++) {
        const w = compCols[c];
        if (isEven) doc.setFillColor(255, 255, 255);
        else doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.18);
        doc.rect(cx, y, w, rowH, 'FD');

        if (c === 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(bodyPt);
          doc.setTextColor(15, 23, 42);
          const ty = y + (rowH - bodyLH) / 2 + bodyPt * PT_TO_MM * 0.85;
          doc.text(String(ep.no), cx + w / 2, ty, { align: 'center' });
        } else if (c === 1) {
          let ty = y + (rowH - nameBlockH) / 2 + bodyPt * PT_TO_MM * 0.85;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(bodyPt);
          doc.setTextColor(15, 23, 42);
          for (const nl of nameLines) {
            doc.text(nl, cx + padX, ty);
            ty += bodyLH;
          }
          ty += 0.4;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(subPt);
          doc.setTextColor(100, 116, 139);
          for (const rl of rmLines) {
            doc.text(rl, cx + padX, ty);
            ty += subLH;
          }
        } else if (c === 2) {
          let ty = y + (rowH - compBlockH) / 2 + bodyPt * PT_TO_MM * 0.85;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(bodyPt);
          doc.setTextColor(190, 18, 60); // rose-700
          for (const cl of compLines) {
            doc.text(cl, cx + padX, ty);
            ty += bodyLH;
          }
        } else if (c === 3) {
          let ty = y + (rowH - timeBlockH) / 2 + bodyPt * PT_TO_MM * 0.85;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(bodyPt);
          doc.setTextColor(15, 23, 42);
          for (const tl of timeLines) {
            doc.text(tl, cx + w / 2, ty, { align: 'center' });
            ty += bodyLH;
          }
        } else {
          let ty = y + (rowH - advBlockH) / 2 + bodyPt * PT_TO_MM * 0.85;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(bodyPt);
          doc.setTextColor(15, 23, 42);
          for (const al of advLines) {
            doc.text(al, cx + padX, ty);
            ty += bodyLH;
          }
        }

        cx += w;
      }

      y += rowH;
    });
  }

  // Staff Bertugas & Total Pasien block (~46mm tall); start new page if tight
  const estimatedStaffBlockH = 48;
  const staffStartY = y + 7;
  if (staffStartY + estimatedStaffBlockH > maxY) {
    doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');
    drawStaffSummaryTable(doc, rows, meta, MARGIN_MM);
  } else {
    drawStaffSummaryTable(doc, rows, meta, staffStartY);
  }
}

function renderFixedSinglePage(doc: jsPDF, plan: LayoutPlan, addNewPage: boolean) {
  if (addNewPage) {
    doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');
  }
  let y = drawBanner(doc, plan, MARGIN_MM);
  y = drawTableHeaders(doc, plan, y);
  plan.rows.forEach((row, idx) => {
    y = drawBodyRow(doc, plan, row, idx, y);
  });
  drawFooterRow(doc, plan, y);
}

export function exportPatientServicesPdf({
  rows,
  summaryStats,
  meta,
  filename,
}: {
  rows: PatientReportPdfRow[];
  summaryStats: PatientReportPdfSummary | null;
  meta: PatientReportPdfMeta;
  filename: string;
}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM],
    compress: true,
  });
  applyRotateLeft270(doc);

  if (rows.length === 0) {
    const widths = computeAllColumnWidths(doc, [], null, 1.0);
    const plan = buildLayoutPlan(doc, [], widths, null, meta, 1.0, 0, 'Halaman 1 dari 2');
    const yAfterBanner = drawBanner(doc, plan, MARGIN_MM);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada logbook yang diinput perawat untuk tanggal dan shift yang dipilih.',
      MARGIN_MM + PRINT_W_MM / 2,
      yAfterBanner + 24,
      { align: 'center' }
    );
    renderComplicationsAndStaffPage(doc, rows, meta);
    doc.save(sanitizeFilename(filename));
    return;
  }

  // Page 1: Optimize scale so ALL patients + TOTAL & RATA-RATA footer fit cleanly on 1 A3 Landscape page
  let fittedPage1: LayoutPlan | null = null;
  for (let s = 1.14; s >= 0.64; s -= 0.02) {
    const scale = Number(s.toFixed(3));
    const widths = computeAllColumnWidths(doc, rows, summaryStats, scale);
    const candidate = buildLayoutPlan(
      doc,
      rows,
      widths,
      summaryStats,
      meta,
      scale,
      rows.length,
      `Halaman 1 dari 2 (${rows.length} Pasien)`
    );
    if (candidate.totalHeightMm <= PRINT_H_MM - 0.5) {
      fittedPage1 = candidate;
      break;
    }
  }

  if (fittedPage1) {
    renderFixedSinglePage(doc, fittedPage1, false);
  } else {
    // Fallback pagination only for massive multi-month archive exports (> ~45 rows)
    const fallbackScale = 0.9;
    const widths = computeAllColumnWidths(doc, rows, summaryStats, fallbackScale);
    const fullPlan = buildLayoutPlan(
      doc,
      rows,
      widths,
      summaryStats,
      meta,
      fallbackScale,
      rows.length,
      `Rekap ${rows.length} Pasien`
    );

    let y = drawBanner(doc, fullPlan, MARGIN_MM);
    y = drawTableHeaders(doc, fullPlan, y);
    const maxY = MARGIN_MM + PRINT_H_MM;
    fullPlan.rows.forEach((row, idx) => {
      if (y + row.rowHeightMm > maxY) {
        doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');
        y = drawTableHeaders(doc, fullPlan, MARGIN_MM);
      }
      y = drawBodyRow(doc, fullPlan, row, idx, y);
    });
    if (fullPlan.footerH > 0) {
      if (y + fullPlan.footerH > maxY) {
        doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');
        y = drawTableHeaders(doc, fullPlan, MARGIN_MM);
      }
      drawFooterRow(doc, fullPlan, y);
    }
  }

  // Page 2: Dedicated Complications, Management & DPJP Advice + Staff Bertugas & Total Pasien
  renderComplicationsAndStaffPage(doc, rows, meta);

  doc.save(sanitizeFilename(filename));
}

export function exportPatientSoapPdf({
  notes,
  meta,
  filename,
}: {
  notes: ReportEntry[];
  meta: PatientReportPdfMeta;
  filename: string;
}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM],
    compress: true,
  });
  applyRotateLeft270(doc);

  const dummyWidths = computeAllColumnWidths(doc, [], null, 1.0);
  const dummyPlan = buildLayoutPlan(
    doc,
    [],
    dummyWidths,
    null,
    meta,
    1.0,
    notes.length,
    'Catatan SOAP',
    'CATATAN PERKEMBANGAN PASIEN TERINTEGRASI (SOAP) HEMODIALISIS'
  );
  let y = drawBanner(doc, dummyPlan, MARGIN_MM) + 4.5;

  if (notes.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada catatan perkembangan SOAP untuk periode ini.',
      MARGIN_MM + PRINT_W_MM / 2,
      y + 18,
      { align: 'center' }
    );
    doc.save(sanitizeFilename(filename));
    return;
  }

  const colGap = 5;
  const colW = (PRINT_W_MM - colGap) / 2;
  const maxY = MARGIN_MM + PRINT_H_MM;
  const soapFieldPt = 9.0;
  const soapFieldLH = 4.2;

  for (const r of notes) {
    const fields = [
      { label: 'S (Subjektif)', val: r.soapSubjective || '-' },
      { label: 'O (Objektif)', val: r.soapObjective || '-' },
      { label: 'A (Asesmen)', val: r.soapAssessment || '-' },
      { label: 'P (Plan / Intervensi)', val: r.soapPlan || '-' },
    ];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(soapFieldPt);
    const wrappedFields = fields.map((f) => ({
      label: f.label,
      lines: doc.splitTextToSize(pdfSafe(f.val), colW - 8) as string[],
    }));
    const row1Lines = Math.max(wrappedFields[0].lines.length, wrappedFields[1].lines.length);
    const row2Lines = Math.max(wrappedFields[2].lines.length, wrappedFields[3].lines.length);
    const orderText =
      r.medicalOrder && r.medicalOrder !== '-'
        ? (doc.splitTextToSize(
            pdfSafe(`Instruksi / Order Medis DPJP: ${r.medicalOrder}`),
            PRINT_W_MM - 10
          ) as string[])
        : [];
    const cardH =
      16 +
      row1Lines * soapFieldLH +
      11 +
      row2Lines * soapFieldLH +
      (orderText.length > 0 ? 6 + orderText.length * soapFieldLH : 0);

    if (y + cardH > maxY) {
      doc.addPage([A3_LANDSCAPE_H_MM, A3_LANDSCAPE_W_MM], 'landscape');
      y = MARGIN_MM;
    }

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, cardH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(`${r.patientName} (${r.patientRm})`), MARGIN_MM + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      pdfSafe(`${formatDateId(r.date)} · Dicatat oleh ${r.authorName} (${r.authorRole})`),
      MARGIN_MM + 4,
      y + 10.4
    );

    const drawBox = (bx: number, by: number, bw: number, bh: number, title: string, lines: string[]) => {
      doc.setFillColor(248, 250, 252);
      doc.rect(bx, by, bw, bh, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(soapFieldPt);
      doc.setTextColor(30, 41, 59);
      doc.text(title, bx + 2.8, by + 4.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      let ly = by + 9.2;
      for (const line of lines) {
        doc.text(line, bx + 2.8, ly);
        ly += soapFieldLH;
      }
    };

    const box1H = 7 + row1Lines * soapFieldLH;
    const box2H = 7 + row2Lines * soapFieldLH;
    drawBox(MARGIN_MM + 4, y + 13, colW - 4.5, box1H, wrappedFields[0].label, wrappedFields[0].lines);
    drawBox(MARGIN_MM + 4 + colW + 0.5, y + 13, colW - 4.5, box1H, wrappedFields[1].label, wrappedFields[1].lines);
    drawBox(
      MARGIN_MM + 4,
      y + 13 + box1H + 2.8,
      colW - 4.5,
      box2H,
      wrappedFields[2].label,
      wrappedFields[2].lines
    );
    drawBox(
      MARGIN_MM + 4 + colW + 0.5,
      y + 13 + box1H + 2.8,
      colW - 4.5,
      box2H,
      wrappedFields[3].label,
      wrappedFields[3].lines
    );

    if (orderText.length > 0) {
      const oy = y + 13 + box1H + 2.8 + box2H + 2.8;
      const oh = 4.5 + orderText.length * soapFieldLH;
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(186, 230, 253);
      doc.rect(MARGIN_MM + 4, oy, PRINT_W_MM - 8, oh, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(soapFieldPt);
      doc.setTextColor(12, 74, 110);
      let ly = oy + 4.8;
      for (const line of orderText) {
        doc.text(line, MARGIN_MM + 6, ly);
        ly += soapFieldLH;
      }
    }

    y += cardH + 4;
  }

  doc.save(sanitizeFilename(filename));
}

const MOBILE_W_MM = 210;
const MOBILE_H_MM = 297;
const MOBILE_MARGIN_MM = 9;
const MOBILE_PRINT_W_MM = MOBILE_W_MM - MOBILE_MARGIN_MM * 2; // 192mm
const MOBILE_MAX_Y_MM = MOBILE_H_MM - 12;

function addMobilePageNumbers(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `HemoLog HDHL · Mode Mobile · Hal. ${i} / ${totalPages}`,
      MOBILE_W_MM - MOBILE_MARGIN_MM,
      MOBILE_H_MM - 5.5,
      { align: 'right' }
    );
  }
}

function drawMobileBanner(doc: jsPDF, title: string, meta: PatientReportPdfMeta, count: number): number {
  const padX = 4;
  const padY = 3.5;
  const textW = MOBILE_PRINT_W_MM - padX * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const titleLines = doc.splitTextToSize(pdfSafe(title), textW) as string[];

  const metaLinesRaw = [
    `Shift: ${meta.shiftLabel}  |  Tanggal: ${meta.dateLabel}`,
    `PJ Shift: ${meta.pjShift}  |  DPJP: ${meta.dpjpLabel}`,
    `Ka. Ruang: ${meta.kaRuang}  |  Total: ${count} catatan (${meta.nurseCount} perawat)`,
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const metaLines: string[] = [];
  for (const raw of metaLinesRaw) {
    metaLines.push(...(doc.splitTextToSize(pdfSafe(raw), textW) as string[]));
  }

  const titleLH = lineHeightMm(11, 1.2);
  const metaLH = lineHeightMm(8.5, 1.28);
  const bannerH = padY * 2 + titleLines.length * titleLH + 1.5 + metaLines.length * metaLH;

  doc.setFillColor(14, 58, 83); // #0e3a53
  doc.roundedRect(MOBILE_MARGIN_MM, MOBILE_MARGIN_MM, MOBILE_PRINT_W_MM, bannerH, 1.8, 1.8, 'F');

  let cy = MOBILE_MARGIN_MM + padY + 11 * PT_TO_MM * 0.85;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  for (const line of titleLines) {
    doc.text(line, MOBILE_MARGIN_MM + padX, cy);
    cy += titleLH;
  }

  cy += 1.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(224, 242, 254);
  for (const line of metaLines) {
    doc.text(line, MOBILE_MARGIN_MM + padX, cy);
    cy += metaLH;
  }

  return MOBILE_MARGIN_MM + bannerH + 3.5;
}

export function exportPatientServicesMobilePdf({
  rows,
  summaryStats,
  meta,
  filename,
}: {
  rows: PatientReportPdfRow[];
  summaryStats: PatientReportPdfSummary | null;
  meta: PatientReportPdfMeta;
  filename: string;
}) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  let y = drawMobileBanner(
    doc,
    'LOGBOOK DETAIL PELAYANAN PASIEN HEMODIALISIS',
    meta,
    rows.length
  );

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada logbook yang diinput perawat untuk tanggal dan shift yang dipilih.',
      MOBILE_MARGIN_MM + MOBILE_PRINT_W_MM / 2,
      y + 14,
      { align: 'center' }
    );
    addMobilePageNumbers(doc);
    doc.save(sanitizeFilename(filename));
    return;
  }

  // Compact Shift Summary Bar
  if (summaryStats) {
    const sumLines = [
      `Rata-rata: Durasi ${fmtNum(summaryStats.avgDurasi, 1)} jam · BB Pre/Post/Kering ${fmtNum(summaryStats.avgPreW, 1)}/${fmtNum(summaryStats.avgPostW, 1)}/${fmtNum(summaryStats.avgDry, 1)} kg · Qb/Qd ${summaryStats.avgQb !== null ? fmtInt(summaryStats.avgQb) : '-'}/${summaryStats.avgQd !== null ? fmtInt(summaryStats.avgQd) : '-'} ml/m`,
      `Total Target UF: ${fmtInt(summaryStats.totalTargetUf)} ml · Total Capaian UF: ${fmtInt(summaryStats.totalAchievedUf)} ml · Transfusi: ${summaryStats.transfusionCount} Ya · EPO: ${summaryStats.epoCount} Ya`,
    ];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    const wrappedSum = sumLines.flatMap((l) => doc.splitTextToSize(pdfSafe(l), MOBILE_PRINT_W_MM - 6) as string[]);
    const sumLH = lineHeightMm(8.2, 1.28);
    const sumH = 5.5 + wrappedSum.length * sumLH + 2;

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.roundedRect(MOBILE_MARGIN_MM, y, MOBILE_PRINT_W_MM, sumH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('RINGKASAN SHIFT', MOBILE_MARGIN_MM + 3, y + 4.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(51, 65, 85);
    let sy = y + 8;
    for (const wl of wrappedSum) {
      doc.text(wl, MOBILE_MARGIN_MM + 3, sy);
      sy += sumLH;
    }
    y += sumH + 3.5;
  }

  const labelPt = 8.2;
  const valPt = 8.8;
  const labelLH = lineHeightMm(labelPt, 1.26);
  const valLH = lineHeightMm(valPt, 1.28);
  const colGap = 3;
  const colW = (MOBILE_PRINT_W_MM - 6 - colGap * 2) / 3;

  rows.forEach((r, idx) => {
    const s = r.entry;
    const isIsolasi = /isolasi|hep/i.test(r.roomCategory);

    // Measure card header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.8);
    const titleStr = pdfSafe(`${idx + 1}. ${s.patientName} (${s.patientRm || '-'})`);
    const badgeStr = pdfSafe(`Bed/Mesin ${r.bedMachine} · ${r.statusRawat} · ${r.roomCategory}`);
    const titleLines = doc.splitTextToSize(titleStr, MOBILE_PRINT_W_MM - 6) as string[];
    const hdrH = 3.2 + titleLines.length * lineHeightMm(9.8, 1.2) + lineHeightMm(8.3, 1.2) + 2;

    // 3-column metrics content
    const c1Lines: string[] = [
      `Akses: ${r.vascularAccessLabel}${r.vascularAccessNote ? ` (${r.vascularAccessNote})` : ''}`,
      `Durasi: ${fmtNum(r.durationHours, 1)} jam`,
      `Qb / Qd: ${r.qbVal !== null ? fmtInt(r.qbVal) : '-'} / ${r.qdVal !== null ? fmtInt(r.qdVal) : '-'} ml/m`,
      `Heparin: ${r.heparinDisplay}`,
    ];
    const c2Lines: string[] = [
      `BB Pre / Post: ${fmtNum(s.preWeight, 1)} / ${fmtNum(s.postWeight, 1)} kg`,
      `BB Kering: ${fmtNum(r.dryWeight, 1)} kg · Kt/V: ${r.ktvDisplay}`,
      `Target UF: ${fmtInt(s.ufGoal)} ml`,
      `Capaian UF: ${fmtInt(s.ufAchieved)} ml`,
    ];
    const transfusiStr =
      r.transfusionGiven === null
        ? '-'
        : r.transfusionGiven
        ? `Ya${r.transfusionNote ? ` (${r.transfusionNote})` : ''}`
        : 'Tidak';
    const epoStr =
      r.epoGiven === null
        ? '-'
        : r.epoGiven
        ? `Ya${r.epoNote ? ` (${r.epoNote})` : ''}`
        : 'Tidak';
    const c3Lines: string[] = [
      `TD Pre HD: ${s.preBp || '-'} mmHg`,
      `TD Post HD: ${s.postBp || '-'} mmHg`,
      `Transfusi: ${transfusiStr}`,
      `EPO: ${epoStr}`,
    ];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(labelPt);
    const wrapCol = (items: string[]) =>
      items.flatMap((it) => doc.splitTextToSize(pdfSafe(it), colW - 1) as string[]);

    const w1 = wrapCol(c1Lines);
    const w2 = wrapCol(c2Lines);
    const w3 = wrapCol(c3Lines);
    const maxMetricLines = Math.max(w1.length, w2.length, w3.length);
    const metricsH = maxMetricLines * labelLH + 2.5;

    // Complication & Advice full-width blocks
    const compRawLines = r.complicationLines.map((line, i) => {
      const timeTag = r.compTimeLines[i] && r.compTimeLines[i] !== '-' ? ` [${r.compTimeLines[i]}]` : '';
      return r.complicationLines.length > 1 ? `${i + 1}. ${line}${timeTag}` : `${line}${timeTag}`;
    });
    const advRawLines = r.dpjpAdviceLines.map((line, i) =>
      r.dpjpAdviceLines.length > 1 ? `${i + 1}. ${line}` : line
    );

    doc.setFont('helvetica', r.hasComplication ? 'bold' : 'normal');
    doc.setFontSize(valPt);
    const compWrapped = compRawLines.flatMap(
      (l) => doc.splitTextToSize(pdfSafe(l), MOBILE_PRINT_W_MM - 10) as string[]
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(valPt);
    const advWrapped = advRawLines.flatMap(
      (l) => doc.splitTextToSize(pdfSafe(l), MOBILE_PRINT_W_MM - 10) as string[]
    );

    const compBoxH = 5.5 + compWrapped.length * valLH + 1.5;
    const advBoxH = 5.5 + advWrapped.length * valLH + 1.5;
    const footerLineH = 6;
    const cardH = hdrH + 2.5 + metricsH + 2 + compBoxH + 2 + advBoxH + footerLineH;

    if (y + cardH > MOBILE_MAX_Y_MM) {
      doc.addPage('a4', 'portrait');
      y = MOBILE_MARGIN_MM;
    }

    // Card outer box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.28);
    doc.roundedRect(MOBILE_MARGIN_MM, y, MOBILE_PRINT_W_MM, cardH, 1.8, 1.8, 'FD');

    // Card Header Band
    if (r.hasComplication) {
      doc.setFillColor(255, 228, 230);
    } else if (isIsolasi) {
      doc.setFillColor(254, 243, 199);
    } else {
      doc.setFillColor(241, 245, 249);
    }
    doc.roundedRect(MOBILE_MARGIN_MM, y, MOBILE_PRINT_W_MM, hdrH, 1.8, 1.8, 'F');
    doc.rect(MOBILE_MARGIN_MM, y + hdrH - 2, MOBILE_PRINT_W_MM, 2, 'F');

    let cy = y + 4.3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.8);
    doc.setTextColor(15, 23, 42);
    for (const tl of titleLines) {
      doc.text(tl, MOBILE_MARGIN_MM + 3, cy);
      cy += lineHeightMm(9.8, 1.2);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.3);
    if (isIsolasi) doc.setTextColor(180, 83, 9);
    else doc.setTextColor(11, 90, 142);
    doc.text(badgeStr, MOBILE_MARGIN_MM + 3, cy);

    // 3-Column Metrics
    const metricsTop = y + hdrH + 3.2;
    const cols = [w1, w2, w3];
    cols.forEach((lines, colIdx) => {
      const cx = MOBILE_MARGIN_MM + 3 + colIdx * (colW + colGap);
      let ly = metricsTop;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(labelPt);
      doc.setTextColor(30, 41, 59);
      for (const l of lines) {
        doc.text(l, cx, ly);
        ly += labelLH;
      }
    });

    // Complication Box
    const compTop = y + hdrH + 2.5 + metricsH;
    if (r.hasComplication) {
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(254, 205, 211);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
    }
    doc.setLineWidth(0.2);
    doc.roundedRect(MOBILE_MARGIN_MM + 3, compTop, MOBILE_PRINT_W_MM - 6, compBoxH, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(r.hasComplication ? 190 : 71, r.hasComplication ? 18 : 85, r.hasComplication ? 60 : 105);
    doc.text('Komplikasi Intra-HD:', MOBILE_MARGIN_MM + 5, compTop + 4);

    doc.setFont('helvetica', r.hasComplication ? 'bold' : 'normal');
    doc.setFontSize(valPt);
    doc.setTextColor(r.hasComplication ? 190 : 30, r.hasComplication ? 18 : 41, r.hasComplication ? 60 : 59);
    let compY = compTop + 4 + valLH;
    for (const l of compWrapped) {
      doc.text(l, MOBILE_MARGIN_MM + 5, compY);
      compY += valLH;
    }

    // Advis DPJP Box
    const advTop = compTop + compBoxH + 2;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(MOBILE_MARGIN_MM + 3, advTop, MOBILE_PRINT_W_MM - 6, advBoxH, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('Tindakan & Advis Medis DPJP:', MOBILE_MARGIN_MM + 5, advTop + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(valPt);
    doc.setTextColor(30, 41, 59);
    let advY = advTop + 4 + valLH;
    for (const l of advWrapped) {
      doc.text(l, MOBILE_MARGIN_MM + 5, advY);
      advY += valLH;
    }

    // Card Footer (Perawat Pelaksana)
    const footY = y + cardH - 2.3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(
      pdfSafe(`Perawat Pelaksana: ${s.nurseName} (Shift ${s.shift})`),
      MOBILE_MARGIN_MM + 3,
      footY
    );

    y += cardH + 3.2;
  });

  addMobilePageNumbers(doc);
  doc.save(sanitizeFilename(filename));
}

export function exportPatientSoapMobilePdf({
  notes,
  meta,
  filename,
}: {
  notes: ReportEntry[];
  meta: PatientReportPdfMeta;
  filename: string;
}) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  let y = drawMobileBanner(doc, 'CATATAN PERKEMBANGAN SOAP PASIEN HD', meta, notes.length);

  if (notes.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada catatan perkembangan SOAP untuk periode ini.',
      MOBILE_MARGIN_MM + MOBILE_PRINT_W_MM / 2,
      y + 14,
      { align: 'center' }
    );
    addMobilePageNumbers(doc);
    doc.save(sanitizeFilename(filename));
    return;
  }

  const soapLH = lineHeightMm(9, 1.3);

  for (const r of notes) {
    const fields = [
      { label: 'S (Subjektif)', val: r.soapSubjective || '-' },
      { label: 'O (Objektif)', val: r.soapObjective || '-' },
      { label: 'A (Asesmen)', val: r.soapAssessment || '-' },
      { label: 'P (Plan / Intervensi)', val: r.soapPlan || '-' },
    ];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const wrappedFields = fields.map((f) => ({
      label: f.label,
      lines: doc.splitTextToSize(pdfSafe(f.val), MOBILE_PRINT_W_MM - 10) as string[],
    }));

    const orderText =
      r.medicalOrder && r.medicalOrder !== '-'
        ? (doc.splitTextToSize(
            pdfSafe(`Instruksi / Order Medis DPJP: ${r.medicalOrder}`),
            MOBILE_PRINT_W_MM - 10
          ) as string[])
        : [];

    const fieldsHeight = wrappedFields.reduce(
      (sum, f) => sum + 5.5 + f.lines.length * soapLH + 2.2,
      0
    );
    const orderH = orderText.length > 0 ? 5 + orderText.length * soapLH + 2 : 0;
    const cardH = 13.5 + fieldsHeight + orderH + 2;

    if (y + cardH > MOBILE_MAX_Y_MM) {
      doc.addPage('a4', 'portrait');
      y = MOBILE_MARGIN_MM;
    }

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.28);
    doc.roundedRect(MOBILE_MARGIN_MM, y, MOBILE_PRINT_W_MM, cardH, 1.8, 1.8, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(`${r.patientName} (${r.patientRm})`), MOBILE_MARGIN_MM + 3.5, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      pdfSafe(`${formatDateId(r.date)} · Dicatat oleh ${r.authorName} (${r.authorRole})`),
      MOBILE_MARGIN_MM + 3.5,
      y + 9.8
    );

    let fy = y + 12.5;
    for (const f of wrappedFields) {
      const boxH = 5.5 + f.lines.length * soapLH;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(MOBILE_MARGIN_MM + 3.5, fy, MOBILE_PRINT_W_MM - 7, boxH, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(30, 41, 59);
      doc.text(f.label, MOBILE_MARGIN_MM + 5.5, fy + 4.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      let ly = fy + 4.2 + soapLH;
      for (const l of f.lines) {
        doc.text(l, MOBILE_MARGIN_MM + 5.5, ly);
        ly += soapLH;
      }
      fy += boxH + 2.2;
    }

    if (orderText.length > 0) {
      const oh = 4 + orderText.length * soapLH;
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(186, 230, 253);
      doc.roundedRect(MOBILE_MARGIN_MM + 3.5, fy, MOBILE_PRINT_W_MM - 7, oh, 1.2, 1.2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(12, 74, 110);
      let ly = fy + 4.5;
      for (const l of orderText) {
        doc.text(l, MOBILE_MARGIN_MM + 5.5, ly);
        ly += soapLH;
      }
    }

    y += cardH + 3.5;
  }

  addMobilePageNumbers(doc);
  doc.save(sanitizeFilename(filename));
}

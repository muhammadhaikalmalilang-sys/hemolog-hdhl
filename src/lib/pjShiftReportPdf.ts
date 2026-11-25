import { jsPDF } from 'jspdf';
import type { ReportSectionDItem } from '../types';

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 9;
const PRINT_W_MM = PAGE_W_MM - MARGIN_MM * 2; // 192mm
const MAX_Y_MM = PAGE_H_MM - 12;
const PT_TO_MM = 25.4 / 72;

export interface PjShiftMobileSectionCRow {
  indicator: string;
  result: string;
  target: string;
  analysisLines: string[];
  hasCases: boolean;
}

export interface PjShiftMobileSectionBRow {
  lLabel: string;
  lVal: number | string;
  rLabel: string;
  rVal: number | string;
  rSubLines?: string[];
}

export interface PjShiftMobileSignatureSlot {
  heading: string;
  roleLabel: string;
  fallbackName: string;
  signed: boolean;
  signerName?: string;
  metaLine?: string;
  sigCode?: string;
}

export interface PjShiftMobilePdfData {
  filename: string;
  sectionAItems: Array<{ label: string; value: string }>;
  sectionBRows: PjShiftMobileSectionBRow[];
  sectionCRows: PjShiftMobileSectionCRow[];
  sectionDRows: ReportSectionDItem[];
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  signatures: PjShiftMobileSignatureSlot[];
  reviewEvaluation?: {
    reviewerName: string;
    note: string;
  } | null;
}

function pdfSafe(text: string): string {
  return (text || '')
    .replace(/\u2192/g, '->')
    .replace(/\u2022/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\xFF\n]/g, ' ');
}

function sanitizeFilename(title: string): string {
  const cleaned = (title || 'Lap PJ')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function lineHeightMm(fontPt: number, mult = 1.28): number {
  return fontPt * PT_TO_MM * mult;
}

function addPageNumbers(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `HemoLog HDHL · Laporan PJ Shift (Mode Mobile) · Hal. ${i} / ${total}`,
      PAGE_W_MM - MARGIN_MM,
      PAGE_H_MM - 5.5,
      { align: 'right' }
    );
  }
}

function drawSectionHeader(doc: jsPDF, title: string, y: number): number {
  const h = 7;
  doc.setFillColor(27, 70, 112); // #1b4670
  doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, h, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfSafe(title), MARGIN_MM + 3, y + 4.8);
  return y + h + 2;
}

function ensureSpace(doc: jsPDF, y: number, neededH: number): number {
  if (y + neededH > MAX_Y_MM) {
    doc.addPage('a4', 'portrait');
    return MARGIN_MM;
  }
  return y;
}

export function exportPjShiftMobilePdf(data: PjShiftMobilePdfData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  let y = MARGIN_MM;

  // Institutional Header Card
  doc.setFillColor(14, 58, 83);
  doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, 21.5, 1.8, 1.8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(186, 230, 253);
  doc.text('INSTALASI DIALISIS RS HAPPY LAND MEDICAL CENTRE', MARGIN_MM + PRINT_W_MM / 2, y + 5.5, {
    align: 'center',
  });

  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'LAPORAN PERTANGGUNGJAWABAN PERAWAT PENANGGUNG JAWAB (PJ) SHIFT',
    MARGIN_MM + PRINT_W_MM / 2,
    y + 11.2,
    { align: 'center' }
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(224, 242, 254);
  doc.text(
    'Asuhan Medis, Keperawatan, Mutu Air RO, Pemeliharaan Mesin & Operasional | Standar KARS & PERNEFRI',
    MARGIN_MM + PRINT_W_MM / 2,
    y + 16.8,
    { align: 'center' }
  );
  y += 25;

  // SECTION A: INFORMASI UMUM SHIFT & KETENAGAAN
  y = drawSectionHeader(doc, 'A. INFORMASI UMUM SHIFT & KETENAGAAN (MANPOWER)', y);
  const labelW = 54;
  const valW = PRINT_W_MM - labelW;
  const bodyPt = 8.8;
  const bodyLH = lineHeightMm(bodyPt, 1.3);

  for (let i = 0; i < data.sectionAItems.length; i++) {
    const item = data.sectionAItems[i];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(bodyPt);
    const lLines = doc.splitTextToSize(pdfSafe(item.label), labelW - 5) as string[];
    doc.setFont('helvetica', 'normal');
    const vLines = doc.splitTextToSize(pdfSafe(item.value), valW - 5) as string[];
    const maxL = Math.max(lLines.length, vLines.length);
    const rowH = maxL * bodyLH + 3;

    y = ensureSpace(doc, y, rowH);

    doc.setFillColor(237, 243, 248);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_MM, y, labelW, rowH, 'FD');

    doc.setFillColor(i % 2 === 1 ? 248 : 255, i % 2 === 1 ? 250 : 255, i % 2 === 1 ? 252 : 255);
    doc.rect(MARGIN_MM + labelW, y, valW, rowH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.4);
    doc.setTextColor(30, 41, 59);
    let ly = y + 4.2;
    for (const l of lLines) {
      doc.text(l, MARGIN_MM + 2.5, ly);
      ly += bodyLH;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(bodyPt);
    doc.setTextColor(15, 23, 42);
    let vy = y + 4.2;
    for (const v of vLines) {
      doc.text(v, MARGIN_MM + labelW + 2.5, vy);
      vy += bodyLH;
    }

    y += rowH;
  }
  y += 4;

  // SECTION B: SENSUS PASIEN & UTILISASI MESIN (2 clean stacked sub-tables for mobile readability)
  y = ensureSpace(doc, y, 30);
  y = drawSectionHeader(doc, 'B. SENSUS PASIEN, AKSES VASKULAR & UTILISASI MESIN HD', y);

  const drawBSubgroup = (
    subTitle: string,
    items: Array<{ label: string; val: string; subLines?: string[] }>
  ) => {
    y = ensureSpace(doc, y, 16);
    doc.setFillColor(44, 94, 143); // #2c5e8f
    doc.rect(MARGIN_MM, y, PRINT_W_MM, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.4);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfSafe(subTitle), MARGIN_MM + 3, y + 4.2);
    y += 6;

    const bValW = 48;
    const bLabelW = PRINT_W_MM - bValW;
    items.forEach((it, idx) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(bodyPt);
      const lLines = doc.splitTextToSize(pdfSafe(it.label), bLabelW - 5) as string[];
      const valLines = doc.splitTextToSize(pdfSafe(it.val), bValW - 5) as string[];
      const subLines = (it.subLines || []).flatMap(
        (sl) => doc.splitTextToSize(pdfSafe(sl), PRINT_W_MM - 10) as string[]
      );
      const baseH = Math.max(lLines.length, valLines.length) * bodyLH + 3;
      const extraH = subLines.length > 0 ? subLines.length * lineHeightMm(8, 1.25) + 2 : 0;
      const totalH = baseH + extraH;

      y = ensureSpace(doc, y, totalH);
      doc.setFillColor(idx % 2 === 1 ? 248 : 255, idx % 2 === 1 ? 250 : 255, idx % 2 === 1 ? 252 : 255);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.2);
      doc.rect(MARGIN_MM, y, PRINT_W_MM, totalH, 'FD');
      doc.line(MARGIN_MM + bLabelW, y, MARGIN_MM + bLabelW, y + baseH);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(bodyPt);
      doc.setTextColor(30, 41, 59);
      let ly = y + 4.2;
      for (const l of lLines) {
        doc.text(l, MARGIN_MM + 2.5, ly);
        ly += bodyLH;
      }

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      let vy = y + 4.2;
      for (const v of valLines) {
        doc.text(v, MARGIN_MM + bLabelW + bValW / 2, vy, { align: 'center' });
        vy += bodyLH;
      }

      if (subLines.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        let sy = y + baseH + 1.5;
        for (const sl of subLines) {
          doc.text(sl, MARGIN_MM + 4, sy);
          sy += lineHeightMm(8, 1.25);
        }
      }

      y += totalH;
    });
    y += 2.5;
  };

  drawBSubgroup(
    'SENSUS & KLASIFIKASI PASIEN SHIFT INI',
    data.sectionBRows.map((r) => ({ label: r.lLabel, val: String(r.lVal) }))
  );
  drawBSubgroup(
    'KAPASITAS MESIN, AKSES VASKULAR & TERAPI',
    data.sectionBRows.map((r) => ({
      label: r.rLabel,
      val: String(r.rVal),
      subLines: r.rSubLines,
    }))
  );
  y += 2;

  // SECTION C: MONITORING ASUHAN KEPERAWATAN & PELAYANAN MEDIS SHIFT
  y = ensureSpace(doc, y, 28);
  y = drawSectionHeader(doc, 'C. MONITORING ASUHAN KEPERAWATAN & PELAYANAN MEDIS SHIFT', y);

  data.sectionCRows.forEach((row, idx) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const indLines = doc.splitTextToSize(pdfSafe(row.indicator), PRINT_W_MM - 6) as string[];
    const metaText = pdfSafe(`Hasil Shift: ${row.result}   |   Target: ${row.target}`);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.6);
    const analysisFormatted =
      row.analysisLines.length > 1
        ? row.analysisLines.map((l, i) => `${i + 1}. ${l}`)
        : row.analysisLines;
    const wrappedAnalysis = analysisFormatted.flatMap(
      (l) => doc.splitTextToSize(pdfSafe(l), PRINT_W_MM - 8) as string[]
    );

    const indLH = lineHeightMm(9, 1.25);
    const anaLH = lineHeightMm(8.6, 1.3);
    const cardH =
      3.5 +
      indLines.length * indLH +
      lineHeightMm(8.4, 1.25) +
      2 +
      wrappedAnalysis.length * anaLH +
      2.5;

    y = ensureSpace(doc, y, cardH);

    if (row.hasCases) {
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(254, 205, 211);
    } else {
      doc.setFillColor(idx % 2 === 1 ? 248 : 255, idx % 2 === 1 ? 250 : 255, idx % 2 === 1 ? 252 : 255);
      doc.setDrawColor(203, 213, 225);
    }
    doc.setLineWidth(0.22);
    doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, cardH, 1.3, 1.3, 'FD');

    let cy = y + 4.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    for (const il of indLines) {
      doc.text(il, MARGIN_MM + 3, cy);
      cy += indLH;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.4);
    doc.setTextColor(row.hasCases ? 190 : 11, row.hasCases ? 18 : 90, row.hasCases ? 60 : 142);
    doc.text(metaText, MARGIN_MM + 3, cy);
    cy += lineHeightMm(8.4, 1.25) + 1.2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.6);
    doc.setTextColor(51, 65, 85);
    for (const al of wrappedAnalysis) {
      doc.text(al, MARGIN_MM + 4, cy);
      cy += anaLH;
    }

    y += cardH + 2;
  });
  y += 2.5;

  // SECTION D: AKUNTABILITAS NON-MEDIS, OPERASIONAL, WATER TREATMENT & K3
  y = ensureSpace(doc, y, 28);
  y = drawSectionHeader(doc, 'D. AKUNTABILITAS NON-MEDIS, OPERASIONAL, WATER TREATMENT & K3', y);

  data.sectionDRows.forEach((row, idx) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const itemLines = doc.splitTextToSize(pdfSafe(`${row.item}  [${row.status}]`), PRINT_W_MM - 6) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const paramLines = doc.splitTextToSize(
      pdfSafe(`Parameter: ${row.parameter}`),
      PRINT_W_MM - 8
    ) as string[];
    const resLines = doc.splitTextToSize(
      pdfSafe(`Hasil Observasi: ${row.result}`),
      PRINT_W_MM - 8
    ) as string[];

    const itemLH = lineHeightMm(9, 1.25);
    const subLH = lineHeightMm(8.5, 1.28);
    const cardH = 3.5 + itemLines.length * itemLH + (paramLines.length + resLines.length) * subLH + 2.5;

    y = ensureSpace(doc, y, cardH);

    doc.setFillColor(idx % 2 === 1 ? 248 : 255, idx % 2 === 1 ? 250 : 255, idx % 2 === 1 ? 252 : 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.22);
    doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, cardH, 1.3, 1.3, 'FD');

    let cy = y + 4.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    for (const il of itemLines) {
      doc.text(il, MARGIN_MM + 3, cy);
      cy += itemLH;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    for (const pl of paramLines) {
      doc.text(pl, MARGIN_MM + 4, cy);
      cy += subLH;
    }
    doc.setTextColor(30, 41, 59);
    for (const rl of resLines) {
      doc.text(rl, MARGIN_MM + 4, cy);
      cy += subLH;
    }

    y += cardH + 2;
  });
  y += 2.5;

  // SECTION E: SERAH TERIMA SHIFT MODEL SBAR
  y = ensureSpace(doc, y, 28);
  y = drawSectionHeader(doc, 'E. SERAH TERIMA SHIFT MODEL SBAR', y);

  const sbarEntries = [
    { label: 'SITUATION (S)', val: data.sbar.situation },
    { label: 'BACKGROUND (B)', val: data.sbar.background },
    { label: 'ASSESSMENT (A)', val: data.sbar.assessment },
    { label: 'RECOMMENDATION (R)', val: data.sbar.recommendation },
  ];

  const sbarPt = 8.8;
  const sbarLH = lineHeightMm(sbarPt, 1.32);

  for (const sbarItem of sbarEntries) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(sbarPt);
    const valLines = doc.splitTextToSize(pdfSafe(sbarItem.val || '-'), PRINT_W_MM - 8) as string[];
    const boxH = 8 + valLines.length * sbarLH + 2.5;

    y = ensureSpace(doc, y, boxH);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.24);
    doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, boxH, 1.4, 1.4, 'FD');

    doc.setFillColor(237, 243, 248);
    doc.rect(MARGIN_MM, y, PRINT_W_MM, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(27, 70, 112);
    doc.text(sbarItem.label, MARGIN_MM + 3, y + 4.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(sbarPt);
    doc.setTextColor(30, 41, 59);
    let sy = y + 9.5;
    for (const vl of valLines) {
      doc.text(vl, MARGIN_MM + 4, sy);
      sy += sbarLH;
    }

    y += boxH + 2.5;
  }
  y += 2;

  // SECTION F: PENGESAHAN & PERTANGGUNGJAWABAN SHIFT
  y = ensureSpace(doc, y, 48);
  y = drawSectionHeader(doc, 'F. PENGESAHAN & PERTANGGUNGJAWABAN SHIFT (PENGESAHAN DIGITAL)', y);

  const sigCols = data.signatures.length;
  const sigGap = 3;
  const sigW = (PRINT_W_MM - sigGap * (sigCols - 1)) / sigCols;
  const sigBoxH = 38;
  y = ensureSpace(doc, y, sigBoxH + 4);

  data.signatures.forEach((sig, i) => {
    const sx = MARGIN_MM + i * (sigW + sigGap);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.24);
    doc.roundedRect(sx, y, sigW, sigBoxH, 1.4, 1.4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.4);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(sig.heading), sx + sigW / 2, y + 5, { align: 'center' });

    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const roleLines = doc.splitTextToSize(pdfSafe(sig.roleLabel), sigW - 6) as string[];
    let ry = y + 9;
    for (const rl of roleLines) {
      doc.text(rl, sx + sigW / 2, ry, { align: 'center' });
      ry += 3.5;
    }

    if (sig.signed) {
      doc.setFillColor(236, 253, 245);
      doc.setDrawColor(110, 231, 183);
      doc.roundedRect(sx + 3, y + 14.5, sigW - 6, 15.5, 1.2, 1.2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(4, 120, 87);
      doc.text('PENGESAHAN DIGITAL SAH', sx + sigW / 2, y + 18.2, { align: 'center' });

      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      const sNameLines = doc.splitTextToSize(pdfSafe(sig.signerName || sig.fallbackName), sigW - 10) as string[];
      doc.text(sNameLines[0] || '', sx + sigW / 2, y + 22.2, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(6, 95, 70);
      if (sig.metaLine) {
        doc.text(pdfSafe(sig.metaLine), sx + sigW / 2, y + 25.8, { align: 'center' });
      }
      if (sig.sigCode) {
        doc.setTextColor(100, 116, 139);
        doc.text(pdfSafe(sig.sigCode), sx + sigW / 2, y + 28.8, { align: 'center' });
      }
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('Belum disahkan secara digital', sx + sigW / 2, y + 23, { align: 'center' });
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(`(${sig.fallbackName})`), sx + sigW / 2, y + 35, { align: 'center' });
  });
  y += sigBoxH + 3;

  if (data.reviewEvaluation && data.reviewEvaluation.note) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const evalLines = doc.splitTextToSize(
      pdfSafe(`Evaluasi Kepala Ruang (${data.reviewEvaluation.reviewerName}): ${data.reviewEvaluation.note}`),
      PRINT_W_MM - 8
    ) as string[];
    const evalH = 4 + evalLines.length * lineHeightMm(8.5, 1.3);
    y = ensureSpace(doc, y, evalH);
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(MARGIN_MM, y, PRINT_W_MM, evalH, 1.3, 1.3, 'FD');
    doc.setTextColor(6, 78, 59);
    let ey = y + 4.5;
    for (const el of evalLines) {
      doc.text(el, MARGIN_MM + 4, ey);
      ey += lineHeightMm(8.5, 1.3);
    }
  }

  addPageNumbers(doc);
  doc.save(sanitizeFilename(data.filename));
}

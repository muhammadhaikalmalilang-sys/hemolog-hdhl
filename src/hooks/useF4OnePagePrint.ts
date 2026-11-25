import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';

export type F4Orientation = 'landscape' | 'portrait';

const PX_PER_MM = 96 / 25.4;
const MARGIN_MM = 4;

// Indonesian F4 / Folio paper size: 215mm x 330mm
const F4_SHORT_MM = 215;
const F4_LONG_MM = 330;

interface UseF4OnePagePrintOptions {
  orientation: F4Orientation;
  sheetRef: RefObject<HTMLDivElement | null>;
  maxPages?: number;
  documentTitle?: string;
}

interface ComputedPrintLayout {
  finalWidth: number;
  finalZoom: number;
  targetWidth: number;
  targetHeight: number;
}

function getPrintableTargetPx(orientation: F4Orientation) {
  const widthMm =
    (orientation === 'landscape' ? F4_LONG_MM : F4_SHORT_MM) - MARGIN_MM * 2;
  const heightMm =
    (orientation === 'landscape' ? F4_SHORT_MM : F4_LONG_MM) - MARGIN_MM * 2;

  // Leave a small safety buffer (~4px) to avoid subpixel rounding spilling onto a blank page 2
  return {
    targetWidth: Math.floor(widthMm * PX_PER_MM) - 4,
    targetHeight: Math.floor(heightMm * PX_PER_MM) - 4,
  };
}

function sanitizePdfFilename(rawTitle?: string) {
  const cleaned = (rawTitle || 'Laporan-HemoLog')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ');
  const base = cleaned || 'Laporan-HemoLog';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function computePrintLayout(
  el: HTMLDivElement,
  orientation: F4Orientation,
  maxPages: number
): ComputedPrintLayout {
  const { targetWidth, targetHeight } = getPrintableTargetPx(orientation);
  const effectiveMaxPages = Math.max(1, maxPages);

  el.style.removeProperty('--f4-print-width');
  el.style.removeProperty('--f4-print-zoom');
  el.classList.add('f4-measuring');
  el.style.width = `${targetWidth}px`;

  // Measure natural dimensions at target printable width using exact print styles
  let baseW = Math.max(el.scrollWidth, targetWidth);
  if (baseW > targetWidth + 1) {
    el.style.width = `${baseW}px`;
    baseW = Math.max(el.scrollWidth, baseW);
  }
  const baseH = Math.max(el.scrollHeight, 1);

  const wScale = targetWidth / baseW;
  const hScale = targetHeight / baseH;
  let bestWidth = baseW;
  let bestZoom = 1;

  if (effectiveMaxPages === 1) {
    bestZoom = Math.min(wScale, hScale, 1);

    // If vertical height is the bottleneck, sweep wider layout widths to unwrap
    // multi-line narrative text and pick the width yielding the LARGEST readable scale
    if (hScale < wScale && bestZoom < 0.995) {
      const steps = 12;
      const maxWidth = Math.round(Math.max(baseW, targetWidth) * 1.85);
      for (let i = 1; i <= steps; i++) {
        const candWidth = Math.round(baseW + ((maxWidth - baseW) * i) / steps);
        if (candWidth <= baseW) continue;
        if (targetWidth / candWidth <= bestZoom) break;

        el.style.width = `${candWidth}px`;
        const nW = Math.max(el.scrollWidth, candWidth);
        const nH = Math.max(el.scrollHeight, 1);
        const candZoom = Math.min(targetWidth / nW, targetHeight / nH, 1);

        if (candZoom > bestZoom) {
          bestZoom = candZoom;
          bestWidth = nW;
        }
        if (bestZoom >= 0.995) break;
      }
    }
  } else if (baseH <= targetHeight) {
    // Fits comfortably on 1 page at full readable width
    bestZoom = Math.min(wScale, 1);
  } else if (hScale >= 0.9 && wScale >= 0.9) {
    // Slight 1-page overflow: scale down gently (>= ~0.89) to avoid a near-empty page 2
    bestZoom = Math.min(wScale, hScale, 1);
  } else {
    // Allow multi-page flow at full readable scale (up to effectiveMaxPages)
    // Reserve buffer for repeated table headers & avoid-break row spacing across page breaks
    const multiPageTargetHeight =
      targetHeight * effectiveMaxPages - 72 * (effectiveMaxPages - 1);
    const multiHScale = multiPageTargetHeight / baseH;
    bestZoom = Math.min(wScale, multiHScale, 1);

    if (multiHScale < wScale && bestZoom < 0.995) {
      const steps = 10;
      const maxWidth = Math.round(Math.max(baseW, targetWidth) * 1.45);
      for (let i = 1; i <= steps; i++) {
        const candWidth = Math.round(baseW + ((maxWidth - baseW) * i) / steps);
        if (candWidth <= baseW) continue;
        if (targetWidth / candWidth <= bestZoom) break;

        el.style.width = `${candWidth}px`;
        const nW = Math.max(el.scrollWidth, candWidth);
        const nH = Math.max(el.scrollHeight, 1);
        const candZoom = Math.min(targetWidth / nW, multiPageTargetHeight / nH, 1);

        if (candZoom > bestZoom) {
          bestZoom = candZoom;
          bestWidth = nW;
        }
        if (bestZoom >= 0.995) break;
      }
    }
  }

  // Apply a small safety factor when scaling down so border/subpixel rounding never triggers an extra page
  const finalZoom = bestZoom < 1 ? bestZoom * 0.988 : 1;
  const finalWidth =
    finalZoom < 1
      ? Math.max(bestWidth, Math.floor(targetWidth / finalZoom))
      : Math.max(bestWidth, targetWidth);

  return { finalWidth, finalZoom, targetWidth, targetHeight };
}

export function useF4OnePagePrint({
  orientation,
  sheetRef,
  maxPages = 1,
  documentTitle,
}: UseF4OnePagePrintOptions) {
  const previousTitleRef = useRef<string | null>(null);
  const downloadingRef = useRef(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Inject page-specific @page rule so browser print dialog defaults to F4 + exact orientation
  useEffect(() => {
    const styleId = 'hemolog-f4-page-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const sizeDecl =
      orientation === 'landscape'
        ? `${F4_LONG_MM}mm ${F4_SHORT_MM}mm`
        : `${F4_SHORT_MM}mm ${F4_LONG_MM}mm`;

    styleEl.textContent = `
      @media print {
        @page {
          size: ${sizeDecl};
          margin: ${MARGIN_MM}mm;
        }
      }
    `;

    return () => {
      const existing = document.getElementById(styleId);
      if (existing) {
        existing.remove();
      }
    };
  }, [orientation]);

  const clearPrintFit = useCallback(() => {
    if (previousTitleRef.current !== null) {
      document.title = previousTitleRef.current;
      previousTitleRef.current = null;
    }
    const el = sheetRef.current;
    if (!el) return;
    el.classList.remove('f4-measuring');
    el.style.removeProperty('--f4-print-width');
    el.style.removeProperty('--f4-print-zoom');
    el.style.width = '';
    el.style.backgroundColor = '';
  }, [sheetRef]);

  const applyPrintFit = useCallback(() => {
    if (documentTitle) {
      if (previousTitleRef.current === null) {
        previousTitleRef.current = document.title;
      }
      document.title = documentTitle;
    }
    const el = sheetRef.current;
    if (!el) return;

    const { finalWidth, finalZoom } = computePrintLayout(el, orientation, maxPages);
    el.classList.remove('f4-measuring');
    el.style.width = '';
    el.style.setProperty('--f4-print-width', `${finalWidth}px`);
    el.style.setProperty('--f4-print-zoom', finalZoom.toFixed(4));
  }, [orientation, sheetRef, maxPages, documentTitle]);

  useEffect(() => {
    const handleBeforePrint = () => applyPrintFit();
    const handleAfterPrint = () => clearPrintFit();

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      clearPrintFit();
    };
  }, [applyPrintFit, clearPrintFit]);

  const handlePrint = useCallback(() => {
    applyPrintFit();
    window.print();
  }, [applyPrintFit]);

  const handleDownloadPdf = useCallback(async () => {
    const el = sheetRef.current;
    if (!el || downloadingRef.current) return;

    downloadingRef.current = true;
    setDownloadingPdf(true);

    try {
      // Allow UI button state to paint before measuring/rendering canvas
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      if (document.fonts?.ready) {
        await document.fonts.ready.catch(() => undefined);
      }

      const effectiveMaxPages = Math.max(1, maxPages);
      const { finalWidth } = computePrintLayout(el, orientation, effectiveMaxPages);

      el.classList.add('f4-measuring');
      el.style.width = `${finalWidth}px`;
      el.style.backgroundColor = '#ffffff';

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const elWidthPx = Math.max(el.scrollWidth, finalWidth);
      const totalHeightPx = Math.max(el.scrollHeight, 1);

      const pageWidthMm = orientation === 'landscape' ? F4_LONG_MM : F4_SHORT_MM;
      const pageHeightMm = orientation === 'landscape' ? F4_SHORT_MM : F4_LONG_MM;
      const printableWidthMm = pageWidthMm - MARGIN_MM * 2;
      const printableHeightMm = pageHeightMm - MARGIN_MM * 2;

      const widthFitMmPerPx = printableWidthMm / elWidthPx;
      const singlePageHeightMm = totalHeightPx * widthFitMmPerPx;

      // Collect indivisible blocks so multi-page PDF breaks never slice through rows or signatures
      const elRect = el.getBoundingClientRect();
      const atomicBlocks: Array<{ top: number; bottom: number }> = [];
      if (effectiveMaxPages > 1 && singlePageHeightMm > printableHeightMm + 2) {
        el.querySelectorAll('tr, .pj-keep-together, .pj-doc-header, .pj-sig-table').forEach(
          (node) => {
            const htmlNode = node as HTMLElement;
            if (htmlNode.closest('.no-print')) return;
            const rect = htmlNode.getBoundingClientRect();
            const top = rect.top - elRect.top;
            const bottom = rect.bottom - elRect.top;
            if (bottom > top && top >= 0) {
              atomicBlocks.push({ top, bottom });
            }
          }
        );
      }

      const captureOptions = {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
        width: elWidthPx,
        height: totalHeightPx,
        filter: (node: HTMLElement) =>
          !(node instanceof HTMLElement && node.classList.contains('no-print')),
      };

      let sourceCanvas: HTMLCanvasElement;
      try {
        sourceCanvas = await toCanvas(el, captureOptions);
      } catch {
        // Fallback if external webfont CSS cannot be serialized offline
        sourceCanvas = await toCanvas(el, { ...captureOptions, skipFonts: true });
      }

      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format: [F4_SHORT_MM, F4_LONG_MM],
        compress: true,
      });

      const filename = sanitizePdfFilename(documentTitle);

      if (effectiveMaxPages === 1 || singlePageHeightMm <= printableHeightMm + 2) {
        const uniformMmPerPx = Math.min(widthFitMmPerPx, printableHeightMm / totalHeightPx);
        const drawWidthMm = elWidthPx * uniformMmPerPx;
        const drawHeightMm = totalHeightPx * uniformMmPerPx;
        const dataUrl = sourceCanvas.toDataURL('image/png');
        pdf.addImage(
          dataUrl,
          'PNG',
          MARGIN_MM,
          MARGIN_MM,
          drawWidthMm,
          drawHeightMm,
          undefined,
          'FAST'
        );
        pdf.save(filename);
        return;
      }

      const maxPageCssPx = Math.max(100, Math.floor(printableHeightMm / widthFitMmPerPx) - 2);
      const slices: Array<{ startPx: number; endPx: number }> = [];
      let cursorPx = 0;

      while (cursorPx < totalHeightPx - 1) {
        let endPx = Math.min(totalHeightPx, cursorPx + maxPageCssPx);
        if (endPx < totalHeightPx) {
          let adjustedEnd = endPx;
          for (const block of atomicBlocks) {
            if (
              block.top < adjustedEnd &&
              block.bottom > adjustedEnd &&
              block.top > cursorPx + maxPageCssPx * 0.4
            ) {
              adjustedEnd = Math.min(adjustedEnd, Math.floor(block.top) - 2);
            }
          }
          if (adjustedEnd > cursorPx + 40) {
            endPx = adjustedEnd;
          }
        }
        slices.push({ startPx: cursorPx, endPx });
        cursorPx = endPx;
      }

      const canvasScale = sourceCanvas.width / elWidthPx;
      const sliceCanvas = document.createElement('canvas');
      const sliceCtx = sliceCanvas.getContext('2d');

      slices.forEach((slice, index) => {
        if (index > 0) {
          pdf.addPage([F4_SHORT_MM, F4_LONG_MM], orientation);
        }

        const sliceHeightCssPx = Math.max(1, slice.endPx - slice.startPx);
        const srcY = Math.max(0, Math.round(slice.startPx * canvasScale));
        const srcH = Math.min(
          sourceCanvas.height - srcY,
          Math.max(1, Math.round(sliceHeightCssPx * canvasScale))
        );

        sliceCanvas.width = sourceCanvas.width;
        sliceCanvas.height = srcH;

        if (sliceCtx) {
          sliceCtx.fillStyle = '#ffffff';
          sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          sliceCtx.drawImage(
            sourceCanvas,
            0,
            srcY,
            sourceCanvas.width,
            srcH,
            0,
            0,
            sourceCanvas.width,
            srcH
          );
        }

        const sliceImgWidthMm = printableWidthMm;
        const sliceImgHeightMm = Math.min(
          printableHeightMm,
          sliceHeightCssPx * widthFitMmPerPx
        );
        const pageDataUrl = sliceCanvas.toDataURL('image/png');
        pdf.addImage(
          pageDataUrl,
          'PNG',
          MARGIN_MM,
          MARGIN_MM,
          sliceImgWidthMm,
          sliceImgHeightMm,
          undefined,
          'FAST'
        );
      });

      pdf.save(filename);
    } finally {
      clearPrintFit();
      downloadingRef.current = false;
      setDownloadingPdf(false);
    }
  }, [clearPrintFit, documentTitle, maxPages, orientation, sheetRef]);

  return { handlePrint, handleDownloadPdf, downloadingPdf };
}

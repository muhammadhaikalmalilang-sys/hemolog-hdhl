import { useCallback, useEffect, type RefObject } from 'react';

export type F4Orientation = 'landscape' | 'portrait';

const PX_PER_MM = 96 / 25.4;
const MARGIN_MM = 4;

// Indonesian F4 / Folio paper size: 215mm x 330mm
const F4_SHORT_MM = 215;
const F4_LONG_MM = 330;

interface UseF4OnePagePrintOptions {
  orientation: F4Orientation;
  sheetRef: RefObject<HTMLDivElement | null>;
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

export function useF4OnePagePrint({
  orientation,
  sheetRef,
}: UseF4OnePagePrintOptions) {
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
    const el = sheetRef.current;
    if (!el) return;
    el.classList.remove('f4-measuring');
    el.style.removeProperty('--f4-print-width');
    el.style.removeProperty('--f4-print-zoom');
    el.style.width = '';
  }, [sheetRef]);

  const applyPrintFit = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return;

    const { targetWidth, targetHeight } = getPrintableTargetPx(orientation);

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
    let bestZoom = Math.min(wScale, hScale, 1);

    // If vertical height is the bottleneck, sweep wider layout widths to unwrap
    // multi-line narrative text and pick the width yielding the LARGEST readable scale
    if (hScale < wScale && bestZoom < 0.995) {
      const steps = 12;
      const maxWidth = Math.round(Math.max(baseW, targetWidth) * 1.85);
      for (let i = 1; i <= steps; i++) {
        const candWidth = Math.round(baseW + ((maxWidth - baseW) * i) / steps);
        if (candWidth <= baseW) continue;
        // Width upper bound check: resulting wScale cannot beat bestZoom
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

    // Apply a small safety factor when scaling down so border/subpixel rounding never triggers page 2
    const finalZoom = bestZoom < 1 ? bestZoom * 0.988 : 1;
    const finalWidth =
      finalZoom < 1
        ? Math.max(bestWidth, Math.floor(targetWidth / finalZoom))
        : Math.max(bestWidth, targetWidth);

    el.classList.remove('f4-measuring');
    el.style.width = '';
    el.style.setProperty('--f4-print-width', `${finalWidth}px`);
    el.style.setProperty('--f4-print-zoom', finalZoom.toFixed(4));
  }, [orientation, sheetRef]);

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

  return { handlePrint };
}

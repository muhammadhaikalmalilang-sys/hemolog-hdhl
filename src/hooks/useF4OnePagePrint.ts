import { useCallback, useEffect, type RefObject } from 'react';

export type F4Orientation = 'landscape' | 'portrait';

const PX_PER_MM = 96 / 25.4;
const MARGIN_MM = 5;

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

  // Leave a small safety buffer (~6px) to avoid subpixel rounding spilling onto a blank page 2
  return {
    targetWidth: Math.floor(widthMm * PX_PER_MM) - 6,
    targetHeight: Math.floor(heightMm * PX_PER_MM) - 6,
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

    // Force layout measurement at target printable width using exact compact print styles
    let naturalW = Math.max(el.scrollWidth, targetWidth);
    let naturalH = Math.max(el.scrollHeight, 1);

    const wScale = targetWidth / naturalW;
    const hScale = targetHeight / naturalH;
    let zoom = Math.min(wScale, hScale, 1);

    // If height is the bottleneck while table width fits, widen the virtual layout container
    // proportionally so content wraps into fewer lines and still fills 100% of page width
    if (hScale < wScale && naturalW <= targetWidth + 2 && zoom < 0.99) {
      const expandedWidth = Math.min(
        Math.round(targetWidth / Math.max(zoom, 0.45)),
        Math.round(targetWidth * 1.6)
      );
      el.style.width = `${expandedWidth}px`;
      naturalW = Math.max(el.scrollWidth, expandedWidth);
      naturalH = Math.max(el.scrollHeight, 1);
      zoom = Math.min(targetWidth / naturalW, targetHeight / naturalH, 1);
    }

    // Apply a tiny 0.5% safety factor when scaling down so border/subpixel never triggers page 2
    const finalZoom = zoom < 1 ? zoom * 0.995 : 1;
    const finalWidth =
      finalZoom < 1
        ? Math.max(naturalW, Math.floor(targetWidth / finalZoom))
        : targetWidth;

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

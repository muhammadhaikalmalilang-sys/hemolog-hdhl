import { useMemo, useState } from 'react';
import { MONTH_NAMES_ID, MONTH_SHORT_ID } from '../../lib/formatters';
import type { LogbookEntry } from '../../types';

interface DialysisChartProps {
  logbooks: LogbookEntry[];
  year: number;
  focusedMonth: number; // 1..12
  onSelectMonth: (month: number) => void;
  primarySeriesLabel: string;
  secondarySeriesLabel: string;
  primaryMatchUserId?: string;
  title?: string;
  subtitle?: string;
}

export function DialysisChart({
  logbooks,
  year,
  focusedMonth,
  onSelectMonth,
  primarySeriesLabel,
  secondarySeriesLabel,
  primaryMatchUserId,
  title,
  subtitle,
}: DialysisChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const monthlyData = useMemo(() => {
    const data = Array.from({ length: 12 }, (_, idx) => ({
      monthNum: idx + 1,
      label: MONTH_SHORT_ID[idx],
      fullName: MONTH_NAMES_ID[idx],
      primary: 0,
      secondary: 0,
    }));

    for (const item of logbooks) {
      if (!item.monthKey.startsWith(`${year}-`)) continue;
      const monthNum = Number(item.monthKey.split('-')[1]);
      if (monthNum >= 1 && monthNum <= 12) {
        const bucket = data[monthNum - 1];
        if (primaryMatchUserId) {
          // Clinical view: Primary = Personal Approved, Secondary = Unit Approved
          if (item.verificationStatus === 'Approved') {
            bucket.secondary += 1;
            if (item.nurseId === primaryMatchUserId) {
              bucket.primary += 1;
            }
          }
        } else {
          // Admin / Managerial view: Primary = Approved, Secondary = Total Entri Unit
          bucket.secondary += 1;
          if (item.verificationStatus === 'Approved') {
            bucket.primary += 1;
          }
        }
      }
    }
    return data;
  }, [logbooks, year, primaryMatchUserId]);

  const rawMax = Math.max(0, ...monthlyData.flatMap((d) => [d.primary, d.secondary]));
  const yAxisMax = useMemo(() => {
    if (rawMax <= 25) return 25;
    return Math.ceil(rawMax / 5) * 5;
  }, [rawMax]);

  const yTicks = useMemo(() => {
    const step = yAxisMax / 5;
    return [5, 4, 3, 2, 1, 0].map((i) => Math.round(i * step));
  }, [yAxisMax]);

  const focusedMonthData = monthlyData[focusedMonth - 1] || monthlyData[0];
  const focusedMonthName = focusedMonthData?.fullName || '';
  const totalYearPrimary = monthlyData.reduce((acc, d) => acc + d.primary, 0);
  const totalYearSecondary = monthlyData.reduce((acc, d) => acc + d.secondary, 0);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-sm p-5 sm:p-6 shadow-sm">
      <div>
        <h3 className="font-display text-base sm:text-lg font-bold text-slate-900">
          {title || `Grafik Data Dialisis Bulanan (${year}) — Fokus Bulan ${focusedMonthName}`}
        </h3>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          {subtitle ||
            `Tren volume data dialisis setahun penuh (Januari – Desember ${year}) dengan sorotan fokus pada bulan ${focusedMonthName}. Klik batang bulan untuk melihat angka rekap pada bulan tersebut.`}
        </p>
      </div>

      {/* Chart Canvas with Y-Axis & 12 Month Columns */}
      <div className="mt-6 overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex items-stretch gap-3">
            {/* Y-Axis Labels */}
            <div className="flex h-64 w-7 shrink-0 flex-col justify-between pb-7 pt-7 text-right font-mono text-[11px] text-slate-500 tabular-nums">
              {yTicks.map((tick) => (
                <span key={tick} className="leading-none">
                  {tick}
                </span>
              ))}
            </div>

            {/* Plot Area */}
            <div className="relative flex-1">
              {/* Horizontal Gridlines */}
              <div className="pointer-events-none absolute inset-x-0 top-7 bottom-7 flex flex-col justify-between">
                {yTicks.map((tick) => (
                  <div
                    key={tick}
                    className={`w-full border-t ${
                      tick === 0 ? 'border-slate-300' : 'border-slate-100'
                    }`}
                  />
                ))}
              </div>

              {/* 12 Interactive Month Columns */}
              <div className="relative z-10 grid h-64 grid-cols-12 gap-1 sm:gap-2">
                {monthlyData.map((d, idx) => {
                  const isFocused = d.monthNum === focusedMonth;
                  const isHovered = hoveredIdx === idx;
                  const primaryPct = yAxisMax > 0 ? (d.primary / yAxisMax) * 100 : 0;
                  const secondaryPct = yAxisMax > 0 ? (d.secondary / yAxisMax) * 100 : 0;

                  return (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => onSelectMonth(d.monthNum)}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className={`group relative flex h-full flex-col justify-between rounded-xl px-1 pt-1.5 pb-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5A8E]/40 ${
                        isFocused
                          ? 'border border-sky-400/75 bg-sky-100/45'
                          : 'border border-transparent hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Top Fokus Label */}
                      <div className="h-5 flex items-center justify-center">
                        {isFocused && (
                          <span className="text-[11px] font-semibold text-[#0B5A8E]">Fokus</span>
                        )}
                      </div>

                      {/* Tooltip on Hover */}
                      {isHovered && (
                        <div className="pointer-events-none absolute -top-2 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-center text-[11px] text-white shadow-md whitespace-nowrap">
                          <div className="font-semibold">
                            {d.fullName} {year}
                          </div>
                          <div className="font-mono tabular-nums text-sky-300">
                            {primarySeriesLabel}: {d.primary}
                          </div>
                          <div className="font-mono tabular-nums text-teal-300">
                            {secondarySeriesLabel}: {d.secondary}
                          </div>
                        </div>
                      )}

                      {/* Side-by-Side Dual Bars */}
                      <div className="flex flex-1 items-end justify-center gap-1 sm:gap-1.5 pb-0.5">
                        {/* Primary Bar */}
                        <div className="flex h-full flex-col items-center justify-end">
                          {d.primary > 0 && (
                            <span className="mb-1 font-mono text-[11px] font-bold tabular-nums text-[#0B5A8E] leading-none">
                              {d.primary}
                            </span>
                          )}
                          <div
                            style={{
                              height: d.primary > 0 ? `${Math.max(8, primaryPct)}%` : '2px',
                            }}
                            className={`w-3.5 sm:w-4 rounded-t-md transition-all duration-200 ${
                              d.primary > 0 ? 'bg-[#0B5A8E]' : 'bg-slate-200'
                            }`}
                          />
                        </div>

                        {/* Secondary Bar */}
                        <div className="flex h-full flex-col items-center justify-end">
                          {d.secondary > 0 && (
                            <span className="mb-1 font-mono text-[11px] font-bold tabular-nums text-teal-700 leading-none">
                              {d.secondary}
                            </span>
                          )}
                          <div
                            style={{
                              height: d.secondary > 0 ? `${Math.max(8, secondaryPct)}%` : '2px',
                            }}
                            className={`w-3.5 sm:w-4 rounded-t-md transition-all duration-200 ${
                              d.secondary > 0 ? 'bg-teal-600' : 'bg-slate-200'
                            }`}
                          />
                        </div>
                      </div>

                      {/* Month Label */}
                      <div
                        className={`pt-1.5 text-center font-mono text-[11px] tabular-nums ${
                          isFocused ? 'font-bold text-[#0B5A8E]' : 'font-medium text-slate-600'
                        }`}
                      >
                        {d.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Legend & Focused Month Summary */}
      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold text-slate-800">
            {focusedMonthName} {year}:
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#0B5A8E]" />
            {primarySeriesLabel}:{' '}
            <strong className="font-mono tabular-nums text-slate-900">
              {focusedMonthData?.primary ?? 0}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-teal-600" />
            {secondarySeriesLabel}:{' '}
            <strong className="font-mono tabular-nums text-slate-900">
              {focusedMonthData?.secondary ?? 0}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500">
          <span>Total Setahun ({year}):</span>
          <span className="font-mono tabular-nums">
            {primarySeriesLabel} <strong className="text-slate-800">{totalYearPrimary}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {secondarySeriesLabel} <strong className="text-slate-800">{totalYearSecondary}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

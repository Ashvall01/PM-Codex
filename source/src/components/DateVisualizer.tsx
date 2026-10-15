import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

export interface DateVisualizerProps {
  date: string | Date | undefined | null;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

const MONTH_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function isLikelyDateString(str: string | undefined | null): boolean {
  if (!str) return false;
  const trimmed = String(str).trim();
  if (trimmed.length > 35 || trimmed.length < 4) return false;
  // Exclude common routes and words that cannot be dates
  if (/^(\/|#|http:\/\/|https:\/\/|www\.)/i.test(trimmed)) return false;
  if (/^(timeline|codex|tasks|deliverables|risks|stakeholders|mom|settings|dashboard|overview|projects|actions|action|issues|issue)/i.test(trimmed)) {
    return false;
  }
  return parseDateSafely(trimmed) !== null;
}

export function parseDateSafely(dateInput: string | Date | undefined | null): Date | null {
  if (!dateInput) return null;
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }
  let cleanStr = String(dateInput).trim().split('T')[0];
  if (!cleanStr) return null;
  
  // Clean date prefixes
  cleanStr = cleanStr.replace(/^(https?:\/\/)?#?date:/i, '').trim();

  // Exclude routes or URLs
  if (/^(\/|#|https?:|www\.)/i.test(cleanStr)) {
    return null;
  }

  // Format YYYY-MM-DD or YYYY/MM/DD
  const parts = cleanStr.split(/[-/]/);
  if (parts.length === 3) {
    // YYYY-MM-DD
    if (parts[0].length === 4) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day) && year >= 1970 && year <= 2100 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
    }
    // DD-MM-YYYY
    if (parts[2].length === 4) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day) && year >= 1970 && year <= 2100 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  // Handle "16 Jun 2026", "16 June 2026", "Jun 16, 2026", "August 25 2026", etc.
  const fallback = new Date(cleanStr);
  if (!isNaN(fallback.getTime())) {
    const yr = fallback.getFullYear();
    if (yr >= 1970 && yr <= 2100) {
      return fallback;
    }
  }

  return null;
}

interface CalendarMonthViewProps {
  year: number;
  month: number;
  targetDay?: number | null;
  todayDay?: number | null;
  isCurrentMonth?: boolean;
  isTargetMonth?: boolean;
}

const CalendarMonthView: React.FC<CalendarMonthViewProps> = ({
  year,
  month,
  targetDay,
  todayDay,
  isCurrentMonth,
  isTargetMonth
}) => {
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sunday
  const totalDays = new Date(year, month + 1, 0).getDate();

  const emptyCells = Array.from({ length: firstDayOfWeek });
  const dayCells = Array.from({ length: totalDays }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-2 p-3 bg-qb-black text-white border border-qb-light-grey/30">
      {/* Month Header */}
      <div className="flex items-center justify-between border-b border-qb-light-grey/20 pb-1.5">
        <div className="flex items-center gap-2">
          {isTargetMonth && <div className="w-2 h-2 bg-[#ff7600]" />}
          {isCurrentMonth && !isTargetMonth && <div className="w-2 h-2 bg-[#2dbcd2]" />}
          <span className="text-xs font-black tracking-widest uppercase text-white font-mono">
            {MONTH_NAMES[month]} {year}
          </span>
        </div>
        <span className="text-[9px] font-mono text-qb-grey tracking-wider uppercase">
          {isTargetMonth && isCurrentMonth ? 'CURRENT & TARGET' : isTargetMonth ? 'TARGET' : isCurrentMonth ? 'CURRENT' : ''}
        </span>
      </div>

      {/* Weekday Labels */}
      <div className="grid grid-cols-7 gap-1 text-center font-mono text-[9px] font-bold text-qb-grey">
        {WEEKDAYS.map((w, idx) => (
          <span key={idx} className="w-6 h-5 flex items-center justify-center">
            {w}
          </span>
        ))}
      </div>

      {/* Days Grid with Numbers */}
      <div className="grid grid-cols-7 gap-1">
        {emptyCells.map((_, idx) => (
          <div key={`empty-${idx}`} className="w-6 h-6 flex items-center justify-center" />
        ))}
        {dayCells.map((day) => {
          const isTarget = isTargetMonth && targetDay === day;
          const isToday = isCurrentMonth && todayDay === day;

          let cellClass = 'text-qb-grey hover:text-white bg-white/5';
          let title = `Day ${day}`;

          if (isTarget && isToday) {
            cellClass = 'bg-[#ff7600] text-white font-black ring-2 ring-[#2dbcd2] shadow-sm';
            title = `Day ${day}: Today & Target Date`;
          } else if (isTarget) {
            cellClass = 'bg-[#ff7600] text-black font-black shadow-sm';
            title = `Day ${day}: Target Date`;
          } else if (isToday) {
            cellClass = 'bg-[#2dbcd2] text-black font-black shadow-sm';
            title = `Day ${day}: Today`;
          }

          return (
            <div
              key={`day-${day}`}
              className={`w-6 h-6 flex items-center justify-center text-[10px] font-mono font-bold transition-all cursor-default select-none ${cellClass}`}
              title={title}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const DateVisualizer: React.FC<DateVisualizerProps> = ({
  date,
  children,
  className = '',
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<any>(null);

  const parsedDate = parseDateSafely(date);

  const handleMouseEnter = () => {
    if (disabled || !parsedDate) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const tooltipHeight = 280; // approximate
        const tooltipWidth = 240; // approximate

        // Check if there's enough space below or place above
        const spaceBelow = window.innerHeight - rect.bottom;
        const placeAbove = spaceBelow < tooltipHeight && rect.top > tooltipHeight;

        let top = placeAbove ? rect.top - 8 : rect.bottom + 8;
        let left = rect.left + rect.width / 2 - tooltipWidth / 2;

        // Keep inside window bounds
        if (left < 12) left = 12;
        if (left + tooltipWidth > window.innerWidth - 12) {
          left = window.innerWidth - tooltipWidth - 12;
        }

        setCoords({ top, left, placeAbove });
        setIsOpen(true);
      }
    }, 120);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleScrollOrResize = () => {
      setIsOpen(false);
    };
    if (isOpen) {
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
    }
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!parsedDate) {
    return <>{children}</>;
  }

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentDay = today.getDate();

  const targetYear = parsedDate.getFullYear();
  const targetMonth = parsedDate.getMonth();
  const targetDay = parsedDate.getDate();

  const monthDiff = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

  // Calculate day difference
  const todayZero = new Date(currentYear, currentMonth, currentDay).getTime();
  const targetZero = new Date(targetYear, targetMonth, targetDay).getTime();
  const diffDays = Math.round((targetZero - todayZero) / (1000 * 60 * 60 * 24));

  let relativeDayText = 'TODAY';
  if (diffDays > 0) {
    relativeDayText = diffDays === 1 ? 'TOMORROW (+1 DAY)' : `IN ${diffDays} DAYS`;
  } else if (diffDays < 0) {
    relativeDayText = diffDays === -1 ? 'YESTERDAY (-1 DAY)' : `${Math.abs(diffDays)} DAYS AGO`;
  }

  const renderTooltipContent = () => {
    // 1. Within current month
    if (monthDiff === 0) {
      return (
        <CalendarMonthView
          year={currentYear}
          month={currentMonth}
          targetDay={targetDay}
          todayDay={currentDay}
          isCurrentMonth={true}
          isTargetMonth={true}
        />
      );
    }

    // 2. Future month
    if (monthDiff > 0) {
      const intermediateMonths: { year: number; month: number }[] = [];
      for (let m = 1; m < monthDiff; m++) {
        const d = new Date(currentYear, currentMonth + m, 1);
        intermediateMonths.push({ year: d.getFullYear(), month: d.getMonth() });
      }

      return (
        <div className="flex flex-col gap-2 p-3 bg-qb-black text-white border border-qb-light-grey/30">
          {/* Current Month Box at Top */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#2dbcd2]/10 border border-[#2dbcd2]/30">
            <div className="w-2.5 h-2.5 bg-[#2dbcd2] shrink-0" />
            <span className="text-[10px] font-mono font-bold tracking-wider text-[#2dbcd2] uppercase">
              {MONTH_SHORT[currentMonth]} {currentYear} (CURRENT)
            </span>
          </div>

          {/* Intermediate Months Rows */}
          {intermediateMonths.length > 0 && (
            <div className="flex flex-col gap-1 pl-1 py-1 max-h-24 overflow-y-auto no-scrollbar border-l border-qb-light-grey/20 my-0.5 ml-3">
              {intermediateMonths.map((im, idx) => (
                <div key={idx} className="flex items-center gap-2 pl-2 text-[9px] font-mono text-qb-grey uppercase tracking-wider">
                  <div className="w-1.5 h-1.5 bg-[#8c9699] shrink-0" />
                  <span>{MONTH_SHORT[im.month]} {im.year}</span>
                </div>
              ))}
            </div>
          )}

          {/* Target Month Fully Rendered */}
          <div className="mt-1">
            <CalendarMonthView
              year={targetYear}
              month={targetMonth}
              targetDay={targetDay}
              todayDay={null}
              isCurrentMonth={false}
              isTargetMonth={true}
            />
          </div>
        </div>
      );
    }

    // 3. Past month (backwards)
    const intermediateMonthsBack: { year: number; month: number }[] = [];
    for (let m = -1; m > monthDiff; m--) {
      const d = new Date(currentYear, currentMonth + m, 1);
      intermediateMonthsBack.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    // Reverse so it flows from target -> ... -> current
    intermediateMonthsBack.reverse();

    return (
      <div className="flex flex-col gap-2 p-3 bg-qb-black text-white border border-qb-light-grey/30">
        {/* Target Month Fully Rendered at Top */}
        <div>
          <CalendarMonthView
            year={targetYear}
            month={targetMonth}
            targetDay={targetDay}
            todayDay={null}
            isCurrentMonth={false}
            isTargetMonth={true}
          />
        </div>

        {/* Intermediate Months Rows */}
        {intermediateMonthsBack.length > 0 && (
          <div className="flex flex-col gap-1 pl-1 py-1 max-h-24 overflow-y-auto no-scrollbar border-l border-qb-light-grey/20 my-0.5 ml-3">
            {intermediateMonthsBack.map((im, idx) => (
              <div key={idx} className="flex items-center gap-2 pl-2 text-[9px] font-mono text-qb-grey uppercase tracking-wider">
                <div className="w-1.5 h-1.5 bg-[#8c9699] shrink-0" />
                <span>{MONTH_SHORT[im.month]} {im.year}</span>
              </div>
            ))}
          </div>
        )}

        {/* Current Month Box at Bottom */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#2dbcd2]/10 border border-[#2dbcd2]/30 mt-1">
          <div className="w-2.5 h-2.5 bg-[#2dbcd2] shrink-0" />
          <span className="text-[10px] font-mono font-bold tracking-wider text-[#2dbcd2] uppercase">
            {MONTH_SHORT[currentMonth]} {currentYear} (CURRENT)
          </span>
        </div>
      </div>
    );
  };

  return (
    <span
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`inline-block relative ${className}`}
    >
      {children}

      {isOpen && coords && createPortal(
        <div
          style={{
            position: 'fixed',
            top: coords.placeAbove ? undefined : coords.top,
            bottom: coords.placeAbove ? window.innerHeight - coords.top : undefined,
            left: coords.left,
            zIndex: 99999
          }}
          className="pointer-events-none w-60 bg-qb-black text-white shadow-2xl border-2 border-qb-black font-sans animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header Bar */}
          <div className="px-3 py-2 bg-[#1a1a1a] border-b border-qb-light-grey/20 flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#ff7600]">
              DATE VISUALIZER
            </span>
            <span className="text-[9px] font-mono font-bold text-[#2dbcd2] tracking-wider uppercase">
              {relativeDayText}
            </span>
          </div>

          {/* Calendar Body */}
          {renderTooltipContent()}

          {/* Legend */}
          <div className="px-3 py-2 bg-[#1a1a1a] border-t border-qb-light-grey/20 flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-qb-grey">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-[#ff7600] text-black font-black text-[9px] flex items-center justify-center font-mono">
                14
              </div>
              <span>Target</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-[#2dbcd2] text-black font-black text-[9px] flex items-center justify-center font-mono">
                17
              </div>
              <span>Today</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-white/10 text-qb-grey font-bold text-[9px] flex items-center justify-center font-mono">
                22
              </div>
              <span>Dates</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
};

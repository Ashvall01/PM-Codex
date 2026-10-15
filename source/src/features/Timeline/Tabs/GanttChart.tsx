import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Revision, TimelineActivity, useTimelineStore } from '../../../store/timelineStore';
import { useDeliverablesStore } from '../../../store/deliverablesStore';
import { useAcrStore } from '../../../store/acrStore';
import { computeAcrDiffs } from '../../../utils/acrDiff';
import { TimelineActivityEditor } from './TimelineActivityEditor';
import { DELIVERABLE_STATUS_COLORS, tint } from '../../../utils/statusStyle';
import { parseGanttDate, ganttDaysDiff, addGanttDays, localTodayString, ganttGroupExtent } from '../ganttDates';

const EMPTY_COLLAPSED_STATES: Record<string, boolean> = {};

const STATUS_COLORS = {
  'Completed': 'var(--color-qb-green)',
  'Completed With Delay': 'var(--color-qb-green)',
  'Work In Progress': 'var(--color-qb-cyan)',
  'Delayed WIP': 'var(--color-qb-orange)',
  'Planned': 'var(--color-qb-light-grey)',
  'Not Started': 'var(--color-qb-magenta)', 
  'Backlog': 'var(--color-qb-light-grey)',
  'Dropped': 'var(--color-qb-black)',
  'On Hold': 'var(--color-qb-dark-grey)'
};

const DAY_WIDTH = 12;

// Date rules live in ../ganttDates.ts, where they are tested. Today is NOT a
// module constant any more: read once at load, it froze the Present line (and
// every running bar) on the day the tab was opened. See `todayStr` below.
const parseDate = parseGanttDate;
const getDaysDiff = ganttDaysDiff;
const addDays = addGanttDays;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const formatTDate = (d: any) => {
  if (!d) return '-- --- ----';
  const date = parseDate(d);
  if (isNaN(date.getTime())) return '-- --- ----';
  const y = date.getFullYear();
  const m = MONTHS[date.getMonth()];
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${m} ${y}`;
};

const STATUS_PRECEDENCE = [
  'Delayed WIP', 'Dropped', 'Completed With Delay', 'On Hold', 'Work In Progress', 'Backlog', 'Planned', 'Not Started', 'Completed'
];

const getCompositeStatus = (tasks: any[]) => {
  let highestPriorityStatus = 'Completed';
  let highestIndex = STATUS_PRECEDENCE.length;

  tasks.forEach(t => {
    const idx = STATUS_PRECEDENCE.indexOf(t.status);
    if (idx !== -1 && idx < highestIndex) {
      highestIndex = idx;
      highestPriorityStatus = t.status;
    }
  });
  return highestPriorityStatus;
};

const WAVES_CONFIG = [
  { color: 'var(--color-qb-dark-grey)', strokeWidth: 0.9, amp: 32, freq: 0.003, base: 50, speed: 0.8, phase: 0 },
  { color: 'var(--color-qb-orange)', strokeWidth: 1, amp: 42, freq: 0.002, base: 40, speed: 1.2, phase: 2 },
  { color: 'var(--color-qb-dark-grey)', strokeWidth: 0.6, amp: 22, freq: 0.004, base: 60, speed: 0.5, phase: 4 },
  { color: 'var(--color-qb-grey)', strokeWidth: 0.9, amp: 36, freq: 0.0025, base: 45, speed: 1.0, phase: 1 }
];

const TimelineWaves = ({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement> }) => {
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);
  const timeRef = useRef(0);
  const lastScrollRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const smoothedDeltaRef = useRef(0);

  React.useEffect(() => {
    let animationFrameId: number;
    let lastDraw = 0;
    // The waves cover the whole chart, so every redraw repaints the whole
    // chart. They drift very slowly: at rest 12 redraws a second look the same
    // as 30, for well under half the cost. While the chart is being scrolled
    // they follow it at 30. The tab being in the background stops them anyway.
    //
    // They keep drifting when the Mac's "Reduce motion" is on. From 24 Sep
    // they stood still under that setting, and on a Mac with it on the waves
    // simply stopped: this slow drift is the chart's look, not a transition.
    const renderLoop = (now: number = performance.now()) => {
      animationFrameId = requestAnimationFrame(renderLoop);
      const scrolling = Math.abs(smoothedDeltaRef.current) > 0.05
        || (scrollRef.current ? scrollRef.current.scrollLeft : 0) !== lastScrollRef.current;
      const interval = scrolling ? 1000 / 30 : 1000 / 12;
      if (lastDraw && now - lastDraw < interval) return;
      const elapsedFrames = lastDraw ? Math.min(8, (now - lastDraw) / (1000 / 30)) : 1;
      lastDraw = now;

      timeRef.current += 0.004 * elapsedFrames;

      const currentScroll = scrollRef.current ? scrollRef.current.scrollLeft : 0;
      const targetDelta = currentScroll - lastScrollRef.current;
      lastScrollRef.current = currentScroll;
      
      smoothedDeltaRef.current += (targetDelta - smoothedDeltaRef.current) * 0.08;
      scrollOffsetRef.current += smoothedDeltaRef.current * 0.015;

      const totalOffset = timeRef.current + scrollOffsetRef.current;

      pathsRef.current.forEach((path, i) => {
        if (!path) return;
        const wave = WAVES_CONFIG[i];
        let d = `M 0 ${wave.base}`;
        
        // Use double step size (40 instead of 20) to significantly cut down sine math and path length
        for (let x = 0; x <= 1000; x += 40) {
          const y = wave.base + Math.sin(x * wave.freq + totalOffset * wave.speed + wave.phase) * wave.amp;
          d += ` L ${x} ${y}`;
        }
        path.setAttribute('d', d);
      });
    };

    renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [scrollRef]);

  return (
    <svg 
      className="absolute inset-0 h-full w-full pointer-events-none opacity-[0.36] z-0" 
      preserveAspectRatio="none" 
      viewBox="0 0 1000 100"
    >
      {WAVES_CONFIG.map((wave, i) => (
        <path 
          key={i} 
          ref={el => { pathsRef.current[i] = el; }}
          fill="none" 
          stroke={wave.color} 
          strokeWidth={wave.strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
};

const TASK_WAVE_CONFIGS = [
  { sw: 0.5, baseAmp: 0, interactAmp: 12, freq: 0.06, speed: 2.0, opacity: 0.5 },
  { sw: 1.5, baseAmp: 0, interactAmp: 18, freq: 0.04, speed: 1.5, opacity: 0.8 },
  { sw: 3.0, baseAmp: 0, interactAmp: 25, freq: 0.03, speed: 1.0, opacity: 1.0 }
];

const TaskWave = ({ width, color, mousePosRef, scrollRef, dayWidth, viewDensity }: { width: number, color: string, mousePosRef: React.MutableRefObject<{x: number, y: number}>, scrollRef: React.RefObject<HTMLDivElement>, dayWidth: number, viewDensity: 'tight' | 'relaxed' }) => {
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const timeRef = useRef(Math.random() * 100);
  const lastScrollRef = useRef(0);
  const smoothedDeltaRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  // Cache bounding rect coordinates to completely prevent layout thrashing
  const rectRef = useRef<{ left: number, top: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const isLoopActiveRef = useRef(false);

  // Monitor visibility using IntersectionObserver to skip rendering completely for off-screen items
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    }, { threshold: 0 });

    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Update/re-measure cached bounding rect dynamically when needed (mount, resize)
  const updateRect = () => {
    if (svgRef.current) {
      const clientRect = svgRef.current.getBoundingClientRect();
      const sLeft = scrollRef.current ? scrollRef.current.scrollLeft : 0;
      const sTop = scrollRef.current ? scrollRef.current.scrollTop : 0;
      
      rectRef.current = {
        left: clientRect.left + sLeft, // store scroll-independent absolute document coordinates
        top: clientRect.top + sTop
      };
    }
  };

  React.useEffect(() => {
    // Measure initial rect inside requestAnimationFrame to ensure correct layout on mount
    const handle = requestAnimationFrame(updateRect);
    const handleGanttResize = () => updateRect();

    window.addEventListener('resize', updateRect);
    window.addEventListener('gantt-resize', handleGanttResize);

    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('gantt-resize', handleGanttResize);
    };
  }, [width, dayWidth, viewDensity]);

  // Shared wave path calculator to keep code DRY and fast
  const drawWave = (isMouseClose: boolean) => {
    const svg = svgRef.current;
    if (!svg) return;

    // Calculate how much to scale the wave amplitude
    const scaleRange = 4 * dayWidth;
    const amplitudeMultiplier = scaleRange > 0 ? Math.max(0, Math.min(1, (width - dayWidth) / scaleRange)) : 1;
    const baseY = 15;

    // Drastically improve CPU performance by doubling the step size (fewer vertex calculations)
    const step = Math.max(12, Math.min(24, width / 15));

    if (amplitudeMultiplier === 0) {
      pathsRef.current.forEach((path) => {
        if (!path) return;
        path.setAttribute('d', `M 0 ${baseY} L ${width} ${baseY}`);
      });
      return;
    }

    const currentScroll = scrollRef.current ? scrollRef.current.scrollLeft : 0;
    const currentScrollTop = scrollRef.current ? scrollRef.current.scrollTop : 0;

    let rectLeft = 0;
    let rectTop = 0;
    if (rectRef.current) {
      rectLeft = rectRef.current.left - currentScroll;
      rectTop = rectRef.current.top - currentScrollTop;
    } else {
      const clientRect = svg.getBoundingClientRect();
      rectRef.current = {
        left: clientRect.left + currentScroll,
        top: clientRect.top + currentScrollTop
      };
      rectLeft = clientRect.left;
      rectTop = clientRect.top;
    }

    const mx = mousePosRef.current.x;
    const my = mousePosRef.current.y;
    const totalOffset = timeRef.current + scrollOffsetRef.current;

    pathsRef.current.forEach((path, i) => {
      if (!path) return;
      const config = TASK_WAVE_CONFIGS[i];
      let d = `M 0 ${baseY}`;

      for (let x = 0; x <= width; x += step) {
        const taper = Math.sin((x / width) * Math.PI);
        
        let interactionAmp = 0;
        if (isMouseClose) {
          const screenX = rectLeft + x;
          const screenY = rectTop + baseY;

          const dx = screenX - mx;
          const dy = screenY - my;
          const dist = Math.sqrt(dx * dx + dy * dy);

          interactionAmp = dist < 150 ? ((150 - dist) / 150) * config.interactAmp : 0;
        }
        
        const amp = (config.baseAmp + interactionAmp) * taper * amplitudeMultiplier;
        const y = baseY + Math.sin(x * config.freq - totalOffset * config.speed) * amp;
        d += ` L ${x} ${y}`;
      }
      
      d += ` L ${width} ${baseY}`;
      path.setAttribute('d', d);
    });
  };

  const startLoop = () => {
    if (isLoopActiveRef.current || !isVisible) return;
    isLoopActiveRef.current = true;

    const loop = () => {
      if (!isLoopActiveRef.current) return;

      timeRef.current += 0.05;

      const currentScroll = scrollRef.current ? scrollRef.current.scrollLeft : 0;
      const currentScrollTop = scrollRef.current ? scrollRef.current.scrollTop : 0;
      const targetDelta = currentScroll - lastScrollRef.current;
      lastScrollRef.current = currentScroll;
      
      smoothedDeltaRef.current += (targetDelta - smoothedDeltaRef.current) * 0.08;
      scrollOffsetRef.current += smoothedDeltaRef.current * 0.015;

      const mx = mousePosRef.current.x;
      const my = mousePosRef.current.y;

      const baseY = 15;
      let rectLeft = 0;
      let rectTop = 0;
      if (rectRef.current) {
        rectLeft = rectRef.current.left - currentScroll;
        rectTop = rectRef.current.top - currentScrollTop;
      }

      const isMouseCloseHorizontally = mx >= rectLeft - 150 && mx <= rectLeft + width + 150;
      const isMouseCloseVertically = Math.abs(rectTop + baseY - my) < 150;
      const isMouseClose = isMouseCloseHorizontally && isMouseCloseVertically;

      drawWave(isMouseClose);

      // Continue animating only if mouse is in range. If not, stop loop and render static resting state
      if (isMouseClose) {
        requestAnimationFrame(loop);
      } else {
        isLoopActiveRef.current = false;
        drawWave(false);
      }
    };

    requestAnimationFrame(loop);
  };

  React.useEffect(() => {
    if (!isVisible) return;

    // Wake up loop upon mouse move or view scroll only if mouse range triggers close proximity
    const handlePointerAndScroll = () => {
      if (isLoopActiveRef.current) return;

      const mx = mousePosRef.current.x;
      const my = mousePosRef.current.y;
      const baseY = 15;
      
      const currentScroll = scrollRef.current ? scrollRef.current.scrollLeft : 0;
      const currentScrollTop = scrollRef.current ? scrollRef.current.scrollTop : 0;

      let rectLeft = 0;
      let rectTop = 0;
      if (rectRef.current) {
        rectLeft = rectRef.current.left - currentScroll;
        rectTop = rectRef.current.top - currentScrollTop;
      } else {
        return; // wait until bounds measured
      }

      const isMouseCloseHorizontally = mx >= rectLeft - 150 && mx <= rectLeft + width + 150;
      const isMouseCloseVertically = Math.abs(rectTop + baseY - my) < 150;

      if (isMouseCloseHorizontally && isMouseCloseVertically) {
        startLoop();
      }
    };

    // Draw initial resting state static wave so it displays correctly immediately with zero CPU overhead
    drawWave(false);

    window.addEventListener('pointermove', handlePointerAndScroll, { passive: true });
    
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handlePointerAndScroll, { passive: true });
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerAndScroll);
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handlePointerAndScroll);
      }
      isLoopActiveRef.current = false;
    };
  }, [width, isVisible, scrollRef, mousePosRef, dayWidth]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-0 pointer-events-none"
      style={{ top: -14, height: 30, width, overflow: 'visible' }}
    >
      {TASK_WAVE_CONFIGS.map((config, i) => (
        <path 
          key={i} 
          ref={el => { pathsRef.current[i] = el; }} 
          fill="none" 
          stroke={color} 
          strokeWidth={config.sw} 
          opacity={config.opacity}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
};


export default function GanttChart({ projectId, revision }: { projectId: string; revision: Revision }) {
  const getProjectTimeline = useTimelineStore(state => state.getProjectTimeline);
  const getDeliverablesByProject = useDeliverablesStore(state => state.getDeliverablesByProject);
  const projectTimeline = getProjectTimeline(projectId);
  const deliverables = getDeliverablesByProject(projectId);
  const revisions = projectTimeline?.revisions || [];

  // Today, kept current. The app stays open for days; a date read once at load
  // left the Present line, running bars and overdue marks on the day the tab
  // was opened. Checked every minute and whenever the tab comes back into view.
  const [todayStr, setTodayStr] = useState<string>(() => localTodayString());
  useEffect(() => {
    const check = () => setTodayStr((prev) => {
      const now = localTodayString();
      return now === prev ? prev : now;
    });
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  const TODAY_DATE = todayStr;

  const [compareRevisionId, setCompareRevisionId] = useState<string>('none');
  
  useEffect(() => {
    if (revision && compareRevisionId === revision.id) {
       setCompareRevisionId('none');
    }
  }, [revision?.id, compareRevisionId]);

  const compareRevision = useMemo(() => {
    if (compareRevisionId === 'none') return null;
    return revisions.find(r => r.id === compareRevisionId) || null;
  }, [compareRevisionId, revisions]);

  const compareActivitiesMap = useMemo(() => {
    if (!compareRevision) return {};
    return compareRevision.activities.reduce((acc, task) => {
      const compositeKey = `${task.phase}|${task.activity}|${task.subActivity}`;
      acc[compositeKey] = task;
      return acc;
    }, {} as Record<string, TimelineActivity>);
  }, [compareRevision]);

  const { activeAcrId, activeAcrChangeId } = useAcrStore();
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));

  const [pendingModifications, setPendingModifications] = useState<Record<string, { targetStartDate: string; targetCompletionDate: string }>>({});
  
  const RAW_DATA = useMemo(() => {
    const originalActivities = (revision?.activities || []).map(task => {
      if (pendingModifications[task.id]) {
        return { ...task, ...pendingModifications[task.id] };
      }
      return task;
    });
    
    const result: any[] = [];

    originalActivities.forEach((act, idx) => {
      const updateChange = acr?.changes.find(c => c.name === 'updateTimelineRow' && String(c.args.id) === String(act.id));
      const deleteChange = acr?.changes.find(c => c.name === 'deleteTimelineRow' && String(c.args.id) === String(act.id));

      if (deleteChange) {
        result.push({
          ...act,
  _acrType: 'proposed-delete',
          _changeId: deleteChange.id,
          _originalIndex: idx,
          acrOriginal: act,
          acrChange: deleteChange,
          acrApproved: deleteChange.approved !== false,
          acrDiffs: [],
        });
      } else if (updateChange) {
        result.push({
          ...act,
          _acrType: 'original-for-update',
          _changeId: updateChange.id,
          _originalIndex: idx
        });
        result.push({
          ...act,
          ...updateChange.args,
          id: `acr-update-${updateChange.id}`,
          _acrType: 'proposed-update',
          _changeId: updateChange.id,
          _originalIndex: idx,
          // The editor and the review panel read these, so a Gantt bar says
          // the same thing about a proposal as every other screen does.
          acrOriginal: act,
          acrChange: updateChange,
          acrApproved: updateChange.approved !== false,
          acrDiffs: computeAcrDiffs(act, updateChange.args, updateChange.name),
        });
      } else {
        result.push({
          ...act,
          _acrType: 'normal',
          _originalIndex: idx
        });
      }
    });

    const addChanges = acr?.changes.filter(c => c.name === 'addTimelineRow') || [];
    addChanges.forEach(chg => {
      const mockAct = {
        id: `acr-add-${chg.id}`,
        phase: chg.args.phase || '',
        activity: chg.args.activity || '',
        subActivity: chg.args.subActivity || '',
        weight: Number(chg.args.weight) || 0,
        progress: Number(chg.args.progress) || 0,
        status: chg.args.status || 'Planned',
        owner: chg.args.owner || '',
        targetStartDate: chg.args.targetStartDate || '',
        targetCompletionDate: chg.args.targetCompletionDate || '',
        actualStartDate: chg.args.actualStartDate || '',
        actualCompletionDate: chg.args.actualCompletionDate || '',
        remarks: chg.args.remarks || '',
        _acrType: 'proposed-add',
        _changeId: chg.id,
        _originalIndex: -1,
        acrOriginal: null,
        acrChange: chg,
        acrApproved: chg.approved !== false,
        acrDiffs: computeAcrDiffs(null, chg.args, chg.name, { treatAllAsChanged: true }),
      };

      const insertAfterId = chg.args.insertAfterId;
      if (insertAfterId) {
        const afterIdx = result.findIndex(r => String(r.id) === String(insertAfterId) || String(r.id) === `acr-update-${insertAfterId}`);
        if (afterIdx !== -1) {
          result.splice(afterIdx + 1, 0, mockAct);
          return;
        }
      }
      result.push(mockAct);
    });

    return {
      activities: result
    };
  }, [revision?.activities, acr, activeAcrChangeId, pendingModifications]);
  const [viewDensity, setViewDensity] = useState<'relaxed'|'tight'>('tight');
  // Finished rows (Completed, Completed With Delay, Dropped) can be hidden so a
  // long plan stays compact. Remembered in this browser; proposals always show.
  const [hideFinished, setHideFinishedState] = useState<boolean>(() => {
    try { return localStorage.getItem('pm-codex-gantt-hide-finished') === '1'; } catch { return false; }
  });
  const setHideFinished = (v: boolean) => {
    setHideFinishedState(v);
    try { localStorage.setItem('pm-codex-gantt-hide-finished', v ? '1' : '0'); } catch { /* default next time */ }
  };
  const [hoveredTask, setHoveredTask] = useState<any>(null);
  const [zoom, setZoom] = useState(1);
  const dayWidth = DAY_WIDTH * zoom;
  const collapsedStates = useTimelineStore(state => state.ganttCollapsedStates?.[projectId]) ?? EMPTY_COLLAPSED_STATES;
  const toggleGanttCollapse = useTimelineStore(state => state.toggleGanttCollapse);
  const setAllGanttCollapsed = useTimelineStore(state => state.setAllGanttCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mousePosRef = useRef({ x: -1000, y: -1000 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredRowRef = useRef<HTMLDivElement | null>(null);
  const updateActivity = useTimelineStore(state => state.updateActivity);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      window.dispatchEvent(new CustomEvent('gantt-resize'));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  const [taskDragAction, setTaskDragAction] = useState<{
    activityId: string;
    type: 'move' | 'resize-start' | 'resize-end';
    startX: number;
    initialTargetStart: Date;
    initialTargetEnd: Date;
    currentDeltaDays: number;
  } | null>(null);

  useEffect(() => {
    const handleGlobalPointerMove = (e: PointerEvent) => {
      if (taskDragAction) {
        const deltaX = e.clientX - taskDragAction.startX;
        const deltaDays = Math.round(deltaX / dayWidth);
        setTaskDragAction(prev => prev ? { ...prev, currentDeltaDays: deltaDays } : null);
      }
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      if (taskDragAction) {
        const deltaX = e.clientX - taskDragAction.startX;
        const deltaDays = Math.round(deltaX / dayWidth);

        if (deltaDays !== 0) {
          const newStart = new Date(taskDragAction.initialTargetStart);
          const newEnd = new Date(taskDragAction.initialTargetEnd);
          
          if (taskDragAction.type === 'move') {
            newStart.setDate(newStart.getDate() + deltaDays);
            newEnd.setDate(newEnd.getDate() + deltaDays);
          } else if (taskDragAction.type === 'resize-start') {
            newStart.setDate(newStart.getDate() + deltaDays);
          } else if (taskDragAction.type === 'resize-end') {
            newEnd.setDate(newEnd.getDate() + deltaDays);
          }
          
          if (newStart <= newEnd) {
             const formatLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
             
             setPendingModifications(prev => ({
               ...prev,
               [taskDragAction.activityId]: {
                 targetStartDate: formatLocal(newStart),
                 targetCompletionDate: formatLocal(newEnd),
               }
             }));
          }
        }
        setTaskDragAction(null);
      }
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [taskDragAction, dayWidth, updateActivity]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // duplicate removed


  const toggleCollapse = (id: string) => {
    toggleGanttCollapse(projectId, id);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };

    if (tooltipRef.current && hoveredRowRef.current) {
      // Get the exact screen coordinates of the hovered row to snap the tooltip vertically
      const rect = hoveredRowRef.current.getBoundingClientRect();
      const anchorX = e.clientX;
      const anchorY = rect.top + rect.height / 2;

      const isLow = anchorY > window.innerHeight - 250;
      tooltipRef.current.dataset.flipped = isLow ? "true" : "false";
      tooltipRef.current.style.transform = `translate(${anchorX}px, ${anchorY}px)`;
      tooltipRef.current.style.opacity = '1';
    }

    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const y = e.pageY - scrollRef.current.offsetTop;
    const walkX = (x - dragStart.x) * 1.5;
    const walkY = (y - dragStart.y) * 1.5;
    scrollRef.current.scrollLeft = dragStart.scrollLeft - walkX;
    scrollRef.current.scrollTop = dragStart.scrollTop - walkY;
  };

  useLayoutEffect(() => {
    if (hoveredTask && tooltipRef.current && hoveredRowRef.current && mousePosRef.current.x !== -1000) {
      const rect = hoveredRowRef.current.getBoundingClientRect();
      const anchorX = mousePosRef.current.x;
      const anchorY = rect.top + rect.height / 2;

      const isLow = anchorY > window.innerHeight - 250;
      tooltipRef.current.dataset.flipped = isLow ? "true" : "false";
      tooltipRef.current.style.transform = `translate(${anchorX}px, ${anchorY}px)`;
      tooltipRef.current.style.opacity = '1';
    }
  }, [hoveredTask]);

  const handleMouseDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    setIsDragging(true);
    setDragStart({
      x: e.pageX - scrollRef.current.offsetLeft,
      y: e.pageY - scrollRef.current.offsetTop,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop
    });
  };

  const handleMouseUpOrLeave = () => setIsDragging(false);

  const { minDate, maxDate, totalDays, groupedActivities } = useMemo(() => {
    let min = new Date('2099-01-01');
    let max = new Date('2000-01-01');
    const FINISHED = ['Completed', 'Completed With Delay', 'Dropped'];
    const activities = hideFinished
      ? RAW_DATA.activities.filter((a: any) => !(FINISHED.includes(a.status) && (!a._acrType || a._acrType === 'normal')))
      : RAW_DATA.activities;
    const compareActivities = compareRevision?.activities || [];

    const updateMinMax = (start: Date, end: Date) => {
      if (start < min) min = start;
      if (end > max) max = end;
    };

    activities.forEach(task => {
      updateMinMax(parseDate(task.targetStartDate), parseDate(task.targetCompletionDate));
      // Actual dates too: work that started before its plan (or ran past it)
      // was drawn off the left or right edge of the chart.
      if (task.actualStartDate) {
        const aStart = parseDate(task.actualStartDate);
        updateMinMax(aStart, task.actualCompletionDate ? parseDate(task.actualCompletionDate) : aStart);
      }
    });

    compareActivities.forEach(task => {
      updateMinMax(parseDate(task.targetStartDate), parseDate(task.targetCompletionDate));
    });

    min = addDays(min, -5);
    max = addDays(max, 10);
    const totalDays = getDaysDiff(min, max) + 1;

    const grouped = activities.reduce((acc, task) => {
      const phaseParts = (task.phase || "").split(". ");
      const phaseLabel = phaseParts.length > 1 ? phaseParts[1] : task.phase;
      const phaseNum = phaseParts.length > 1 ? `SECTION ${phaseParts[0]}` : '';
      
      const key = task.phase;
      if (!acc[key]) acc[key] = { label: phaseLabel, num: phaseNum, activities: {} };

      const actKey = task.activity;
      if (!acc[key].activities[actKey]) {
        acc[key].activities[actKey] = {
          tasks: [],
          targetStart: null,
          targetEnd: null,
          compareTargetStart: null,
          compareTargetEnd: null,
          actualStart: null,
          actualEnd: null,
          isOngoing: false,
          totalWeight: 0,
          weightedProgress: 0,
          status: 'Planned',
          owner: task.owner 
        };
      }
      
      const group = acc[key].activities[actKey];
      group.tasks.push(task);
      
      group.totalWeight += task.weight;
      group.weightedProgress += (task.progress * task.weight);
      
      const tStart = parseDate(task.targetStartDate);
      const tEnd = parseDate(task.targetCompletionDate);
      if (!group.targetStart || tStart < group.targetStart) group.targetStart = tStart;
      if (!group.targetEnd || tEnd > group.targetEnd) group.targetEnd = tEnd;
      
      // Update group compare bounds
      const compositeKey = `${task.phase}|${task.activity}|${task.subActivity}`;
      const compareTask = compareActivitiesMap[compositeKey];
      if (compareTask) {
        const cStart = parseDate(compareTask.targetStartDate);
        const cEnd = parseDate(compareTask.targetCompletionDate);
        if (!group.compareTargetStart || cStart < group.compareTargetStart) group.compareTargetStart = cStart;
        if (!group.compareTargetEnd || cEnd > group.compareTargetEnd) group.compareTargetEnd = cEnd;
      }
      
      if (task.actualStartDate) {
        const aStart = parseDate(task.actualStartDate);
        if (!group.actualStart || aStart < group.actualStart) group.actualStart = aStart;
        
        if (task.actualCompletionDate) {
          const aEnd = parseDate(task.actualCompletionDate);
          if (!group.actualEnd || aEnd > group.actualEnd) group.actualEnd = aEnd;
        } else {
          group.isOngoing = true;
        }
      }

      group.status = getCompositeStatus(group.tasks);
      
      return acc;
    }, {});

    return { minDate: min, maxDate: max, totalDays, groupedActivities: grouped };
  }, [RAW_DATA.activities, compareRevision, compareActivitiesMap, hideFinished]);

  const allGroupKeys = useMemo(() => {
    const keys: string[] = [];
    Object.entries(groupedActivities).forEach(([phaseKey, phaseObj]: [string, any]) => {
      Object.keys(phaseObj.activities).forEach(actName => {
        keys.push(`${phaseKey}-${actName}`);
      });
    });
    return keys;
  }, [groupedActivities]);

  const areAllCollapsed = allGroupKeys.length > 0 && allGroupKeys.every(k => !!collapsedStates[k]);

  const handleToggleAllSections = () => {
    if (areAllCollapsed) {
      setAllGanttCollapsed(projectId, {});
    } else {
      const nextStates: Record<string, boolean> = {};
      allGroupKeys.forEach(k => { nextStates[k] = true; });
      setAllGanttCollapsed(projectId, nextStates);
    }
  };

  const dateHeaders = useMemo(() => {
    const headers = [];
    let currentDate = new Date(minDate);
    let currentMonth = currentDate.getMonth();
    // The month's own year. Reading the year from the day that has already
    // moved on labelled December "DECEMBER 2027" in a plan crossing into 2027.
    let currentYear = currentDate.getFullYear();
    let daysInMonth = 0;

    for (let i = 0; i <= totalDays; i++) {
      if (currentDate.getMonth() !== currentMonth || i === totalDays) {
        headers.push({
          month: new Date(currentYear, currentMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase(),
          days: daysInMonth
        });
        currentMonth = currentDate.getMonth();
        currentYear = currentDate.getFullYear();
        daysInMonth = 0;
      }
      daysInMonth++;
      currentDate = addDays(currentDate, 1);
    }
    return headers;
  }, [minDate, totalDays]);

  const totalPixelWidth = totalDays * dayWidth;

  /**
   * Open on today, a third of the way across. The chart used to open at the
   * first activity, often months back, and the current work had to be found
   * by dragging. Changing the magnification re-centres on today too.
   */
  const scrollToToday = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const x = getDaysDiff(minDate, parseDate(TODAY_DATE)) * dayWidth;
    const LABEL_COLUMN = 180;
    // And down to the first phase with work still to finish, so the rows in
    // view are the ones crossing today rather than long-finished ones.
    let top = el.scrollTop;
    const DONE = ['Completed', 'Completed With Delay', 'Dropped'];
    // The first activity with work still to do, not the top of its phase: a
    // long phase of finished rows used to fill the screen with nothing
    // crossing today.
    let focusKey: string | null = null;
    for (const [phaseKey, phaseObj] of Object.entries(groupedActivities) as [string, any][]) {
      const act = Object.entries(phaseObj.activities).find(([, g]: [string, any]) =>
        g.tasks.some((t: any) => !DONE.includes(t.status)));
      if (act) { focusKey = `${phaseKey}-${act[0]}`; break; }
    }
    if (focusKey) {
      const groupEl = el.querySelector(`[data-gantt-group="${CSS.escape(focusKey)}"]`) as HTMLElement | null;
      if (groupEl) {
        const STICKY_HEADER = 48, HEADING = 40;
        top = Math.max(0, groupEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - STICKY_HEADER - HEADING);
      }
    }
    el.scrollTo({ left: Math.max(0, x - (el.clientWidth - LABEL_COLUMN) * 0.3), top, behavior: smooth ? 'smooth' : 'auto' });
  };
  const centredFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = `${revision?.id}|${dayWidth}|${hideFinished}`;
    if (centredFor.current === key || !scrollRef.current || totalDays <= 0) return;
    centredFor.current = key;
    scrollToToday(false);
  });

  const renderTimelineBar = (item: any, isContainer: boolean, isCollapsed: boolean, label?: string) => {
    let targetStart = isContainer ? item.targetStart : parseDate(item.targetStartDate);
    let targetEnd = isContainer ? item.targetEnd : parseDate(item.targetCompletionDate);

    let compareStart = null;
    let compareEnd = null;
    let compareVarianceDays = undefined;

    if (compareRevision) {
      if (isContainer) {
         if (item.compareTargetStart && item.compareTargetEnd) {
           compareStart = item.compareTargetStart;
           compareEnd = item.compareTargetEnd;
         }
      } else {
         const compositeKey = `${item.phase}|${item.activity}|${item.subActivity}`;
         const compareTask = compareActivitiesMap[compositeKey];
         if (compareTask && compareTask.targetStartDate && compareTask.targetCompletionDate) {
           compareStart = parseDate(compareTask.targetStartDate);
           compareEnd = parseDate(compareTask.targetCompletionDate);
           
           // Variance = new targetEnd - original targetEnd
           compareVarianceDays = getDaysDiff(compareEnd, targetEnd);
         }
      }
    }

    // Apply drag preview
    let isPreviewDragging = false;
    let originalTargetStart = targetStart;
    let originalTargetEnd = targetEnd;

    if (!isContainer && taskDragAction?.activityId === item.id && taskDragAction.currentDeltaDays !== undefined) {
      const deltaDays = taskDragAction.currentDeltaDays;
      let newStart = new Date(targetStart);
      let newEnd = new Date(targetEnd);
      if (taskDragAction.type === 'move') {
        newStart.setDate(newStart.getDate() + deltaDays);
        newEnd.setDate(newEnd.getDate() + deltaDays);
      } else if (taskDragAction.type === 'resize-start') {
        newStart.setDate(newStart.getDate() + deltaDays);
      } else if (taskDragAction.type === 'resize-end') {
        newEnd.setDate(newEnd.getDate() + deltaDays);
      }

      if (newStart <= newEnd) {
        targetStart = newStart;
        targetEnd = newEnd;
        isPreviewDragging = true;
      }
    }
    
    const plannedLeft = getDaysDiff(minDate, targetStart) * dayWidth;
    const plannedWidth = (getDaysDiff(targetStart, targetEnd) + 1) * dayWidth;

    let compareLeft = 0;
    let compareWidth = 0;
    if (compareStart && compareEnd) {
      compareLeft = getDaysDiff(minDate, compareStart) * dayWidth;
      compareWidth = (getDaysDiff(compareStart, compareEnd) + 1) * dayWidth;
    }

    let actualLeft = plannedLeft;
    let actualWidth = 0;
    let isOverdue = false;
    let overdueWidth = 0;

    const actualStartStr = isContainer ? item.actualStart : (item.actualStartDate ? parseDate(item.actualStartDate) : null);

    if (actualStartStr) {
      actualLeft = getDaysDiff(minDate, actualStartStr) * dayWidth;
      
      const actualEndStr = isContainer ? item.actualEnd : (item.actualCompletionDate ? parseDate(item.actualCompletionDate) : null);
      const ongoing = isContainer ? item.isOngoing : !item.actualCompletionDate;

      if (actualEndStr && !ongoing) {
        actualWidth = (getDaysDiff(actualStartStr, actualEndStr) + 1) * dayWidth;
      } else {
        const todayDateObj = parseDate(TODAY_DATE);
        if (todayDateObj >= actualStartStr) {
          actualWidth = (getDaysDiff(actualStartStr, todayDateObj)) * dayWidth;
        }
      }
    } else if (!['Completed', 'Completed With Delay', 'Dropped'].includes(item.status)) {
      // Not started past its start date is overdue — unless it was finished or
      // dropped without actual dates, which is not late work.
      const todayDateObj = parseDate(TODAY_DATE);
      if (todayDateObj > targetStart) {
        isOverdue = true;
        overdueWidth = (getDaysDiff(targetStart, todayDateObj)) * dayWidth;
      }
    }

    const showActive = !isContainer || isCollapsed;

    const barColor = STATUS_COLORS[item.status] || 'var(--color-qb-light-grey)';
    const progressPercent = isContainer 
      ? (item.totalWeight > 0 ? (item.weightedProgress / item.totalWeight) * 100 : 0).toFixed(0)
      : (item.progress * 100);

    const isHoverable = !isContainer || isCollapsed;

    let rowBgStyle = '';
    let plannedLineColor = isPreviewDragging ? 'bg-qb-dark-grey' : 'bg-qb-light-grey';

    if (item._acrType === 'proposed-add') {
      rowBgStyle = 'bg-[#51b53e]/5 border-y border-dashed border-[#51b53e]/10';
      plannedLineColor = 'bg-[#51b53e]';
    } else if (item._acrType === 'proposed-update') {
      rowBgStyle = 'bg-[#ff7600]/5 border-y border-dashed border-[#ff7600]/15';
      plannedLineColor = 'bg-[#ff7600]';
    } else if (item._acrType === 'original-for-update') {
      rowBgStyle = 'bg-slate-200/20 border-y border-dashed border-slate-300/40 opacity-70';
      plannedLineColor = 'bg-slate-400';
    } else if (item._acrType === 'proposed-delete') {
      rowBgStyle = 'bg-[#c11c4d]/5 border-y border-dashed border-[#c11c4d]/10';
      plannedLineColor = 'bg-[#c11c4d]';
    }

    return (
      <div 
        className={`h-full relative flex items-center group w-full border-b border-transparent ${isContainer && !isCollapsed ? 'bg-transparent' : 'transition-colors'} ${rowBgStyle}`}
        onPointerMove={(e) => {
          if (taskDragAction) {
            if (hoveredTask) setHoveredTask(null);
            return;
          }
          if (isHoverable) {
            mousePosRef.current = { x: e.clientX, y: e.clientY };
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const minX = Math.min(plannedLeft, actualLeft);
            const maxX = Math.max(plannedLeft + plannedWidth, actualLeft + actualWidth) + overdueWidth;
            // Add a generous buffer for drag handles and visual padding
            if (mouseX >= minX - 16 && mouseX <= maxX + 16) {
              hoveredRowRef.current = (e.currentTarget as HTMLDivElement);
              // Only update state if it changed
              setHoveredTask((prev) => prev?.id === item.id ? prev : { ...item, compareVarianceDays });
            } else {
              setHoveredTask((prev) => prev?.id === item.id ? null : prev);
            }
          }
        }}
        onPointerLeave={() => {
          if (isHoverable) {
            hoveredRowRef.current = null;
            setHoveredTask((prev) => prev?.id === item.id ? null : prev);
          }
        }}
        onDoubleClick={(e) => {
          if (!isContainer) {
            e.stopPropagation();
            setEditingTaskId(item.id);
          }
        }}
      >
        {compareWidth > 0 && (
          <div 
            className="absolute rounded border border-dashed border-qb-grey pointer-events-none opacity-40 z-10 box-border bg-qb-grey/10"
            style={{ 
              left: `${compareLeft}px`, 
              width: `${compareWidth}px`, 
              top: isContainer && !isCollapsed ? 'calc(50% - 1.5px)' : 'calc(50% - 8px)',
              height: isContainer && !isCollapsed ? '3px' : '16px'
            }}
          />
        )}
        
        {label && (
          // The label rides along the bar: it starts at the bar's start and,
          // once that has scrolled off to the left, stays at the left edge of
          // the chart until the bar ends (CSS sticky, so scrolling costs
          // nothing). Opening on today had left long bars nameless.
          <div className="absolute z-20 pointer-events-none" style={{ left: `${plannedLeft}px`, width: `${Math.max(1, Math.max(plannedLeft + plannedWidth, actualLeft + actualWidth, plannedLeft + overdueWidth) - plannedLeft)}px`, top: 'calc(50% - 22px)' }}>
          <div 
             className={`sticky left-[188px] w-max text-[10px] lowercase tracking-wider font-bold whitespace-nowrap flex items-center gap-1.5 ${
               item._acrType === 'original-for-update' ? 'line-through italic text-qb-grey opacity-70' :
               item._acrType === 'proposed-delete' ? 'line-through text-[#c11c4d] opacity-80' : 'text-qb-dark-grey'
             }`}
          >
             {item._acrType === 'proposed-add' && (
               <span className="text-[10px] font-black text-[#51b53e] tracking-tight font-sans leading-none bg-[#51b53e]/10 px-1 py-0.5 border border-[#51b53e]/20 uppercase">ADD</span>
             )}
             {item._acrType === 'proposed-update' && (
               <span className="text-[10px] font-black text-[#ff7600] tracking-tight font-sans leading-none bg-[#ff7600]/10 px-1 py-0.5 border border-[#ff7600]/20 animate-pulse uppercase">UPD</span>
             )}
             {item._acrType === 'original-for-update' && (
               <span className="text-[10px] font-black text-[#5c666b] tracking-tight font-sans leading-none bg-slate-200 px-1 py-0.5 uppercase">ORIG</span>
             )}
             {item._acrType === 'proposed-delete' && (
               <span className="text-[10px] font-black text-[#c11c4d] tracking-tight font-sans leading-none bg-[#c11c4d]/10 px-1 py-0.5 border border-[#c11c4d]/20 uppercase">DEL</span>
             )}
             <span>{label}</span>
          </div>
          </div>
        )}
        <div 
          className={`absolute h-[8px] flex items-center cursor-pointer z-20 transition-colors ${isContainer && !isCollapsed ? 'opacity-30 top-[calc(50%-4px)]' : 'opacity-80 hover:opacity-100 top-[calc(50%-8.5px)]'}`}
          style={{ left: `${plannedLeft}px`, width: `${plannedWidth}px`, touchAction: 'none' }}
          onPointerDown={(e) => {
            if (!isContainer) {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setTaskDragAction({
                activityId: item.id,
                type: 'move',
                startX: e.clientX,
                initialTargetStart: originalTargetStart,
                initialTargetEnd: originalTargetEnd,
                currentDeltaDays: 0
              });
            }
          }}
        >
          <div className={`absolute left-0 top-0 bottom-0 w-[1px] ${plannedLineColor}`} />
          <div className={`w-full h-[1px] ${item._acrType === 'original-for-update' || item._acrType === 'proposed-delete' ? 'border-t border-dashed border-current opacity-60' : plannedLineColor}`} style={{ color: item._acrType === 'original-for-update' ? '#5c666b' : (item._acrType === 'proposed-delete' ? '#c11c4d' : undefined) }} />
          <div className={`absolute right-0 top-0 bottom-0 w-[1px] ${plannedLineColor}`} />
        </div>

        {/* Left Resize Handle */}
        <div 
          className={`absolute w-4 h-6 flex items-center justify-center cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-[41] touch-none -translate-y-1/2 ${isContainer ? 'hidden' : ''}`}
          style={{ left: `${plannedLeft - 8}px`, top: 'calc(50% - 4.5px)' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setTaskDragAction({
              activityId: item.id,
              type: 'resize-start',
              startX: e.clientX,
              initialTargetStart: originalTargetStart,
              initialTargetEnd: originalTargetEnd,
              currentDeltaDays: 0
            });
          }}
        >
          <div className="w-[1px] h-3 bg-qb-black" />
        </div>
        
        {/* Right Resize Handle */}
        <div 
          className={`absolute w-4 h-6 flex items-center justify-center cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-[41] touch-none -translate-y-1/2 ${isContainer ? 'hidden' : ''}`}
          style={{ left: `${plannedLeft + plannedWidth - 8}px`, top: 'calc(50% - 4.5px)' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setTaskDragAction({
              activityId: item.id,
              type: 'resize-end',
              startX: e.clientX,
              initialTargetStart: originalTargetStart,
              initialTargetEnd: originalTargetEnd,
              currentDeltaDays: 0
            });
          }}
        >
          <div className="w-[1px] h-3 bg-qb-black" />
        </div>

        {showActive && isOverdue && (
          <>
            <div 
              className="absolute h-[1px] border-t-[1.5px] border-dotted border-qb-magenta opacity-80 z-10 pointer-events-none"
              style={{ top: 'calc(50% + 6px)', left: `${plannedLeft}px`, width: `${overdueWidth}px` }}
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-qb-magenta bg-transparent" />
              
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 flex items-center justify-center pointer-events-none">
                <div className="absolute w-8 h-8 rounded-full bg-qb-magenta opacity-40 animate-ping pointer-events-none" />
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="relative z-10 text-qb-magenta drop-shadow-[0_0_8px_rgba(193,28,77,0.8)] pointer-events-none">
                  <path d="M12 2L1 21H23L12 2Z" fill="currentColor" stroke="var(--color-qb-bg)" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M12 9V14M12 18.5H12.01" stroke="var(--color-qb-bg)" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            
            <div 
              className="absolute text-[9px] tracking-widest font-bold text-qb-magenta opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ top: 'calc(50% + 6px)', transform: 'translateY(-50%)', left: `${plannedLeft + overdueWidth + 16}px` }}
            >
              OVERDUE
            </div>
          </>
        )}

        {showActive && actualWidth > 0 && (
          <div 
            className="absolute h-[2px] z-10 flex items-center pointer-events-none"
            style={{ top: 'calc(50% + 6px)', left: `${actualLeft}px`, width: `${actualWidth}px` }}
          >
            <TaskWave width={actualWidth} color={barColor} mousePosRef={mousePosRef} scrollRef={scrollRef} dayWidth={dayWidth} viewDensity={viewDensity} />

            <div className="absolute left-0 w-2 h-2 rounded-full -translate-x-1/2 bg-transparent border-[1.5px]" style={{ borderColor: barColor }}></div>
            
            <div className="absolute right-0 translate-x-1/2 w-3 h-3 rounded-full bg-transparent border-[1.5px] flex items-center justify-center" style={{ borderColor: barColor }}>
              <div className="w-1 h-1 rounded-full" style={{ backgroundColor: barColor }} />
            </div>


          
        
      </div>
        )}

        {showActive && actualLeft > plannedLeft && (
          <div 
            className="absolute h-[1px] border-t border-dashed border-qb-orange opacity-50"
            style={{ top: 'calc(50% + 6px)', left: `${plannedLeft}px`, width: `${actualLeft - plannedLeft}px` }}
          />
        )}

        {showActive && actualWidth > 0 && (
          <div 
            className="absolute text-[10px] tracking-widest font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ top: 'calc(50% + 6px)', transform: 'translateY(-50%)', left: `${actualLeft + actualWidth + 16}px`, color: barColor }}
          >
            {progressPercent}% <span className="text-qb-dark-grey text-[10px]">COMPLETED</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className="flex flex-col h-screen bg-transparent font-sans text-sm overflow-hidden text-qb-dark-grey"
      onPointerMove={handlePointerMove}
    >
      <header className="px-6 py-3 bg-transparent flex justify-between items-center z-20 flex-shrink-0 border-b border-qb-box-bg">
        <div className="flex items-center gap-2">
          {Object.keys(pendingModifications).length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-extrabold text-orange-500 uppercase tracking-widest bg-orange-500/10 px-2 py-1 rounded">Unsaved Changes</span>
              <button 
                onClick={() => {
                   Object.entries(pendingModifications).forEach(([id, mods]) => {
                      updateActivity(projectId, revision.id, id, mods);
                   });
                   setPendingModifications({});
                }} 
                className="text-[10px] font-extrabold tracking-widest text-qb-bg bg-qb-black px-3 py-1.5 hover:bg-opacity-80 transition-colors uppercase border border-qb-black shadow-sm"
              >
                Save Changes
              </button>
              <button 
                onClick={() => setPendingModifications({})} 
                className="text-[10px] font-extrabold tracking-widest text-qb-dark-grey hover:text-qb-black transition-colors uppercase px-3 py-1.5 border border-qb-light-grey bg-white hover:bg-gray-50 shadow-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-widest text-qb-light-grey uppercase font-black">Planned</span>
            <div className="w-6 h-[8px] relative flex items-center">
              <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-qb-light-grey" />
              <div className="w-full h-[1px] bg-qb-light-grey" />
              <div className="absolute right-0 top-0 bottom-0 w-[1px] bg-qb-light-grey" />
            </div>
          </div>
          
          <div className="flex items-center gap-2 relative group/legend cursor-help">
            <span className="text-[10px] tracking-widest text-qb-orange uppercase font-black border-b border-dotted border-qb-orange">Actual / Active</span>
            <div className="w-6 h-[2px] bg-qb-orange relative">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-qb-orange" />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-qb-orange bg-transparent flex items-center justify-center">
                 <div className="w-0.5 h-0.5 bg-qb-orange rounded-full" />
              </div>
            </div>
            
            {/* Hover Legend Dropdown */}
            <div className="absolute top-full left-0 mt-3 w-48 bg-transparent/95 backdrop-blur-md p-4 shadow-2xl border border-qb-box-bg opacity-0 pointer-events-none group-hover/legend:opacity-100 transition-opacity z-50 duration-200">
              <div className="text-[10px] font-black tracking-[0.2em] text-qb-grey uppercase mb-3 border-b border-qb-box-bg pb-1.5">Status Legend</div>
              <div className="flex flex-col gap-2">
                {Object.entries(STATUS_COLORS).map(([status, color]) => (
                  <div key={status} className="flex items-center gap-2">
                    {status === 'Not Started' ? (
                      <div className="relative w-2 h-2 flex items-center justify-center">
                        <div className="absolute w-4 h-4 rounded-full bg-qb-magenta opacity-40 animate-ping" />
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="relative z-10 text-qb-magenta drop-shadow-[0_0_4px_rgba(193,28,77,0.8)]">
                          <path d="M12 2L1 21H23L12 2Z" fill="currentColor" stroke="var(--color-qb-bg)" strokeWidth="1.5" strokeLinejoin="round" />
                          <path d="M12 9V14M12 18.5H12.01" stroke="var(--color-qb-bg)" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-2 h-2 rounded-full border border-qb-box-bg shadow-sm" style={{ backgroundColor: color }} />
                    )}
                    <span className="text-[10px] tracking-widest uppercase font-black text-qb-black">{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-widest text-qb-magenta uppercase font-black">Overdue</span>
            <div className="w-6 h-[2px] border-t-[1.5px] border-dotted border-qb-magenta" />
          </div>
          <button
            type="button"
            onClick={() => scrollToToday(true)}
            className="ml-2 text-[9px] font-black uppercase tracking-widest text-qb-orange border border-qb-orange px-2 py-1 hover:bg-qb-orange hover:text-white transition-colors"
            title="Scroll to today"
          >
            Today
          </button>
          <div className="flex flex-col gap-0.5 items-end ml-2">
            <label className="text-[10px] tracking-widest text-qb-dark-grey uppercase font-black">Finished</label>
            <button
              type="button"
              onClick={() => setHideFinished(!hideFinished)}
              aria-pressed={hideFinished}
              className="text-[10px] bg-transparent border-b border-qb-dark-grey text-qb-black hover:text-qb-orange hover:border-qb-orange uppercase tracking-wider font-black cursor-pointer pb-0.5 transition-colors whitespace-nowrap"
              title={hideFinished ? 'Show completed and dropped rows' : 'Hide completed and dropped rows'}
            >
              {hideFinished ? 'Hidden' : 'Shown'}
            </button>
          </div>
          <div className="flex flex-col gap-0.5 items-end ml-2">
            <label className="text-[10px] tracking-widest text-qb-dark-grey uppercase font-black">Sections</label>
            <button
              type="button"
              onClick={handleToggleAllSections}
              className="text-[10px] bg-transparent border-b border-qb-dark-grey text-qb-black hover:text-qb-orange hover:border-qb-orange uppercase tracking-wider font-black cursor-pointer pb-0.5 transition-colors whitespace-nowrap"
              title={areAllCollapsed ? "Expand all sections" : "Collapse all sections"}
            >
              {areAllCollapsed ? "Expand All" : "Collapse All"}
            </button>
          </div>
          <div className="flex flex-col gap-0.5 items-end ml-2">
            <label className="text-[10px] tracking-widest text-qb-dark-grey uppercase font-black">Compare With</label>
            <select 
              value={compareRevisionId}
              onChange={(e) => setCompareRevisionId(e.target.value)}
              className="text-[10px] bg-transparent border-b border-qb-dark-grey text-qb-black uppercase tracking-wider font-black cursor-pointer focus:outline-none pb-0.5 min-w-[80px]"
            >
              <option value="none">None</option>
              {revisions.filter(r => r.id !== revision.id).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5 items-end ml-2">
            <label className="text-[10px] tracking-widest text-qb-dark-grey uppercase font-black">Density</label>
            <select 
              value={viewDensity}
              onChange={(e) => setViewDensity(e.target.value as 'relaxed' | 'tight')}
              className="text-[10px] bg-transparent border-b border-qb-dark-grey text-qb-black uppercase tracking-wider font-black cursor-pointer focus:outline-none pb-0.5"
            >
              <option value="relaxed">Relaxed</option>
              <option value="tight">Tight</option>
            </select>
          </div>
          <div className="flex flex-col gap-0.5 items-end ml-2">
            <label className="text-[10px] tracking-widest text-qb-dark-grey uppercase font-black">Mag</label>
            <select 
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="text-[10px] bg-transparent border-b border-qb-dark-grey text-qb-black uppercase tracking-wider font-black cursor-pointer focus:outline-none pb-0.5"
            >
              <option value="0.5">0.5X</option>
              <option value="0.75">0.75X</option>
              <option value="1">1.0X</option>
              <option value="1.25">1.25X</option>
              <option value="1.5">1.5X</option>
              <option value="2">2.0X</option>
            </select>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
           <TimelineWaves scrollRef={scrollRef} />
        </div>

        <div 
          ref={scrollRef}
          className={`flex-1 overflow-auto hide-scrollbar relative z-10 ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
          onPointerDown={handleMouseDown}
          onPointerLeave={handleMouseUpOrLeave}
          onPointerUp={handleMouseUpOrLeave}
        >
          <div className="min-w-max flex">
            
            {/* The phase column and the month row stay put while the chart
                scrolls, so they are solid: bars and labels used to slide
                under them and show through, text over text. The column fades
                out at its right edge so a bar goes under it softly. */}
            <div
              className="w-[180px] flex-shrink-0 sticky left-0 z-[50] pr-4"
              style={{ background: 'linear-gradient(to right, var(--color-qb-bg) calc(100% - 20px), transparent)' }}
            >
              <div className="h-12 sticky top-0 z-[60] bg-qb-bg" />
              
              <div className="py-4 pl-10 pb-64">
                {Object.entries(groupedActivities).map(([phaseKey, phaseObj]: [string, any]) => (
                  <div key={phaseKey} className="mb-12 relative pt-6">
                    {/* The phase name stays in view while its rows scroll by. */}
                    <div className="absolute top-6 bottom-0 left-0 w-full pr-4 pointer-events-none">
                      <div className="sticky top-[60px] flex flex-col justify-start">
                        {phaseObj.num && <span className="text-[10px] tracking-[0.2em] text-qb-dark-grey mb-1">{phaseObj.num}</span>}
                        <h2 className="text-[11px] font-extrabold tracking-widest uppercase text-qb-black leading-tight break-words">{phaseObj.label}</h2>
                      </div>
                    </div>

                    {Object.entries(phaseObj.activities).map(([actName, actGroup]: [string, any]) => {
                       const groupKey = `${phaseKey}-${actName}`;
                       const isCollapsed = collapsedStates[groupKey];

                       return (
                         <div key={actName} className="mb-8 mt-6">
                           {!isCollapsed ? (
                             <div className="py-4">
                               {actGroup.tasks.map((task: any) => (
                                 <div key={task.id} className={viewDensity === 'tight' ? 'h-10' : 'h-16'} />
                               ))}
                             </div>
                           ) : (
                             <div className="h-10" />
                           )}
                         </div>
                       );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 relative">
              <div className="sticky top-0 z-[45] flex h-12 items-end pb-2 bg-qb-bg">
                {dateHeaders.map((header, idx) => (
                  <div 
                    key={idx} 
                    className="flex flex-col justify-end border-l border-qb-box-bg pl-2 flex-shrink-0 relative"
                    style={{ width: `${header.days * dayWidth}px` }}
                  >
                    <span className="text-[10px] tracking-widest font-bold text-qb-dark-grey leading-none mb-1">{header.month}</span>
                    <div className="w-full h-[1px] bg-qb-box-bg absolute bottom-0 left-0" />
                  </div>
                ))}
              </div>

              <div 
                className="absolute top-12 bottom-0 left-0 flex pointer-events-none"
                style={{ width: `${totalPixelWidth}px` }}
              >
                {Array.from({ length: totalDays }).map((_, i) => (
                  <div 
                    key={i} 
                    className={`h-full border-r ${addDays(minDate, i + 1).getDate() === 1 ? 'border-qb-light-grey' : 'border-qb-box-bg/40'} flex-shrink-0`}
                    style={{ width: `${dayWidth}px` }}
                  />
                ))}
                
                <div 
                  className="absolute top-0 bottom-0 border-l-[1px] border-qb-orange z-[42] pointer-events-none"
                  style={{ left: `${getDaysDiff(minDate, parseDate(TODAY_DATE)) * dayWidth}px` }}
                >
                   <div className="sticky top-12 z-[42] overflow-visible">
                     <div className="absolute top-0 left-[-4px] w-2 h-2 bg-qb-orange rotate-45" />
                     <div className="absolute top-3 left-2 text-[9px] text-qb-orange tracking-widest uppercase font-black">Present</div>
                   </div>
                </div>
              </div>

              <div className="py-4 pb-64 relative z-10" style={{ width: `${totalPixelWidth}px` }}>
                {Object.entries(groupedActivities).map(([phaseKey, phaseObj]: [string, any]) => (
                  <div key={phaseKey} data-gantt-phase={phaseKey} className="mb-12 relative pt-6">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from--qb-box-bg to-transparent" />
                    
                    {Object.entries(phaseObj.activities).map(([actName, actGroup]: [string, any]) => {
                       const groupKey = `${phaseKey}-${actName}`;
                       const isCollapsed = collapsedStates[groupKey];
                       // The outline goes round every bar in the group — planned,
                       // compared, actual, and a running bar up to today — not
                       // the planned dates alone, which let early or late bars
                       // stick out of their own group.
                       const extent = ganttGroupExtent(actGroup, parseDate(TODAY_DATE));
                       const actLeft = extent.start ? getDaysDiff(minDate, extent.start) * dayWidth : 0;
                       const actWidth = (extent.start && extent.end) ? (getDaysDiff(extent.start, extent.end) + 1) * dayWidth : 0;
                       const boxLeft = Math.max(0, actLeft - 20);
                       const boxWidth = actWidth + 60;
                       // The heading stays in view while any of the group's
                       // bars is: planned, actual, or still running today.
                       const todayLeft = getDaysDiff(minDate, parseDate(TODAY_DATE)) * dayWidth;
                       const headingRight = Math.max(
                         boxLeft + boxWidth,
                         actGroup.actualEnd ? getDaysDiff(minDate, actGroup.actualEnd) * dayWidth : 0,
                         actGroup.isOngoing ? todayLeft : 0,
                       );

                       return (
                         <div key={actName} data-gantt-group={groupKey} className="mb-8 flex flex-col relative mt-6">
                           <div className="absolute -top-6 z-40 pointer-events-none" style={{ left: `${boxLeft}px`, width: `${Math.max(headingRight - boxLeft, 1)}px` }}>
                           <div 
                             className="sticky left-[180px] w-max flex items-center gap-2 cursor-pointer bg-transparent py-1 px-2 pointer-events-auto" 
                             onClick={() => toggleCollapse(groupKey)}
                           >
                             <svg 
                               width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                               className={`transition-transform duration-200 text-qb-dark-grey ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                             >
                                <path d="M6 9l6 6 6-6" />
                             </svg>
                             <span className="text-[11px] font-extrabold tracking-[0.1em] text-qb-black uppercase whitespace-nowrap">{actName}</span>
                           </div>
                           </div>

                           {!isCollapsed && (
                             <div className="relative py-4">
                               {/* No side padding on this box: bars are placed
                                   from the chart's left edge, and 8px of padding
                                   pushed every expanded bar most of a day right
                                   of the grid, the Present line and the outline. */}
                               <div className="absolute inset-y-0 pointer-events-none z-0 overflow-hidden" style={{ left: `${boxLeft}px`, width: `${boxWidth}px` }}>
                                 <div className="absolute top-0 left-0 right-[32px] h-px bg-qb-light-grey" /><div className="absolute bottom-0 left-[32px] right-0 h-px bg-qb-light-grey" /><div className="absolute top-0 bottom-[32px] left-0 w-px bg-qb-light-grey" /><div className="absolute top-[32px] bottom-0 right-0 w-px bg-qb-light-grey" />
                                 {/* Top Right Chamfer */}
                                 <div className="absolute top-0 w-[45.25px] h-px bg-qb-light-grey origin-top-left transform rotate-45" style={{ left: 'calc(100% - 32px)' }} />
                                 {/* Bottom Left Chamfer */}
                                 <div className="absolute bottom-[32px] left-0 w-[45.25px] h-px bg-qb-light-grey origin-top-left transform rotate-45" />
                               </div>
                               
                               {actGroup.tasks.map((task: any) => (
                                 <div key={task.id} className={`${viewDensity === 'tight' ? 'h-10' : 'h-16'} w-full relative z-10`}>
                                   {renderTimelineBar(task, false, false, task.subActivity)}
                                 </div>
                               ))}
                             </div>
                           )}

                           {isCollapsed && (
                             <div className="h-10 w-full relative">
                               {renderTimelineBar(actGroup, true, isCollapsed)}
                             </div>
                           )}
                         </div>
                       );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {editingTaskId && (
         <div className="absolute right-0 top-0 bottom-0 w-[400px] z-[120] bg-white border-l border-qb-box-bg shadow-2xl animate-in slide-in-from-right duration-200 overflow-hidden">
            <TimelineActivityEditor 
              activity={RAW_DATA.activities.find((a: any) => a.id === editingTaskId)!}
              onSave={(id, updates) => {
                /**
                 * An edit must land where the row came from.
                 *
                 * This called `updateActivity` for every row. On a proposed
                 * EDIT that wrote straight into the real activity, so the
                 * change happened before anyone signed anything off and the
                 * proposal kept its old values. On a proposed NEW activity the
                 * id is invented (`acr-add-...`) and is in no store at all, so
                 * the save silently did nothing.
                 */
                const row: any = RAW_DATA.activities.find((a: any) => a.id === editingTaskId);
                const changeId = row?._changeId;
                const isProposal =
                  row?._acrType === 'proposed-add' || row?._acrType === 'proposed-update';

                if (isProposal && changeId && acr?.id) {
                  const change = acr.changes.find((c: any) => c.id === changeId);
                  if (change) {
                    useAcrStore.getState().updateAcrChange(acr.id, changeId, {
                      args: { ...change.args, ...updates },
                    });
                  }
                  return;
                }
                updateActivity(projectId, revision.id, id, updates);
              }}
              onClose={() => setEditingTaskId(null)}
            />
         </div>
      )}

      {hoveredTask && !editingTaskId && createPortal(
        <div 
          ref={tooltipRef}
          className="fixed top-0 left-0 z-50 pointer-events-none group/tooltip opacity-0 transition-opacity duration-150"
          data-flipped="false"
          style={{ transform: 'translate3d(-1000px, -1000px, 0)' }}
        >
          <div className="relative w-[340px] animate-in fade-in duration-150">
            {/* The anchor pin */}
            <div className="absolute left-[-4px] top-[-4px] w-2 h-2 rounded-full border-[1.5px] bg-transparent z-10" style={{ borderColor: STATUS_COLORS[hoveredTask.status] || 'var(--color-qb-orange)' }} />
            
            {/* Wrapper that handles flipping up/down */}
            <div className="relative w-full mt-[8px] group-data-[flipped=true]/tooltip:mt-0 group-data-[flipped=true]/tooltip:-translate-y-[calc(100%+8px)]">
              
              {/* The vertical left line that stretches top to bottom */}
              <div className="absolute left-0 top-[-8px] bottom-0 w-[1px] bg-qb-light-grey group-data-[flipped=true]/tooltip:top-0 group-data-[flipped=true]/tooltip:-bottom-[8px]" />
              
              {/* Box Content (Flush with left line) */}
              <div className="ml-[1px] bg-transparent/95 backdrop-blur-md p-5 shadow-[10px_10px_30px_rgba(0,0,0,0.06)] border-t border-b border-r border-qb-box-bg">
                
                <div 
                  className="text-sm font-light uppercase tracking-widest mb-3"
                  style={{ color: STATUS_COLORS[hoveredTask.status] || 'var(--color-qb-orange)' }}
                >
                  {(hoveredTask.phase || "").split(". ")[1] || hoveredTask.phase}
                </div>
                
                <div className="text-[9px] font-black tracking-[0.15em] text-qb-grey uppercase mb-1 flex items-center gap-1.5 flex-wrap">
                  {hoveredTask._acrType === 'proposed-add' && (
                    <span className="text-[10px] font-black text-[#51b53e] tracking-tight font-sans bg-[#51b53e]/10 px-1.5 py-0.5 border border-[#51b53e]/20 rounded-sm">PROPOSED ADDITION</span>
                  )}
                  {hoveredTask._acrType === 'proposed-update' && (
                    <span className="text-[10px] font-black text-[#ff7600] tracking-tight font-sans bg-[#ff7600]/10 px-1.5 py-0.5 border border-[#ff7600]/20 rounded-sm animate-pulse">PROPOSED UPDATE</span>
                  )}
                  {hoveredTask._acrType === 'original-for-update' && (
                    <span className="text-[10px] font-black text-[#5c666b] tracking-tight font-sans bg-slate-200 px-1.5 py-0.5 rounded-sm">ORIGINAL (SUPERSEDED)</span>
                  )}
                  {hoveredTask._acrType === 'proposed-delete' && (
                    <span className="text-[10px] font-black text-[#c11c4d] tracking-tight font-sans bg-[#c11c4d]/10 px-1.5 py-0.5 border border-[#c11c4d]/20 rounded-sm">PROPOSED DELETION</span>
                  )}
                  <span>{hoveredTask.owner} / {hoveredTask.status}</span>
                </div>
                
                <div className="text-xl font-extrabold text-qb-black tracking-wider leading-none mb-2">
                  {hoveredTask.subActivity || hoveredTask.activity}
                </div>
                
                <div className="text-[10px] font-black tracking-[0.1em] text-qb-grey uppercase mb-5">
                  {hoveredTask.remarks || "No known repercussions"}
                </div>
                
                <div className="flex flex-col gap-2 mb-4">
                    {hoveredTask.compareVarianceDays !== undefined && hoveredTask.compareVarianceDays !== 0 && (
                      <div className="flex justify-between items-end mb-2">
                         <span className="text-[10px] tracking-widest font-extrabold text-qb-orange bg-qb-orange/10 px-2 py-0.5 rounded">
                           {hoveredTask.compareVarianceDays > 0 ? '+' : ''}{hoveredTask.compareVarianceDays} Days Variance
                         </span>
                      </div>
                    )}
                    <div className="flex justify-between items-end">
                       <span className="text-[10px] tracking-[0.2em] font-black text-qb-grey uppercase">Planned</span>
                       <span className="text-[10px] tracking-widest font-extrabold text-qb-dark-grey">
                         {formatTDate(hoveredTask.targetStartDate || hoveredTask.targetStart)} <span className="text-qb-light-grey mx-1">/</span> {formatTDate(hoveredTask.targetCompletionDate || hoveredTask.targetEnd)}
                       </span>
                    </div>
                    <div className="flex justify-between items-end">
                       <span className="text-[10px] tracking-[0.2em] font-black text-qb-grey uppercase">Actual</span>
                       <span className="text-[10px] tracking-widest font-extrabold text-qb-black">
                          {hoveredTask.actualStartDate || hoveredTask.actualStart ? formatTDate(hoveredTask.actualStartDate || hoveredTask.actualStart) : '--/--/----'} <span className="text-qb-light-grey mx-1">/</span> {hoveredTask.actualCompletionDate || hoveredTask.actualEnd ? formatTDate(hoveredTask.actualCompletionDate || hoveredTask.actualEnd) : (hoveredTask.actualStartDate || hoveredTask.actualStart ? 'ACTIVE' : '--/--/----')}
                       </span>
                    </div>
                </div>
                
                {deliverables.filter(d => Array.isArray(d.linkedActivityIds) && d.linkedActivityIds.includes(hoveredTask.id)).length > 0 && (
                  <div className="pt-3 border-t border-qb-box-bg">
                    <div className="text-[10px] tracking-[0.2em] font-black text-qb-grey uppercase mb-2">Linked Deliverables</div>
                    <div className="flex flex-col gap-1.5">
                      {deliverables.filter(d => Array.isArray(d.linkedActivityIds) && d.linkedActivityIds.includes(hoveredTask.id)).map(d => (
                        <div key={d.id} className="flex justify-between items-center text-xs">
                          <span className="font-medium text-qb-black truncate max-w-[200px]">{d.title}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5" style={{
                            backgroundColor: tint(DELIVERABLE_STATUS_COLORS[d.status] || 'var(--color-qb-grey)'),
                            color: DELIVERABLE_STATUS_COLORS[d.status] || 'var(--color-qb-grey)'
                          }}>{d.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex items-center gap-8 border-t border-qb-box-bg pt-4 mt-4">
                  <div className="flex items-center gap-3">
                    <div className="relative w-8 h-8">
                      <svg viewBox="0 0 36 36" className="w-full h-full absolute inset-0">
                        <path className="text-qb-box-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
                        <path 
                          stroke={STATUS_COLORS[hoveredTask.status] || 'var(--color-qb-orange)'} 
                          strokeDasharray={`${(hoveredTask.progress !== undefined ? hoveredTask.progress : (hoveredTask.totalWeight > 0 ? hoveredTask.weightedProgress / hoveredTask.totalWeight : 0)) * 100}, 100`} 
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                          fill="none" 
                          strokeWidth="3" 
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center text-qb-dark-grey">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                      </div>
                    </div>
                    <span className="text-sm font-bold" style={{ color: STATUS_COLORS[hoveredTask.status] || 'var(--color-qb-orange)' }}>
                      {hoveredTask.progress !== undefined 
                        ? (hoveredTask.progress * 100).toFixed(0) 
                        : (hoveredTask.totalWeight > 0 ? (hoveredTask.weightedProgress / hoveredTask.totalWeight) * 100 : 0).toFixed(0)}%
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2 border-l border-qb-box-bg pl-6">
                    <div className="text-3xl font-light text-qb-black leading-none tracking-tighter">
                      {getDaysDiff(parseDate(hoveredTask.targetStartDate || hoveredTask.targetStart), parseDate(hoveredTask.targetCompletionDate || hoveredTask.targetEnd))}
                    </div>
                    <div className="flex flex-col justify-center gap-[2px]">
                      <span className="text-[10px] text-qb-grey uppercase font-black tracking-widest leading-none mt-1">Days</span>
                      <span className="text-[10px] text-qb-grey uppercase font-black tracking-widest leading-none">Duration</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
}
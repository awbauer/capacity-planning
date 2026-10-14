import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { bucketStats, type BucketStats } from '../../domain/aggregate';
import { colorFor } from '../../domain/colors';
import { assignmentFlagWeeks } from '../../domain/conflicts';
import { lowRiskAt, weekClass, weekKind, type Severity } from '../../domain/load';
import {
  BOOKING_LABELS,
  bookingState,
  edges,
  fteLabel,
  moveEdits,
  resizeEdits,
  segmentEdges,
  valueRun,
  type BookingState,
  type DragEdits,
  type SegmentEdge,
  type WeekRun,
} from '../../domain/timeline';
import { isFilled, type Assignment, type WeekKey, type Zoom } from '../../domain/types';
import { nextStep } from '../../domain/steps';
import { format } from 'date-fns';
import { currentWeek, formatWeek, formatWeekRange, weekMonth, type Bucket } from '../../domain/weeks';
import { cellLockedFor, lockCoversCell, type Lock } from '../../domain/locks';
import { useCollabStore } from '../../store/collabStore';
import { isShared } from '../../store/mode';
import { usePlan, usePlanStore, type AllocationEdit } from '../../store/planStore';
import { sendPresence, showComments } from '../../store/sharedPlanStore';
import { useUIStore } from '../../store/uiStore';
import { useCan } from '../../store/useCan';
import { useDerived } from '../../store/useDerived';
import { CellMenu, type CellMenuTarget } from '../../collab/CellMenu';
import { cellCommentAnchor } from '../../collab/commentAnchors';
import { anchorOnCell, isOpenThread, type Thread } from '../../domain/comments';
import { Pie } from './Pie';

export interface SummaryCell {
  text: string;
  /** Secondary value shown small after the text (e.g. tentative load). */
  extra?: string;
  className?: string;
  title?: string;
  /**
   * Drawn as a continuous band instead of a number per column: the text is
   * shown only where it changes. Rows without it (e.g. a person's weekly
   * load) show their value in every column.
   */
  band?: 'staffed' | 'open';
  /** Shorter text and extra for the circles and % displays, which repeat the value in every column. */
  short?: { text: string; extra?: string };
}

export interface GridRow {
  key: string;
  depth: 0 | 1;
  label: ReactNode;
  className?: string;
  /** Present on editable allocation rows. */
  assignmentId?: string;
  /** Read-only cells for summary rows. */
  summary?: (bucket: Bucket) => SummaryCell;
  /** Project date range: drawn as start/end lines; cells outside it are shaded (see rangeClasses). */
  range?: { start?: WeekKey; end?: WeekKey };
  /** The person on an allocation row: dimmed when someone else is highlighted. */
  resourceId?: string;
  /** Spoken name of an allocation row's bars, e.g. "Andrew Kim, MCN Agent". */
  name?: string;
}

interface Props {
  zoom: Zoom;
  buckets: Bucket[];
  rows: GridRow[];
  corner: ReactNode;
  empty?: ReactNode;
}

interface Pos {
  r: number;
  c: number;
}

/** A selected cell by row and column key, so it survives rows being added or removed (by anyone). */
interface CellKey {
  row: string;
  bucket: string;
}

/**
 * 'critical': committed work past the red threshold. 'conflict': committed
 * work over capacity. 'potential': over only if pipeline work is won;
 * 'potential-low': only if pipeline work under LIKELY_WIN% likely is won.
 */
type IssueKind = 'critical' | 'conflict' | 'potential' | 'potential-low';

interface RowTimeline {
  stats: BucketStats[];
  /** What each column shows: its average, or at Month/Quarter zoom its peak if chosen. */
  shown: number[];
  states: (BookingState | null)[];
  bars: (SegmentEdge | null)[];
  flags: Record<Severity, WeekKey[]>[];
  issues: (IssueKind | null)[];
  issueEdges: (SegmentEdge | null)[];
}

/** A bar being dragged: one edge (resize) or the whole bar (move), on one row. */
interface BarDrag {
  kind: 'start' | 'end' | 'move';
  roleId: string;
  r: number;
  /** Column the drag started in, and the one under the pointer now. */
  c0: number;
  c: number;
  run: WeekRun;
}

const edgeClasses = (e: SegmentEdge) => `${e.start ? ' seg-start' : ''}${e.end ? ' seg-end' : ''}`;

const relativeMins = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : `${m} min ago`;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Classes showing where a cell sits relative to its workstream's dates.
 * - Start/end weeks get a vertical line ('edge-start' / 'edge-end').
 * - After the end, every row is shaded as outside the workstream.
 * - Before the start is the presales period: not shaded, and the workstream
 *   row is marked 'prestart'.
 */
function rangeClasses(range: GridRow['range'], b: Bucket, kind: 'allocation' | 'summary'): string[] {
  if (!range) return [];
  const out: string[] = [];
  const { start, end } = range;
  if (start && b.weeks.includes(start)) out.push('edge-start');
  if (end && b.weeks.includes(end)) out.push('edge-end');
  const before = !!start && b.weeks.every((w) => w < start);
  const after = !!end && b.weeks.every((w) => w > end);
  if (after) out.push('outside');
  else if (before && kind === 'summary') out.push('prestart');
  return out;
}

function formatPct(v: number): string {
  return v ? String(Math.round(v)) : '';
}

function parsePct(text: string): number | null {
  const t = text.trim().replace(/%$/, '');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Time-bucketed grid with sticky header/labels. Rows with an `assignmentId`
 * are editable like a spreadsheet: click or drag to select, type a number to
 * fill the selection, Delete to clear, arrows/Tab/Enter to move.
 */
export function TimeGrid({ zoom, buckets, rows, corner, empty }: Props) {
  const plan = usePlan();
  const d = useDerived();
  const setAllocations = usePlanStore((s) => s.setAllocations);
  const focusRow = useUIStore((s) => s.focusRow);
  const clearFocusRow = useUIStore((s) => s.clearFocusRow);
  const cellStyle = useUIStore((s) => s.cellStyle);
  const thisWeek = currentWeek();
  const shared = isShared();
  const can = useCan();
  const view = useUIStore((s) => s.view);
  const me = useCollabStore((s) => s.me);
  const locks = useCollabStore((s) => s.locks);
  const presence = useCollabStore((s) => s.presence);
  const recent = useCollabStore((s) => s.recent);
  const threadMap = useCollabStore((s) => s.threads);
  /** Open cell threads by role, for the comment markers. */
  const cellThreads = useMemo(() => {
    const m = new Map<string, Thread[]>();
    for (const t of Object.values(threadMap)) {
      if (t.anchor.kind !== 'cells' || !isOpenThread(t)) continue;
      m.set(t.anchor.roleId, [...(m.get(t.anchor.roleId) ?? []), t]);
    }
    return m;
  }, [threadMap]);
  const serverWeek = useCollabStore((s) => s.thisWeek);
  const toast = useCollabStore((s) => s.toast);
  const [menu, setMenu] = useState<CellMenuTarget | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const editRows = useMemo(() => rows.filter((r) => r.assignmentId), [rows]);
  const editIndex = useMemo(() => new Map(editRows.map((r, i) => [r.key, i])), [editRows]);
  const assignmentsById = useMemo(
    () => new Map<string, Assignment>(plan.assignments.map((a) => [a.id, a])),
    [plan.assignments],
  );

  const bucketIndex = useMemo(() => new Map(buckets.map((b, i) => [b.key, i])), [buckets]);
  /** Week columns that start a month: drawn with a stronger line. */
  const monthStarts = useMemo(() => {
    const out = new Set<number>();
    if (zoom !== 'week') return out;
    buckets.forEach((b, i) => {
      const m = weekMonth(b.weeks[0]);
      const prev = i > 0 ? weekMonth(buckets[i - 1].weeks[0]) : null;
      if (i > 0 && prev && prev.month !== m.month) out.add(i);
    });
    return out;
  }, [buckets, zoom]);
  const highlight = useUIStore((s) => s.highlightResource);
  const rollup = useUIStore((s) => s.rollup);
  const setFocusedCell = useUIStore((s) => s.setFocusedCell);
  const [barDrag, setBarDrag] = useState<BarDrag | null>(null);
  const barDragRef = useRef<BarDrag | null>(null);
  const commitDragRef = useRef<(d: BarDrag) => void>(() => {});
  /** Bars can be dragged where a column is one week. */
  const canDrag = zoom === 'week' && can.edit && cellStyle === 'bars';
  const [anchorKey, setAnchorKey] = useState<CellKey | null>(null);
  const [focusKey, setFocusKey] = useState<CellKey | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const selectAllOnFocus = useRef(false);
  const dragging = useRef(false);

  // Selection is kept by key; if its row or column goes away it simply ends.
  const toPos = (k: CellKey | null): Pos | null => {
    const r = k ? editIndex.get(k.row) : undefined;
    const c = k ? bucketIndex.get(k.bucket) : undefined;
    return r === undefined || c === undefined ? null : { r, c };
  };
  const toKey = (p: Pos | null): CellKey | null =>
    p && editRows[p.r] && buckets[p.c] ? { row: editRows[p.r].key, bucket: buckets[p.c].key } : null;
  const anchor = toPos(anchorKey);
  const focus = toPos(focusKey);
  const setAnchor = (p: Pos | null) => setAnchorKey(toKey(p));
  const setFocus = (p: Pos | null) => setFocusKey(toKey(p));
  if (draft !== null && !focus) setDraft(null);

  useEffect(() => {
    const up = () => {
      dragging.current = false;
      const drag = barDragRef.current;
      if (!drag) return;
      barDragRef.current = null;
      setBarDrag(null);
      commitDragRef.current(drag);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // The inspector follows the focused cell.
  const focusedRole = focusKey ? editRows[editIndex.get(focusKey.row) ?? -1]?.assignmentId : undefined;
  const focusedWeek = focusKey ? buckets[bucketIndex.get(focusKey.bucket) ?? -1]?.weeks[0] : undefined;
  useEffect(() => {
    setFocusedCell(focusedRole && focusedWeek ? { roleId: focusedRole, week: focusedWeek } : null);
  }, [focusedRole, focusedWeek, setFocusedCell]);

  useEffect(() => {
    if (!focus) return;
    scrollRef.current
      ?.querySelector(`[data-pos="${focus.r}:${focus.c}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);

  // Scroll to a row requested from elsewhere (e.g. the conflicts panel); it flashes until cleared.
  useEffect(() => {
    if (!focusRow) return;
    document.getElementById(`row-${focusRow}`)?.scrollIntoView({ block: 'center' });
    const t = window.setTimeout(clearFocusRow, 1600);
    return () => window.clearTimeout(t);
  }, [focusRow, clearFocusRow]);

  // Tell others in the plan what's selected (shared mode).
  const selRoleIds = anchor && focus ? editRows.slice(Math.min(anchor.r, focus.r), Math.max(anchor.r, focus.r) + 1).map((r) => r.assignmentId!) : [];
  const selFrom = anchor && focus ? buckets[Math.min(anchor.c, focus.c)]?.weeks[0] : undefined;
  const selTo = anchor && focus ? buckets[Math.max(anchor.c, focus.c)]?.weeks.at(-1) : undefined;
  const selSig = `${view}|${selRoleIds.join(',')}|${selFrom}|${selTo}`;
  useEffect(() => {
    if (!shared) return;
    sendPresence({ view, ...(selRoleIds.length && selFrom && selTo ? { sel: { roleIds: selRoleIds.slice(0, 100), from: selFrom, to: selTo } } : {}) });
    // selSig captures everything the message depends on.
  }, [selSig, shared]); // eslint-disable-line react-hooks/exhaustive-deps

  const rect =
    anchor && focus
      ? {
          r0: Math.min(anchor.r, focus.r),
          r1: Math.max(anchor.r, focus.r),
          c0: Math.min(anchor.c, focus.c),
          c1: Math.max(anchor.c, focus.c),
        }
      : null;
  const inSelection = (r: number, c: number) =>
    !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
  const isSingle = !!rect && rect.r0 === rect.r1 && rect.c0 === rect.c1;

  const lockUser = { email: me?.email ?? '', admin: me?.role === 'admin' };
  const lockedFor = (a: Assignment, week: WeekKey): Lock | undefined =>
    shared ? cellLockedFor(locks, a, week, serverWeek, lockUser) : undefined;

  /** Says why nothing happened when a viewer (or someone offline) tries to edit. */
  const readOnlyNotice = () => {
    if (shared) toast(me && me.role === 'viewer' ? 'You have view-only access.' : 'You’re offline; editing is paused.');
  };

  /** Applies edits as one change (one undo step), leaving out locked weeks with a note. */
  const applyEdits = (wanted: { a: Assignment; weeks: WeekKey[]; percent: number }[]) => {
    if (!can.edit) return readOnlyNotice();
    const edits: AllocationEdit[] = [];
    let blocked: Lock | undefined;
    for (const { a, weeks, percent } of wanted) {
      // Locked weeks are left out (the server would refuse the whole edit).
      const open = weeks.filter((w) => {
        const l = lockedFor(a, w);
        if (l) blocked ??= l;
        return !l;
      });
      if (open.length) edits.push({ assignmentId: a.id, weeks: open, percent });
    }
    if (blocked) {
      toast(
        blocked.scope === 'past'
          ? 'Past weeks are locked; only admins can change them.'
          : `Some cells are locked by ${blocked.owner}${blocked.note ? ` (“${blocked.note}”)` : ''} and were left as they are.`,
        'info',
      );
    }
    setAllocations(edits);
  };

  const applyToCells = (area: { r0: number; r1: number; c0: number; c1: number }, percent: number) => {
    const weeks = buckets.slice(area.c0, area.c1 + 1).flatMap((b) => b.weeks);
    applyEdits(
      editRows
        .slice(area.r0, area.r1 + 1)
        .map((row) => assignmentsById.get(row.assignmentId!))
        .filter((a): a is Assignment => !!a)
        .map((a) => ({ a, weeks, percent })),
    );
  };

  /** What a bar drag would change, for the preview and the commit. */
  const dragEdits = (drag: BarDrag): DragEdits =>
    drag.kind === 'move'
      ? moveEdits(drag.run, drag.c - drag.c0)
      : resizeEdits(drag.run, drag.kind, buckets[drag.c].weeks[0]);

  const commitDrag = (drag: BarDrag) => {
    const a = assignmentsById.get(drag.roleId);
    if (!a) return;
    const e = dragEdits(drag);
    // A move or resize is one operation. Skipping a locked destination while
    // clearing the source would silently discard part of the booking.
    if ([...e.set, ...e.clear].some((w) => lockedFor(a, w))) {
      toast('That drag touches locked weeks. The booking was left unchanged.', 'info');
      return;
    }
    applyEdits([
      { a, weeks: e.set, percent: e.value },
      { a, weeks: e.clear, percent: 0 },
    ]);
  };
  // The window's mouseup handler commits with this render's plan and locks.
  useEffect(() => {
    commitDragRef.current = commitDrag;
  });

  /** Starts dragging a bar's edge, or (Alt+drag) the whole bar. */
  const startBarDrag = (kind: BarDrag['kind'], r: number, c: number, e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!can.edit) return readOnlyNotice();
    const a = assignmentsById.get(editRows[r].assignmentId!);
    if (!a) return;
    const project = d.projectsById.get(a.projectId);
    const week = buckets[c].weeks[0];
    const state = (w: WeekKey) => bookingState(weekClass(project, w), isFilled(a));
    const run = valueRun(a.weekly, week, (w) => state(w) === state(week));
    if (!run) return;
    const drag = { kind, roleId: a.id, r, c0: c, c, run };
    barDragRef.current = drag;
    setBarDrag(drag);
  };

  const dragPreview = barDrag ? { r: barDrag.r, ...dragEdits(barDrag) } : null;

  const applyToSelection = (percent: number) => {
    if (rect) applyToCells(rect, percent);
  };

  const move = (dr: number, dc: number, extend = false) => {
    if (editRows.length === 0) return;
    const f = focus ?? { r: 0, c: 0 };
    const next = { r: clamp(f.r + dr, 0, editRows.length - 1), c: clamp(f.c + dc, 0, buckets.length - 1) };
    setFocus(next);
    if (!extend || !anchor) setAnchor(next);
  };

  const startEditing = (initial: string, selectAll: boolean) => {
    selectAllOnFocus.current = selectAll;
    draftRef.current = initial;
    setDraft(initial);
  };

  const stopEditing = (commit: boolean) => {
    const text = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (commit && text !== null) {
      const pct = parsePct(text);
      if (pct !== null) applyToSelection(pct);
    }
    scrollRef.current?.focus({ preventScroll: true });
  };

  const cellValue = (assignmentId: string, b: Bucket) => {
    const weekly = assignmentsById.get(assignmentId)?.weekly ?? {};
    return bucketStats((w) => weekly[w] ?? 0, b.weeks);
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== scrollRef.current || !focus) return;
    const mod = e.metaKey || e.ctrlKey;
    if (/^[0-9]$/.test(e.key) && !mod) {
      e.preventDefault();
      if (can.edit) startEditing(e.key, false);
      else readOnlyNotice();
    } else if ((e.key === 'Enter' || e.key === 'F2') && can.edit) {
      e.preventDefault();
      const st = cellValue(editRows[focus.r].assignmentId!, buckets[focus.c]);
      startEditing(formatPct(st.avg), true);
    } else if (e.key === ' ') {
      // Space cycles the whole selection to the step after the focused cell's value.
      e.preventDefault();
      const st = cellValue(editRows[focus.r].assignmentId!, buckets[focus.c]);
      applyToSelection(nextStep(st.avg));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      applyToSelection(0);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[
        e.key as 'ArrowUp'
      ] ?? [0, 0];
      move(dr, dc, e.shiftKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      setAnchor(null);
      setFocus(null);
    } else if ((e.key === 'i' || e.key === 'I') && !mod) {
      e.preventDefault();
      useUIStore.getState().toggleInspector();
    } else if (shared && (e.key === 'h' || e.key === 'H') && !mod) {
      e.preventDefault();
      openMenuAt(focus, null, 'history');
    } else if (shared && (e.key === 'm' || e.key === 'M') && !mod) {
      e.preventDefault();
      openMenuAt(focus, null, 'comments');
    }
  };

  /** Opens the cell menu (or straight to history) for a cell, using the selection if the cell is in it. */
  const openMenuAt = (pos: Pos, at: { x: number; y: number } | null, direct?: 'history' | 'comments') => {
    const area = rect && inSelection(pos.r, pos.c) ? rect : { r0: pos.r, r1: pos.r, c0: pos.c, c1: pos.c };
    const roles = editRows
      .slice(area.r0, area.r1 + 1)
      .map((r) => assignmentsById.get(r.assignmentId!))
      .filter((a): a is Assignment => !!a);
    const cell = assignmentsById.get(editRows[pos.r].assignmentId!);
    if (!cell) return;
    const weeks = buckets.slice(area.c0, area.c1 + 1).flatMap((b) => b.weeks);
    const target: CellMenuTarget = { cell, cellWeeks: buckets[pos.c].weeks, roles, weeks, at, direct };
    if (direct === 'comments') showComments({ anchor: cellCommentAnchor(target) });
    else setMenu(target);
  };

  const onCellMouseDown = (pos: Pos, e: MouseEvent) => {
    if (e.button !== 0) return;
    if (e.altKey && zoom === 'week') {
      const a = assignmentsById.get(editRows[pos.r].assignmentId!);
      if (a?.weekly[buckets[pos.c].weeks[0]]) return startBarDrag('move', pos.r, pos.c, e);
    }
    dragging.current = true;
    setFocus(pos);
    if (!e.shiftKey || !anchor) setAnchor(pos);
  };

  /** Tooltip explaining a flagged week: committed vs tentative load and what makes it up. */
  const loadTitle = (resourceId: string, week: WeekKey, sev: Severity) => {
    const resource = d.resourcesById.get(resourceId);
    const committed = d.loads.committed.get(resourceId)?.get(week) ?? 0;
    const tentative = d.loads.tentative.get(resourceId)?.get(week) ?? 0;
    const parts = (d.assignmentsByResource.get(resourceId) ?? [])
      .filter((a) => a.weekly[week] && d.loads.classAt(a, week) !== 'excluded')
      .map((a) => {
        const project = d.projectsById.get(a.projectId);
        const tag =
          weekKind(project, week) === 'presales'
            ? 'presales'
            : d.loads.classAt(a, week) === 'tentative'
              ? 'pipeline delivery'
              : 'delivery';
        return `${d.projectsById.get(a.projectId)?.name ?? '?'} ${a.weekly[week]}% (${tag})`;
      });
    const head =
      sev !== 'risk'
        ? `${resource?.name ?? 'Resource'} is at ${committed}% committed`
        : `${resource?.name ?? 'Resource'} would be at ${committed + tentative}% if pipeline work is won (${committed}% committed)`;
    return `${head} in the week of ${formatWeek(week)}: ${parts.join(', ')}`;
  };

  /** A row's columns as bars and issue bands, computed once per row per render. */
  const rowTimeline = (a: Assignment): RowTimeline => {
    const project = d.projectsById.get(a.projectId);
    const stats = buckets.map((b) => bucketStats((w) => a.weekly[w] ?? 0, b.weeks));
    const states = buckets.map((b, i): BookingState | null => {
      if (!(stats[i].avg > 0)) return null;
      // A month/quarter column can straddle the start date; it's drawn as its first booked week.
      const repWeek = b.weeks.find((w) => a.weekly[w]) ?? b.weeks[0];
      return bookingState(weekClass(project, repWeek), isFilled(a));
    });
    // An open role is nobody's load, so it's never flagged.
    const flags = buckets.map((b) =>
      isFilled(a) ? assignmentFlagWeeks(a, b.weeks, d.loads, plan.settings) : { over: [], stretch: [], risk: [] },
    );
    const issues = flags.map((f): IssueKind | null =>
      f.over.length
        ? 'critical'
        : f.stretch.length
          ? 'conflict'
          : f.risk.length
            ? a.resourceId && f.risk.every((w) => lowRiskAt(d.loads, a.resourceId!, w, plan.settings))
              ? 'potential-low'
              : 'potential'
            : null,
    );
    const shown = stats.map((st) => (zoom === 'week' ? st.avg : st[rollup]));
    return {
      stats,
      shown,
      states,
      bars: segmentEdges(shown.map((value, i) => ({ value, state: states[i] }))),
      flags,
      issues,
      issueEdges: edges(issues),
    };
  };

  const renderEditCell = (row: GridRow, r: number, b: Bucket, c: number, tl: RowTimeline) => {
    const a = assignmentsById.get(row.assignmentId!);
    if (!a) return <td key={b.key} />;
    const st = tl.stats[c];
    const v = tl.shown[c];
    const repWeek = b.weeks.find((w) => a.weekly[w]) ?? b.weeks[0];
    const kind = weekKind(d.projectsById.get(a.projectId), repWeek);
    const cls = weekClass(d.projectsById.get(a.projectId), repWeek);
    const person = isFilled(a) ? a : null;
    const role = person ? null : a;
    const flags = tl.flags[c];
    const flag: Severity | null = flags.over.length ? 'over' : flags.stretch.length ? 'stretch' : flags.risk.length ? 'risk' : null;
    const flagWeek = flag ? flags[flag][0] : undefined;
    const state = tl.states[c];
    const bar = tl.bars[c];
    const issue = tl.issues[c];
    const issueEdge = tl.issueEdges[c];
    const selected = inSelection(r, c);
    const isFocus = focus?.r === r && focus?.c === c;
    const classes = ['cell', 'edit', kind, ...rangeClasses(row.range, b, 'allocation')];
    if (selected) classes.push('selected');
    if (isFocus) classes.push('focus');
    if (flag) classes.push(flag);
    if (cls === 'tentative') classes.push('tentative');
    if (cls === 'excluded') classes.push('excluded');
    if (b.weeks.includes(thisWeek)) classes.push('today');
    if (monthStarts.has(c)) classes.push('month-start');
    if (st.avg > 0) classes.push('filled');
    if (role) classes.push('open-role');
    if (!can.edit) classes.push('read-only');
    if (dragPreview?.r === r) {
      if (b.weeks.some((w) => dragPreview.set.includes(w))) classes.push('drag-add');
      if (b.weeks.some((w) => dragPreview.clear.includes(w))) classes.push('drag-remove');
    }

    // Shared mode: locks, who else has this cell selected, and recent changes by others.
    let lockNote: string | undefined;
    let presenceColor: string | undefined;
    const presenceNames: string[] = [];
    let recentBy: { email: string; ts: number } | undefined;
    let commentCount = 0;
    if (shared) {
      const covering = locks.filter((l) => b.weeks.some((w) => lockCoversCell(l, a, w, serverWeek)));
      if (covering.length) {
        const mine = covering.every((l) => (l.scope === 'past' ? lockUser.admin : l.owner === lockUser.email));
        classes.push(mine ? 'locked locked-mine' : 'locked');
        const l = covering[0];
        lockNote =
          l.scope === 'past'
            ? 'Locked: past weeks (admins can still edit)'
            : `Locked by ${l.owner}${l.note ? `: “${l.note}”` : ''}${mine ? ' (you can still edit)' : ''}`;
      }
      for (const p of Object.values(presence)) {
        if (p.sel && p.sel.roleIds.includes(a.id) && b.weeks.some((w) => w >= p.sel!.from && w <= p.sel!.to)) {
          presenceColor ??= p.color;
          presenceNames.push(p.name);
        }
      }
      if (presenceColor) classes.push('presence');
      // Old entries are pruned from `recent` (SharedGate), so anything here is recent.
      for (const w of b.weeks) {
        const rc = recent[`${a.id}|${w}`];
        if (rc && (!recentBy || rc.ts > recentBy.ts)) recentBy = rc;
      }
      if (recentBy) classes.push('recent');
      commentCount = (cellThreads.get(a.id) ?? []).filter((t) => anchorOnCell(t.anchor, a.id, b.weeks)).length;
    }

    const when = b.weeks.length > 1 ? formatWeekRange(b.weeks[0], b.weeks[b.weeks.length - 1]) : `week of ${formatWeek(b.weeks[0])}`;
    const amount = st.mixed
      ? `${fteLabel(v)} ${rollup === 'peak' ? 'peak' : 'average'} (avg ${Math.round(st.avg)}%, peak ${st.peak}%)`
      : `${fteLabel(v)} (${Math.round(v)}%)`;
    let title: string | undefined;
    if (person && flag && flagWeek) title = `This row: ${amount}. ${loadTitle(person.resourceId, flagWeek, flag)}`;
    else if (role && st.avg > 0) title = `Open role: ${amount} needed, ${when}. Not anyone's load until filled.`;
    else if (cls === 'excluded' && st.avg > 0) title = `${amount}, ${when}. Delivery on a lost workstream: not counted toward load.`;
    else if (st.avg > 0 && state)
      title = `${BOOKING_LABELS[state]}${kind === 'presales' ? ' (presales)' : ''}: ${amount}, ${when}.${st.mixed ? ` Varies by week, peak ${st.peak}%. Double-clicking or typing sets every week.` : ''}`;
    const notes = [
      lockNote && `🔒 ${lockNote}`,
      presenceNames.length && `${presenceNames.join(', ')} ${presenceNames.length === 1 ? 'has' : 'have'} this selected`,
      recentBy && `Changed by ${recentBy.email} ${relativeMins(recentBy.ts)}`,
      commentCount && `💬 ${commentCount} open comment thread${commentCount === 1 ? '' : 's'} (M to open)`,
    ].filter(Boolean);
    if (notes.length) title = [title, ...notes].filter(Boolean).join('\n');
    const spoken =
      st.avg > 0 && state
        ? [row.name, BOOKING_LABELS[state], fteLabel(v), when, issue === 'critical' || issue === 'conflict' ? 'over capacity' : issue === 'potential-low' ? 'low risk: over capacity only if unlikely pipeline work is won' : issue === 'potential' ? 'over capacity if pipeline is won' : '']
            .filter(Boolean)
            .join(', ')
        : undefined;

    return (
      <td
        key={b.key}
        data-pos={`${r}:${c}`}
        data-value={Math.round(v)}
        className={classes.join(' ')}
        title={title}
        aria-label={spoken}
        style={
          presenceColor || recentBy
            ? ({
                ...(presenceColor ? { '--presence': presenceColor } : {}),
                ...(recentBy ? { '--recent': colorFor(recentBy.email) } : {}),
              } as CSSProperties)
            : undefined
        }
        onMouseDown={(e) => onCellMouseDown({ r, c }, e)}
        onContextMenu={
          shared
            ? (e) => {
                e.preventDefault();
                openMenuAt({ r, c }, { x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        onMouseEnter={() => {
          const drag = barDragRef.current;
          if (drag) {
            if (drag.c !== c) setBarDrag((barDragRef.current = { ...drag, c }));
            return;
          }
          if (dragging.current) setFocus({ r, c });
        }}
        onDoubleClick={() => {
          // A single click only selects; a double-click cycles 0 → 25 → 50 → 100 → 0.
          if (draft !== null) return;
          applyToCells({ r0: r, r1: r, c0: c, c1: c }, nextStep(v));
        }}
      >
        {state && cellStyle === 'pie' && (
          <span className={`pie-wrap pie-${state}`} aria-hidden="true">
            {st.mixed && <span className="mixed">~</span>}
            <Pie value={v} />
          </span>
        )}
        {state && bar && cellStyle !== 'pie' && (
          <span className={`bar bar-${state}${edgeClasses(bar)}`} aria-hidden="true">
            {canDrag && bar.start && (
              <span className="bar-handle start" title="Drag to change when this starts" onMouseDown={(e) => startBarDrag('start', r, c, e)} />
            )}
            {canDrag && bar.end && (
              <span className="bar-handle end" title="Drag to change when this ends" onMouseDown={(e) => startBarDrag('end', r, c, e)} />
            )}
            {(bar.start || cellStyle === 'number') && (
              <span className="bar-label">
                {st.mixed && '~'}
                {cellStyle === 'number' ? formatPct(v) : fteLabel(v)}
              </span>
            )}
          </span>
        )}
        {issue && issueEdge && (
          <span
            className={`issue-band ${issue.startsWith('potential') ? 'issue-potential' : 'issue-conflict'}${issue === 'critical' ? ' issue-critical' : ''}${issue === 'potential-low' ? ' issue-low' : ''}${edgeClasses(issueEdge)}`}
            aria-hidden="true"
          >
            {issueEdge.end && <span className="issue-icon">⚠</span>}
          </span>
        )}
        {isFocus && draft !== null && (
          <input
            className="cell-input"
            autoFocus
            inputMode="numeric"
            value={draft}
            aria-label="Allocation percent"
            onFocus={(e) => {
              const el = e.currentTarget;
              if (selectAllOnFocus.current) el.select();
              else el.setSelectionRange(el.value.length, el.value.length);
            }}
            onChange={(e) => {
              draftRef.current = e.target.value;
              setDraft(e.target.value);
            }}
            onBlur={() => {
              if (draftRef.current !== null) stopEditing(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const single = isSingle;
                stopEditing(true);
                if (single) move(e.shiftKey ? -1 : 1, 0);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                stopEditing(true);
                move(0, e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                stopEditing(false);
              }
            }}
          />
        )}
        {commentCount > 0 && <span className="comment-mark" aria-label={`${commentCount} open comment thread${commentCount === 1 ? '' : 's'}`} />}
      </td>
    );
  };

  const renderSummaryCell = (row: GridRow, cells: (SummaryCell | undefined)[], b: Bucket, c: number, bands: (SegmentEdge | null)[]) => {
    const cell = cells[c];
    const classes = ['cell', 'summary', cell?.className ?? '', ...rangeClasses(row.range, b, 'summary')];
    if (b.weeks.includes(thisWeek)) classes.push('today');
    if (monthStarts.has(c)) classes.push('month-start');
    const band = bands[c];
    // Banded rows say their value where it changes, not in every column.
    const prev = cells[c - 1];
    const changed = !band || band.start || cellStyle !== 'bars' || prev?.text !== cell?.text || prev?.extra !== cell?.extra;
    const shown = cellStyle !== 'bars' && cell?.short ? cell.short : cell;
    return (
      <td key={b.key} className={classes.join(' ')} title={cell?.title}>
        {band && cell?.band && <span className={`demand-band demand-${cell.band}${edgeClasses(band)}`} aria-hidden="true" />}
        {changed && (shown?.text || shown?.extra) && (
          <span className={band ? 'band-label' : undefined}>
            {shown?.text}
            {shown?.extra && <span className="extra">{shown.extra}</span>}
          </span>
        )}
      </td>
    );
  };

  /** Header groups: months over weeks, years over months and quarters. */
  const headerGroups: { key: string; label: string; span: number }[] = [];
  for (const b of buckets) {
    // A week belongs to the month holding its Wednesday (see weekMonth), as in the Month view.
    const m = weekMonth(b.weeks[0]);
    const label = zoom === 'week' ? format(new Date(m.year, m.month, 1), 'MMMM yyyy') : (b.sublabel ?? '');
    const last = headerGroups[headerGroups.length - 1];
    if (last && last.label === label) last.span++;
    else headerGroups.push({ key: b.key, label, span: 1 });
  }

  return (
    <div
      ref={scrollRef}
      className={`grid-scroll zoom-${zoom} cells-${cellStyle}${can.edit ? '' : ' grid-read-only'}`}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      aria-label="Allocation grid"
    >
      <table className="grid">
        <thead>
          <tr className="head-groups">
            <th className="corner" rowSpan={2}>
              {corner}
            </th>
            {headerGroups.map((g) => (
              <th key={g.key} className="col-group" colSpan={g.span}>
                <span>{g.label}</span>
              </th>
            ))}
          </tr>
          <tr className="head-cols">
            {buckets.map((b, c) => (
              <th
                key={b.key}
                className={['col', b.weeks.includes(thisWeek) ? 'today' : '', monthStarts.has(c) ? 'month-start' : ''].filter(Boolean).join(' ')}
                title={b.weeks.length > 1 ? `${b.weeks.length} weeks` : undefined}
              >
                {zoom === 'week' ? (
                  <span className="col-label">{b.label}</span>
                ) : (
                  <button
                    type="button"
                    className="col-label col-drill"
                    title={`Show the weeks of ${b.label} ${b.sublabel ?? ''}`.trim()}
                    onClick={() => {
                      const ui = useUIStore.getState();
                      ui.setZoom('week');
                      ui.setAnchor(b.weeks[0]);
                    }}
                  >
                    {b.label}
                  </button>
                )}
                {zoom === 'week' && b.sublabel && <span className="col-sub">{b.sublabel}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={buckets.length + 1}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const r = editIndex.get(row.key);
            const a = r !== undefined ? assignmentsById.get(row.assignmentId!) : undefined;
            const tl = a ? rowTimeline(a) : undefined;
            const cells = r === undefined ? buckets.map((b) => row.summary?.(b)) : [];
            const bands = edges(cells.map((x) => (x?.band && (x.text || x.extra) ? x.band : null)));
            const dim = !!highlight && !!row.resourceId && row.resourceId !== highlight;
            const lit = !!highlight && row.resourceId === highlight;
            return (
              <tr
                key={row.key}
                id={`row-${row.key}`}
                className={[`depth-${row.depth}`, row.className, focusRow === row.key ? 'flash' : '', dim ? 'dimmed' : '', lit ? 'highlighted' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <th scope="row" className="label">
                  {row.label}
                </th>
                {buckets.map((b, c) =>
                  r !== undefined && tl ? renderEditCell(row, r, b, c, tl) : renderSummaryCell(row, cells, b, c, bands),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu && <CellMenu target={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

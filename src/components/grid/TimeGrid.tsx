import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { bucketStats } from '../../domain/aggregate';
import { assignmentFlagWeeks } from '../../domain/conflicts';
import { totalIsCritical, weekClass, weekKind, type Severity } from '../../domain/load';
import { isFilled, type Assignment, type WeekKey, type Zoom } from '../../domain/types';
import { nextStep } from '../../domain/steps';
import { currentWeek, formatWeek, type Bucket } from '../../domain/weeks';
import { usePlan, usePlanStore, type AllocationEdit } from '../../store/planStore';
import { useUIStore } from '../../store/uiStore';
import { useDerived } from '../../store/useDerived';
import { Pie } from './Pie';

export interface SummaryCell {
  text: string;
  /** Secondary value shown small after the text (e.g. tentative load). */
  extra?: string;
  className?: string;
  title?: string;
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const editRows = useMemo(() => rows.filter((r) => r.assignmentId), [rows]);
  const editIndex = useMemo(() => new Map(editRows.map((r, i) => [r.key, i])), [editRows]);
  const assignmentsById = useMemo(
    () => new Map<string, Assignment>(plan.assignments.map((a) => [a.id, a])),
    [plan.assignments],
  );

  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const selectAllOnFocus = useRef(false);
  const dragging = useRef(false);

  // Reset the selection when the set of editable rows or columns changes.
  const signature = editRows.map((r) => r.key).join('|') + '#' + buckets.map((b) => b.key).join('|');
  const [selectionFor, setSelectionFor] = useState(signature);
  if (selectionFor !== signature) {
    setSelectionFor(signature);
    setAnchor(null);
    setFocus(null);
    setDraft(null);
  }

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

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

  const applyToCells = (area: { r0: number; r1: number; c0: number; c1: number }, percent: number) => {
    const weeks = buckets.slice(area.c0, area.c1 + 1).flatMap((b) => b.weeks);
    const edits: AllocationEdit[] = [];
    for (let r = area.r0; r <= area.r1; r++) {
      edits.push({ assignmentId: editRows[r].assignmentId!, weeks, percent });
    }
    setAllocations(edits);
  };

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
      startEditing(e.key, false);
    } else if (e.key === 'Enter' || e.key === 'F2') {
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
    }
  };

  const onCellMouseDown = (pos: Pos, e: MouseEvent) => {
    if (e.button !== 0) return;
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

  const renderEditCell = (row: GridRow, r: number, b: Bucket, c: number) => {
    const a = assignmentsById.get(row.assignmentId!);
    if (!a) return <td key={b.key} />;
    const st = cellValue(a.id, b);
    // A month/quarter cell can straddle the start date; style it by its first allocated week.
    const repWeek = b.weeks.find((w) => a.weekly[w]) ?? b.weeks[0];
    const kind = weekKind(d.projectsById.get(a.projectId), repWeek);
    const cls = weekClass(d.projectsById.get(a.projectId), repWeek);
    const person = isFilled(a) ? a : null;
    const role = person ? null : a;
    // An open role is nobody's load, so it's never flagged.
    const flags = person
      ? assignmentFlagWeeks(person, b.weeks, d.loads, plan.settings)
      : { over: [] as WeekKey[], stretch: [] as WeekKey[], risk: [] as WeekKey[] };
    const flag: Severity | null = flags.over.length ? 'over' : flags.stretch.length ? 'stretch' : flags.risk.length ? 'risk' : null;
    const flagWeek = flag ? flags[flag][0] : undefined;
    const selected = inSelection(r, c);
    const isFocus = focus?.r === r && focus?.c === c;
    const classes = ['cell', 'edit', kind, ...rangeClasses(row.range, b, 'allocation')];
    if (selected) classes.push('selected');
    if (isFocus) classes.push('focus');
    if (flag) classes.push(flag);
    // Pipeline-driven overload past the red threshold is drawn red, like an overallocation.
    if (
      person &&
      flag === 'risk' &&
      flags.risk.some((w) =>
        totalIsCritical(
          d.loads.committed.get(person.resourceId)?.get(w) ?? 0,
          d.loads.tentative.get(person.resourceId)?.get(w) ?? 0,
          plan.settings,
        ),
      )
    ) {
      classes.push('risk-critical');
    }
    if (cls === 'tentative') classes.push('tentative');
    if (cls === 'excluded') classes.push('excluded');
    if (b.weeks.includes(thisWeek)) classes.push('today');
    if (st.avg > 0) classes.push('filled');
    if (role) classes.push('open-role');

    let title: string | undefined;
    if (person && flag && flagWeek) title = `This row: ${Math.round(st.avg)}%. ${loadTitle(person.resourceId, flagWeek, flag)}`;
    else if (role && st.avg > 0) title = `Open role: ${Math.round(st.avg)}% needed${st.mixed ? ' (average)' : ''}. Not anyone's load until filled.`;
    else if (cls === 'excluded' && st.avg > 0) title = 'Delivery on a lost workstream: not counted toward load.';
    else if (st.mixed) title = `Varies by week: avg ${Math.round(st.avg)}%, peak ${st.peak}%. Double-clicking or typing sets every week.`;
    else if (st.avg > 0) title = `${Math.round(st.avg)}%`;

    return (
      <td
        key={b.key}
        data-pos={`${r}:${c}`}
        data-value={Math.round(st.avg)}
        className={classes.join(' ')}
        title={title}
        onMouseDown={(e) => onCellMouseDown({ r, c }, e)}
        onMouseEnter={() => {
          if (dragging.current) setFocus({ r, c });
        }}
        onDoubleClick={() => {
          // A single click only selects; a double-click cycles 0 → 25 → 50 → 100 → 0.
          if (draft !== null) return;
          applyToCells({ r0: r, r1: r, c0: c, c1: c }, nextStep(st.avg));
        }}
      >
        {isFocus && draft !== null ? (
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
        ) : cellStyle === 'pie' ? (
          st.avg > 0 && (
            <span className="pie-wrap">
              {st.mixed && <span className="mixed">~</span>}
              <Pie value={st.avg} />
            </span>
          )
        ) : (
          <>
            {st.mixed && st.avg > 0 && <span className="mixed">~</span>}
            {formatPct(st.avg)}
          </>
        )}
      </td>
    );
  };

  const renderSummaryCell = (row: GridRow, b: Bucket) => {
    const cell = row.summary?.(b);
    const classes = ['cell', 'summary', cell?.className ?? '', ...rangeClasses(row.range, b, 'summary')];
    if (b.weeks.includes(thisWeek)) classes.push('today');
    return (
      <td key={b.key} className={classes.join(' ')} title={cell?.title}>
        {cell?.text}
        {cell?.extra && <span className="extra">{cell.extra}</span>}
      </td>
    );
  };

  return (
    <div
      ref={scrollRef}
      className={`grid-scroll zoom-${zoom} cells-${cellStyle}`}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      aria-label="Allocation grid"
    >
      <table className="grid">
        <thead>
          <tr>
            <th className="corner">{corner}</th>
            {buckets.map((b) => (
              <th key={b.key} className={b.weeks.includes(thisWeek) ? 'col today' : 'col'} title={b.weeks.length > 1 ? `${b.weeks.length} weeks` : undefined}>
                <span className="col-label">{b.label}</span>
                {b.sublabel && <span className="col-sub">{b.sublabel}</span>}
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
            return (
              <tr
                key={row.key}
                id={`row-${row.key}`}
                className={[`depth-${row.depth}`, row.className, focusRow === row.key ? 'flash' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <th scope="row" className="label">
                  {row.label}
                </th>
                {buckets.map((b, c) =>
                  r !== undefined ? renderEditCell(row, r, b, c) : renderSummaryCell(row, b),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

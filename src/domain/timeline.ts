import type { LoadClass } from './load';
import type { WeekKey } from './types';
import { addWeeks, weeksBetween } from './weeks';

/**
 * How a booked week is drawn on the timeline:
 * - confirmed: counts toward the person's load (presales, or delivery on a won workstream)
 * - tentative: pipeline delivery, counted only as "if won"
 * - open: an unfilled role (demand nobody covers yet)
 * - excluded: delivery on a lost workstream, not counted
 *
 * Booking state is derived from the week's load class for now; the plan has no
 * per-assignment confirmed/tentative flag yet.
 */
export type BookingState = 'confirmed' | 'tentative' | 'open' | 'excluded';

export function bookingState(cls: LoadClass, filled: boolean): BookingState {
  if (!filled) return 'open';
  if (cls === 'committed') return 'confirmed';
  return cls;
}

export const BOOKING_LABELS: Record<BookingState, string> = {
  confirmed: 'Confirmed',
  tentative: 'Tentative',
  open: 'Open role',
  excluded: 'Not counted (lost)',
};

/** One column of a row: its (average) % and how it's booked; 0 means nothing booked. */
export interface TimelineCell {
  value: number;
  state: BookingState | null;
}

/** Where a column sits in its bar. A bar is a run of columns with the same % and state. */
export interface SegmentEdge {
  start: boolean;
  end: boolean;
}

/**
 * Where each column sits in its run of equal, non-null keys: a run starts
 * where the key differs from the column before and ends where it differs
 * from the column after.
 */
export function edges(keys: (string | null)[]): (SegmentEdge | null)[] {
  return keys.map((k, i) => (k === null ? null : { start: keys[i - 1] !== k, end: keys[i + 1] !== k }));
}

/**
 * Splits a row into bars: consecutive columns with the same % and booking
 * state form one bar, and a change of either starts a new, touching bar. The
 * % is labelled once, at the start of each bar. Averages are compared rounded.
 */
export function segmentEdges(cells: TimelineCell[]): (SegmentEdge | null)[] {
  return edges(cells.map((c) => (c.value > 0 ? `${Math.round(c.value)}|${c.state}` : null)));
}

/** Weekly % as FTE: 50 → "0.5 FTE", 25 → "0.25 FTE", 100 → "1.0 FTE". */
export function fte(percent: number): string {
  const s = (percent / 100).toFixed(2).replace(/0$/, '');
  return s.endsWith('.') ? `${s}0` : s;
}

export function fteLabel(percent: number): string {
  return `${fte(percent)} FTE`;
}

/** Runs of consecutive true flags, as [start, end] column indexes (inclusive). */
export function runs(flags: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  flags.forEach((on, i) => {
    if (!on) return;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  });
  return out;
}

/** A run of consecutive weeks on one row with the same %: what dragging a bar moves or resizes. */
export interface WeekRun {
  from: WeekKey;
  to: WeekKey;
  value: number;
}

/**
 * The run of equal, non-zero weeks containing `week`, or null if the week is
 * empty. `sameBar` can end the run earlier, e.g. where the booking state
 * changes and the grid draws a new bar.
 */
export function valueRun(
  weekly: Record<WeekKey, number>,
  week: WeekKey,
  sameBar: (w: WeekKey) => boolean = () => true,
): WeekRun | null {
  const value = weekly[week];
  if (!value) return null;
  const joins = (w: WeekKey) => weekly[w] === value && sameBar(w);
  let from = week;
  while (joins(addWeeks(from, -1))) from = addWeeks(from, -1);
  let to = week;
  while (joins(addWeeks(to, 1))) to = addWeeks(to, 1);
  return { from, to, value };
}

/** Weeks to fill with the run's % and weeks to clear, for one drag. */
export interface DragEdits {
  set: WeekKey[];
  clear: WeekKey[];
  value: number;
}

/**
 * Drags one edge of a run to `target`. Extending fills the new weeks with the
 * run's %; shrinking clears weeks. An edge can't pass the other one, so a run
 * shrinks to one week at least (Delete clears it entirely).
 */
export function resizeEdits(run: WeekRun, edge: 'start' | 'end', target: WeekKey): DragEdits {
  const out: DragEdits = { set: [], clear: [], value: run.value };
  if (edge === 'end') {
    const to = target < run.from ? run.from : target;
    if (to > run.to) out.set = weeksBetween(addWeeks(run.to, 1), to);
    else if (to < run.to) out.clear = weeksBetween(addWeeks(to, 1), run.to);
  } else {
    const from = target > run.to ? run.to : target;
    if (from < run.from) out.set = weeksBetween(from, addWeeks(run.from, -1));
    else if (from > run.from) out.clear = weeksBetween(run.from, addWeeks(from, -1));
  }
  return out;
}

/** Moves a whole run by `delta` weeks; where it lands on other bookings, the moved % wins. */
export function moveEdits(run: WeekRun, delta: number): DragEdits {
  if (delta === 0) return { set: [], clear: [], value: run.value };
  const set = weeksBetween(addWeeks(run.from, delta), addWeeks(run.to, delta));
  const landing = new Set(set);
  return { set, clear: weeksBetween(run.from, run.to).filter((w) => !landing.has(w)), value: run.value };
}

import type { LoadClass } from './load';

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

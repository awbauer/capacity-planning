import {
  addDays,
  addMonths,
  addWeeks as dfAddWeeks,
  differenceInCalendarDays,
  format,
  getISOWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { WeekKey, Zoom } from './types';

const KEY_FORMAT = 'yyyy-MM-dd';

export const ZOOM_COLUMNS: Record<Zoom, number> = { week: 26, month: 12, quarter: 8 };

export interface Bucket {
  key: string;
  label: string;
  sublabel?: string;
  weeks: WeekKey[];
}

export function toWeekKey(date: Date): WeekKey {
  return format(startOfWeek(date, { weekStartsOn: 1 }), KEY_FORMAT);
}

/** Parses a week key (or any yyyy-MM-dd) as local midnight. */
export function parseWeek(key: WeekKey): Date {
  return parseISO(key);
}

export function addWeeks(key: WeekKey, n: number): WeekKey {
  return format(dfAddWeeks(parseWeek(key), n), KEY_FORMAT);
}

export function currentWeek(today: Date = new Date()): WeekKey {
  return toWeekKey(today);
}

/** Whole weeks from `from` to `to` (negative if `to` is earlier). */
export function weeksApart(from: WeekKey, to: WeekKey): number {
  return Math.round(differenceInCalendarDays(parseWeek(to), parseWeek(from)) / 7);
}

/**
 * Moves every week on or after `from` by `delta` weeks; earlier weeks stay.
 * Where a moved week lands on a week that stayed, the moved value wins.
 */
export function shiftWeekly(weekly: Record<WeekKey, number>, from: WeekKey, delta: number): Record<WeekKey, number> {
  if (delta === 0) return weekly;
  const kept: Record<WeekKey, number> = {};
  const moved: Record<WeekKey, number> = {};
  for (const [w, v] of Object.entries(weekly)) {
    if (w >= from) moved[addWeeks(w, delta)] = v;
    else kept[w] = v;
  }
  return { ...kept, ...moved };
}

/** Normalizes any yyyy-MM-dd date string to the Monday of its week. */
export function normalizeWeek(dateStr: string): WeekKey {
  return toWeekKey(parseISO(dateStr));
}

/** Inclusive list of weeks from `from` to `to`. Empty if `to` precedes `from`. */
export function weeksBetween(from: WeekKey, to: WeekKey): WeekKey[] {
  const out: WeekKey[] = [];
  for (let w = from; w <= to; w = addWeeks(w, 1)) out.push(w);
  return out;
}

/**
 * The month a week belongs to: the month containing its Wednesday, which is
 * where the majority of its Mon–Fri working days fall.
 */
export function weekMonth(key: WeekKey): { year: number; month: number } {
  const wed = addDays(parseWeek(key), 2);
  return { year: wed.getFullYear(), month: wed.getMonth() };
}

/** First week (by the Wednesday rule) belonging to the given month. */
function firstWeekOfMonth(year: number, month: number): WeekKey {
  const w = toWeekKey(new Date(year, month, 1));
  const m = weekMonth(w);
  return m.year === year && m.month === month ? w : addWeeks(w, 1);
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

function bucketForMonths(year: number, month: number, count: number): WeekKey[] {
  const weeks: WeekKey[] = [];
  const end = monthIndex(year, month) + count;
  for (let w = firstWeekOfMonth(year, month); ; w = addWeeks(w, 1)) {
    const m = weekMonth(w);
    if (monthIndex(m.year, m.month) >= end) break;
    weeks.push(w);
  }
  return weeks;
}

export function buckets(zoom: Zoom, anchor: WeekKey): Bucket[] {
  const n = ZOOM_COLUMNS[zoom];
  if (zoom === 'week') {
    return Array.from({ length: n }, (_, i) => {
      const w = addWeeks(anchor, i);
      const d = parseWeek(w);
      return { key: w, label: format(d, 'MMM d'), sublabel: `W${getISOWeek(d)}`, weeks: [w] };
    });
  }
  const { year, month } = weekMonth(anchor);
  if (zoom === 'month') {
    return Array.from({ length: n }, (_, i) => {
      const d = addMonths(new Date(year, month, 1), i);
      return {
        key: format(d, 'yyyy-MM'),
        label: format(d, 'MMM'),
        sublabel: format(d, 'yyyy'),
        weeks: bucketForMonths(d.getFullYear(), d.getMonth(), 1),
      };
    });
  }
  const qStart = month - (month % 3);
  return Array.from({ length: n }, (_, i) => {
    const d = addMonths(new Date(year, qStart, 1), i * 3);
    const q = Math.floor(d.getMonth() / 3) + 1;
    return {
      key: `${d.getFullYear()}-Q${q}`,
      label: `Q${q}`,
      sublabel: String(d.getFullYear()),
      weeks: bucketForMonths(d.getFullYear(), d.getMonth(), 3),
    };
  });
}

/** Moves the view anchor one "page step" in the given direction. */
export function shiftAnchor(zoom: Zoom, anchor: WeekKey, dir: 1 | -1): WeekKey {
  if (zoom === 'week') return addWeeks(anchor, 4 * dir);
  const { year, month } = weekMonth(anchor);
  const step = zoom === 'month' ? 3 : 6;
  const d = startOfMonth(addMonths(new Date(year, month, 1), step * dir));
  return firstWeekOfMonth(d.getFullYear(), d.getMonth());
}

export function formatWeek(key: WeekKey): string {
  return format(parseWeek(key), 'MMM d, yyyy');
}

export function formatWeekRange(from: WeekKey, to: WeekKey): string {
  if (from === to) return `wk of ${formatWeek(from)}`;
  return `${format(parseWeek(from), 'MMM d')} – ${format(addDays(parseWeek(to), 4), 'MMM d, yyyy')}`;
}

/**
 * The current week as seen in an IANA time zone (falls back to UTC). The
 * server and every browser use this with the workspace's zone, so they agree
 * on which weeks are "past" even across a Monday.
 */
/** The shared workspace's time zone until an admin picks one (Manage → Settings). */
export const DEFAULT_TIME_ZONE = 'America/New_York';

/** Whether a string is an IANA time zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function weekInZone(timeZone: string | undefined, now: Date = new Date()): WeekKey {
  let ymd: string;
  try {
    ymd = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    ymd = now.toISOString().slice(0, 10);
  }
  const [y, m, d] = ymd.split('-').map(Number);
  return toWeekKey(new Date(y, m - 1, d));
}

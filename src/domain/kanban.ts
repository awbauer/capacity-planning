import { assignmentFlagWeeks } from './conflicts';
import { LIKELY_WIN, lowRiskAt, weekKind, type SplitLoads } from './load';
import { isFilled, type Assignment, type PlanSettings, type Project, type WeekKey, type WinProbability } from './types';
import { weeksBetween } from './weeks';

/** Kanban columns, left to right: pipeline by win % (unset first), then won and lost. */
export type KanbanColumn = 'unknown' | `${WinProbability}` | 'won' | 'lost';

export const KANBAN_COLUMNS: { id: KanbanColumn; label: string }[] = [
  { id: 'unknown', label: 'Unknown' },
  { id: '25', label: '25%' },
  { id: '50', label: '50%' },
  { id: '75', label: '75%' },
  { id: '90', label: '90%' },
  { id: 'won', label: 'Sold' },
  { id: 'lost', label: 'Lost' },
];

export function kanbanColumn(p: Pick<Project, 'status' | 'winProbability'>): KanbanColumn {
  if (p.status !== 'pipeline') return p.status;
  return p.winProbability ? (`${p.winProbability}` as KanbanColumn) : 'unknown';
}

/**
 * The change that moves a workstream into a column. Won and lost keep the win %
 * (it's only used while in the pipeline), so dragging a card back restores it.
 */
export function columnPatch(col: KanbanColumn): Pick<Project, 'status'> & { winProbability?: WinProbability | undefined } {
  if (col === 'won' || col === 'lost') return { status: col };
  return { status: 'pipeline', winProbability: col === 'unknown' ? undefined : (Number(col) as WinProbability) };
}

/** Late-stage cards show delivery staffing; early ones the people on presales. */
export function showsStaffing(p: Pick<Project, 'status' | 'winProbability'>): boolean {
  return p.status === 'won' || (p.status === 'pipeline' && (p.winProbability ?? 0) >= LIKELY_WIN);
}

export interface PersonFte {
  resourceId: string;
  /** Average % over the weeks they're booked in that phase. */
  pct: number;
}

/** A workstream's delivery size and staffing, averaged over its delivery weeks. All values are weekly % (100 = 1 FTE). */
export interface WorkstreamStats {
  /** Delivery weeks: start to end date, or else the first to last booked delivery week. */
  weeks: WeekKey[];
  /** Every role, filled or open. */
  demand: number;
  /** Filled roles. */
  staffed: number;
  /** Filled roles that count as booked (won); `tentative` while it's in the pipeline. Lost counts as neither. */
  confirmed: number;
  tentative: number;
  /** Open roles. */
  unfilled: number;
  /** People on presales (weeks before the start date), most effort first. */
  presales: PersonFte[];
  /** People on delivery, most effort first. */
  delivery: PersonFte[];
}

function byPerson(roles: Assignment[], weekOk: (w: WeekKey) => boolean): PersonFte[] {
  const sums = new Map<string, Map<WeekKey, number>>();
  for (const a of roles) {
    if (!isFilled(a)) continue;
    for (const [w, pct] of Object.entries(a.weekly)) {
      if (!pct || !weekOk(w)) continue;
      const weeks = sums.get(a.resourceId) ?? new Map<WeekKey, number>();
      weeks.set(w, (weeks.get(w) ?? 0) + pct);
      sums.set(a.resourceId, weeks);
    }
  }
  return [...sums]
    .map(([resourceId, weeks]) => ({ resourceId, pct: [...weeks.values()].reduce((n, v) => n + v, 0) / weeks.size }))
    .sort((a, b) => b.pct - a.pct || a.resourceId.localeCompare(b.resourceId));
}

export function workstreamStats(p: Project, roles: Assignment[]): WorkstreamStats {
  const isDelivery = (w: WeekKey) => weekKind(p, w) === 'delivery';
  let weeks: WeekKey[] = [];
  if (p.startWeek && p.endWeek && p.endWeek >= p.startWeek) {
    weeks = weeksBetween(p.startWeek, p.endWeek);
  } else {
    const booked = roles.flatMap((a) => Object.keys(a.weekly).filter((w) => a.weekly[w] > 0 && isDelivery(w))).sort();
    if (booked.length) weeks = weeksBetween(p.startWeek && p.startWeek < booked[0] ? p.startWeek : booked[0], booked.at(-1)!);
  }
  const avg = (filter: (a: Assignment) => boolean) =>
    weeks.length
      ? roles.filter(filter).reduce((n, a) => n + weeks.reduce((m, w) => m + (a.weekly[w] ?? 0), 0), 0) / weeks.length
      : 0;
  const demand = avg(() => true);
  const staffed = avg(isFilled);
  return {
    weeks,
    demand,
    staffed,
    confirmed: p.status === 'won' ? staffed : 0,
    tentative: p.status === 'pipeline' ? staffed : 0,
    unfilled: demand - staffed,
    presales: byPerson(roles, (w) => !isDelivery(w)),
    delivery: byPerson(roles, (w) => weeks.includes(w)),
  };
}

/** One week of a team's load, as the average % per person (100 = everyone fully booked). */
export interface TeamWeek {
  week: WeekKey;
  committed: number;
  pipeline: number;
  /** People on the team over capacity on committed work that week. */
  over: string[];
}

/** The load of a workstream's people across all their work, week by week. */
export function teamLoad(resourceIds: string[], weeks: WeekKey[], loads: SplitLoads, overThreshold: number): TeamWeek[] {
  const n = resourceIds.length || 1;
  return weeks.map((week) => {
    let committed = 0;
    let pipeline = 0;
    const over: string[] = [];
    for (const id of resourceIds) {
      const c = loads.committed.get(id)?.get(week) ?? 0;
      committed += c;
      pipeline += loads.tentative.get(id)?.get(week) ?? 0;
      if (c > overThreshold) over.push(id);
    }
    return { week, committed: committed / n, pipeline: pipeline / n, over };
  });
}

/** How a person in a role stands from `fromWeek` on, worst first. */
export type RoleStanding = 'conflict' | 'risk' | 'low-risk' | 'ok';

export interface WorkstreamIssues {
  /** Each role's standing (open roles are left out). */
  standing: Map<string, RoleStanding>;
  /** People over capacity on committed work. */
  conflictPeople: Set<string>;
  /** People over only if pipeline work is won (and not in conflict). */
  riskPeople: Set<string>;
  /** True when every risk is only through pipeline work under LIKELY_WIN% likely. */
  allRiskLow: boolean;
  /** Open roles with demand from `fromWeek` on. */
  openRoles: number;
}

/** Issues on a workstream's people from `fromWeek` on (the past can't be fixed). */
export function workstreamIssues(roles: Assignment[], loads: SplitLoads, settings: PlanSettings, fromWeek: WeekKey): WorkstreamIssues {
  const standing = new Map<string, RoleStanding>();
  const conflictPeople = new Set<string>();
  const risky = new Map<string, boolean>();
  let openRoles = 0;
  for (const a of roles) {
    const weeks = Object.keys(a.weekly).filter((w) => w >= fromWeek && a.weekly[w] > 0);
    if (!isFilled(a)) {
      if (weeks.length) openRoles++;
      continue;
    }
    const flags = assignmentFlagWeeks(a, weeks, loads, settings);
    if (flags.over.length || flags.stretch.length) {
      standing.set(a.id, 'conflict');
      conflictPeople.add(a.resourceId);
    } else if (flags.risk.length) {
      const low = flags.risk.every((w) => lowRiskAt(loads, a.resourceId, w, settings));
      standing.set(a.id, low ? 'low-risk' : 'risk');
      risky.set(a.resourceId, (risky.get(a.resourceId) ?? true) && low);
    } else {
      standing.set(a.id, 'ok');
    }
  }
  const riskPeople = new Set([...risky.keys()].filter((id) => !conflictPeople.has(id)));
  return {
    standing,
    conflictPeople,
    riskPeople,
    allRiskLow: [...riskPeople].every((id) => risky.get(id)),
    openRoles,
  };
}

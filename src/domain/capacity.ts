import type { Overallocation } from './conflicts';
import type { SplitLoads } from './load';
import type { PlanData, WeekKey } from './types';

/**
 * Team capacity in FTE-weeks (one person for one week at 100% = 1 FTE-week).
 * Every share below uses the same denominator, `supply`.
 *
 * Supply assumes everyone is available full time every week: the plan has no
 * part-time schedules or leave yet.
 */
export interface CapacitySummary {
  weeks: number;
  people: number;
  /** People × weeks. */
  supply: number;
  /** Filled roles on won workstreams (presales and delivery). */
  delivery: number;
  /** Filled roles on pipeline workstreams (presales and tentative delivery), unweighted. */
  pipeline: number;
  /** Presales on lost workstreams: time that was spent, on nothing live. */
  other: number;
  /** Unused supply: max(0, supply − demand). Not a promise that nobody is over. */
  headroom: number;
  /** Demand beyond supply: max(0, demand − supply). */
  overflow: number;
}

export interface PersonCapacity {
  resourceId: string;
  /** FTE-weeks booked on won / pipeline / other workstreams in the window. */
  delivery: number;
  pipeline: number;
  other: number;
  /** Booked FTE-weeks ÷ available FTE-weeks, as a %. Can pass 100. */
  utilization: number;
  /** Weeks over capacity on committed work, and weeks over only if pipeline is won. */
  conflictWeeks: number;
  riskWeeks: number;
}

export interface OpenRoleDemand {
  roleId: string;
  projectId: string;
  /** Unfilled FTE-weeks in the window. */
  fteWeeks: number;
  /** First week in the window with demand. */
  from: WeekKey;
}

/** FTE-weeks booked per person in the window, split by workstream status. Delivery on lost workstreams is left out. */
export function capacityByPerson(
  plan: Pick<PlanData, 'assignments' | 'projects' | 'resources'>,
  loads: SplitLoads,
  overallocations: Overallocation[],
  weeks: WeekKey[],
): PersonCapacity[] {
  const status = new Map(plan.projects.map((p) => [p.id, p.status]));
  const inWindow = new Set(weeks);
  const rows = new Map<string, PersonCapacity>(
    plan.resources.map((r) => [
      r.id,
      { resourceId: r.id, delivery: 0, pipeline: 0, other: 0, utilization: 0, conflictWeeks: 0, riskWeeks: 0 },
    ]),
  );
  for (const a of plan.assignments) {
    const row = a.resourceId === null ? undefined : rows.get(a.resourceId);
    if (!row) continue;
    for (const w of weeks) {
      const pct = a.weekly[w];
      if (!pct || loads.classAt(a, w) === 'excluded') continue;
      const s = status.get(a.projectId);
      const key = s === 'won' ? 'delivery' : s === 'pipeline' ? 'pipeline' : 'other';
      row[key] += pct / 100;
    }
  }
  for (const o of overallocations) {
    const row = rows.get(o.resourceId);
    if (!row) continue;
    const n = o.weeks.filter((w) => inWindow.has(w)).length;
    if (o.severity === 'risk') row.riskWeeks += n;
    else row.conflictWeeks += n;
  }
  for (const row of rows.values()) {
    row.utilization = weeks.length ? (100 * (row.delivery + row.pipeline + row.other)) / weeks.length : 0;
  }
  return [...rows.values()];
}

export function capacitySummary(people: PersonCapacity[], weeks: number): CapacitySummary {
  const sum = (k: 'delivery' | 'pipeline' | 'other') => people.reduce((n, p) => n + p[k], 0);
  const supply = people.length * weeks;
  const delivery = sum('delivery');
  const pipeline = sum('pipeline');
  const other = sum('other');
  const demand = delivery + pipeline + other;
  return {
    weeks,
    people: people.length,
    supply,
    delivery,
    pipeline,
    other,
    headroom: Math.max(0, supply - demand),
    overflow: Math.max(0, demand - supply),
  };
}

/** Share of supply, as a %; 0 when there is no supply. */
export function shareOf(part: number, s: Pick<CapacitySummary, 'supply'>): number {
  return s.supply ? (100 * part) / s.supply : 0;
}

/** Open roles with demand in the window on workstreams that aren't lost, largest first. */
export function openRoleDemand(plan: Pick<PlanData, 'assignments' | 'projects'>, weeks: WeekKey[]): OpenRoleDemand[] {
  const lost = new Set(plan.projects.filter((p) => p.status === 'lost').map((p) => p.id));
  const out: OpenRoleDemand[] = [];
  for (const a of plan.assignments) {
    if (a.resourceId !== null || lost.has(a.projectId)) continue;
    const booked = weeks.filter((w) => a.weekly[w] > 0);
    if (!booked.length) continue;
    out.push({
      roleId: a.id,
      projectId: a.projectId,
      fteWeeks: booked.reduce((n, w) => n + a.weekly[w] / 100, 0),
      from: booked[0],
    });
  }
  return out.sort((a, b) => b.fteWeeks - a.fteWeeks || a.from.localeCompare(b.from));
}

/** Issues in the window across the whole plan, whatever is filtered: each counted once. */
export interface IssueCounts {
  /** Runs of weeks where someone's committed work is over capacity. */
  conflicts: number;
  /** People with at least one such run. */
  conflictPeople: number;
  /** Runs that go over only if pipeline work is won. */
  risks: number;
  /** Open roles with demand in the window. */
  openRoles: number;
}

export function issueCounts(
  overallocations: Overallocation[],
  openRoles: OpenRoleDemand[],
  weeks: WeekKey[],
): IssueCounts {
  const inWindow = new Set(weeks);
  const visible = overallocations.filter((o) => o.weeks.some((w) => inWindow.has(w)));
  const conflicts = visible.filter((o) => o.severity !== 'risk');
  return {
    conflicts: conflicts.length,
    conflictPeople: new Set(conflicts.map((o) => o.resourceId)).size,
    risks: visible.length - conflicts.length,
    openRoles: openRoles.length,
  };
}

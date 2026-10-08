import { assignmentFlagWeeks, requiredTags } from './conflicts';
import type { Derived } from './derive';
import { weekKind } from './load';
import type { Assignment, PlanData, Project, Resource, WeekKey } from './types';
import { utilizationByResource, utilizationOf, utilizationTarget, type Utilization } from './utilization';

/** One line of a health checklist: passes, or fails with what's wrong. */
export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** For a failed check, what's wrong; for a passed one, optional context. */
  detail?: string;
}

export type RolePhase = 'presales' | 'delivery' | 'both' | 'none';

export interface RoleSummary {
  role: Assignment;
  /** First and last allocated week from `from` on (undefined if none). */
  first?: WeekKey;
  last?: WeekKey;
  /** Which phases the role's weeks from `from` on fall in. */
  phase: RolePhase;
  /** Average % over the given window. */
  avg: number;
}

/** A role's weeks from `from` on: when, which phase, and its average % over `window`. */
export function summarizeRole(role: Assignment, project: Project | undefined, from: WeekKey, window: WeekKey[]): RoleSummary {
  const weeks = Object.keys(role.weekly)
    .filter((w) => w >= from && role.weekly[w] > 0)
    .sort();
  const kinds = new Set(weeks.map((w) => weekKind(project, w)));
  const phase: RolePhase =
    kinds.size === 2 ? 'both' : kinds.has('presales') ? 'presales' : kinds.has('delivery') ? 'delivery' : 'none';
  const avg = window.length ? window.reduce((n, w) => n + (role.weekly[w] ?? 0), 0) / window.length : 0;
  return { role, first: weeks[0], last: weeks[weeks.length - 1], phase, avg };
}

const list = (names: string[], max = 4) =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max} more`;

/**
 * Health checks for a workstream, judged from `from` (this week) on and over
 * `window` (the next 10 weeks) for load. Lost workstreams only get the checks
 * that still matter.
 */
export function workstreamChecks(plan: PlanData, d: Derived, project: Project, from: WeekKey, window: WeekKey[]): Check[] {
  const roles = d.assignmentsByProject.get(project.id) ?? [];
  const name = (id: string | null) => (id ? (d.resourcesById.get(id)?.name ?? '?') : 'Open');
  const upcoming = roles.filter((a) => Object.keys(a.weekly).some((w) => w >= from && a.weekly[w] > 0));
  const checks: Check[] = [];

  checks.push({
    id: 'seller',
    label: 'Has a seller',
    ok: !!project.sellerId,
    detail: project.sellerId ? d.sellersById.get(project.sellerId)?.name : 'No seller assigned',
  });
  checks.push({
    id: 'dates',
    label: 'Has start and end dates',
    ok: !!project.startWeek && !!project.endWeek,
    detail: !project.startWeek ? 'No start date: presales vs delivery can’t be told apart' : !project.endWeek ? 'No end date' : undefined,
  });
  if (project.status === 'lost') return checks;

  const open = upcoming.filter((a) => a.resourceId === null);
  checks.push({
    id: 'filled',
    label: 'All upcoming roles filled',
    ok: open.length === 0,
    detail: open.length ? `Open: ${list(open.map((a) => a.name || 'Unnamed role'))}` : undefined,
  });

  const uncovered = d.uncoveredByProject.get(project.id) ?? [];
  checks.push({
    id: 'covered',
    label: 'Required capabilities covered',
    ok: uncovered.length === 0,
    detail: uncovered.length
      ? `Nobody covers ${list(uncovered.map((t) => d.tagsById.get(t)?.name ?? '?'))}`
      : project.tagIds.length === 0
        ? 'No capabilities required'
        : undefined,
  });

  const mismatched = roles.filter((a) => d.mismatchedAssignmentIds.has(a.id));
  checks.push({
    id: 'skills',
    label: 'Everyone has a skill their role needs',
    ok: mismatched.length === 0,
    detail: mismatched.length
      ? list(mismatched.map((a) => `${name(a.resourceId)} (${requiredTags(a, project).map((t) => d.tagsById.get(t)?.name).join(', ')})`))
      : undefined,
  });

  const flagged = (sev: 'over' | 'stretch' | 'risk') => [
    ...new Set(
      roles
        .filter((a) => a.resourceId !== null && assignmentFlagWeeks(a, window, d.loads, plan.settings)[sev].length > 0)
        .map((a) => name(a.resourceId)),
    ),
  ];
  const over = [...new Set([...flagged('over'), ...flagged('stretch')])];
  checks.push({
    id: 'overallocated',
    label: 'Nobody on it is over capacity (next 10 weeks)',
    ok: over.length === 0,
    detail: over.length ? list(over) : undefined,
  });
  const risk = flagged('risk').filter((n) => !over.includes(n));
  checks.push({
    id: 'risk',
    label: 'Nobody over capacity if pipeline work is won',
    ok: risk.length === 0,
    detail: risk.length ? list(risk) : undefined,
  });

  if (project.endWeek) {
    const after = roles.filter((a) => Object.keys(a.weekly).some((w) => w > project.endWeek! && a.weekly[w] > 0));
    checks.push({
      id: 'within-dates',
      label: 'No staffing after the end date',
      ok: after.length === 0,
      detail: after.length ? list(after.map((a) => `${a.name || 'Unnamed role'} (${name(a.resourceId)})`)) : undefined,
    });
  }

  const startsLater = project.startWeek && project.startWeek > from;
  if (project.status === 'pipeline' && startsLater) {
    const supporting = upcoming.filter(
      (a) => a.resourceId !== null && Object.keys(a.weekly).some((w) => w >= from && w < project.startWeek! && a.weekly[w] > 0),
    );
    checks.push({
      id: 'presales',
      label: 'Someone is supporting the pursuit',
      ok: supporting.length > 0,
      detail: supporting.length ? list([...new Set(supporting.map((a) => name(a.resourceId)))]) : 'No presales time before the start date',
    });
  }
  const delivery = roles.filter(
    (a) => a.resourceId !== null && Object.keys(a.weekly).some((w) => weekKind(project, w) === 'delivery' && a.weekly[w] > 0),
  );
  checks.push({
    id: 'delivery',
    label: project.status === 'won' ? 'Staffed for delivery' : 'Delivery team named',
    ok: delivery.length > 0,
    detail: delivery.length ? `${new Set(delivery.map((a) => a.resourceId)).size} people` : 'Nobody in a delivery role yet',
  });
  return checks;
}

export interface PersonSummary {
  util: Utilization;
  target: number;
  /** Highest committed + pipeline load in any one week of the window. */
  peak: number;
  checks: Check[];
}

/** Utilization over `window` against target, and health checks for a person. */
export function personSummary(plan: PlanData, d: Derived, resource: Resource, window: WeekKey[]): PersonSummary {
  const util = utilizationOf(utilizationByResource(plan, d.loads, window), resource.id);
  const target = utilizationTarget(plan.settings, resource.level);
  const committed = d.loads.committed.get(resource.id);
  const tentative = d.loads.tentative.get(resource.id);
  const peak = Math.max(0, ...window.map((w) => (committed?.get(w) ?? 0) + (tentative?.get(w) ?? 0)));
  const roles = d.assignmentsByResource.get(resource.id) ?? [];
  const flaggedIn = (sev: 'over' | 'stretch' | 'risk') =>
    [...new Set(roles.filter((a) => assignmentFlagWeeks(a, window, d.loads, plan.settings)[sev].length > 0).map((a) => a.projectId))].map(
      (id) => d.projectsById.get(id)?.name ?? '?',
    );
  const over = [...new Set([...flaggedIn('over'), ...flaggedIn('stretch')])];
  const risk = flaggedIn('risk');
  const mismatched = roles.filter((a) => d.mismatchedAssignmentIds.has(a.id));
  const checks: Check[] = [
    {
      id: 'overallocated',
      label: 'Not over capacity (next 10 weeks)',
      ok: over.length === 0,
      detail: over.length ? `On ${list(over)}` : undefined,
    },
    {
      id: 'risk',
      label: 'Not over capacity if pipeline work is won',
      ok: risk.length === 0,
      detail: risk.length ? `On ${list(risk)}` : undefined,
    },
    {
      id: 'target',
      label: `At or above their utilization target (${target}%)`,
      ok: util.committed >= target,
      detail: `${Math.round(util.committed)}% committed over the next 10 weeks`,
    },
    {
      id: 'skills',
      label: 'Has a skill each of their roles needs',
      ok: mismatched.length === 0,
      detail: mismatched.length ? list(mismatched.map((a) => d.projectsById.get(a.projectId)?.name ?? '?')) : undefined,
    },
    {
      id: 'level',
      label: 'Has a career level',
      ok: !!resource.level,
      detail: resource.level ? undefined : 'Needed for their utilization target and role matching',
    },
    {
      id: 'capabilities',
      label: 'Has capabilities listed',
      ok: resource.tagIds.length > 0,
      detail: resource.tagIds.length ? undefined : 'Needed for skill checks and for ranking them for roles',
    },
  ];
  return { util, target, peak, checks };
}

/** Upcoming open roles on live workstreams that need a capability this person has (or any capability). */
export function matchingOpenRoles(d: Derived, resource: Resource): Assignment[] {
  return d.upcomingRoles
    .map((u) => u.role)
    .filter((role) => {
      const project = d.projectsById.get(role.projectId);
      if (!project) return false;
      const need = requiredTags(role, project);
      return need.length === 0 || need.some((t) => resource.tagIds.includes(t));
    });
}

export interface WorkstreamDemand {
  project: Project;
  /** Filled roles with presales weeks from now on: the pursuit team. */
  supporting: RoleSummary[];
  /** Filled roles with delivery weeks from now on. */
  staffed: RoleSummary[];
  /** Open roles with weeks from now on. */
  open: RoleSummary[];
  /** Average FTE over the window, in filled and open roles. */
  filledFte: number;
  openFte: number;
}

export interface DemandSummary {
  pipeline: WorkstreamDemand[];
  won: WorkstreamDemand[];
  /** Live workstreams left out because they've ended and have nothing from now on. */
  ended: number;
}

/**
 * What's being pursued and what's sold, from `from` on: per live workstream,
 * who's supporting it (presales), who's staffed (delivery) and which roles are
 * still open, with FTE averaged over `window`. Lost workstreams are left out.
 */
export function demandSummary(plan: PlanData, d: Derived, from: WeekKey, window: WeekKey[]): DemandSummary {
  const out: DemandSummary = { pipeline: [], won: [], ended: 0 };
  for (const project of plan.projects) {
    if (project.status === 'lost') continue;
    const roles = (d.assignmentsByProject.get(project.id) ?? [])
      .map((a) => summarizeRole(a, project, from, window))
      .filter((r) => r.phase !== 'none');
    if (roles.length === 0 && project.endWeek && project.endWeek < from) {
      out.ended++;
      continue;
    }
    const filled = roles.filter((r) => r.role.resourceId !== null);
    const open = roles.filter((r) => r.role.resourceId === null);
    const row: WorkstreamDemand = {
      project,
      supporting: filled.filter((r) => r.phase === 'presales' || r.phase === 'both'),
      staffed: filled.filter((r) => r.phase === 'delivery' || r.phase === 'both'),
      open,
      filledFte: filled.reduce((n, r) => n + r.avg, 0) / 100,
      openFte: open.reduce((n, r) => n + r.avg, 0) / 100,
    };
    out[project.status === 'won' ? 'won' : 'pipeline'].push(row);
  }
  const byStart = (a: WorkstreamDemand, b: WorkstreamDemand) =>
    (a.project.startWeek ?? '9999').localeCompare(b.project.startWeek ?? '9999') || a.project.name.localeCompare(b.project.name);
  out.pipeline.sort(byStart);
  out.won.sort(byStart);
  return out;
}

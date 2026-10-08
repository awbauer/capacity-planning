import { projectLoad, type WeekTotals } from './aggregate';
import { findOverallocations, findSkillIssues, type Overallocation, type SkillIssue } from './conflicts';
import { splitLoads, type SplitLoads } from './load';
import type { Assignment, CapabilityTag, OpenRole, PlanData, Project, Resource, Seller } from './types';
import { currentWeek } from './weeks';

/** Lookups and conflict results computed once per plan version. */
export interface Derived {
  tagsById: Map<string, CapabilityTag>;
  sellersById: Map<string, Seller>;
  resourcesById: Map<string, Resource>;
  projectsById: Map<string, Project>;
  assignmentsByProject: Map<string, Assignment[]>;
  assignmentsByResource: Map<string, Assignment[]>;
  rolesByProject: Map<string, OpenRole[]>;
  /** Open roles with demand this week or later, on workstreams that aren't lost; soonest first. */
  upcomingRoles: { role: OpenRole; from: string }[];
  /** Per-resource weekly load, split into committed and tentative (pipeline delivery). */
  loads: SplitLoads;
  /** Per-project weekly total, excluding delivery on lost projects. */
  projectLoad: Map<string, WeekTotals>;
  overallocations: Overallocation[];
  skillIssues: SkillIssue[];
  mismatchedAssignmentIds: Set<string>;
  uncoveredByProject: Map<string, string[]>;
}

const cache = new WeakMap<PlanData, Derived>();

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function upcomingRoles(plan: PlanData): { role: OpenRole; from: string }[] {
  const thisWeek = currentWeek();
  const lost = new Set(plan.projects.filter((p) => p.status === 'lost').map((p) => p.id));
  return plan.roles
    .filter((r) => !lost.has(r.projectId))
    .flatMap((role) => {
      const weeks = Object.keys(role.weekly).filter((w) => w >= thisWeek && role.weekly[w] > 0).sort();
      return weeks.length ? [{ role, from: weeks[0] }] : [];
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.role.name.localeCompare(b.role.name));
}

export function derive(plan: PlanData): Derived {
  const hit = cache.get(plan);
  if (hit) return hit;
  const loads = splitLoads(plan);
  const skillIssues = findSkillIssues(plan);
  const derived: Derived = {
    tagsById: new Map(plan.tags.map((t) => [t.id, t])),
    sellersById: new Map(plan.sellers.map((s) => [s.id, s])),
    resourcesById: new Map(plan.resources.map((r) => [r.id, r])),
    projectsById: new Map(plan.projects.map((p) => [p.id, p])),
    assignmentsByProject: groupBy(plan.assignments, (a) => a.projectId),
    assignmentsByResource: groupBy(plan.assignments, (a) => a.resourceId),
    rolesByProject: groupBy(plan.roles, (r) => r.projectId),
    upcomingRoles: upcomingRoles(plan),
    loads,
    projectLoad: projectLoad(
      plan.assignments.map((a) => ({
        ...a,
        weekly: Object.fromEntries(Object.entries(a.weekly).filter(([w]) => loads.classAt(a, w) !== 'excluded')),
      })),
    ),
    overallocations: findOverallocations(plan, loads),
    skillIssues,
    mismatchedAssignmentIds: new Set(
      skillIssues.flatMap((i) => (i.kind === 'mismatch' ? [i.assignmentId] : [])),
    ),
    uncoveredByProject: new Map(
      skillIssues.flatMap((i) => (i.kind === 'uncovered' ? [[i.projectId, i.tagIds] as const] : [])),
    ),
  };
  cache.set(plan, derived);
  return derived;
}

import { projectLoad, type WeekTotals } from './aggregate';
import { findOverallocations, findSkillIssues, type Overallocation, type SkillIssue } from './conflicts';
import { splitLoads, type SplitLoads } from './load';
import type { Assignment, CapabilityTag, PlanData, Project, Resource, Seller } from './types';

/** Lookups and conflict results computed once per plan version. */
export interface Derived {
  tagsById: Map<string, CapabilityTag>;
  sellersById: Map<string, Seller>;
  resourcesById: Map<string, Resource>;
  projectsById: Map<string, Project>;
  assignmentsByProject: Map<string, Assignment[]>;
  assignmentsByResource: Map<string, Assignment[]>;
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

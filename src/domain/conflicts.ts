import { resourceLoad, type WeekTotals } from './aggregate';
import type { Assignment, PlanData, Project, Resource, WeekKey } from './types';
import { addWeeks } from './weeks';

export interface Overallocation {
  resourceId: string;
  from: WeekKey;
  to: WeekKey;
  weeks: WeekKey[];
  peak: number;
  /** Projects with a non-zero allocation in any of these weeks. */
  projectIds: string[];
}

export type SkillIssue =
  | { kind: 'mismatch'; assignmentId: string; projectId: string; resourceId: string }
  | { kind: 'uncovered'; projectId: string; tagIds: string[] };

export function isOver(total: number, threshold: number): boolean {
  return total > threshold;
}

/** Overallocated weeks per resource, merged into runs of consecutive weeks. */
export function findOverallocations(
  plan: PlanData,
  load: Map<string, WeekTotals> = resourceLoad(plan.assignments),
): Overallocation[] {
  const threshold = plan.settings.overallocationThreshold;
  const out: Overallocation[] = [];
  for (const [resourceId, totals] of load) {
    const overWeeks = [...totals.entries()]
      .filter(([, v]) => isOver(v, threshold))
      .map(([w]) => w)
      .sort();
    let run: WeekKey[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const projectIds = new Set<string>();
      for (const a of plan.assignments) {
        if (a.resourceId !== resourceId) continue;
        if (run.some((w) => a.weekly[w])) projectIds.add(a.projectId);
      }
      out.push({
        resourceId,
        from: run[0],
        to: run[run.length - 1],
        weeks: run,
        peak: Math.max(...run.map((w) => totals.get(w) ?? 0)),
        projectIds: [...projectIds],
      });
      run = [];
    };
    for (const w of overWeeks) {
      if (run.length && addWeeks(run[run.length - 1], 1) !== w) flush();
      run.push(w);
    }
    flush();
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.resourceId.localeCompare(b.resourceId));
}

/** Weeks (of those given) in which this assignment contributes to an overallocation. */
export function assignmentOverWeeks(
  a: Assignment,
  weeks: WeekKey[],
  load: WeekTotals | undefined,
  threshold: number,
): WeekKey[] {
  return weeks.filter((w) => (a.weekly[w] ?? 0) > 0 && isOver(load?.get(w) ?? 0, threshold));
}

/** True when the project requires capabilities and the resource has none of them. */
export function isSkillMismatch(resource: Resource, project: Project): boolean {
  if (project.tagIds.length === 0) return false;
  return !resource.tagIds.some((t) => project.tagIds.includes(t));
}

/**
 * Required tags that no resource assigned to the project has. Projects with no
 * assignments yet return [] — they're unstaffed, which the grid already shows.
 */
export function uncoveredTags(
  project: Project,
  plan: Pick<PlanData, 'assignments' | 'resources'>,
): string[] {
  const resourcesById = new Map(plan.resources.map((r) => [r.id, r]));
  const covered = new Set<string>();
  let staffed = false;
  for (const a of plan.assignments) {
    if (a.projectId !== project.id) continue;
    staffed = true;
    for (const t of resourcesById.get(a.resourceId)?.tagIds ?? []) covered.add(t);
  }
  if (!staffed) return [];
  return project.tagIds.filter((t) => !covered.has(t));
}

export function findSkillIssues(plan: PlanData): SkillIssue[] {
  const resourcesById = new Map(plan.resources.map((r) => [r.id, r]));
  const projectsById = new Map(plan.projects.map((p) => [p.id, p]));
  const issues: SkillIssue[] = [];
  for (const a of plan.assignments) {
    const r = resourcesById.get(a.resourceId);
    const p = projectsById.get(a.projectId);
    if (r && p && isSkillMismatch(r, p)) {
      issues.push({ kind: 'mismatch', assignmentId: a.id, projectId: p.id, resourceId: r.id });
    }
  }
  for (const p of plan.projects) {
    const tagIds = uncoveredTags(p, plan);
    if (tagIds.length) issues.push({ kind: 'uncovered', projectId: p.id, tagIds });
  }
  return issues;
}

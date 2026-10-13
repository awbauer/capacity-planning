import type { Change } from './diff';
import { flattenOps, type Op } from './ops';
import type { Assignment, PlanData } from './types';
import { formatWeek, formatWeekRange } from './weeks';

const q = (s: string | undefined) => `“${s || 'Unnamed'}”`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function roleLabel(plan: PlanData, role: Assignment | undefined): string {
  if (!role) return 'a deleted role';
  const person = role.resourceId ? plan.resources.find((r) => r.id === role.resourceId)?.name : undefined;
  const project = plan.projects.find((p) => p.id === role.projectId)?.name ?? '?';
  const what = [role.name, person ?? (role.resourceId ? undefined : 'open')].filter(Boolean).join(' › ');
  return `${what || 'a role'} on ${project}`;
}

function weekSpan(weeks: string[]): string {
  const sorted = [...weeks].sort();
  if (sorted.length === 0) return '';
  if (sorted.length === 1) return `week of ${formatWeek(sorted[0])}`;
  return `${plural(sorted.length, 'week')} (${formatWeekRange(sorted[0], sorted[sorted.length - 1])})`;
}

/** One line describing an op, for the activity log (names looked up in the plan before it). */
export function describeOp(op: Op, plan: PlanData): string {
  const name = <T extends { id: string; name?: string }>(list: T[], id: string) => q(list.find((x) => x.id === id)?.name);
  const role = (id: string) => plan.assignments.find((a) => a.id === id);
  const person = (id: string | null) => (id ? (plan.resources.find((r) => r.id === id)?.name ?? '?') : 'nobody (open)');
  switch (op.t) {
    case 'tag.add':
      return `Added capability ${q(op.tag.name)}`;
    case 'tag.update':
      return `Edited capability ${name(plan.tags, op.id)}`;
    case 'tag.delete':
      return `Deleted capability ${name(plan.tags, op.id)}`;
    case 'seller.add':
      return `Added seller ${q(op.seller.name)}`;
    case 'seller.update':
      return `Edited seller ${name(plan.sellers, op.id)}`;
    case 'seller.delete':
      return `Deleted seller ${name(plan.sellers, op.id)}`;
    case 'resource.add':
      return `Added person ${q(op.resource.name)}`;
    case 'resource.update':
      return `Edited ${name(plan.resources, op.id)} (${Object.keys(op.p.set ?? {}).concat(op.p.unset ?? []).join(', ')})`;
    case 'resource.delete':
      return `Deleted person ${name(plan.resources, op.id)}; their roles are now open`;
    case 'project.add':
      return `Added workstream ${q(op.project.name)}`;
    case 'project.update': {
      const fields = Object.keys(op.p.set ?? {}).concat(op.p.unset ?? []);
      const base = `Edited workstream ${name(plan.projects, op.id)} (${fields.join(', ')})`;
      return op.shift ? `${base}; moved staffing from ${formatWeek(op.shift.from)} by ${plural(op.shift.weeks, 'week')}` : base;
    }
    case 'project.delete':
      return `Deleted workstream ${name(plan.projects, op.id)} and its roles`;
    case 'role.add': {
      const weeks = Object.keys(op.role.weekly);
      const project = name(plan.projects, op.role.projectId);
      const who = op.role.resourceId ? person(op.role.resourceId) : 'open';
      return `Added role ${q(op.role.name)} (${who}) on ${project}${weeks.length ? `, ${weekSpan(weeks)}` : ''}`;
    }
    case 'role.update':
      return `Edited ${roleLabel(plan, role(op.id))}`;
    case 'role.assign':
      return op.resourceId
        ? `Put ${person(op.resourceId)} in ${roleLabel(plan, role(op.id))}`
        : `Left ${roleLabel(plan, role(op.id))} open`;
    case 'role.delete':
      return `Removed ${roleLabel(plan, role(op.id))}`;
    case 'cells.set': {
      const roles = new Set(op.edits.map((e) => e.roleId));
      const weeks = op.edits.flatMap((e) => e.weeks);
      const values = new Set(op.edits.map((e) => e.value));
      const value = values.size === 1 ? `${[...values][0]}%` : 'mixed values';
      const where = roles.size === 1 ? roleLabel(plan, role([...roles][0])) : `${plural(roles.size, 'role')}`;
      return value === '0%' ? `Cleared ${where}, ${weekSpan(weeks)}` : `Set ${where} to ${value}, ${weekSpan(weeks)}`;
    }
    case 'settings.update':
      return 'Changed plan settings';
    case 'plan.replace':
      return `Replaced the whole plan (${plural(op.plan.projects.length, 'workstream')}, ${plural(op.plan.resources.length, 'person')})`;
    case 'group': {
      const ops = flattenOps(op);
      if (op.label) return op.label;
      if (ops.length === 1) return describeOp(ops[0], plan);
      return `${describeOp(ops[0], plan)} (+${ops.length - 1} more)`;
    }
  }
}

/** Ids of the workstreams and people a set of changes touched (for filtering the activity log). */
export function changeRefs(changes: Change[], before: PlanData): { projectIds: string[]; resourceIds: string[] } {
  const projects = new Set<string>();
  const people = new Set<string>();
  const roles = new Map(before.assignments.map((a) => [a.id, a]));
  for (const c of changes) {
    if (c.kind === 'project') projects.add(c.id);
    if (c.kind === 'resource') people.add(c.id);
    if (c.kind === 'role') {
      if (c.projectId) projects.add(c.projectId);
      for (const r of [c.before, c.after, roles.get(c.id)] as (Partial<Assignment> | null | undefined)[]) {
        if (r?.projectId) projects.add(r.projectId);
        if (r?.resourceId) people.add(r.resourceId);
      }
      if (c.field === 'resourceId') {
        if (typeof c.before === 'string') people.add(c.before);
        if (typeof c.after === 'string') people.add(c.after);
      }
    }
  }
  return { projectIds: [...projects], resourceIds: [...people] };
}

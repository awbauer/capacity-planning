import type { Thread } from '../../src/domain/comments';
import type { Lock } from '../../src/domain/locks';
import { capacityByPerson, capacitySummary, openRoleDemand } from '../../src/domain/capacity';
import { derive } from '../../src/domain/derive';
import { findOverallocations, findSkillIssues, requiredTags } from '../../src/domain/conflicts';
import { splitLoads, weekKind } from '../../src/domain/load';
import { workstreamIssues, workstreamStats } from '../../src/domain/kanban';
import { toRanges } from '../../src/domain/staffing';
import { workstreamChecks } from '../../src/domain/summary';
import {
  demandByCapability,
  utilizationByResource,
  utilizationOf,
  utilizationTarget,
} from '../../src/domain/utilization';
import { CAREER_LEVELS, WIN_PROBABILITIES, type Assignment, type PlanData } from '../../src/domain/types';
import { addWeeks, weeksBetween } from '../../src/domain/weeks';
import type { User } from '../roomEngine';
import { checkRange, type Command } from './inputs';
import { person, resolve, seller, workstream } from './resolve';
const issueCounts = (i: ReturnType<typeof workstreamIssues>) => ({
  conflicts: i.conflictPeople.size,
  risks: i.riskPeople.size,
  allRiskLow: i.allRiskLow,
  openRoles: i.openRoles,
});
export interface Snapshot {
  plan: PlanData;
  seq: number;
  thisWeek: string;
  timeZone: string;
  locks: Lock[];
  threads: Thread[];
}
const named = (x: { id: string; name: string } | undefined) => (x ? { id: x.id, name: x.name } : null);
export function page<T>(rows: T[], limit = 50) {
  return {
    items: rows.slice(0, limit),
    total: rows.length,
    truncated: rows.length > limit,
  };
}
export function windowOf(s: Snapshot, a: { from?: string; to?: string }) {
  const from = a.from ?? s.thisWeek,
    to = a.to ?? addWeeks(from, 9);
  checkRange(from, to);
  return weeksBetween(from, to);
}
function allocation(s: Snapshot, r: Assignment, weeks?: string[]) {
  const p = s.plan.projects.find((p) => p.id === r.projectId);
  const weekly = Object.fromEntries(Object.entries(r.weekly).filter(([w]) => !weeks || weeks.includes(w)));
  const phase = (kind: 'presales' | 'delivery') =>
    toRanges(Object.fromEntries(Object.entries(weekly).filter(([w]) => weekKind(p, w) === kind)));
  return {
    id: r.id,
    name: r.name,
    person: named(s.plan.resources.find((x) => x.id === r.resourceId)),
    workstream: named(p),
    level: r.level,
    capabilities: s.plan.tags.filter((t) => r.tagIds.includes(t.id)).map(named),
    ranges: toRanges(weekly),
    presales: phase('presales'),
    delivery: phase('delivery'),
    standing: workstreamIssues([r], splitLoads(s.plan), s.plan.settings, s.thisWeek).standing.get(r.id) ?? 'open',
  };
}
export function getContext(s: Snapshot, user: User) {
  let matchedPerson = null,
    matchedSeller = null;
  try {
    matchedPerson = named(person(s.plan, 'me', user));
  } catch {
    /* An unmatched identity can still read. */
  }
  try {
    matchedSeller = named(seller(s.plan, 'me', user));
  } catch {
    /* Sellers are optional. */
  }
  return {
    user,
    matchedPerson,
    matchedSeller,
    thisWeek: s.thisWeek,
    timeZone: s.timeZone,
    allocationSteps: [0, 25, 50, 100],
    stages: ['pipeline', 'won', 'lost'],
    winProbabilities: WIN_PROBABILITIES,
    sellers: s.plan.sellers,
    capabilities: s.plan.tags,
    levels: CAREER_LEVELS,
    thresholds: s.plan.settings,
  };
}
export function listWorkstreams(s: Snapshot, a: Extract<Command, { tool: 'list_workstreams' }>['args'], user: User) {
  const weeks = windowOf(s, a),
    p = s.plan;
  const sellerId = a.seller ? seller(p, a.seller, user).id : undefined;
  const resourceId = a.person ? person(p, a.person, user).id : undefined;
  const tagId = a.capability ? resolve(p.tags, a.capability, 'capability').id : undefined;
  const rows = p.projects
    .filter(
      (x) =>
        (!a.stage || x.status === a.stage) &&
        (a.minWinProbability === undefined ||
          (x.status === 'won' ? 100 : x.status === 'lost' ? 0 : (x.winProbability ?? 0)) >= a.minWinProbability) &&
        (!sellerId || x.sellerId === sellerId) &&
        (!tagId || x.tagIds.includes(tagId)) &&
        (!a.client || (x.client ?? '').toLowerCase().includes(a.client.toLowerCase())) &&
        (!a.externalId || x.externalId?.toLowerCase() === a.externalId.toLowerCase()) &&
        (!a.text ||
          [x.name, x.client, x.externalId, x.notes].some((v) => v?.toLowerCase().includes(a.text!.toLowerCase()))) &&
        (!resourceId || p.assignments.some((r) => r.projectId === x.id && r.resourceId === resourceId)) &&
        (!(a.from || a.to) ||
          ((!x.startWeek || x.startWeek <= weeks.at(-1)!) && (!x.endWeek || x.endWeek >= weeks[0]))),
    )
    .map((x) => {
      const roles = p.assignments.filter((r) => r.projectId === x.id),
        stats = workstreamStats(x, roles);
      const checks = workstreamChecks(p, derive(p), x, weeks[0], weeks);
      return {
        id: x.id,
        name: x.name,
        externalId: x.externalId,
        client: x.client,
        stage: x.status,
        winProbability: x.winProbability,
        seller: named(p.sellers.find((t) => t.id === x.sellerId)),
        startWeek: x.startWeek,
        endWeek: x.endWeek,
        weeks: stats.weeks.length,
        demandFte: stats.demand / 100,
        staffedFte: stats.staffed / 100,
        percentStaffed: stats.demand ? (stats.staffed / stats.demand) * 100 : 100,
        openRoles: roles.filter((r) => r.resourceId === null).length,
        issues: issueCounts(workstreamIssues(roles, splitLoads(p), p.settings, weeks[0])),
        issueCount: checks.filter((c) => !c.ok).length,
      };
    })
    .filter((r) => a.hasIssues === undefined || r.issueCount > 0 === a.hasIssues);
  const totals = (by: 'stage' | 'seller') =>
    Object.values(
      rows.reduce<Record<string, { key: string; count: number; demandFte: number; staffedFte: number }>>((out, r) => {
        const key = by === 'stage' ? r.stage : (r.seller?.id ?? 'none');
        const v = (out[key] ??= { key, count: 0, demandFte: 0, staffedFte: 0 });
        v.count++;
        v.demandFte += r.demandFte;
        v.staffedFte += r.staffedFte;
        return out;
      }, {}),
    );
  return {
    ...page(rows, a.limit),
    ...(a.totals ? { totals: { byStage: totals('stage'), bySeller: totals('seller') } } : {}),
    window: { from: weeks[0], to: weeks.at(-1) },
  };
}
export function getWorkstream(s: Snapshot, a: Extract<Command, { tool: 'get_workstream' }>['args']) {
  const p = workstream(s.plan, a.workstream),
    weeks = windowOf(s, a),
    roles = s.plan.assignments.filter((r) => r.projectId === p.id);
  return {
    ...p,
    seller: named(s.plan.sellers.find((x) => x.id === p.sellerId)),
    capabilities: s.plan.tags.filter((t) => p.tagIds.includes(t.id)),
    roles: page(
      roles.map((r) => allocation(s, r)),
      a.limit,
    ),
    stats: workstreamStats(p, roles),
    checks: workstreamChecks(s.plan, derive(s.plan), p, s.thisWeek, weeks),
    threads: page(
      s.threads.filter(
        (t) =>
          !t.resolvedAt &&
          ((t.anchor.kind === 'project' && t.anchor.projectId === p.id) ||
            ((t.anchor.kind === 'role' || t.anchor.kind === 'cells') &&
              roles.some((r) => r.id === ('roleId' in t.anchor ? t.anchor.roleId : '')))),
      ),
      a.limit,
    ),
  };
}
export function listPeople(s: Snapshot, a: Extract<Command, { tool: 'list_people' }>['args']) {
  const weeks = windowOf(s, {
      from: a.availableFrom ?? a.from,
      to: a.availableTo ?? a.to,
    }),
    loads = splitLoads(s.plan),
    utilization = utilizationByResource(s.plan, loads, weeks);
  const tag = a.capability ? resolve(s.plan.tags, a.capability, 'capability').id : undefined;
  const flags = findOverallocations(s.plan, loads);
  const rows = s.plan.resources
    .filter(
      (r) =>
        (!a.level || a.level === r.level) &&
        (!tag || r.tagIds.includes(tag)) &&
        (!a.text || [r.name, r.email, r.role].some((v) => v?.toLowerCase().includes(a.text!.toLowerCase()))),
    )
    .map((r) => {
      const u = utilizationOf(utilization, r.id),
        target = utilizationTarget(s.plan.settings, r.level);
      const free = weeks.map((w) =>
        Math.max(
          0,
          100 -
            (loads.committed.get(r.id)?.get(w) ?? 0) -
            (a.countPipelineAsBooked ? (loads.tentative.get(r.id)?.get(w) ?? 0) : 0),
        ),
      );
      return {
        ...r,
        capabilities: s.plan.tags.filter((t) => r.tagIds.includes(t.id)).map(named),
        utilization: u,
        target,
        belowTarget: u.committed < target,
        minFreePercent: Math.min(...free),
        averageFreePercent: free.reduce((n, v) => n + v, 0) / weeks.length,
        flags: flags.filter((f) => f.resourceId === r.id && f.weeks.some((w) => weeks.includes(w))),
      };
    })
    .filter((r) => r.minFreePercent >= (a.minFreePercent ?? 0))
    .sort(
      (a, b) =>
        b.minFreePercent - a.minFreePercent ||
        b.averageFreePercent - a.averageFreePercent ||
        a.name.localeCompare(b.name),
    );
  return {
    ...page(rows, a.limit),
    window: { from: weeks[0], to: weeks.at(-1) },
  };
}
export function getPerson(s: Snapshot, a: Extract<Command, { tool: 'get_person' }>['args'], user: User) {
  const r = person(s.plan, a.person, user),
    weeks = windowOf(s, a),
    loads = splitLoads(s.plan);
  return {
    ...r,
    target: utilizationTarget(s.plan.settings, r.level),
    utilization: utilizationOf(utilizationByResource(s.plan, loads, weeks), r.id),
    weekly: weeks.map((week) => ({
      week,
      committed: loads.committed.get(r.id)?.get(week) ?? 0,
      tentative: loads.tentative.get(r.id)?.get(week) ?? 0,
    })),
    allocations: page(
      s.plan.assignments.filter((x) => x.resourceId === r.id).map((x) => allocation(s, x, weeks)),
      a.limit,
    ),
    conflicts: page(
      findOverallocations(s.plan).filter((x) => x.resourceId === r.id && x.weeks.some((w) => weeks.includes(w))),
      a.limit,
    ),
    matchingOpenRoles: page(
      s.plan.assignments
        .filter(
          (x) =>
            x.resourceId === null &&
            Object.keys(x.weekly).some((w) => weeks.includes(w)) &&
            s.plan.projects.find((p) => p.id === x.projectId)?.status !== 'lost' &&
            (!x.level || x.level === r.level) &&
            requiredTags(
              x,
              s.plan.projects.find((p) => p.id === x.projectId)!,
            ).every((t) => r.tagIds.includes(t)),
        )
        .map((x) => allocation(s, x, weeks)),
      a.limit,
    ),
    threads: page(
      s.threads.filter(
        (t) =>
          !t.resolvedAt &&
          ((t.anchor.kind === 'resource' && t.anchor.resourceId === r.id) ||
            ((t.anchor.kind === 'role' || t.anchor.kind === 'cells') &&
              s.plan.assignments.some(
                (x) => x.id === ('roleId' in t.anchor ? t.anchor.roleId : '') && x.resourceId === r.id,
              ))),
      ),
      a.limit,
    ),
  };
}
export function getAllocations(s: Snapshot, a: Extract<Command, { tool: 'get_allocations' }>['args'], user: User) {
  const weeks = windowOf(s, a),
    people = a.people?.map((q) => person(s.plan, q, user).id),
    projects = a.workstreams?.map((q) => workstream(s.plan, q).id);
  const rows = s.plan.assignments
    .filter(
      (r) =>
        (!people || (r.resourceId && people.includes(r.resourceId))) && (!projects || projects.includes(r.projectId)),
    )
    .map((r) => {
      const buckets = new Map<string, { sum: number; weeks: number }>();
      for (const w of weeks) {
        const k = a.rollup === 'monthly' ? w.slice(0, 7) : w;
        const b = buckets.get(k) ?? { sum: 0, weeks: 0 };
        b.sum += r.weekly[w] ?? 0;
        b.weeks++;
        buckets.set(k, b);
      }
      return {
        ...allocation(s, r, weeks),
        rollup: [...buckets].map(([period, b]) => ({
          period,
          percent: b.sum / b.weeks,
        })),
      };
    });
  return {
    ...page(rows, a.limit),
    window: { from: weeks[0], to: weeks.at(-1) },
    rollup: a.rollup,
  };
}
export function listIssues(s: Snapshot, a: Extract<Command, { tool: 'list_issues' }>['args']) {
  const weeks = windowOf(s, a);
  const flags = findOverallocations(s.plan)
    .filter((f) => f.weeks.some((w) => weeks.includes(w)))
    .map((f) => ({
      ...f,
      type: f.severity === 'risk' ? (f.low ? 'low-risk' : 'at-risk') : 'conflict',
      person: named(s.plan.resources.find((r) => r.id === f.resourceId)),
    }));
  const inWindow = new Set(weeks);
  const windowPlan = {
    ...s.plan,
    assignments: s.plan.assignments.filter((r) =>
      Object.keys(r.weekly).some((w) => inWindow.has(w) && r.weekly[w] > 0),
    ),
  };
  const skills = findSkillIssues(windowPlan)
    .filter((f) => {
      const p = s.plan.projects.find((p) => p.id === f.projectId)!;
      return (!p.startWeek || p.startWeek <= weeks.at(-1)!) && (!p.endWeek || p.endWeek >= weeks[0]);
    })
    .map((f) => ({
      ...f,
      type: f.kind === 'mismatch' ? 'skill-gap' : 'uncovered-capability',
      workstream: named(s.plan.projects.find((p) => p.id === f.projectId)),
    }));
  const loads = splitLoads(s.plan);
  const open = openRoleDemand(s.plan, weeks).map((d) => {
    const r = s.plan.assignments.find((r) => r.id === d.roleId)!,
      p = s.plan.projects.find((p) => p.id === r.projectId)!;
    const eligible = a.withCandidates
      ? s.plan.resources.filter(
          (x) =>
            (!r.level || x.level === r.level) &&
            requiredTags(r, p).every((t) => x.tagIds.includes(t)) &&
            weeks.every((w) => (loads.committed.get(x.id)?.get(w) ?? 0) + (r.weekly[w] ?? 0) <= 100),
        )
      : [];
    const candidates = a.withCandidates
      ? listPeople(
          { ...s, plan: { ...s.plan, resources: eligible } },
          {
            from: weeks[0],
            to: weeks.at(-1),
            limit: 5,
            countPipelineAsBooked: false,
          },
        ).items.map((x) => ({ id: x.id, name: x.name, minFreePercent: x.minFreePercent }))
      : undefined;
    return {
      type: 'open-role',
      ...d,
      name: r.name,
      workstream: named(p),
      candidates,
    };
  });
  return page(
    [...flags, ...skills, ...open].filter((x) => a.type === 'all' || x.type === a.type),
    a.limit,
  );
}
export function getCapacitySummary(s: Snapshot, a: Extract<Command, { tool: 'get_capacity_summary' }>['args']) {
  const weeks = windowOf(s, a),
    loads = splitLoads(s.plan),
    people = capacityByPerson(s.plan, loads, findOverallocations(s.plan, loads), weeks);
  return {
    window: { from: weeks[0], to: weeks.at(-1) },
    ...capacitySummary(people, weeks.length),
    people: page(
      people.map((r) => ({
        ...r,
        person: named(s.plan.resources.find((x) => x.id === r.resourceId)),
      })),
      a.limit,
    ),
    byCapability: page(
      demandByCapability(s.plan, loads, weeks).map((d) => ({
        ...d,
        capability: named(s.plan.tags.find((t) => t.id === d.tagId)),
      })),
      a.limit,
    ),
    openRoleDemand: page(openRoleDemand(s.plan, weeks), a.limit),
  };
}
export function read(s: Snapshot, cmd: Command, user: User): unknown {
  switch (cmd.tool) {
    case 'get_context':
      return getContext(s, user);
    case 'list_workstreams':
      return listWorkstreams(s, cmd.args, user);
    case 'get_workstream':
      return getWorkstream(s, cmd.args);
    case 'list_people':
      return listPeople(s, cmd.args);
    case 'get_person':
      return getPerson(s, cmd.args, user);
    case 'get_allocations':
      return getAllocations(s, cmd.args, user);
    case 'list_issues':
      return listIssues(s, cmd.args);
    case 'get_capacity_summary':
      return getCapacitySummary(s, cmd.args);
    default:
      throw new Error('Not a read tool.');
  }
}

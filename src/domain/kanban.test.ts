import { describe, expect, it } from 'vitest';
import { columnPatch, kanbanColumn, showsStaffing, teamLoad, workstreamIssues, workstreamStats } from './kanban';
import { splitLoads } from './load';
import { createEmptyPlan } from './sampleData';
import type { Assignment, PlanData, Project } from './types';
import { addWeeks } from './weeks';

const W = (n: number) => addWeeks('2026-10-05', n);
const role = (id: string, resourceId: string | null, weekly: Record<string, number>, projectId = 'p'): Assignment => ({
  id,
  projectId,
  resourceId,
  name: '',
  tagIds: [],
  weekly,
});

describe('kanban columns', () => {
  it('puts pipeline work in its win % column, unset in Unknown', () => {
    expect(kanbanColumn({ status: 'pipeline' })).toBe('unknown');
    expect(kanbanColumn({ status: 'pipeline', winProbability: 50 })).toBe('50');
    expect(kanbanColumn({ status: 'won', winProbability: 50 })).toBe('won');
    expect(kanbanColumn({ status: 'lost' })).toBe('lost');
  });

  it('turns a column into the stage and win % it stands for', () => {
    expect(columnPatch('75')).toEqual({ status: 'pipeline', winProbability: 75 });
    expect(columnPatch('unknown')).toEqual({ status: 'pipeline', winProbability: undefined });
    // Won keeps the win %, so dragging back restores it.
    expect(columnPatch('won')).toEqual({ status: 'won' });
  });

  it('shows staffing from 75% on, presales before', () => {
    expect(showsStaffing({ status: 'pipeline', winProbability: 50 })).toBe(false);
    expect(showsStaffing({ status: 'pipeline', winProbability: 75 })).toBe(true);
    expect(showsStaffing({ status: 'won' })).toBe(true);
    expect(showsStaffing({ status: 'lost' })).toBe(false);
  });
});

describe('workstream stats', () => {
  const p: Project = { id: 'p', name: 'P', sellerId: null, status: 'pipeline', tagIds: [], startWeek: W(2), endWeek: W(5) };
  const roles = [
    // Presales in W0–W1, then 100% for the 4 delivery weeks.
    role('a', 'r1', { [W(0)]: 20, [W(1)]: 40, [W(2)]: 100, [W(3)]: 100, [W(4)]: 100, [W(5)]: 100 }),
    role('b', 'r2', { [W(2)]: 50, [W(3)]: 50 }),
    role('open', null, { [W(4)]: 100, [W(5)]: 100 }),
  ];

  it('averages demand and staffing over the delivery weeks', () => {
    const s = workstreamStats(p, roles);
    expect(s.weeks).toEqual([W(2), W(3), W(4), W(5)]);
    expect(s.staffed).toBe(125);
    expect(s.demand).toBe(175);
    expect(s.unfilled).toBe(50);
    expect(s.tentative).toBe(125);
    expect(s.confirmed).toBe(0);
    expect(s.presales).toEqual([{ resourceId: 'r1', pct: 30 }]);
    expect(s.delivery.map((x) => x.resourceId)).toEqual(['r1', 'r2']);
  });

  it('counts a won workstream as confirmed and finds weeks from bookings without an end date', () => {
    const s = workstreamStats({ ...p, status: 'won', endWeek: undefined }, roles);
    expect(s.weeks).toEqual([W(2), W(3), W(4), W(5)]);
    expect(s.confirmed).toBe(125);
    expect(s.tentative).toBe(0);
  });

  it('has no delivery weeks when a pipeline workstream has no start date', () => {
    const s = workstreamStats({ ...p, startWeek: undefined, endWeek: undefined }, roles);
    expect(s.weeks).toEqual([]);
    expect(s.demand).toBe(0);
    expect(s.presales.map((x) => x.resourceId)).toEqual(['r1', 'r2']);
  });
});

describe('workstream issues and team load', () => {
  const plan: PlanData = {
    ...createEmptyPlan(),
    resources: [
      { id: 'r1', name: 'R1', tagIds: [] },
      { id: 'r2', name: 'R2', tagIds: [] },
      { id: 'r3', name: 'R3', tagIds: [] },
    ],
    projects: [
      { id: 'p', name: 'P', sellerId: null, status: 'won', tagIds: [] },
      { id: 'q', name: 'Q', sellerId: null, status: 'won', tagIds: [] },
      { id: 'low', name: 'Low', sellerId: null, status: 'pipeline', winProbability: 25, tagIds: [], startWeek: W(0) },
    ],
    assignments: [
      role('a', 'r1', { [W(1)]: 100 }),
      role('a2', 'r1', { [W(1)]: 60 }, 'q'),
      role('b', 'r2', { [W(1)]: 100 }),
      role('b2', 'r2', { [W(1)]: 50 }, 'low'),
      role('c', 'r3', { [W(-3)]: 100 }),
      role('c2', 'r3', { [W(-3)]: 100 }, 'q'),
      role('open', null, { [W(2)]: 50 }),
      role('oldOpen', null, { [W(-2)]: 50 }),
    ],
  };
  const loads = splitLoads(plan);
  const roles = plan.assignments.filter((a) => a.projectId === 'p');

  it('classifies each person from this week on', () => {
    const i = workstreamIssues(roles, loads, plan.settings, W(0));
    expect(i.standing.get('a')).toBe('conflict');
    expect(i.standing.get('b')).toBe('low-risk');
    // r3's conflict is in the past.
    expect(i.standing.get('c')).toBe('ok');
    expect([...i.conflictPeople]).toEqual(['r1']);
    expect([...i.riskPeople]).toEqual(['r2']);
    expect(i.allRiskLow).toBe(true);
    expect(i.openRoles).toBe(1);
  });

  it('averages the team per week and names who is over', () => {
    const [w1] = teamLoad(['r1', 'r2'], [W(1)], loads, plan.settings.overallocationThreshold);
    expect(w1.committed).toBe(130);
    expect(w1.pipeline).toBe(25);
    expect(w1.over).toEqual(['r1']);
  });
});

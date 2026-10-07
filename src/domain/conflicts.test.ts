import { describe, expect, it } from 'vitest';
import { assignmentFlagWeeks, findOverallocations, findSkillIssues, isSkillMismatch, uncoveredTags } from './conflicts';
import { splitLoads, weekKind } from './load';
import { createEmptyPlan, createSamplePlan } from './sampleData';
import type { Assignment, PlanData, Project, ProjectStatus } from './types';

const project = (id: string, status: ProjectStatus = 'won', tagIds: string[] = [], startWeek?: string): Project => ({
  id,
  name: id,
  sellerId: null,
  status,
  tagIds,
  startWeek,
});

const alloc = (
  id: string,
  projectId: string,
  weekly: Record<string, number>,
  resourceId = 'r',
): Assignment => ({ id, projectId, resourceId, weekly });

function plan(patch: Partial<PlanData>): PlanData {
  return { ...createEmptyPlan(), projects: [project('p1'), project('p2')], ...patch };
}

describe('overallocation', () => {
  it('does not flag exactly 100%', () => {
    const p = plan({
      assignments: [alloc('a', 'p1', { '2026-10-05': 60 }), alloc('b', 'p2', { '2026-10-05': 40 })],
    });
    expect(findOverallocations(p)).toEqual([]);
  });

  it('merges consecutive weeks and splits on gaps', () => {
    const p = plan({
      assignments: [
        alloc('a', 'p1', { '2026-10-05': 100, '2026-10-12': 100, '2026-10-19': 100, '2026-11-02': 100 }),
        alloc('b', 'p2', { '2026-10-05': 20, '2026-10-12': 50, '2026-11-02': 10 }),
      ],
    });
    const over = findOverallocations(p);
    expect(over).toHaveLength(2);
    expect(over[0]).toMatchObject({ severity: 'over', from: '2026-10-05', to: '2026-10-12', peak: 150, projectIds: ['p1', 'p2'] });
    expect(over[1]).toMatchObject({ from: '2026-11-02', to: '2026-11-02', peak: 110 });
  });

  it('respects the configured threshold', () => {
    const p = plan({
      settings: { overallocationThreshold: 80 },
      assignments: [alloc('a', 'p1', { '2026-10-05': 90 })],
    });
    expect(findOverallocations(p)).toHaveLength(1);
  });
});

describe('presales vs pipeline delivery', () => {
  // All three start on 2026-10-05: earlier weeks are presales, later ones delivery.
  const START = '2026-10-05';
  const PRE = '2026-09-28';
  const projects = [
    project('won', 'won', [], START),
    project('pipe', 'pipeline', [], START),
    project('lost', 'lost', [], START),
  ];

  it('decides presales vs delivery from the start date', () => {
    expect(weekKind(projects[1], PRE)).toBe('presales');
    expect(weekKind(projects[1], START)).toBe('delivery');
    // Without a start date: won is delivery, pipeline and lost are presales.
    expect(weekKind(project('w', 'won'), PRE)).toBe('delivery');
    expect(weekKind(project('p', 'pipeline'), PRE)).toBe('presales');
    expect(weekKind(project('l', 'lost'), PRE)).toBe('presales');
  });

  it('counts presales weeks as committed whatever the status', () => {
    const p = plan({
      projects,
      assignments: [alloc('a', 'won', { [PRE]: 80 }), alloc('b', 'pipe', { [PRE]: 20 }), alloc('c', 'lost', { [PRE]: 10 })],
    });
    expect(findOverallocations(p)).toEqual([
      expect.objectContaining({ severity: 'over', peak: 110, projectIds: ['won', 'pipe', 'lost'] }),
    ]);
  });

  it('flags pipeline delivery that would push someone over as "risk", not "over"', () => {
    const p = plan({
      projects,
      assignments: [alloc('a', 'won', { [START]: 80 }), alloc('b', 'pipe', { [START]: 40 })],
    });
    expect(findOverallocations(p)).toEqual([
      expect.objectContaining({ severity: 'risk', peak: 120, projectIds: ['won', 'pipe'] }),
    ]);
  });

  it('ignores delivery weeks on lost workstreams', () => {
    const p = plan({
      projects,
      assignments: [alloc('a', 'won', { [START]: 80 }), alloc('b', 'lost', { [START]: 80 })],
    });
    expect(findOverallocations(p)).toEqual([]);
    expect(splitLoads(p).classAt(p.assignments[1], START)).toBe('excluded');
  });

  it('treats one row as presales before the start and delivery after it', () => {
    const p = plan({
      projects,
      assignments: [alloc('a', 'won', { [PRE]: 80, [START]: 80 }), alloc('b', 'pipe', { [PRE]: 50, [START]: 50 })],
    });
    expect(findOverallocations(p).map((o) => [o.severity, o.from, o.peak])).toEqual([
      ['over', PRE, 130],
      ['risk', START, 130],
    ]);
  });

  it('splits runs when severity changes week to week', () => {
    const p = plan({
      projects,
      assignments: [
        alloc('a', 'won', { '2026-10-05': 120, '2026-10-12': 80, '2026-10-19': 80 }),
        alloc('b', 'pipe', { '2026-10-12': 40, '2026-10-19': 40 }),
      ],
    });
    expect(findOverallocations(p).map((o) => [o.severity, o.from, o.to])).toEqual([
      ['over', '2026-10-05', '2026-10-05'],
      ['risk', '2026-10-12', '2026-10-19'],
    ]);
  });

  it('flags each assignment only in weeks it contributes to', () => {
    const p = plan({
      projects,
      assignments: [
        alloc('a', 'won', { '2026-10-05': 120, '2026-10-12': 80 }),
        alloc('b', 'pipe', { '2026-10-12': 40 }),
        alloc('c', 'lost', { '2026-10-05': 50 }),
      ],
    });
    const loads = splitLoads(p);
    const weeks = ['2026-10-05', '2026-10-12'];
    expect(assignmentFlagWeeks(p.assignments[0], weeks, loads, 100)).toEqual({ over: ['2026-10-05'], risk: ['2026-10-12'] });
    expect(assignmentFlagWeeks(p.assignments[1], weeks, loads, 100)).toEqual({ over: [], risk: ['2026-10-12'] });
    expect(assignmentFlagWeeks(p.assignments[2], weeks, loads, 100)).toEqual({ over: [], risk: [] });
  });
});

describe('skills', () => {
  const resource = { id: 'r', name: 'R', tagIds: ['dc'] };

  it('flags a mismatch only when the resource has none of the required tags', () => {
    expect(isSkillMismatch(resource, project('p', 'won', ['dc', 'mc']))).toBe(false);
    expect(isSkillMismatch(resource, project('p', 'won', ['mc']))).toBe(true);
    expect(isSkillMismatch(resource, project('p', 'won', []))).toBe(false);
  });

  it('reports required tags no assigned resource covers, ignoring unstaffed projects', () => {
    const pr = project('p', 'won', ['dc', 'mc']);
    const assignments = [alloc('a', 'p', {})];
    expect(uncoveredTags(pr, { resources: [resource], assignments })).toEqual(['mc']);
    expect(uncoveredTags(pr, { resources: [resource], assignments: [] })).toEqual([]);
  });

  it('ignores skill issues on lost projects', () => {
    const p = plan({
      resources: [resource],
      projects: [project('l', 'lost', ['mc'])],
      assignments: [alloc('a', 'l', {})],
    });
    expect(findSkillIssues(p)).toEqual([]);
  });
});

describe('sample plan', () => {
  it('demonstrates each conflict type', () => {
    const p = createSamplePlan('2026-10-05');
    const over = findOverallocations(p);
    expect(new Set(over.filter((o) => o.severity === 'over').map((o) => o.resourceId))).toEqual(new Set(['res-sam']));
    expect(new Set(over.filter((o) => o.severity === 'risk').map((o) => o.resourceId))).toEqual(new Set(['res-alex']));
    expect(over.find((o) => o.resourceId === 'res-sam')?.peak).toBe(150);
    const issues = findSkillIssues(p);
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'mismatch', resourceId: 'res-riley', projectId: 'proj-globex' }));
    expect(issues).toContainEqual({ kind: 'uncovered', projectId: 'proj-northwind', tagIds: ['tag-af'] });
  });
});

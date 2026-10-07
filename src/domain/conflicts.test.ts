import { describe, expect, it } from 'vitest';
import { findOverallocations, findSkillIssues, isSkillMismatch, uncoveredTags } from './conflicts';
import { createEmptyPlan, createSamplePlan } from './sampleData';
import type { PlanData } from './types';

function plan(patch: Partial<PlanData>): PlanData {
  return { ...createEmptyPlan(), ...patch };
}

describe('overallocation', () => {
  it('does not flag exactly 100%', () => {
    const p = plan({
      assignments: [
        { id: 'a', projectId: 'p1', resourceId: 'r', weekly: { '2026-10-05': 60 } },
        { id: 'b', projectId: 'p2', resourceId: 'r', weekly: { '2026-10-05': 40 } },
      ],
    });
    expect(findOverallocations(p)).toEqual([]);
  });

  it('merges consecutive weeks and splits on gaps', () => {
    const p = plan({
      assignments: [
        {
          id: 'a',
          projectId: 'p1',
          resourceId: 'r',
          weekly: { '2026-10-05': 100, '2026-10-12': 100, '2026-10-19': 100, '2026-11-02': 100 },
        },
        {
          id: 'b',
          projectId: 'p2',
          resourceId: 'r',
          weekly: { '2026-10-05': 20, '2026-10-12': 50, '2026-11-02': 10 },
        },
      ],
    });
    const over = findOverallocations(p);
    expect(over).toHaveLength(2);
    expect(over[0]).toMatchObject({ from: '2026-10-05', to: '2026-10-12', peak: 150, projectIds: ['p1', 'p2'] });
    expect(over[1]).toMatchObject({ from: '2026-11-02', to: '2026-11-02', peak: 110 });
  });

  it('respects the configured threshold', () => {
    const p = plan({
      settings: { overallocationThreshold: 80 },
      assignments: [{ id: 'a', projectId: 'p', resourceId: 'r', weekly: { '2026-10-05': 90 } }],
    });
    expect(findOverallocations(p)).toHaveLength(1);
  });
});

describe('skills', () => {
  const resource = { id: 'r', name: 'R', tagIds: ['dc'] };

  it('flags a mismatch only when the resource has none of the required tags', () => {
    const base = { id: 'p', name: 'P', sellerId: null };
    expect(isSkillMismatch(resource, { ...base, tagIds: ['dc', 'mc'] })).toBe(false);
    expect(isSkillMismatch(resource, { ...base, tagIds: ['mc'] })).toBe(true);
    expect(isSkillMismatch(resource, { ...base, tagIds: [] })).toBe(false);
  });

  it('reports required tags no assigned resource covers, ignoring unstaffed projects', () => {
    const project = { id: 'p', name: 'P', sellerId: null, tagIds: ['dc', 'mc'] };
    const assignments = [{ id: 'a', projectId: 'p', resourceId: 'r', weekly: {} }];
    expect(uncoveredTags(project, { resources: [resource], assignments })).toEqual(['mc']);
    expect(uncoveredTags(project, { resources: [resource], assignments: [] })).toEqual([]);
  });
});

describe('sample plan', () => {
  it('demonstrates each conflict type', () => {
    const p = createSamplePlan('2026-10-05');
    const over = findOverallocations(p);
    expect(new Set(over.map((o) => o.resourceId))).toEqual(new Set(['res-alex', 'res-sam']));
    expect(over.find((o) => o.resourceId === 'res-sam')?.peak).toBe(150);
    const issues = findSkillIssues(p);
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'mismatch', resourceId: 'res-riley', projectId: 'proj-globex' }));
    expect(issues).toContainEqual({ kind: 'uncovered', projectId: 'proj-northwind', tagIds: ['tag-af'] });
  });
});

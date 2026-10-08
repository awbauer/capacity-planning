import { describe, expect, it } from 'vitest';
import { splitLoads } from './load';
import { createEmptyPlan } from './sampleData';
import type { PlanData } from './types';
import { lookaheadWeeks, teamUtilization, utilizationByResource, utilizationOf } from './utilization';

const W1 = '2026-10-05';
const W2 = '2026-10-12';

function plan(): PlanData {
  return {
    ...createEmptyPlan(),
    projects: [
      { id: 'won', name: 'won', sellerId: null, status: 'won', tagIds: [] },
      { id: 'pipe', name: 'pipe', sellerId: null, status: 'pipeline', tagIds: [], startWeek: W2 },
      { id: 'lost', name: 'lost', sellerId: null, status: 'lost', tagIds: [], startWeek: W1 },
    ],
    assignments: [
      { id: 'a', projectId: 'won', resourceId: 'r', weekly: { [W1]: 100, [W2]: 50 } },
      // Presales in W1 (before start), tentative delivery in W2.
      { id: 'b', projectId: 'pipe', resourceId: 'r', weekly: { [W1]: 25, [W2]: 50 } },
      // Lost delivery is excluded.
      { id: 'c', projectId: 'lost', resourceId: 'r', weekly: { [W1]: 100 } },
    ],
  };
}

describe('utilization', () => {
  it('lists the lookahead weeks from the given week', () => {
    expect(lookaheadWeeks(W1, 2)).toEqual([W1, W2]);
    expect(lookaheadWeeks(W1)).toHaveLength(10);
  });

  it('averages delivery and pipeline separately, excluding lost delivery', () => {
    const p = plan();
    const u = utilizationOf(utilizationByResource(p, splitLoads(p), [W1, W2]), 'r');
    expect(u.delivery).toBe(75);
    expect(u.pipeline).toBe(37.5);
    expect(u.presales).toBe(12.5);
    // W1: won 100 + presales 25 = 125, capped at 100. W2: 50 (tentative delivery doesn't count).
    expect(u.committed).toBe(75);
  });

  it('caps committed at 100% per week, so an overloaded week cannot offset an idle one', () => {
    const p: PlanData = {
      ...createEmptyPlan(),
      projects: [{ id: 'won', name: 'won', sellerId: null, status: 'won', tagIds: [] }],
      assignments: [
        { id: 'a', projectId: 'won', resourceId: 'r', weekly: { [W1]: 100 } },
        { id: 'b', projectId: 'won', resourceId: 'r', weekly: { [W1]: 50, [W2]: 50 } },
      ],
    };
    const u = utilizationOf(utilizationByResource(p, splitLoads(p), [W1, W2]), 'r');
    // 150% then 50% averages 75%, not 100%.
    expect(u.committed).toBe(75);
  });

  it('averages the team per person, counting idle people as 0', () => {
    const p = plan();
    const map = utilizationByResource(p, splitLoads(p), [W1, W2]);
    const team = teamUtilization(map, ['r', 'idle']);
    expect(team.delivery).toBe(37.5);
    expect(team.pipeline).toBe(18.75);
  });
});

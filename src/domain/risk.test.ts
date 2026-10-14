import { describe, expect, it } from 'vitest';
import { findOverallocations } from './conflicts';
import { isLowRisk, lowRiskAt, splitLoads } from './load';
import { createEmptyPlan } from './sampleData';
import { parsePlanFile } from './schema';
import type { PlanData, WinProbability } from './types';

const W = '2026-10-12';

/** One person: 60% committed, plus 50% pipeline delivery on a workstream with the given win %. */
function plan(winProbability?: WinProbability): PlanData {
  return {
    ...createEmptyPlan(),
    resources: [{ id: 'r', name: 'R', tagIds: [] }],
    projects: [
      { id: 'won', name: 'Won', sellerId: null, status: 'won', tagIds: [] },
      { id: 'pipe', name: 'Pipe', sellerId: null, status: 'pipeline', tagIds: [], startWeek: W, ...(winProbability ? { winProbability } : {}) },
    ],
    assignments: [
      { id: 'a', projectId: 'won', resourceId: 'r', name: '', tagIds: [], weekly: { [W]: 60 } },
      { id: 'b', projectId: 'pipe', resourceId: 'r', name: '', tagIds: [], weekly: { [W]: 50 } },
    ],
  };
}

describe('low risk: over only through pipeline work under 75% likely', () => {
  it('splits likely pipeline load out', () => {
    expect(splitLoads(plan(90)).tentativeLikely.get('r')?.get(W)).toBe(50);
    expect(splitLoads(plan(50)).tentativeLikely.get('r')).toBeUndefined();
  });

  it('marks the risk low below 75% (or unset) and normal from 75%', () => {
    for (const [p, low] of [[undefined, true], [25, true], [50, true], [75, false], [90, false]] as const) {
      const pl = plan(p);
      const loads = splitLoads(pl);
      expect(lowRiskAt(loads, 'r', W, pl.settings)).toBe(low);
      const [risk] = findOverallocations(pl, loads);
      expect(risk.severity).toBe('risk');
      expect(!!risk.low).toBe(low);
    }
  });

  it('is low only if the likely part alone stays within capacity', () => {
    expect(isLowRisk(60, 0, { overallocationThreshold: 100 })).toBe(true);
    expect(isLowRisk(60, 50, { overallocationThreshold: 100 })).toBe(false);
  });

  it('keeps a win % through export and import, and rejects other values', () => {
    const file = (wp: unknown) => ({ name: 'P', revision: 1, ...plan(), projects: [plan().projects[0], { ...plan().projects[1], winProbability: wp }] });
    expect(parsePlanFile(file(75)).plan.projects[1].winProbability).toBe(75);
    expect(() => parsePlanFile(file(60))).toThrow();
  });
});

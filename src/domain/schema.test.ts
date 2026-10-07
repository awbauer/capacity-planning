import { describe, expect, it } from 'vitest';
import { createSamplePlan } from './sampleData';
import { parsePlan, upgradePlan } from './schema';

describe('parsePlan', () => {
  it('round-trips an exported plan', () => {
    const plan = createSamplePlan('2026-10-05');
    expect(parsePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('rejects non-Monday week keys', () => {
    const plan = createSamplePlan('2026-10-05');
    plan.assignments[0].weekly = { '2026-10-07': 50 };
    expect(() => parsePlan(plan)).toThrow(/Mondays/);
  });

  it('rejects dangling references', () => {
    const plan = createSamplePlan('2026-10-05');
    plan.assignments[0].resourceId = 'nobody';
    expect(() => parsePlan(plan)).toThrow(/unknown resource "nobody"/);
  });

  it('rejects files that are not plans', () => {
    expect(() => parsePlan({ hello: 'world' })).toThrow(/Invalid plan file/);
  });

  it('upgrades version 1 files: projects become won, allocations delivery', () => {
    const plan = createSamplePlan('2026-10-05');
    const v1 = JSON.parse(JSON.stringify({ ...plan, version: 1 }));
    for (const p of v1.projects) delete p.status;
    for (const a of v1.assignments) delete a.kind;
    // v1 had one row per person per project, so drop the sample's extra presales rows.
    v1.assignments = v1.assignments.filter(
      (a: { id: string }, i: number, all: { projectId: string; resourceId: string }[]) =>
        all.findIndex((b) => b.projectId === all[i].projectId && b.resourceId === all[i].resourceId) === i && a.id,
    );
    const parsed = parsePlan(v1);
    expect(parsed.version).toBe(2);
    expect(parsed.projects.every((p) => p.status === 'won')).toBe(true);
    expect(parsed.assignments.every((a) => a.kind === 'delivery')).toBe(true);
    expect(upgradePlan(v1)).toEqual(parsed);
  });

  it('rejects duplicate rows of the same kind', () => {
    const plan = createSamplePlan('2026-10-05');
    plan.assignments.push({ ...plan.assignments[0], id: 'dup' });
    expect(() => parsePlan(plan)).toThrow(/duplicate/);
  });

  it('rounds imported weekly values to 0/25/50/100', () => {
    const plan = createSamplePlan('2026-10-05');
    plan.assignments[0].weekly = { '2026-10-05': 60, '2026-10-12': 10 };
    expect(parsePlan(plan).assignments[0].weekly).toEqual({ '2026-10-05': 50 });
  });
});

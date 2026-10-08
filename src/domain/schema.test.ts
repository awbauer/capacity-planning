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

  it('upgrades version 1 files: workstreams become won', () => {
    const plan = createSamplePlan('2026-10-05');
    const v1 = JSON.parse(JSON.stringify({ ...plan, version: 1 }));
    for (const p of v1.projects) delete p.status;
    const parsed = parsePlan(v1);
    expect(parsed.version).toBe(4);
    expect(parsed.projects.every((p) => p.status === 'won')).toBe(true);
    expect(upgradePlan(v1)).toEqual(parsed);
  });

  it('merges version 2 presales/delivery rows into one row per person', () => {
    const plan = createSamplePlan('2026-10-05');
    const base = plan.assignments[0];
    const v2 = JSON.parse(JSON.stringify({ ...plan, version: 2 }));
    v2.assignments[0] = { ...base, kind: 'delivery', weekly: { '2026-10-05': 50, '2026-10-12': 50 } };
    v2.assignments.push({ ...base, id: 'dup', kind: 'presales', weekly: { '2026-10-05': 25, '2026-09-28': 25 } });
    const parsed = parsePlan(v2);
    const rows = parsed.assignments.filter((a) => a.projectId === base.projectId && a.resourceId === base.resourceId);
    expect(rows).toHaveLength(1);
    // 50 + 25 = 75 rounds up to 100.
    expect(rows[0].weekly).toEqual({ '2026-09-28': 25, '2026-10-05': 100, '2026-10-12': 50 });
    expect('kind' in rows[0]).toBe(false);
  });

  it('rounds imported weekly values to 0/25/50/100', () => {
    const plan = createSamplePlan('2026-10-05');
    plan.assignments[0].weekly = { '2026-10-05': 60, '2026-10-12': 10 };
    expect(parsePlan(plan).assignments[0].weekly).toEqual({ '2026-10-05': 50 });
  });

  it('accepts known career levels and rejects others', () => {
    const plan = createSamplePlan('2026-10-05');
    expect(parsePlan(plan).resources.find((r) => r.id === 'res-alex')?.level).toBe('SM');
    const bad = JSON.parse(JSON.stringify(plan));
    bad.resources[0].level = 'VP';
    expect(() => parsePlan(bad)).toThrow(/level/);
  });

  it('upgrades version 3 files: people’s rows become roles named after their title, open roles fold in', () => {
    const v3 = {
      ...JSON.parse(JSON.stringify(createSamplePlan('2026-10-05'))),
      version: 3,
      assignments: [{ id: 'a1', projectId: 'proj-acme', resourceId: 'res-alex', weekly: { '2026-10-05': 50 } }],
      roles: [{ id: 'o1', projectId: 'proj-acme', name: 'Architect', tagIds: ['tag-dc'], weekly: { '2026-10-05': 100 } }],
    };
    const parsed = parsePlan(v3);
    expect(parsed.assignments).toEqual([
      { id: 'a1', projectId: 'proj-acme', resourceId: 'res-alex', name: 'Solution Architect', tagIds: [], weekly: { '2026-10-05': 50 } },
      { id: 'o1', projectId: 'proj-acme', resourceId: null, name: 'Architect', tagIds: ['tag-dc'], weekly: { '2026-10-05': 100 } },
    ]);
    expect(upgradePlan(v3).assignments).toEqual(parsed.assignments);
  });

  it('keeps two roles for the same person on a workstream from v4 on', () => {
    const plan = createSamplePlan('2026-10-05');
    const a = plan.assignments[0];
    plan.assignments.push({ ...a, id: 'second', name: 'Delivery Lead' });
    expect(parsePlan(JSON.parse(JSON.stringify(plan))).assignments.filter((x) => x.resourceId === a.resourceId && x.projectId === a.projectId)).toHaveLength(2);
  });

  it('checks open role references', () => {
    const bad = JSON.parse(JSON.stringify(createSamplePlan('2026-10-05')));
    bad.assignments.find((a: { resourceId: string | null }) => a.resourceId === null).projectId = 'nowhere';
    expect(() => parsePlan(bad)).toThrow(/unknown workstream "nowhere"/);
  });
});

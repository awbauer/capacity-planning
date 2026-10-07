import { describe, expect, it } from 'vitest';
import { createSamplePlan } from './sampleData';
import { parsePlan } from './schema';

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
});

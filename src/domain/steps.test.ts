import { describe, expect, it } from 'vitest';
import { nextStep, snapToStep, snapWeekly } from './steps';

describe('nextStep', () => {
  it('cycles 0 → 25 → 50 → 100 → 0', () => {
    expect([0, 25, 50, 100].map((v) => nextStep(v))).toEqual([25, 50, 100, 0]);
  });

  it('advances off-step values to the next step up', () => {
    expect(nextStep(10)).toBe(25);
    expect(nextStep(37.5)).toBe(50);
    expect(nextStep(60)).toBe(100);
  });

  it('wraps anything at or above the top step to 0', () => {
    expect(nextStep(150)).toBe(0);
  });

  it('supports custom steps', () => {
    expect(nextStep(50, [0, 25, 50, 75, 100])).toBe(75);
  });

  it('snaps arbitrary values to the nearest step', () => {
    expect([-5, 0, 10, 13, 30, 40, 60, 74, 75, 80, 100, 150].map((v) => snapToStep(v))).toEqual([
      0, 0, 0, 25, 25, 50, 50, 50, 100, 100, 100, 100,
    ]);
    expect(snapWeekly({ a: 60, b: 10, c: 80 })).toEqual({ a: 50, c: 100 });
  });
});

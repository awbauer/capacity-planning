import { describe, expect, it } from 'vitest';
import { capacityByPerson, capacitySummary, issueCounts, openRoleDemand, shareOf } from './capacity';
import { findOverallocations } from './conflicts';
import { splitLoads } from './load';
import { createEmptyPlan } from './sampleData';
import { bookingState, fte, fteLabel, runs, segmentEdges, type TimelineCell } from './timeline';
import type { PlanData } from './types';

const W1 = '2026-10-05';
const W2 = '2026-10-12';
const W3 = '2026-10-19';

const c = (value: number, state: TimelineCell['state'] = 'confirmed'): TimelineCell => ({ value, state: value ? state : null });

describe('timeline segments', () => {
  it('draws twelve unchanged weeks as one bar, labelled once', () => {
    const edges = segmentEdges(Array.from({ length: 12 }, () => c(50)));
    expect(edges.filter((e) => e?.start)).toHaveLength(1);
    expect(edges[0]).toEqual({ start: true, end: false });
    expect(edges[11]).toEqual({ start: false, end: true });
    expect(edges.slice(1, 11).every((e) => e && !e.start && !e.end)).toBe(true);
  });

  it('starts a touching bar when the % or the booking state changes', () => {
    const edges = segmentEdges([c(50), c(50), c(100), c(100, 'tentative'), c(0), c(25)]);
    expect(edges).toEqual([
      { start: true, end: false },
      { start: false, end: true },
      { start: true, end: true },
      { start: true, end: true },
      null,
      { start: true, end: true },
    ]);
  });

  it('treats averages that round to the same % as one bar', () => {
    const edges = segmentEdges([c(33.3), c(33.4)]);
    expect(edges[1]).toEqual({ start: false, end: true });
  });

  it('formats FTE', () => {
    expect(fte(50)).toBe('0.5');
    expect(fte(25)).toBe('0.25');
    expect(fte(100)).toBe('1.0');
    expect(fte(150)).toBe('1.5');
    expect(fteLabel(30)).toBe('0.3 FTE');
  });

  it('maps load classes to booking states', () => {
    expect(bookingState('committed', true)).toBe('confirmed');
    expect(bookingState('tentative', true)).toBe('tentative');
    expect(bookingState('excluded', true)).toBe('excluded');
    expect(bookingState('committed', false)).toBe('open');
  });

  it('finds runs of flags', () => {
    expect(runs([true, true, false, true, false, false, true, true, true])).toEqual([
      [0, 1],
      [3, 3],
      [6, 8],
    ]);
  });
});

function plan(): PlanData {
  return {
    ...createEmptyPlan(),
    resources: [
      { id: 'r', name: 'R', tagIds: [] },
      { id: 's', name: 'S', tagIds: [] },
    ],
    projects: [
      { id: 'won', name: 'won', sellerId: null, status: 'won', tagIds: [] },
      { id: 'pipe', name: 'pipe', sellerId: null, status: 'pipeline', tagIds: [], startWeek: W2 },
      { id: 'lost', name: 'lost', sellerId: null, status: 'lost', tagIds: [], startWeek: W2 },
    ],
    assignments: [
      { id: 'a', projectId: 'won', resourceId: 'r', name: '', tagIds: [], weekly: { [W1]: 100, [W2]: 100 } },
      // Presales in W1, tentative delivery in W2.
      { id: 'b', projectId: 'pipe', resourceId: 'r', name: '', tagIds: [], weekly: { [W1]: 50, [W2]: 50 } },
      // Presales on a lost workstream counts; its delivery doesn't.
      { id: 'c', projectId: 'lost', resourceId: 's', name: '', tagIds: [], weekly: { [W1]: 50, [W2]: 100 } },
      { id: 'open', projectId: 'pipe', resourceId: null, name: 'Architect', tagIds: [], weekly: { [W2]: 100, [W3]: 50 } },
      { id: 'lostOpen', projectId: 'lost', resourceId: null, name: 'x', tagIds: [], weekly: { [W2]: 100 } },
    ],
  };
}

describe('capacity in FTE-weeks', () => {
  const p = plan();
  const loads = splitLoads(p);
  const over = findOverallocations(p, loads);
  const weeks = [W1, W2];
  const people = capacityByPerson(p, loads, over, weeks);
  const summary = capacitySummary(people, weeks.length);

  it('sums bookings by workstream status over one denominator', () => {
    expect(summary.supply).toBe(4);
    expect(summary.delivery).toBe(2);
    expect(summary.pipeline).toBe(1);
    expect(summary.other).toBe(0.5);
    expect(summary.headroom).toBe(0.5);
    expect(summary.overflow).toBe(0);
    expect(shareOf(summary.delivery, summary)).toBe(50);
  });

  it('reports overflow instead of negative headroom', () => {
    const s = capacitySummary(people, 1);
    expect(s.supply).toBe(2);
    expect(s.headroom).toBe(0);
    expect(s.overflow).toBe(1.5);
  });

  it('gives each person utilization and conflict weeks', () => {
    const r = people.find((x) => x.resourceId === 'r')!;
    expect(r.utilization).toBe(150);
    // W1: 150% committed (presales + won) is a conflict; W2: 100% committed + 50% tentative is at risk.
    expect(r.conflictWeeks).toBe(1);
    expect(r.riskWeeks).toBe(1);
    expect(people.find((x) => x.resourceId === 's')!.utilization).toBe(25);
  });

  it('lists open roles with demand in the window, not on lost workstreams', () => {
    expect(openRoleDemand(p, weeks)).toEqual([{ roleId: 'open', projectId: 'pipe', fteWeeks: 1, from: W2 }]);
    expect(openRoleDemand(p, [W3])[0].fteWeeks).toBe(0.5);
  });

  it('counts unique issues in the window', () => {
    expect(issueCounts(over, openRoleDemand(p, weeks), weeks)).toEqual({
      conflicts: 1,
      conflictPeople: 1,
      risks: 1,
      openRoles: 1,
    });
    expect(issueCounts(over, [], [W3])).toEqual({ conflicts: 0, conflictPeople: 0, risks: 0, openRoles: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import { bucketStats, projectLoad, resourceLoad, totalsGetter } from './aggregate';
import type { Assignment } from './types';

const a = (id: string, projectId: string, resourceId: string, weekly: Record<string, number>): Assignment => ({
  id,
  projectId,
  resourceId,
  weekly,
});

describe('aggregate', () => {
  const assignments = [
    a('1', 'p1', 'r1', { '2026-10-05': 50, '2026-10-12': 50 }),
    a('2', 'p2', 'r1', { '2026-10-12': 60 }),
    a('3', 'p1', 'r2', { '2026-10-05': 100 }),
  ];

  it('sums load per resource and per project', () => {
    const r = resourceLoad(assignments);
    expect(r.get('r1')?.get('2026-10-05')).toBe(50);
    expect(r.get('r1')?.get('2026-10-12')).toBe(110);
    const p = projectLoad(assignments);
    expect(p.get('p1')?.get('2026-10-05')).toBe(150);
  });

  it('reports average and peak separately so spikes are not hidden', () => {
    const get = totalsGetter(resourceLoad(assignments).get('r1'));
    const s = bucketStats(get, ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(s.avg).toBe(40);
    expect(s.peak).toBe(110);
    expect(s.mixed).toBe(true);
  });

  it('marks uniform buckets as not mixed', () => {
    expect(bucketStats(() => 50, ['a', 'b'])).toEqual({ avg: 50, peak: 50, mixed: false });
    expect(bucketStats(() => 50, [])).toEqual({ avg: 0, peak: 0, mixed: false });
  });
});

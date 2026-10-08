import { describe, expect, it } from 'vitest';
import { addWeeks, buckets, normalizeWeek, shiftAnchor, shiftWeekly, toWeekKey, weekMonth, weeksApart, weeksBetween } from './weeks';

describe('weeks', () => {
  it('keys weeks by their Monday', () => {
    expect(toWeekKey(new Date(2026, 9, 7))).toBe('2026-10-05'); // Wed
    expect(toWeekKey(new Date(2026, 9, 11))).toBe('2026-10-05'); // Sun
    expect(normalizeWeek('2026-10-12')).toBe('2026-10-12');
  });

  it('adds weeks across the year boundary and DST changes', () => {
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(addWeeks('2026-10-26', 1)).toBe('2026-11-02');
    expect(addWeeks('2026-03-02', 2)).toBe('2026-03-16');
    expect(weeksBetween('2026-12-21', '2027-01-04')).toEqual(['2026-12-21', '2026-12-28', '2027-01-04']);
    expect(weeksBetween('2027-01-04', '2026-12-21')).toEqual([]);
  });

  it('assigns a week spanning two months to the month of its Wednesday', () => {
    // Mon Sep 28 – Fri Oct 2 2026: Wednesday is Sep 30.
    expect(weekMonth('2026-09-28')).toEqual({ year: 2026, month: 8 });
    // Mon Jun 29 – Fri Jul 3 2026: Wednesday is Jul 1.
    expect(weekMonth('2026-06-29')).toEqual({ year: 2026, month: 6 });
    // Mon Dec 28 2026: Wednesday is Dec 30.
    expect(weekMonth('2026-12-28')).toEqual({ year: 2026, month: 11 });
  });

  it('builds month buckets covering every week exactly once', () => {
    const months = buckets('month', '2026-09-28');
    expect(months).toHaveLength(12);
    expect(months[0].key).toBe('2026-09');
    expect(months[0].weeks).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(months[1].weeks[0]).toBe('2026-10-05');
    const all = months.flatMap((m) => m.weeks);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(weeksBetween(all[0], all[all.length - 1]));
  });

  it('builds quarter buckets from the anchor quarter', () => {
    const qs = buckets('quarter', '2026-11-16');
    expect(qs).toHaveLength(8);
    expect(qs[0].key).toBe('2026-Q4');
    expect(qs[1].key).toBe('2027-Q1');
    expect(qs[0].weeks[0]).toBe('2026-10-05'); // Wed Sep 30 puts 2026-09-28 in Q3
  });

  it('builds week buckets starting at the anchor', () => {
    const ws = buckets('week', '2026-10-05');
    expect(ws).toHaveLength(26);
    expect(ws[0]).toMatchObject({ key: '2026-10-05', weeks: ['2026-10-05'], label: 'Oct 5', sublabel: 'W41' });
  });

  it('shifts the anchor by a page step per zoom', () => {
    expect(shiftAnchor('week', '2026-10-05', 1)).toBe('2026-11-02');
    expect(weekMonth(shiftAnchor('month', '2026-10-05', 1))).toEqual({ year: 2027, month: 0 });
    expect(weekMonth(shiftAnchor('quarter', '2026-10-05', -1))).toEqual({ year: 2026, month: 3 });
  });
});

describe('shifting', () => {
  it('counts weeks apart', () => {
    expect(weeksApart('2026-10-05', '2026-10-26')).toBe(3);
    expect(weeksApart('2026-10-26', '2026-10-05')).toBe(-3);
    // Across the DST change.
    expect(weeksApart('2026-10-19', '2026-11-09')).toBe(3);
  });

  it('moves weeks from the given week on, leaving earlier weeks', () => {
    const weekly = { '2026-09-28': 25, '2026-10-05': 50, '2026-10-12': 100 };
    expect(shiftWeekly(weekly, '2026-10-05', 2)).toEqual({ '2026-09-28': 25, '2026-10-19': 50, '2026-10-26': 100 });
  });

  it('lets moved weeks overwrite earlier weeks when shifting back', () => {
    const weekly = { '2026-09-28': 25, '2026-10-05': 50 };
    expect(shiftWeekly(weekly, '2026-10-05', -1)).toEqual({ '2026-09-28': 50 });
  });
});

import { findOverallocations } from '../../src/domain/conflicts';
import { lowRiskAt, splitLoads } from '../../src/domain/load';
import type { PlanData } from '../../src/domain/types';
export function impact(before: PlanData, after: PlanData, from: string) {
  const flags = (p: PlanData) => {
    const loads = splitLoads(p);
    return findOverallocations(p, loads).flatMap((i) =>
      i.weeks
        .filter((w) => w >= from)
        .map((week) => ({
          person: {
            id: i.resourceId,
            name: p.resources.find((r) => r.id === i.resourceId)?.name,
          },
          week,
          type: i.severity === 'risk' && lowRiskAt(loads, i.resourceId, week, p.settings) ? 'low-risk' : i.severity,
        })),
    );
  };
  const a = flags(before),
    b = flags(after);
  const key = (x: (typeof a)[number]) => `${x.person.id}:${x.week}:${x.type}`;
  const ak = new Set(a.map(key)),
    bk = new Set(b.map(key));
  const added = b.filter((x) => !ak.has(key(x))),
    cleared = a.filter((x) => !bk.has(key(x)));
  return {
    added: added.slice(0, 50),
    cleared: cleared.slice(0, 50),
    truncated: added.length > 50 || cleared.length > 50,
  };
}

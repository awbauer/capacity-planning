import type { Change } from '../../src/domain/diff';
import type { Assignment, PlanData } from '../../src/domain/types';
/** Role creates/deletes hold full weekly maps rather than individual cell diffs. */
export function cellCount(changes: Change[]) {
  return changes.reduce(
    (n, c) =>
      n +
      (c.week
        ? 1
        : c.kind === 'role' && !c.field
          ? Object.keys(((c.after ?? c.before) as Assignment).weekly).length
          : 0),
    0,
  );
}
export function changesPast(changes: Change[], before: PlanData, thisWeek: string) {
  return changes.some((c) => {
    if (c.kind !== 'role') return false;
    if (c.week) return c.week < thisWeek;
    if (c.field && c.field !== 'resourceId') return false;
    const role = c.field ? before.assignments.find((r) => r.id === c.id) : ((c.before ?? c.after) as Assignment);
    return Object.keys(role?.weekly ?? {}).some((w) => w < thisWeek);
  });
}

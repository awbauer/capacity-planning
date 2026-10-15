import type { Project, WeekKey } from './types';
import { addWeeks, currentWeek } from './weeks';
import { weekKind } from './load';

/**
 * Pipeline workstreams that haven't started default to the presales period
 * (now until the start date); everything else to the workstream's dates.
 */
export function defaultRange(
  project: Project | undefined,
  now: WeekKey = currentWeek(),
): { from: WeekKey; to: WeekKey } {
  if (project?.status === 'pipeline' && project.startWeek && project.startWeek > now) {
    return { from: now, to: addWeeks(project.startWeek, -1) };
  }
  const from = project?.startWeek ?? now;
  return {
    from,
    to: project?.endWeek && project.endWeek >= from ? project.endWeek : addWeeks(from, 11),
  };
}

/** Explains how the chosen weeks will count: presales before the start date, delivery from it. */
export function rangeNote(project: Project, weeks: WeekKey[]): string {
  const presales = weeks.filter((w) => weekKind(project, w) === 'presales').length;
  const delivery = weeks.length - presales;
  const deliveryCounts =
    project.status === 'won'
      ? 'counted'
      : project.status === 'pipeline'
        ? 'tentative until the workstream is won'
        : 'not counted (workstream lost)';
  const parts: string[] = [];
  if (presales)
    parts.push(`${presales} presales week${presales === 1 ? '' : 's'} before the start date (always counted)`);
  if (delivery) parts.push(`${delivery} delivery week${delivery === 1 ? '' : 's'} (${deliveryCounts})`);
  return parts.join(' · ');
}

/** Coalesces adjacent equal allocations; gaps always split a range. */
export function toRanges(weekly: Record<WeekKey, number>) {
  const ranges: { from: WeekKey; to: WeekKey; percent: number }[] = [];
  for (const w of Object.keys(weekly)
    .filter((w) => weekly[w] > 0)
    .sort()) {
    const prev = ranges.at(-1);
    if (prev && prev.percent === weekly[w] && addWeeks(prev.to, 1) === w) prev.to = w;
    else ranges.push({ from: w, to: w, percent: weekly[w] });
  }
  return ranges;
}

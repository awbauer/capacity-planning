import type { Assignment } from '../domain/types';

/** A timestamp as "Oct 13, 2:05 PM". */
export const when = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Role › Person", or "Role › open". */
export const roleTitle = (a: Assignment, personName?: string) =>
  [a.name || 'Unnamed role', personName ?? (a.resourceId ? '?' : 'open')].join(' › ');

/** Up to two initials for an avatar. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

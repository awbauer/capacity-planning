import type { Change } from './diff';
import type { Assignment, PlanData, Project, WeekKey } from './types';

/**
 * A freeze on part of a plan's staffing. Only its owner can change what it
 * covers (admins can remove it). "past" freezes every week before the
 * current one for everyone but admins.
 */
export type Lock =
  | ({ scope: 'cells'; roleIds: string[]; from: WeekKey; to: WeekKey } & LockInfo)
  | ({ scope: 'role'; roleId: string } & LockInfo)
  | ({ scope: 'project'; projectId: string } & LockInfo)
  | ({ scope: 'past' } & LockInfo);

export interface LockInfo {
  id: string;
  /** Email of who set it (for "past", the admin who turned it on). */
  owner: string;
  note?: string;
  /** Epoch ms. */
  createdAt: number;
}

export type LockScope = Lock['scope'];
export type NewLock = DistributiveOmit<Lock, 'owner' | 'createdAt'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Workstream fields a workstream lock freezes (names, tags etc. stay editable). */
const FROZEN_PROJECT_FIELDS = new Set(['startWeek', 'endWeek', 'status']);
/** Role fields that count as staffing. */
const FROZEN_ROLE_FIELDS = new Set(['resourceId', 'projectId', 'weekly']);

/** Whether a lock covers one week of one role. */
export function lockCoversCell(lock: Lock, role: Pick<Assignment, 'id' | 'projectId'>, week: WeekKey, thisWeek: WeekKey): boolean {
  switch (lock.scope) {
    case 'cells':
      return lock.roleIds.includes(role.id) && week >= lock.from && week <= lock.to;
    case 'role':
      return lock.roleId === role.id;
    case 'project':
      return lock.projectId === role.projectId;
    case 'past':
      return week < thisWeek;
  }
}

/** Whether a lock covers a role as a whole (who's in it, adding or removing it). */
function lockCoversRole(lock: Lock, role: Pick<Assignment, 'id' | 'projectId' | 'weekly'>, thisWeek: WeekKey): boolean {
  switch (lock.scope) {
    case 'cells':
      return lock.roleIds.includes(role.id);
    case 'role':
      return lock.roleId === role.id;
    case 'project':
      return lock.projectId === role.projectId;
    case 'past':
      // Adding or removing a role with past weeks changes the past.
      return Object.keys(role.weekly).some((w) => w < thisWeek);
  }
}

/** Whether a user can edit through a lock. */
export function exempt(lock: Lock, user: { email: string; admin: boolean }): boolean {
  return lock.scope === 'past' ? user.admin : lock.owner === user.email;
}

/**
 * The locks a set of changes would break, for this user. Checked against
 * what an op actually did (cascades included), so deleting a person who is
 * in a locked role is caught too.
 */
export function brokenLocks(
  changes: Change[],
  before: PlanData,
  locks: Lock[],
  user: { email: string; admin: boolean },
  thisWeek: WeekKey,
): Lock[] {
  const active = locks.filter((l) => !exempt(l, user));
  if (active.length === 0) return [];
  const roleBefore = new Map(before.assignments.map((a) => [a.id, a]));
  const broken = new Set<Lock>();
  const hit = (pred: (l: Lock) => boolean) => {
    for (const l of active) if (pred(l)) broken.add(l);
  };
  for (const c of changes) {
    if (c.kind === 'role') {
      if (c.field === undefined) {
        // Created or deleted: the whole role.
        const role = (c.after ?? c.before) as Assignment;
        hit((l) => lockCoversRole(l, role, thisWeek));
      } else if (c.field === 'weekly' && c.week) {
        const role = roleBefore.get(c.id) ?? ({ id: c.id, projectId: c.projectId ?? '' } as Assignment);
        const week = c.week;
        hit((l) => lockCoversCell(l, role, week, thisWeek));
      } else if (FROZEN_ROLE_FIELDS.has(c.field)) {
        const role = roleBefore.get(c.id);
        if (role) hit((l) => l.scope !== 'past' && lockCoversRole(l, role, thisWeek));
      }
    } else if (c.kind === 'project') {
      const id = c.id;
      const frozen = c.field === undefined ? c.after === null : FROZEN_PROJECT_FIELDS.has(c.field);
      if (frozen) hit((l) => l.scope === 'project' && l.projectId === id);
    }
  }
  return [...broken];
}

/** Locks that cover one week of a role (for drawing the grid). */
export function locksOnCell(locks: Lock[], role: Assignment, week: WeekKey, thisWeek: WeekKey): Lock[] {
  return locks.filter((l) => lockCoversCell(l, role, week, thisWeek));
}

/** Locks that stop this user editing a cell. */
export function cellLockedFor(
  locks: Lock[],
  role: Assignment,
  week: WeekKey,
  thisWeek: WeekKey,
  user: { email: string; admin: boolean },
): Lock | undefined {
  return locks.find((l) => !exempt(l, user) && lockCoversCell(l, role, week, thisWeek));
}

/** Short description of what a lock covers. */
export function describeLock(lock: Lock, plan: PlanData, roleName: (a: Assignment) => string): string {
  const project = (id: string): Project | undefined => plan.projects.find((p) => p.id === id);
  switch (lock.scope) {
    case 'past':
      return 'All weeks before this week';
    case 'project':
      return `Workstream ${project(lock.projectId)?.name ?? '(deleted)'}`;
    case 'role': {
      const role = plan.assignments.find((a) => a.id === lock.roleId);
      return role ? `${roleName(role)} on ${project(role.projectId)?.name ?? '?'}` : 'A deleted role';
    }
    case 'cells': {
      const n = lock.roleIds.length;
      const role = n === 1 ? plan.assignments.find((a) => a.id === lock.roleIds[0]) : undefined;
      const what = role ? roleName(role) : `${n} roles`;
      return `${what}, ${lock.from === lock.to ? lock.from : `${lock.from} – ${lock.to}`}`;
    }
  }
}

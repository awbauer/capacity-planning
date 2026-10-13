import { flattenOps, type Op } from './ops';

/** One workspace-wide role per person. */
export type UserRole = 'viewer' | 'editor' | 'admin';
export const USER_ROLES: UserRole[] = ['viewer', 'editor', 'admin'];

export const ROLE_LABELS: Record<UserRole, string> = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin' };

const rank = (r: UserRole) => USER_ROLES.indexOf(r);
export const atLeast = (role: UserRole, min: UserRole) => rank(role) >= rank(min);

/** Ops only admins may send: plan-wide settings and wholesale replacement. */
export function opNeedsAdmin(op: Op): boolean {
  return flattenOps(op).some((o) => o.t === 'settings.update' || o.t === 'plan.replace');
}

/** Whether `role` may apply `op`. */
export function canApply(role: UserRole, op: Op): boolean {
  return opNeedsAdmin(op) ? role === 'admin' : atLeast(role, 'editor');
}

export interface Can {
  /** Change plan data, undo own changes, revert, set own locks, create plans. */
  edit: boolean;
  /** Settings, import/replace, rename/archive plans, users, anyone's locks. */
  admin: boolean;
}

export const canFor = (role: UserRole): Can => ({ edit: atLeast(role, 'editor'), admin: role === 'admin' });

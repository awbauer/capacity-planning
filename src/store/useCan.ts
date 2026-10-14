import { canFor, type Can } from '../domain/permissions';
import { useCollabStore } from './collabStore';
import { isShared } from './mode';

const ALL: Can = { edit: true, admin: true };
const NONE: Can = { edit: false, admin: false };

/**
 * What this person can do right now. Local mode: everything. Shared mode:
 * their workspace role, and no edits while disconnected (after a short grace).
 */
export function useCan(): Can {
  const role = useCollabStore((s) => s.me?.role);
  const status = useCollabStore((s) => s.status);
  const offlineReadOnly = useCollabStore((s) => s.offlineReadOnly);
  if (!isShared()) return ALL;
  if (!role) return NONE;
  const can = canFor(role);
  // Without an open plan (no-plan, archived) there's no connection to lose; plan actions go straight to the API.
  const connected =
    status === 'live' ||
    status === 'connecting' ||
    status === 'no-plan' ||
    status === 'archived' ||
    (status === 'offline' && !offlineReadOnly);
  return connected ? can : { ...can, edit: false };
}

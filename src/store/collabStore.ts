import { create } from 'zustand';
import type { Lock } from '../domain/locks';
import type { UserRole } from '../domain/permissions';
import type { Me, Presence } from '../domain/protocol';
import type { WeekKey } from '../domain/types';
import { currentWeek } from '../domain/weeks';

/** A plan in the shared workspace. */
export interface ServerPlan {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
}

export type ConnectionStatus =
  /** Checking who you are. */
  | 'booting'
  /** Access wants a sign-in (expired session). */
  | 'signed-out'
  /** Signed in, but not allowed in. */
  | 'forbidden'
  /** The shared workspace didn't answer (or isn't set up). */
  | 'unreachable'
  /** Signed in, no plan open yet. */
  | 'no-plan'
  | 'connecting'
  | 'live'
  /** Lost the connection; retrying. */
  | 'offline'
  /** The app was updated on the server. */
  | 'reload'
  /** The open plan was archived. */
  | 'archived';

export interface RecentChange {
  email: string;
  ts: number;
}

export interface Toast {
  id: number;
  msg: string;
  kind: 'error' | 'info';
}

interface CollabState {
  status: ConnectionStatus;
  statusMsg?: string;
  /** When the connection dropped. */
  offlineSince?: number;
  /** Offline for longer than the grace period: edits are paused. */
  offlineReadOnly?: boolean;
  me?: Me & { connId?: string; color?: string };
  /** The open plan has arrived from the server at least once. */
  loaded: boolean;
  plans: ServerPlan[];
  locks: Lock[];
  /** Other people with the open plan, by connection. */
  presence: Record<string, Presence>;
  /** The current week in the workspace's time zone (for the past-weeks lock); kept current by SharedGate. */
  thisWeek: WeekKey;
  timeZone?: string;
  /** Cells someone else changed recently, by `${roleId}|${week}`. */
  recent: Record<string, RecentChange>;
  toasts: Toast[];
  set: (patch: Partial<CollabState>) => void;
  toast: (msg: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let nextToast = 1;

/** Shared-mode state that isn't plan data: connection, who's here, locks, notices. */
export const useCollabStore = create<CollabState>()((set, get) => ({
  status: 'booting',
  loaded: false,
  plans: [],
  locks: [],
  presence: {},
  thisWeek: currentWeek(),
  recent: {},
  toasts: [],
  set: (patch) => set(patch),
  toast: (msg, kind = 'error') => {
    const id = nextToast++;
    set({ toasts: [...get().toasts.slice(-3), { id, msg, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** How long an offline browser keeps accepting edits (queued) before going read-only. */
export const OFFLINE_GRACE_MS = 30_000;

export const myRole = (): UserRole | undefined => useCollabStore.getState().me?.role;

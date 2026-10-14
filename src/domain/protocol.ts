import type { CommentAnchor, Thread } from './comments';
import type { Put } from './diff';
import type { Lock, NewLock } from './locks';
import type { Op } from './ops';
import type { UserRole } from './permissions';
import type { PlanData, WeekKey } from './types';

/** Bumped on any incompatible change; a mismatch asks the browser to reload. */
export const PROTOCOL_VERSION = 2;

export const CLOSE = {
  /** Access session expired: sign in again. */
  sessionExpired: 4001,
  /** No access (removed, or disabled). */
  forbidden: 4003,
  /** The app was updated: reload. */
  protocol: 4009,
  /** The plan was archived. */
  archived: 4010,
} as const;

export interface Me {
  email: string;
  name: string;
  role: UserRole;
  /** Listed in OWNER_EMAILS: always admin. */
  owner: boolean;
}

/** What someone else in the plan is looking at. */
export interface Presence {
  connId: string;
  email: string;
  name: string;
  color: string;
  view?: string;
  /** Selected cells: role ids and a week range. */
  sel?: { roleIds: string[]; from: WeekKey; to: WeekKey };
}

/** A summary of one recorded batch of changes. */
export interface BatchInfo {
  batchId: string;
  seq: number;
  actor: string;
  ts: number;
  op: string;
  summary: string;
  changeCount: number;
  revertOf?: string;
}

export type ClientMsg =
  | { t: 'hello'; proto: number; epoch?: number; lastSeq?: number }
  | { t: 'op'; cid: string; op: Op }
  | { t: 'revert'; cid: string; batchId: string }
  | { t: 'lock.add'; cid: string; lock: NewLock }
  | { t: 'lock.remove'; cid: string; id: string }
  | { t: 'presence'; view?: string; sel?: Presence['sel'] }
  | { t: 'comment.add'; cid: string; threadId: string; commentId: string; anchor?: CommentAnchor; body: string }
  | { t: 'comment.edit'; cid: string; threadId: string; commentId: string; body: string }
  | { t: 'comment.delete'; cid: string; threadId: string; commentId: string }
  | { t: 'thread.resolve'; cid: string; threadId: string; resolved: boolean };

export type RejectCode = 'forbidden' | 'locked' | 'invalid' | 'duplicate' | 'too_large' | 'not_found';

export type ServerMsg =
  | {
      t: 'welcome';
      proto: number;
      you: Me & { connId: string; color: string };
      plan: { id: string; name: string; archived: boolean };
      epoch: number;
      seq: number;
      /** Whole plan (first connect, or too far behind), or what changed since lastSeq. */
      full?: PlanData;
      puts?: Put[];
      locks: Lock[];
      /** Every comment thread in the plan. */
      threads: Thread[];
      presence: Presence[];
      /** The current week where the server is (for the past-weeks lock). */
      thisWeek: WeekKey;
      /** The workspace's time zone, so the browser keeps "this week" current itself. */
      timeZone: string;
    }
  | {
      t: 'applied';
      seq: number;
      batch: BatchInfo;
      /** Set when it was this browser's op/revert. */
      cid?: string;
      puts: Put[];
      /** A whole-plan replacement sends the plan instead of puts. */
      full?: PlanData;
      /** For a revert: how many changes were left alone because they'd changed since. */
      skipped?: number;
    }
  | { t: 'ack'; cid: string; dup: true; seq: number }
  | { t: 'rejected'; cid: string; code: RejectCode; msg: string; lockIds?: string[] }
  | { t: 'locks'; locks: Lock[] }
  /** A comment thread as it now is (after a comment, edit, delete, resolve or reopen). */
  | { t: 'thread'; thread: Thread }
  | { t: 'presence'; presence: Presence }
  | { t: 'presence.leave'; connId: string }
  | { t: 'role'; role: UserRole }
  /** The workspace's time zone changed (decides "this week"). */
  | { t: 'timezone'; timeZone: string }
  | { t: 'meta'; name: string; archived: boolean };

/**
 * Recorded batches that change no plan data (locks, comments): they're in the
 * activity log but can't be undone.
 */
export const isSideChange = (op: string) => op.startsWith('lock.') || op.startsWith('comment.');

/** Ops sent per message are capped well below the platform's message size limit. */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

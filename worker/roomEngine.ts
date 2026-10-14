import { changeRefs, describeOp } from '../src/domain/describeOp';
import {
  diffPlans,
  planEntities,
  planFromEntities,
  toPuts,
  type Change,
  type EntityKind,
  type Put,
} from '../src/domain/diff';
import {
  anchorExists,
  anchorLabel,
  anchorRefs,
  excerpt,
  indexRow,
  MAX_COMMENTS_PER_THREAD,
  MAX_THREADS_PER_PLAN,
  parseMentions,
  rawExcerpt,
  type Comment,
  type CommentAdd,
  type MentionNotice,
  type Thread,
  type ThreadIndexRow,
} from '../src/domain/comments';
import { brokenLocks, type Lock, type NewLock } from '../src/domain/locks';
import { parseOp, validateChanged } from '../src/domain/opSchema';
import { applyOp, flattenOps, type Op } from '../src/domain/ops';
import { canApply, opNeedsAdmin, type UserRole } from '../src/domain/permissions';
import type { BatchInfo, RejectCode } from '../src/domain/protocol';
import { revertChanges } from '../src/domain/revert';
import { createEmptyPlan } from '../src/domain/sampleData';
import { checkReferences } from '../src/domain/schema';
import type { PlanData, WeekKey } from '../src/domain/types';
import { DEFAULT_TIME_ZONE } from '../src/domain/weeks';
import { metaGet, metaSet, migrate, one, type Sql, type SqlValue } from './sql';

const MIGRATIONS = [
  `
  CREATE TABLE entities (kind TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, id));
  CREATE TABLE batches (
    seq INTEGER PRIMARY KEY, batch_id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, client_op_id TEXT, ts INTEGER NOT NULL,
    op TEXT NOT NULL, summary TEXT NOT NULL, revert_of TEXT, change_count INTEGER NOT NULL,
    project_ids TEXT NOT NULL DEFAULT '[]', resource_ids TEXT NOT NULL DEFAULT '[]', admin_only INTEGER NOT NULL DEFAULT 0);
  CREATE UNIQUE INDEX batches_cid ON batches (actor, client_op_id) WHERE client_op_id IS NOT NULL;
  CREATE TABLE changes (
    seq INTEGER NOT NULL, idx INTEGER NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, project_id TEXT,
    field TEXT, week TEXT, before TEXT, after TEXT, PRIMARY KEY (seq, idx));
  CREATE INDEX changes_cell ON changes (target_id, week, seq) WHERE week IS NOT NULL;
  CREATE INDEX changes_target ON changes (kind, target_id, seq);
  CREATE INDEX changes_project ON changes (project_id, seq) WHERE project_id IS NOT NULL;
  CREATE TABLE locks (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  `,
  `
  CREATE TABLE threads (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE comment_revisions (
    seq INTEGER NOT NULL, comment_id TEXT NOT NULL, thread_id TEXT NOT NULL, before TEXT, after TEXT, PRIMARY KEY (seq, comment_id));
  CREATE TABLE thread_dirty (thread_id TEXT PRIMARY KEY, v INTEGER NOT NULL);
  CREATE TABLE mention_events (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
  ALTER TABLE batches ADD COLUMN thread_id TEXT;
  `,
];

export interface User {
  email: string;
  name: string;
  role: UserRole;
}

/** What the activity index keeps about a batch. */
export interface ActivityRow extends BatchInfo {
  planId: string;
  epoch: number;
  projectIds: string[];
  resourceIds: string[];
  /** The comment thread, for comment batches. */
  threadId?: string;
}

/** What the workspace needs to hear about comments since the last flush. */
export interface ThreadOutbox {
  threads: ThreadIndexRow[];
  /** Thread ids and the version read, to clear once the workspace has them. */
  versions: [string, number][];
  notices: MentionNotice[];
  /** Comments deleted since: their notices are dropped. */
  retracted: string[];
  /** Highest mention event included. */
  lastEvent: number;
}

/** A comment's text before and after one recorded change (for the audit log). */
export interface CommentRevision {
  commentId: string;
  threadId: string;
  before: string | null;
  after: string | null;
}

export type Result =
  | { ok: true; seq: number; batch: BatchInfo; puts: Put[]; full?: PlanData; skipped?: number; locks?: Lock[]; thread?: Thread }
  | { ok: false; code: RejectCode; msg: string; lockIds?: string[] }
  | { ok: 'dup'; seq: number }
  | { ok: 'noop'; seq: number };

export interface HistoryEntry {
  seq: number;
  batchId: string;
  ts: number;
  actor: string;
  summary: string;
  kind: EntityKind;
  id: string;
  field: string | null;
  week: string | null;
  before: unknown;
  after: unknown;
}

/** Above this share of entities changed since a browser's last seq, catch-up sends the whole plan. */
const FULL_SNAPSHOT_SHARE = 0.3;

const parse = (s: SqlValue): unknown => (s === null ? null : JSON.parse(String(s)));
const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

/**
 * One plan's authoritative state, change log and locks, on SQLite. Runs
 * inside the PlanRoom Durable Object (and in tests on Node's SQLite).
 * Every change is validated, checked against permissions and locks as
 * actually applied (cascades included), and recorded field by field and week
 * by week in one transaction.
 */
export class RoomEngine {
  private plan?: PlanData;
  private lockList?: Lock[];
  private threadMap?: Map<string, Thread>;

  private readonly sql: Sql;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(sql: Sql, now: () => number = Date.now, newId: () => string = () => crypto.randomUUID()) {
    this.sql = sql;
    this.now = now;
    this.newId = newId;
    migrate(sql, MIGRATIONS);
  }

  get seq(): number {
    return Number(metaGet(this.sql, 'seq') ?? 0);
  }

  /** Bumped when history is rewound (a point-in-time restore), so browsers re-sync from scratch. */
  get epoch(): number {
    return Number(metaGet(this.sql, 'epoch') ?? 1);
  }

  bumpEpoch() {
    metaSet(this.sql, 'epoch', this.epoch + 1);
  }

  /** The workspace's time zone, which decides "this week" (pushed by the Workspace when an admin changes it). */
  get timeZone(): string {
    return metaGet(this.sql, 'time_zone') ?? DEFAULT_TIME_ZONE;
  }

  set timeZone(tz: string) {
    metaSet(this.sql, 'time_zone', tz);
  }

  get planId(): string | undefined {
    return metaGet(this.sql, 'plan_id');
  }

  setPlanId(id: string) {
    if (!this.planId) metaSet(this.sql, 'plan_id', id);
  }

  /** The current plan, loaded from storage on first use. */
  current(): PlanData {
    if (!this.plan) {
      const rows = this.sql.all<{ kind: EntityKind; data: string }>('SELECT kind, data FROM entities ORDER BY ord');
      this.plan = rows.length ? planFromEntities(rows.map((r) => ({ k: r.kind, v: JSON.parse(r.data) }))) : createEmptyPlan();
    }
    return this.plan;
  }

  locks(): Lock[] {
    this.lockList ??= this.sql
      .all<{ data: string }>('SELECT data FROM locks ORDER BY created_at')
      .map((r) => JSON.parse(r.data) as Lock);
    return this.lockList;
  }

  /** Applies a browser's op. `cid` makes resends harmless. */
  apply(user: User, cid: string | undefined, input: unknown, thisWeek: WeekKey): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    const parsed = parseOp(input);
    if ('error' in parsed) return { ok: false, code: 'invalid', msg: parsed.error };
    const { op } = parsed;
    if (!canApply(user.role, op)) {
      return {
        ok: false,
        code: 'forbidden',
        msg: opNeedsAdmin(op) ? 'Only admins can change plan settings or replace the plan.' : 'Viewers can’t edit.',
      };
    }
    const before = this.current();
    const missing = this.missingTarget(before, op);
    if (missing) return { ok: false, code: 'not_found', msg: missing };
    const after = applyOp(before, op);
    const problem = checkReferences(after);
    if (problem) return { ok: false, code: 'invalid', msg: problem };
    const changes = diffPlans(before, after);
    if (changes.length === 0) return { ok: 'noop', seq: this.seq };
    const broken = validateChanged(after, changes);
    if (broken) return { ok: false, code: 'invalid', msg: broken };
    const locked = this.lockCheck(changes, before, user, thisWeek);
    if (locked) return locked;
    const replace = flattenOps(op).some((o) => o.t === 'plan.replace');
    return this.commit(user, cid, before, after, changes, {
      op: op.t === 'group' ? flattenOps(op)[0].t : op.t,
      summary: describeOp(op, before),
      replace,
      adminOnly: opNeedsAdmin(op),
    });
  }

  /** Undoes a recorded batch where nothing has changed it since. */
  revert(user: User, cid: string | undefined, batchId: string, thisWeek: WeekKey): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    if (user.role === 'viewer') return { ok: false, code: 'forbidden', msg: 'Viewers can’t edit.' };
    const batch = one(this.sql.all<{ seq: number; summary: string; admin_only: number; change_count: number }>(
      'SELECT seq, summary, admin_only, change_count FROM batches WHERE batch_id = ?',
      batchId,
    ));
    if (!batch) return { ok: false, code: 'not_found', msg: 'That change no longer exists.' };
    if (batch.admin_only && user.role !== 'admin') {
      return { ok: false, code: 'forbidden', msg: 'Only admins can undo plan settings or a whole-plan replacement.' };
    }
    const changes = this.batchChanges(batch.seq);
    const before = this.current();
    const { plan: after, skipped } = revertChanges(before, changes);
    const diff = diffPlans(before, after);
    if (diff.length === 0) {
      return { ok: false, code: 'invalid', msg: 'Nothing to undo: everything it changed has been changed again since.' };
    }
    const broken = validateChanged(after, diff);
    if (broken) return { ok: false, code: 'invalid', msg: broken };
    const locked = this.lockCheck(diff, before, user, thisWeek);
    if (locked) return locked;
    const result = this.commitRevert(user, cid, before, after, diff, {
      op: 'revert',
      summary: `Undid: ${batch.summary}`,
      revertOf: batchId,
      replace: !!batch.admin_only && diff.length > 500,
      adminOnly: !!batch.admin_only,
    });
    return result.ok === true ? { ...result, skipped: skipped.length } : result;
  }

  /** Sets a freeze lock (recorded in the activity log). */
  addLock(user: User, cid: string | undefined, input: NewLock): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    if (user.role === 'viewer') return { ok: false, code: 'forbidden', msg: 'Viewers can’t set locks.' };
    if (input.scope === 'past' && user.role !== 'admin') {
      return { ok: false, code: 'forbidden', msg: 'Only admins can lock past weeks.' };
    }
    if (input.scope === 'past' && this.locks().some((l) => l.scope === 'past')) {
      return { ok: false, code: 'invalid', msg: 'Past weeks are already locked.' };
    }
    const lock = { ...input, id: input.id || this.newId(), owner: user.email, createdAt: this.now() } as Lock;
    if (this.locks().some((l) => l.id === lock.id)) return { ok: false, code: 'duplicate', msg: 'That lock already exists.' };
    return this.recordLockChange(user, cid, () => {
      this.sql.all('INSERT INTO locks (id, data, created_at) VALUES (?, ?, ?)', lock.id, JSON.stringify(lock), lock.createdAt);
    }, 'lock.add', `Locked ${this.lockLabel(lock)}${lock.note ? ` (“${lock.note}”)` : ''}`, lock);
  }

  removeLock(user: User, cid: string | undefined, id: string): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    const lock = this.locks().find((l) => l.id === id);
    if (!lock) return { ok: false, code: 'not_found', msg: 'That lock was already removed.' };
    if (user.role !== 'admin' && (user.role === 'viewer' || lock.owner !== user.email || lock.scope === 'past')) {
      return { ok: false, code: 'forbidden', msg: `Only ${lock.owner} or an admin can remove this lock.` };
    }
    const by = lock.owner === user.email ? '' : ` (set by ${lock.owner})`;
    return this.recordLockChange(user, cid, () => {
      this.sql.all('DELETE FROM locks WHERE id = ?', id);
    }, 'lock.remove', `Unlocked ${this.lockLabel(lock)}${by}`, lock);
  }

  // ── comments ──

  /** Every comment thread, oldest first. */
  threads(): Thread[] {
    if (!this.threadMap) {
      const rows = this.sql.all<{ data: string }>('SELECT data FROM threads ORDER BY created_at, id');
      this.threadMap = new Map(rows.map((r) => {
        const t = JSON.parse(r.data) as Thread;
        return [t.id, t];
      }));
    }
    return [...this.threadMap.values()];
  }

  thread(id: string): Thread | undefined {
    this.threads();
    return this.threadMap!.get(id);
  }

  /** Adds a comment: to a thread, or starting one when `anchor` is given. Anyone with access can comment. */
  addComment(user: User, cid: string | undefined, input: CommentAdd): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    const plan = this.current();
    const existing = this.thread(input.threadId);
    if (this.threads().some((t) => t.comments.some((c) => c.id === input.commentId))) {
      return { ok: false, code: 'duplicate', msg: 'That comment already exists.' };
    }
    const now = this.now();
    const mentions = parseMentions(input.body);
    const comment = { id: input.commentId, author: user.email, body: input.body, mentions, createdAt: now };
    let thread: Thread;
    let what: string;
    if (existing) {
      if (input.anchor) return { ok: false, code: 'duplicate', msg: 'That thread already exists.' };
      if (existing.comments.length >= MAX_COMMENTS_PER_THREAD) {
        return { ok: false, code: 'too_large', msg: `A thread holds at most ${MAX_COMMENTS_PER_THREAD} comments; start a new one.` };
      }
      const reopen = existing.resolvedAt !== undefined;
      thread = { ...existing, comments: [...existing.comments, comment] };
      if (reopen) {
        delete thread.resolvedAt;
        delete thread.resolvedBy;
      }
      what = reopen ? 'Replied to and reopened a resolved thread on' : 'Replied on';
    } else {
      if (!input.anchor) return { ok: false, code: 'not_found', msg: 'That thread no longer exists.' };
      if (!anchorExists(plan, input.anchor)) return { ok: false, code: 'not_found', msg: 'What you commented on no longer exists.' };
      if (this.threads().length >= MAX_THREADS_PER_PLAN) {
        return { ok: false, code: 'too_large', msg: `This plan has the most comment threads it can hold (${MAX_THREADS_PER_PLAN}).` };
      }
      thread = { id: input.threadId, anchor: input.anchor, createdBy: user.email, createdAt: now, comments: [comment] };
      what = 'Commented on';
    }
    const summary = `${what} ${anchorLabel(plan, thread.anchor)}: “${excerpt(input.body)}”`;
    return this.recordComment(user, cid, thread, 'comment.add', summary, {
      comment: { id: comment.id, before: null, after: comment.body },
      notices: mentions.map((email) => this.notice(email, thread, comment.id, user.email, now, comment.body)),
    });
  }

  /** Changes a comment's text. Only its author can. */
  editComment(user: User, cid: string | undefined, threadId: string, commentId: string, body: string): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    const found = this.findComment(threadId, commentId);
    if ('ok' in found) return found;
    const { thread, comment } = found;
    if (comment.author !== user.email) return { ok: false, code: 'forbidden', msg: 'Only the person who wrote a comment can edit it.' };
    if (comment.body === body) return { ok: 'noop', seq: this.seq };
    const now = this.now();
    const mentions = parseMentions(body);
    const added = mentions.filter((m) => !comment.mentions.includes(m));
    const updated = { ...comment, body, mentions, editedAt: now };
    const next = { ...thread, comments: thread.comments.map((c) => (c.id === commentId ? updated : c)) };
    const summary = `Edited a comment on ${anchorLabel(this.current(), thread.anchor)}: “${excerpt(body)}”`;
    return this.recordComment(user, cid, next, 'comment.edit', summary, {
      comment: { id: commentId, before: comment.body, after: body },
      notices: added.map((email) => this.notice(email, next, commentId, user.email, now, body)),
    });
  }

  /** Deletes a comment (its author or an admin). Its place in the thread stays; its text is only kept for the audit log. */
  deleteComment(user: User, cid: string | undefined, threadId: string, commentId: string): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    const found = this.findComment(threadId, commentId);
    if ('ok' in found) return found;
    const { thread, comment } = found;
    if (comment.author !== user.email && user.role !== 'admin') {
      return { ok: false, code: 'forbidden', msg: 'Only the person who wrote a comment, or an admin, can delete it.' };
    }
    const deleted: Comment = { id: comment.id, author: comment.author, body: '', mentions: [], createdAt: comment.createdAt, deleted: { by: user.email, at: this.now() } };
    const next = { ...thread, comments: thread.comments.map((c) => (c.id === commentId ? deleted : c)) };
    const by = comment.author === user.email ? '' : ` by ${comment.author}`;
    const summary = `Deleted a comment${by} on ${anchorLabel(this.current(), thread.anchor)}`;
    return this.recordComment(user, cid, next, 'comment.delete', summary, {
      comment: { id: commentId, before: comment.body, after: null },
      retract: commentId,
    });
  }

  /** Resolves or reopens a thread. Anyone with access can. */
  setResolved(user: User, cid: string | undefined, threadId: string, resolved: boolean): Result {
    const dup = this.dupOf(user, cid);
    if (dup !== undefined) return { ok: 'dup', seq: dup };
    const thread = this.thread(threadId);
    if (!thread) return { ok: false, code: 'not_found', msg: 'That thread no longer exists.' };
    if ((thread.resolvedAt !== undefined) === resolved) return { ok: 'noop', seq: this.seq };
    const next: Thread = { ...thread };
    if (resolved) {
      next.resolvedAt = this.now();
      next.resolvedBy = user.email;
    } else {
      delete next.resolvedAt;
      delete next.resolvedBy;
    }
    const summary = `${resolved ? 'Resolved' : 'Reopened'} the thread on ${anchorLabel(this.current(), thread.anchor)}`;
    return this.recordComment(user, cid, next, resolved ? 'comment.resolve' : 'comment.reopen', summary, {});
  }

  /** What the workspace hasn't heard yet: changed threads and new mentions. */
  threadOutbox(limit = 100): ThreadOutbox {
    const plan = this.current();
    const dirty = this.sql.all<{ thread_id: string; v: number }>('SELECT thread_id, v FROM thread_dirty LIMIT ?', limit);
    const events = this.sql.all<{ id: number; data: string }>('SELECT id, data FROM mention_events ORDER BY id LIMIT ?', limit * 5);
    const notices: MentionNotice[] = [];
    const retracted: string[] = [];
    for (const e of events) {
      const d = JSON.parse(e.data) as MentionNotice | { retract: string };
      if ('retract' in d) retracted.push(d.retract);
      else notices.push(d);
    }
    return {
      threads: dirty.map((d) => this.thread(d.thread_id)).filter((t): t is Thread => !!t).map((t) => indexRow(plan, t)),
      versions: dirty.map((d) => [d.thread_id, d.v]),
      notices,
      retracted,
      lastEvent: events.length ? events[events.length - 1].id : 0,
    };
  }

  /** Clears what the workspace now has (threads changed again since stay dirty). */
  threadOutboxSent(sent: ThreadOutbox) {
    this.sql.transaction(() => {
      for (const [id, v] of sent.versions) this.sql.all('DELETE FROM thread_dirty WHERE thread_id = ? AND v = ?', id, v);
      if (sent.lastEvent) this.sql.all('DELETE FROM mention_events WHERE id <= ?', sent.lastEvent);
    });
  }

  /** Marks every thread for re-sending (rebuilding the workspace's index). */
  reindexThreads() {
    this.sql.all('INSERT INTO thread_dirty (thread_id, v) SELECT id, 1 FROM threads WHERE true ON CONFLICT(thread_id) DO UPDATE SET v = v + 1');
  }

  get threadOutboxEmpty(): boolean {
    return !one(this.sql.all('SELECT 1 FROM thread_dirty LIMIT 1')) && !one(this.sql.all('SELECT 1 FROM mention_events LIMIT 1'));
  }

  private notice(email: string, thread: Thread, commentId: string, actor: string, ts: number, body: string): MentionNotice {
    return { email, threadId: thread.id, commentId, actor, ts, label: anchorLabel(this.current(), thread.anchor), excerpt: rawExcerpt(body, 500) };
  }

  private findComment(threadId: string, commentId: string): { thread: Thread; comment: Comment } | (Result & { ok: false }) {
    const thread = this.thread(threadId);
    if (!thread) return { ok: false, code: 'not_found', msg: 'That thread no longer exists.' };
    const comment = thread.comments.find((c) => c.id === commentId);
    if (!comment || comment.deleted) return { ok: false, code: 'not_found', msg: 'That comment was deleted.' };
    return { thread, comment };
  }

  private recordComment(
    user: User,
    cid: string | undefined,
    thread: Thread,
    op: string,
    summary: string,
    extra: { comment?: { id: string; before: string | null; after: string | null }; notices?: MentionNotice[]; retract?: string },
  ): Result {
    const refs = anchorRefs(this.current(), thread.anchor);
    const r = this.recordSideChange(
      user,
      cid,
      (seq) => {
        this.sql.all(
          'INSERT INTO threads (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
          thread.id,
          JSON.stringify(thread),
          thread.createdAt,
        );
        if (extra.comment) {
          this.sql.all(
            'INSERT INTO comment_revisions (seq, comment_id, thread_id, before, after) VALUES (?, ?, ?, ?, ?)',
            seq,
            extra.comment.id,
            thread.id,
            extra.comment.before,
            extra.comment.after,
          );
        }
        this.sql.all('INSERT INTO thread_dirty (thread_id, v) VALUES (?, 1) ON CONFLICT(thread_id) DO UPDATE SET v = v + 1', thread.id);
        for (const n of extra.notices ?? []) this.sql.all('INSERT INTO mention_events (data) VALUES (?)', JSON.stringify(n));
        if (extra.retract) this.sql.all('INSERT INTO mention_events (data) VALUES (?)', JSON.stringify({ retract: extra.retract }));
      },
      op,
      summary.slice(0, 600),
      refs,
      thread.id,
    );
    this.threads();
    this.threadMap!.set(thread.id, thread);
    return { ...r, thread };
  }

  /** Replaces the whole plan (creating or uploading one); recorded like any other change. */
  replacePlan(user: User, plan: PlanData, summary: string): Result {
    const before = this.current();
    const changes = diffPlans(before, plan);
    if (changes.length === 0) return { ok: 'noop', seq: this.seq };
    return this.commit(user, undefined, before, plan, changes, { op: 'plan.replace', summary, replace: true, adminOnly: false });
  }

  /**
   * What a browser that last saw `lastSeq` (in `epoch`) needs: the entities
   * changed since, or the whole plan when that's simpler.
   */
  catchUp(epoch: number | undefined, lastSeq: number | undefined): { full?: PlanData; puts?: Put[] } {
    const plan = this.current();
    if (epoch !== this.epoch || lastSeq === undefined || lastSeq > this.seq) return { full: plan };
    if (lastSeq === this.seq) return { puts: [] };
    const replaced = one(this.sql.all('SELECT 1 FROM batches WHERE seq > ? AND op = ? LIMIT 1', lastSeq, 'plan.replace'));
    if (replaced) return { full: plan };
    // Something deleted and re-created since (an undone delete) moved to the end on the
    // server; the browser still has it in its old place, so send the whole plan.
    const recreated = one(
      this.sql.all(
        `SELECT 1 FROM changes d JOIN changes c ON c.kind = d.kind AND c.target_id = d.target_id AND c.seq > d.seq
         WHERE d.seq > ? AND d.field IS NULL AND d.after IS NULL AND c.field IS NULL AND c.before IS NULL LIMIT 1`,
        lastSeq,
      ),
    );
    if (recreated) return { full: plan };
    // In stored order, so entities the browser doesn't have yet are added in the same order the
    // server keeps them (deleted ones, with no row left, come first).
    const touched = this.sql.all<{ kind: EntityKind; target_id: string }>(
      `SELECT c.kind, c.target_id FROM (SELECT DISTINCT kind, target_id FROM changes WHERE seq > ?) c
       LEFT JOIN entities e ON e.kind = c.kind AND e.id = c.target_id
       ORDER BY COALESCE(e.ord, -1), c.kind, c.target_id`,
      lastSeq,
    );
    const total = plan.tags.length + plan.sellers.length + plan.resources.length + plan.projects.length + plan.assignments.length;
    if (touched.length > Math.max(50, total * FULL_SNAPSHOT_SHARE)) return { full: plan };
    return { puts: toPuts(plan, touched.map((t) => ({ kind: t.kind, id: t.target_id, before: null, after: null }))) };
  }

  /** Every recorded change to some weeks of a role (or, without weeks, to the role itself), newest first. */
  history(q: { roleId: string; weeks?: string[] } | { kind: EntityKind; id: string }, limit = 200): HistoryEntry[] {
    const cols = `c.seq, c.kind, c.target_id, c.field, c.week, c.before, c.after, b.batch_id, b.ts, b.actor, b.summary
      FROM changes c JOIN batches b ON b.seq = c.seq`;
    let rows: Record<string, SqlValue>[];
    if ('roleId' in q) {
      const weeks = (q.weeks ?? []).slice(0, 60);
      const weekFilter = weeks.length ? `AND (c.week IS NULL OR c.week IN (${weeks.map(() => '?').join(',')}))` : '';
      rows = this.sql.all(
        `SELECT ${cols} WHERE c.kind = 'role' AND c.target_id = ? ${weekFilter} ORDER BY c.seq DESC, c.idx LIMIT ?`,
        q.roleId,
        ...weeks,
        limit,
      );
    } else if (q.kind === 'project') {
      // The workstream itself, plus roles added to or removed from it.
      rows = this.sql.all(
        `SELECT ${cols} WHERE (c.kind = 'project' AND c.target_id = ?) OR (c.project_id = ? AND (c.field IS NULL OR c.field <> 'weekly'))
         ORDER BY c.seq DESC, c.idx LIMIT ?`,
        q.id,
        q.id,
        limit,
      );
    } else {
      rows = this.sql.all(
        `SELECT ${cols} WHERE c.kind = ? AND c.target_id = ? ORDER BY c.seq DESC, c.idx LIMIT ?`,
        q.kind,
        q.id,
        limit,
      );
    }
    return rows.map((r) => ({
      seq: Number(r.seq),
      batchId: String(r.batch_id),
      ts: Number(r.ts),
      actor: String(r.actor),
      summary: String(r.summary),
      kind: r.kind as EntityKind,
      id: String(r.target_id),
      field: r.field === null ? null : String(r.field),
      week: r.week === null ? null : String(r.week),
      before: parse(r.before),
      after: parse(r.after),
    }));
  }

  /**
   * One batch and every change in it. For a comment batch, `withText` adds
   * the comment's text before and after (admins only: it can be deleted text).
   */
  batch(
    batchId: string,
    withText = false,
  ): { batch: BatchInfo; changes: Change[]; threadId?: string; comment?: CommentRevision } | undefined {
    const row = one(this.sql.all('SELECT * FROM batches WHERE batch_id = ?', batchId));
    if (!row) return undefined;
    const seq = Number(row.seq);
    const rev = withText
      ? one(this.sql.all<{ comment_id: string; thread_id: string; before: string | null; after: string | null }>(
          'SELECT comment_id, thread_id, before, after FROM comment_revisions WHERE seq = ?',
          seq,
        ))
      : undefined;
    return {
      batch: toBatchInfo(row),
      changes: this.batchChanges(seq),
      ...(row.thread_id ? { threadId: String(row.thread_id) } : {}),
      ...(rev ? { comment: { commentId: rev.comment_id, threadId: rev.thread_id, before: rev.before, after: rev.after } } : {}),
    };
  }

  /** Batches after `afterSeq`, for the workspace's activity index. */
  activitySince(afterSeq: number, limit = 200): ActivityRow[] {
    const planId = this.planId ?? '';
    const epoch = this.epoch;
    return this.sql
      .all('SELECT * FROM batches WHERE seq > ? ORDER BY seq LIMIT ?', afterSeq, limit)
      .map((r) => ({
        ...toBatchInfo(r),
        planId,
        epoch,
        projectIds: JSON.parse(String(r.project_ids)) as string[],
        resourceIds: JSON.parse(String(r.resource_ids)) as string[],
        ...(r.thread_id ? { threadId: String(r.thread_id) } : {}),
      }));
  }

  get flushedSeq(): number {
    return Number(metaGet(this.sql, 'flushed_seq') ?? 0);
  }

  set flushedSeq(seq: number) {
    metaSet(this.sql, 'flushed_seq', seq);
  }

  // ── internals ──

  private dupOf(user: User, cid: string | undefined): number | undefined {
    if (!cid) return undefined;
    const row = one(this.sql.all<{ seq: number }>('SELECT seq FROM batches WHERE actor = ? AND client_op_id = ?', user.email, cid));
    return row?.seq;
  }

  /** A message if the op updates or deletes something that doesn't exist. */
  private missingTarget(plan: PlanData, op: Op): string | undefined {
    for (const o of flattenOps(op)) {
      const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id);
      const t = o.t;
      if ((t === 'tag.update' || t === 'tag.delete') && !has(plan.tags, o.id)) return 'That capability no longer exists.';
      if ((t === 'seller.update' || t === 'seller.delete') && !has(plan.sellers, o.id)) return 'That seller no longer exists.';
      if ((t === 'resource.update' || t === 'resource.delete') && !has(plan.resources, o.id)) return 'That person no longer exists.';
      if ((t === 'project.update' || t === 'project.delete') && !has(plan.projects, o.id)) return 'That workstream no longer exists.';
      if ((t === 'role.update' || t === 'role.assign' || t === 'role.delete') && !has(plan.assignments, o.id)) {
        return 'That role no longer exists.';
      }
      if (t === 'cells.set') {
        const gone = o.edits.find((e) => !has(plan.assignments, e.roleId));
        if (gone) return 'That role no longer exists.';
      }
      if (t === 'role.assign' && o.resourceId && !has(plan.resources, o.resourceId)) return 'That person no longer exists.';
      // Adds reuse ids the browser generated; an id that's taken means a stale or forged op.
      if (t === 'tag.add' && has(plan.tags, o.tag.id)) return 'That capability already exists.';
      if (t === 'seller.add' && has(plan.sellers, o.seller.id)) return 'That seller already exists.';
      if (t === 'resource.add' && has(plan.resources, o.resource.id)) return 'That person already exists.';
      if (t === 'project.add' && has(plan.projects, o.project.id)) return 'That workstream already exists.';
      if (t === 'role.add' && has(plan.assignments, o.role.id)) return 'That role already exists.';
    }
    return undefined;
  }

  private lockCheck(changes: Change[], before: PlanData, user: User, thisWeek: WeekKey): Result | undefined {
    const broken = brokenLocks(changes, before, this.locks(), { email: user.email, admin: user.role === 'admin' }, thisWeek);
    if (broken.length === 0) return undefined;
    const l = broken[0];
    const why = l.scope === 'past' ? 'past weeks are locked' : `${this.lockLabel(l)} is locked by ${l.owner}`;
    return {
      ok: false,
      code: 'locked',
      msg: `Can’t change that: ${why}${l.note ? ` (“${l.note}”)` : ''}.`,
      lockIds: broken.map((b) => b.id),
    };
  }

  private lockLabel(lock: Lock): string {
    const plan = this.current();
    const project = (id: string) => plan.projects.find((p) => p.id === id)?.name ?? 'a deleted workstream';
    const role = (id: string) => {
      const a = plan.assignments.find((x) => x.id === id);
      if (!a) return 'a deleted role';
      const person = a.resourceId ? plan.resources.find((r) => r.id === a.resourceId)?.name : 'open';
      return `${[a.name, person].filter(Boolean).join(' › ')} on ${project(a.projectId)}`;
    };
    switch (lock.scope) {
      case 'past':
        return 'past weeks';
      case 'project':
        return `workstream ${project(lock.projectId)}`;
      case 'role':
        return role(lock.roleId);
      case 'cells': {
        const what = lock.roleIds.length === 1 ? role(lock.roleIds[0]) : `${lock.roleIds.length} roles`;
        return `${what}, ${lock.from === lock.to ? `week of ${lock.from}` : `${lock.from} to ${lock.to}`}`;
      }
    }
  }

  private recordLockChange(user: User, cid: string | undefined, write: () => void, op: string, summary: string, lock: Lock): Result {
    const projectIds = lock.scope === 'project' ? [lock.projectId] : [];
    const r = this.recordSideChange(user, cid, write, op, summary, { projectIds, resourceIds: [] });
    this.lockList = undefined;
    return { ...r, locks: this.locks() };
  }

  /** Records a batch that changes no plan data (a lock or a comment), running `write` in its transaction. */
  private recordSideChange(
    user: User,
    cid: string | undefined,
    write: (seq: number) => void,
    op: string,
    summary: string,
    refs: { projectIds: string[]; resourceIds: string[] },
    threadId?: string,
  ): Result & { ok: true } {
    const seq = this.seq + 1;
    const batch: BatchInfo = { batchId: this.newId(), seq, actor: user.email, ts: this.now(), op, summary, changeCount: 0 };
    this.sql.transaction(() => {
      write(seq);
      this.insertBatch(batch, cid, refs.projectIds, refs.resourceIds, false, threadId);
      metaSet(this.sql, 'seq', seq);
    });
    return { ok: true, seq, batch, puts: [] };
  }

  private insertBatch(
    batch: BatchInfo,
    cid: string | undefined,
    projectIds: string[],
    resourceIds: string[],
    adminOnly: boolean,
    threadId?: string,
  ) {
    this.sql.all(
      `INSERT INTO batches (seq, batch_id, actor, client_op_id, ts, op, summary, revert_of, change_count, project_ids, resource_ids, admin_only, thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      batch.seq,
      batch.batchId,
      batch.actor,
      cid ?? null,
      batch.ts,
      batch.op,
      batch.summary,
      batch.revertOf ?? null,
      batch.changeCount,
      JSON.stringify(projectIds),
      JSON.stringify(resourceIds),
      adminOnly ? 1 : 0,
      threadId ?? null,
    );
  }

  private commit(
    user: User,
    cid: string | undefined,
    before: PlanData,
    after: PlanData,
    changes: Change[],
    info: { op: string; summary: string; revertOf?: string; replace: boolean; adminOnly: boolean },
  ): Result {
    const seq = this.seq + 1;
    const batch: BatchInfo = {
      batchId: this.newId(),
      seq,
      actor: user.email,
      ts: this.now(),
      op: info.op,
      summary: info.summary,
      changeCount: changes.length,
      ...(info.revertOf ? { revertOf: info.revertOf } : {}),
    };
    const refs = changeRefs(changes, before);
    const puts = toPuts(after, changes);
    this.sql.transaction(() => {
      this.insertBatch(batch, cid, refs.projectIds, refs.resourceIds, info.adminOnly);
      changes.forEach((c, idx) => {
        this.sql.all(
          'INSERT INTO changes (seq, idx, kind, target_id, project_id, field, week, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          seq,
          idx,
          c.kind,
          c.id,
          c.projectId ?? null,
          c.field ?? null,
          c.week ?? null,
          json(c.before),
          json(c.after),
        );
      });
      if (info.replace) this.writeAll(after);
      else this.writePuts(puts);
      metaSet(this.sql, 'seq', seq);
    });
    this.plan = after;
    return { ok: true, seq, batch, puts, ...(info.replace ? { full: after } : {}) };
  }

  /**
   * A revert can bring entities back in a different order than storage
   * keeps them, so the plan is reloaded from storage (the order browsers
   * get from the puts) after committing.
   */
  private commitRevert(...args: Parameters<RoomEngine['commit']>): Result {
    const result = this.commit(...args);
    if (result.ok === true) this.plan = undefined;
    return result;
  }

  private writePuts(puts: Put[]) {
    let next = Number(one(this.sql.all<{ m: number | null }>('SELECT MAX(ord) AS m FROM entities'))?.m ?? 0);
    for (const p of puts) {
      if (p.v === null) this.sql.all('DELETE FROM entities WHERE kind = ? AND id = ?', p.k, p.id);
      else {
        this.sql.all(
          `INSERT INTO entities (kind, id, ord, data) VALUES (?, ?, ?, ?)
           ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data`,
          p.k,
          p.id,
          ++next,
          JSON.stringify(p.v),
        );
      }
    }
  }

  private writeAll(plan: PlanData) {
    this.sql.all('DELETE FROM entities');
    planEntities(plan).forEach((p, i) => {
      this.sql.all('INSERT INTO entities (kind, id, ord, data) VALUES (?, ?, ?, ?)', p.k, p.id, i + 1, JSON.stringify(p.v));
    });
  }

  private batchChanges(seq: number): Change[] {
    return this.sql
      .all('SELECT * FROM changes WHERE seq = ? ORDER BY idx', seq)
      .map((r) => ({
        kind: r.kind as EntityKind,
        id: String(r.target_id),
        ...(r.project_id !== null ? { projectId: String(r.project_id) } : {}),
        ...(r.field !== null ? { field: String(r.field) } : {}),
        ...(r.week !== null ? { week: String(r.week) } : {}),
        before: parse(r.before),
        after: parse(r.after),
      }));
  }
}

function toBatchInfo(r: Record<string, SqlValue>): BatchInfo {
  return {
    batchId: String(r.batch_id),
    seq: Number(r.seq),
    actor: String(r.actor),
    ts: Number(r.ts),
    op: String(r.op),
    summary: String(r.summary),
    changeCount: Number(r.change_count),
    ...(r.revert_of !== null && r.revert_of !== undefined ? { revertOf: String(r.revert_of) } : {}),
  };
}

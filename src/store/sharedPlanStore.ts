import { create, useStore, type StoreApi, type UseBoundStore } from 'zustand';
import { ApiError, api } from '../api/client';
import { anchorRoleId, threadMentions, type CommentAnchor, type Thread } from '../domain/comments';
import type { Put } from '../domain/diff';
import type { NewLock } from '../domain/locks';
import { applyOp, type Op } from '../domain/ops';
import { canFor } from '../domain/permissions';
import { CLOSE, type ClientMsg, type Presence, type ServerMsg } from '../domain/protocol';
import { createEmptyPlan } from '../domain/sampleData';
import type { Assignment, PlanData } from '../domain/types';
import { weekInZone } from '../domain/weeks';
import { SyncCore, type Pending } from '../sync/syncCore';
import { makePlanActions } from './actions';
import { OFFLINE_GRACE_MS, useCollabStore, type Person, type ServerPlan } from './collabStore';
import type { PlanState } from './localPlanStore';
import { useUIStore, workstreamGroupKeys } from './uiStore';

export interface SharedPlanState extends PlanState {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Remembered in this browser between visits. */
const PREFS_KEY = 'capacity-collab:v1';
const pendingKey = (planId: string) => `capacity-pending:${planId}`;
/** Cells changed by someone else are marked for this long. */
export const RECENT_MS = 10 * 60_000;

interface Prefs {
  lastPlanId?: string;
  /** This browser's plans were already offered for upload (so the offer isn't repeated). */
  uploadOffered?: boolean;
}

export function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

export function writePrefs(patch: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // Storage full or blocked; not essential.
  }
}

const notAvailable = (what: string) => () => {
  throw new Error(`${what} works differently in the shared workspace.`);
};

/** Messages whose outcome the caller waits for. */
type RequestMsg = ClientMsg extends infer M
  ? M extends { cid: string; t: 'revert' | 'lock.add' | 'lock.remove' | 'comment.add' | 'comment.edit' | 'comment.delete' | 'thread.resolve' }
    ? Omit<M, 'cid'>
    : never
  : never;

/** Socket attempts that never open before the plan is checked over HTTP (archived? gone?). */
const NEVER_OPENED_LIMIT = 3;

/**
 * The shared workspace session: the socket, timers and UI side of syncing
 * the open plan. The sync itself (confirmed state, pending edits, undo
 * stacks) is in SyncCore; what's shown is always rebuilt from it.
 */
class Session {
  private core = new SyncCore(() => this.cid());
  /** Ops dispatched this tick, sent together as one change (one undo step). */
  private batch: Op[] = [];
  planId?: string;
  private ws?: WebSocket;
  /** Bumped by open()/close(); a reconnect from an older generation gives up. */
  private generation = 0;
  private retry = 0;
  private neverOpened = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private graceTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private frame?: number;
  private nextCid = 0;
  /** Callbacks waiting for a cid's outcome (locks, reverts). */
  private waiters = new Map<string, (ok: boolean, msg?: string) => void>();

  private readonly store: () => StoreApi<SharedPlanState>;

  constructor(store: () => StoreApi<SharedPlanState>) {
    this.store = store;
  }

  private get collab() {
    return useCollabStore.getState();
  }

  private cid() {
    return `${Date.now().toString(36)}-${(this.nextCid++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── edits ──

  canEdit(): boolean {
    const c = this.collab;
    if (!c.me || !canFor(c.me.role).edit) return false;
    if (c.status === 'live' || c.status === 'connecting') return true;
    return c.status === 'offline' && !c.offlineReadOnly;
  }

  dispatch(op: Op) {
    if (!this.planId) return;
    if (!this.canEdit()) {
      const c = this.collab;
      this.collab.toast(
        c.me && !canFor(c.me.role).edit ? 'You have view-only access to the shared workspace.' : 'You’re offline; changes are paused until the connection is back.',
      );
      return;
    }
    const s = this.store();
    s.setState({ plan: applyOp(s.getState().plan, op) });
    if (this.batch.length === 0) queueMicrotask(() => this.flushBatch());
    this.batch.push(op);
  }

  private flushBatch() {
    const ops = this.batch;
    this.batch = [];
    if (ops.length === 0) return;
    const msg = this.core.edit(ops.length === 1 ? ops[0] : { t: 'group', ops });
    this.stash();
    this.updateHistory();
    this.send(msg);
  }

  /** Sends a request whose outcome the caller wants (locks, reverts). */
  request(msg: RequestMsg): Promise<void> {
    const cid = this.cid();
    return new Promise((resolve, reject) => {
      if (!this.connected || this.collab.status !== 'live') {
        reject(new Error('You’re offline; try again once reconnected.'));
        return;
      }
      this.waiters.set(cid, (ok, m) => (ok ? resolve() : reject(new Error(m))));
      this.send({ ...msg, cid } as ClientMsg);
    });
  }

  undo() {
    this.revert('undo');
  }

  redo() {
    this.revert('redo');
  }

  /** Undo/redo only take the batch off the stack when the request can actually be sent. */
  private revert(which: 'undo' | 'redo') {
    const msg = this.core.takeRevert(which, this.connected && this.collab.status === 'live');
    if (!msg) {
      const stack = which === 'undo' ? this.core.undoStack : this.core.redoStack;
      if (stack.length && !this.connected) this.collab.toast('Reconnecting — try again in a moment.', 'info');
      return;
    }
    this.updateHistory();
    this.send(msg);
  }

  private updateHistory() {
    const can = this.canEdit() && this.connected && this.collab.status === 'live';
    this.store().setState({ canUndo: can && this.core.undoStack.length > 0, canRedo: can && this.core.redoStack.length > 0 });
  }

  // ── connection ──

  open(planId: string, name: string) {
    this.close();
    this.planId = planId;
    this.core = new SyncCore(() => this.cid(), this.unstash(planId));
    this.neverOpened = 0;
    this.retry = 0;
    this.store().setState({ plan: this.core.view(), meta: { id: planId, name, revision: 0 } });
    this.updateHistory();
    writePrefs({ lastPlanId: planId });
    const focus = this.collab.comments;
    this.collab.set({
      status: 'connecting',
      loaded: false,
      offlineSince: undefined,
      offlineReadOnly: false,
      locks: [],
      presence: {},
      recent: {},
      threads: {},
      // A thread being opened from a link or the inbox stays open across the switch.
      comments: focus?.jump ? focus : null,
    });
    this.connect(this.generation);
  }

  close() {
    this.generation++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.graceTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onclose = null;
      ws.close(1000);
    }
  }

  private connect(generation: number) {
    const planId = this.planId;
    if (!planId || generation !== this.generation) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/plans/${encodeURIComponent(planId)}/ws`);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.neverOpened = 0;
      this.send(this.core.hello());
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
      this.updateHistory();
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong' || this.ws !== ws) return;
      try {
        this.receive(JSON.parse(String(e.data)) as ServerMsg);
      } catch (err) {
        console.error('Bad message from the shared workspace', err);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = undefined;
      for (const [cid, w] of this.waiters) {
        w(false, 'The connection dropped; try again.');
        this.waiters.delete(cid);
      }
      if (!opened) this.neverOpened++;
      void this.onClose(e.code, e.reason, generation);
    };
  }

  private async onClose(code: number, reason: string, generation: number) {
    if (code === CLOSE.sessionExpired) return this.collab.set({ status: 'signed-out', statusMsg: 'Your sign-in expired.' });
    if (code === CLOSE.forbidden) return this.collab.set({ status: 'forbidden', statusMsg: reason || 'Your access was removed.' });
    if (code === CLOSE.protocol) return this.collab.set({ status: 'reload', statusMsg: 'The app was updated.' });
    if (code === CLOSE.archived) return this.planGone('This plan was archived.');
    // The socket was refused before it ever opened: find out why over HTTP instead of retrying blindly.
    if (this.neverOpened > 0 && this.planId) {
      try {
        const { plan } = await api<{ plan: ServerPlan }>(`/api/plans/${encodeURIComponent(this.planId)}`);
        if (generation !== this.generation) return;
        if (plan.archivedAt) return this.planGone('This plan was archived.');
      } catch (err) {
        if (generation !== this.generation) return;
        if (err instanceof ApiError && err.status === 404) return this.planGone('This plan no longer exists.');
        if (err instanceof ApiError && err.signIn) return this.collab.set({ status: 'signed-out', statusMsg: 'Your sign-in expired.' });
        if (err instanceof ApiError && err.status === 403) return this.collab.set({ status: 'forbidden', statusMsg: err.message });
      }
      if (this.neverOpened >= NEVER_OPENED_LIMIT && !this.collab.loaded) {
        return this.collab.set({ status: 'unreachable', statusMsg: 'The plan’s live connection was refused. Retry, or work locally for now.' });
      }
    }
    if (generation !== this.generation) return;
    const c = this.collab;
    if (!c.offlineSince) {
      this.collab.set({ status: 'offline', offlineSince: Date.now(), offlineReadOnly: false });
      // After the grace period, stop taking edits until the connection is back.
      clearTimeout(this.graceTimer);
      this.graceTimer = setTimeout(() => {
        if (this.collab.status === 'offline') {
          this.collab.set({ offlineReadOnly: true });
          this.updateHistory();
        }
      }, OFFLINE_GRACE_MS);
    } else this.collab.set({ status: 'offline' });
    this.updateHistory();
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => void this.reconnect(generation), delay);
  }

  private planGone(msg: string) {
    this.collab.set({ status: 'archived', statusMsg: msg });
    void refreshPlans().catch(() => undefined);
  }

  /** Before reconnecting, checks the sign-in is still good (Access may want a fresh login). */
  private async reconnect(generation: number) {
    try {
      await api('/api/me');
    } catch (err) {
      if (generation !== this.generation) return;
      if (err instanceof ApiError && err.signIn) return this.collab.set({ status: 'signed-out', statusMsg: 'Your sign-in expired.' });
      if (err instanceof ApiError && err.status === 403) return this.collab.set({ status: 'forbidden', statusMsg: err.message });
    }
    // The user may have opened another plan meanwhile; that connection is the live one.
    this.connect(generation);
  }

  send(msg: ClientMsg): boolean {
    if (!this.connected || (msg.t !== 'hello' && this.collab.status !== 'live')) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  private stash() {
    if (!this.planId) return;
    try {
      if (this.core.pending.length) sessionStorage.setItem(pendingKey(this.planId), JSON.stringify(this.core.pending));
      else sessionStorage.removeItem(pendingKey(this.planId));
    } catch {
      // Not essential.
    }
  }

  private unstash(planId: string): Pending[] {
    try {
      return JSON.parse(sessionStorage.getItem(pendingKey(planId)) ?? '[]') as Pending[];
    } catch {
      return [];
    }
  }

  // ── server messages ──

  private receive(msg: ServerMsg) {
    const r = this.core.receive(msg);
    switch (msg.t) {
      case 'welcome': {
        if (r.kind !== 'welcome') return;
        this.retry = 0;
        clearTimeout(this.graceTimer);
        this.collab.set({
          status: 'live',
          loaded: true,
          statusMsg: undefined,
          offlineSince: undefined,
          offlineReadOnly: false,
          me: msg.you,
          locks: msg.locks,
          threads: Object.fromEntries(msg.threads.map((t) => [t.id, t])),
          presence: Object.fromEntries(msg.presence.map((p) => [p.connId, p])),
          timeZone: msg.timeZone,
          thisWeek: weekInZone(msg.timeZone),
          ...(r.first ? { recent: {} } : {}),
        });
        this.store().setState({ meta: { id: msg.plan.id, name: msg.plan.name, revision: msg.seq } });
        for (const m of r.resend) this.send(m);
        this.publish();
        this.updateHistory();
        return;
      }
      case 'applied': {
        this.store().setState({ meta: { ...this.store().getState().meta, revision: msg.seq } });
        if (r.kind === 'own') {
          this.stash();
          this.settle(r.cid, true);
          if (r.skipped) {
            this.collab.toast(`${r.skipped} change${r.skipped === 1 ? '' : 's'} made or built on since by someone else ${r.skipped === 1 ? 'was' : 'were'} kept.`, 'info');
          }
        } else if (r.kind === 'theirs') {
          this.markRecent(r.before, r.puts, r.actor, r.ts);
        }
        this.updateHistory();
        this.publish();
        return;
      }
      case 'ack':
        this.stash();
        this.settle(msg.cid, true);
        this.publish();
        return;
      case 'rejected': {
        if (r.kind !== 'rejected') return;
        this.stash();
        if (!this.settle(msg.cid, false, msg.msg)) this.collab.toast(msg.msg);
        if (r.wasPending) this.publish();
        this.updateHistory();
        return;
      }
      case 'locks':
        this.collab.set({ locks: msg.locks });
        return;
      case 'thread':
        this.onThread(msg.thread);
        return;
      case 'timezone':
        this.collab.set({ timeZone: msg.timeZone, thisWeek: weekInZone(msg.timeZone) });
        return;
      case 'presence':
        this.collab.set({ presence: { ...this.collab.presence, [msg.presence.connId]: msg.presence } });
        return;
      case 'presence.leave': {
        const { [msg.connId]: _gone, ...rest } = this.collab.presence;
        this.collab.set({ presence: rest });
        return;
      }
      case 'role': {
        const me = this.collab.me;
        if (me) this.collab.set({ me: { ...me, role: msg.role } });
        this.collab.toast(`Your role is now ${msg.role}.`, 'info');
        this.updateHistory();
        return;
      }
      case 'meta':
        this.store().setState({ meta: { ...this.store().getState().meta, name: msg.name } });
        this.collab.set({ plans: this.collab.plans.map((p) => (p.id === this.planId ? { ...p, name: msg.name } : p)) });
        return;
    }
  }

  private onThread(thread: Thread) {
    const before = this.collab.threads[thread.id];
    this.collab.set({ threads: { ...this.collab.threads, [thread.id]: thread } });
    const me = this.collab.me?.email;
    if (!me || !this.planId) return;
    // Open in front of you: it's read. Otherwise, if it mentions you, the Mentions badge updates now.
    if (this.collab.comments?.threadId === thread.id && document.visibilityState === 'visible') {
      void markThreadRead(this.planId, thread.id);
    } else if (threadMentions(thread).includes(me) || (before && threadMentions(before).includes(me))) {
      // The plan tells the workspace's index right after broadcasting; give it a moment.
      setTimeout(() => void refreshMentionCounts(), 1500);
    }
  }

  /** Resolves a waiting request; returns whether anyone was waiting. */
  private settle(cid: string, ok: boolean, msg?: string): boolean {
    const w = this.waiters.get(cid);
    this.waiters.delete(cid);
    w?.(ok, msg);
    return !!w;
  }

  /** Remembers which cells someone else just changed, to mark them for a while. */
  private markRecent(before: PlanData, puts: Put[], email: string, ts: number) {
    const prev = new Map(before.assignments.map((a) => [a.id, a]));
    const recent = { ...this.collab.recent };
    let changed = false;
    for (const p of puts) {
      if (p.k !== 'role' || !p.v) continue;
      const now = (p.v as Assignment).weekly;
      const old = prev.get(p.id)?.weekly ?? {};
      for (const w of new Set([...Object.keys(now), ...Object.keys(old)])) {
        if ((now[w] ?? 0) !== (old[w] ?? 0)) {
          recent[`${p.id}|${w}`] = { email, ts: Math.min(ts, Date.now()) };
          changed = true;
        }
      }
    }
    if (changed) this.collab.set({ recent });
  }

  /**
   * Redraws from the confirmed plan with pending edits (and any not yet
   * queued) replayed on it, at most once per frame. Always rebuilt: the
   * screen can be behind the confirmed plan (a hidden tab's frames wait).
   */
  private publish() {
    if (this.frame !== undefined) return;
    const run = () => {
      this.frame = undefined;
      this.store().setState({ plan: this.core.view(this.batch) });
    };
    if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
      this.frame = requestAnimationFrame(run);
    } else run();
  }
}

let store: UseBoundStore<StoreApi<SharedPlanState>> | undefined;
let session: Session | undefined;

export function getSharedPlanStore(): UseBoundStore<StoreApi<SharedPlanState>> {
  if (store) return store;
  const s = create<SharedPlanState>()((_set, get) => ({
    plan: createEmptyPlan(),
    meta: { id: '', name: '', revision: 0 },
    library: [],
    ...makePlanActions(
      () => get().plan,
      (op) => getSession().dispatch(op),
    ),
    newPlan: notAvailable('Creating plans'),
    switchPlan: notAvailable('Switching plans'),
    renamePlan: notAvailable('Renaming plans'),
    deletePlan: notAvailable('Deleting plans'),
    bumpRevision: () => get().meta,
    importPlanFile: notAvailable('Importing'),
    undo: () => getSession().undo(),
    redo: () => getSession().redo(),
    canUndo: false,
    canRedo: false,
  }));
  store = s;
  return s;
}

export function getSession(): Session {
  session ??= new Session(() => getSharedPlanStore());
  return session;
}

export function useSharedHistory() {
  const s = getSharedPlanStore();
  return { canUndo: useStore(s, (x) => x.canUndo), canRedo: useStore(s, (x) => x.canRedo) };
}

import { hasExplicitMode, noBackendThisSession } from './mode';

// ── workspace actions used by the shared-mode UI ──

/** Checks who you are and loads the plan list, then opens the last plan used (or the first). */
export async function bootShared() {
  const collab = useCollabStore.getState();
  try {
    const { me, prefs, timeZone } = await api<{ me: SharedMe; prefs?: { mail: boolean; mentionEmails: boolean }; timeZone?: string }>('/api/me');
    const { plans } = await api<{ plans: ServerPlan[] }>('/api/plans');
    collab.set({ me, plans, ...(prefs ? { prefs } : {}), ...(timeZone ? { timeZone, thisWeek: weekInZone(timeZone) } : {}) });
    watchMentions();
    const link = takeCommentLink();
    const last = link?.planId ?? readPrefs().lastPlanId;
    const plan = plans.find((p) => p.id === last) ?? plans[0];
    if (link && plan?.id === link.planId) {
      const ui = useUIStore.getState();
      if (ui.view !== 'projects' && ui.view !== 'resources') ui.setView('projects');
      collab.set({ comments: { threadId: link.threadId, jump: true } });
    }
    else if (link) collab.toast('That comment’s plan isn’t in the shared workspace (it may have been archived).');
    if (plan) getSession().open(plan.id, plan.name);
    else collab.set({ status: 'no-plan' });
  } catch (err) {
    const e = err instanceof ApiError ? err : new ApiError(0, String(err));
    if (e.noBackend && !hasExplicitMode()) { noBackendThisSession(); return; }
    collab.set({
      status: e.signIn || e.status === 401 ? 'signed-out' : e.status === 403 ? 'forbidden' : 'unreachable',
      statusMsg: e.message,
    });
  }
}
type SharedMe = NonNullable<ReturnType<typeof useCollabStore.getState>['me']>;

export async function refreshPlans() {
  const { plans } = await api<{ plans: ServerPlan[] }>('/api/plans');
  useCollabStore.getState().set({ plans });
  return plans;
}

export function openSharedPlan(id: string) {
  const plan = useCollabStore.getState().plans.find((p) => p.id === id);
  if (plan) getSession().open(plan.id, plan.name);
}

/** Creates a plan (optionally with content) and opens it. */
export async function createSharedPlan(name: string, plan?: PlanData, note?: string): Promise<ServerPlan> {
  const { plan: row } = await api<{ plan: ServerPlan }>('/api/plans', { method: 'POST', json: { name, plan, note } });
  await refreshPlans();
  return row;
}

export const sendPresence = (() => {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: Omit<Presence, 'connId' | 'email' | 'name' | 'color'> | undefined;
  return (p: Omit<Presence, 'connId' | 'email' | 'name' | 'color'>) => {
    queued = p;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const text = JSON.stringify(queued);
      if (text === last) return;
      last = text;
      getSession().send({ t: 'presence', ...queued });
    }, 250);
  };
})();

export const addLock = (lock: NewLock) => getSession().request({ t: 'lock.add', lock });
export const removeLock = (id: string) => getSession().request({ t: 'lock.remove', id });
export const revertBatch = (batchId: string) => getSession().request({ t: 'revert', batchId });

// ── comments ──

export const addComment = (c: { threadId: string; commentId: string; anchor?: CommentAnchor; body: string }) =>
  getSession().request({ t: 'comment.add', ...c });
export const editComment = (threadId: string, commentId: string, body: string) =>
  getSession().request({ t: 'comment.edit', threadId, commentId, body });
export const deleteComment = (threadId: string, commentId: string) => getSession().request({ t: 'comment.delete', threadId, commentId });
export const setThreadResolved = (threadId: string, resolved: boolean) =>
  getSession().request({ t: 'thread.resolve', threadId, resolved });

/** Opens the comments panel on a thread, a cell or row, or (no argument) the plan's list. */
export function showComments(focus: { anchor?: CommentAnchor; threadId?: string; jump?: boolean } = {}) {
  useCollabStore.getState().set({ comments: focus });
}

/** Opens a thread in any plan (from the Mentions inbox or an activity entry): switches plan if needed. */
export function openThread(planId: string, threadId: string) {
  const collab = useCollabStore.getState();
  const ui = useUIStore.getState();
  if (ui.view !== 'projects' && ui.view !== 'resources') ui.setView('projects');
  collab.set({ comments: { threadId, jump: true } });
  if (getSession().planId === planId) return;
  // A plan created since the list was loaded isn't in it yet.
  if (collab.plans.some((p) => p.id === planId)) openSharedPlan(planId);
  else {
    void refreshPlans().then(
      (plans) => {
        if (plans.some((p) => p.id === planId)) openSharedPlan(planId);
        else useCollabStore.getState().toast('That comment’s plan isn’t in the shared workspace (it may have been archived).');
      },
      (e: Error) => useCollabStore.getState().toast(e.message),
    );
  }
}

let peopleLoaded = 0;
/** Loads who can be @mentioned (at most once a minute). */
export async function loadPeople(): Promise<Person[]> {
  const collab = useCollabStore.getState();
  if (Date.now() - peopleLoaded < 60_000 && collab.people.length) return collab.people;
  peopleLoaded = Date.now();
  try {
    const { people } = await api<{ people: Person[] }>('/api/people');
    useCollabStore.getState().set({ people });
    return people;
  } catch {
    peopleLoaded = 0;
    return collab.people;
  }
}

export async function refreshMentionCounts() {
  try {
    const { counts } = await api<{ counts: { open: number; unreadOpen: number } }>('/api/mentions/counts');
    useCollabStore.getState().set({ mentionCounts: counts });
  } catch {
    // Shown again on the next poll.
  }
}

const reads = new Map<string, number>();
/** Marks a thread read (debounced per thread), then refreshes the badge. */
export async function markThreadRead(planId: string, threadId: string) {
  const key = `${planId}/${threadId}`;
  if (Date.now() - (reads.get(key) ?? 0) < 2000) return;
  reads.set(key, Date.now());
  try {
    await api('/api/mentions/read', { method: 'POST', json: { planId, threadId } });
    await refreshMentionCounts();
  } catch {
    reads.delete(key);
  }
}

/** Admins: the workspace's time zone, which decides "this week" for everyone. */
export async function setWorkspaceTimeZone(timeZone: string) {
  const r = await api<{ timeZone: string }>('/api/settings', { method: 'PUT', json: { timeZone } });
  useCollabStore.getState().set({ timeZone: r.timeZone, thisWeek: weekInZone(r.timeZone) });
}

export async function setMentionEmails(on: boolean) {
  const { prefs } = await api<{ prefs: { mail: boolean; mentionEmails: boolean } }>('/api/me/prefs', {
    method: 'PUT',
    json: { mentionEmails: on },
  });
  useCollabStore.getState().set({ prefs });
}

let watching = false;
/** Keeps the Mentions badge current: now, every minute, when the tab comes back, and on comment links. */
function watchMentions() {
  void refreshMentionCounts();
  if (watching) return;
  watching = true;
  setInterval(() => document.visibilityState === 'visible' && void refreshMentionCounts(), 60_000);
  window.addEventListener('focus', () => void refreshMentionCounts());
  window.addEventListener('hashchange', () => {
    const link = takeCommentLink();
    if (!link) return;
    openThread(link.planId, link.threadId);
  });
}

/** `#comment=<planId>/<threadId>`, as in mention emails. */
export function commentLink(): { planId: string; threadId: string } | null {
  const m = location.hash.match(/^#comment=([\w-]{1,64})\/([\w-]{1,64})$/);
  return m ? { planId: m[1], threadId: m[2] } : null;
}

/** Reads a comment link from the address bar and clears it (so a reload doesn't reopen it). */
function takeCommentLink() {
  const link = commentLink();
  if (link) history.replaceState(null, '', location.pathname + location.search);
  return link;
}

/** The grid row a thread is on, and the rows above it to expand. */
export function threadRow(thread: Thread, plan: PlanData): { view: 'projects' | 'resources'; row: string; week?: string; parents: string[] } | null {
  const a = thread.anchor;
  const roleId = anchorRoleId(a);
  const groupKeys = (projectId: string) => workstreamGroupKeys(plan.projects.find((p) => p.id === projectId));
  if (roleId) {
    const role = plan.assignments.find((r) => r.id === roleId);
    if (!role) return null;
    return { view: 'projects', row: `a:${roleId}`, ...(a.kind === 'cells' ? { week: a.from } : {}), parents: [`p:${role.projectId}`, ...groupKeys(role.projectId)] };
  }
  if (a.kind === 'project') return plan.projects.some((p) => p.id === a.projectId) ? { view: 'projects', row: `p:${a.projectId}`, parents: groupKeys(a.projectId) } : null;
  if (a.kind === 'resource') {
    const r = plan.resources.find((x) => x.id === a.resourceId);
    return r ? { view: 'resources', row: `r:${r.id}`, parents: [`g:${r.level ?? 'none'}`] } : null;
  }
  return null;
}

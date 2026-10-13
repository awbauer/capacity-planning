import { create, useStore, type StoreApi, type UseBoundStore } from 'zustand';
import { ApiError, api } from '../api/client';
import { applyPuts, deepEqual, type Put } from '../domain/diff';
import type { NewLock } from '../domain/locks';
import { applyOp, type Op } from '../domain/ops';
import { canFor } from '../domain/permissions';
import { CLOSE, PROTOCOL_VERSION, type ClientMsg, type Presence, type ServerMsg } from '../domain/protocol';
import { createEmptyPlan } from '../domain/sampleData';
import type { Assignment, PlanData } from '../domain/types';
import { makePlanActions } from './actions';
import { OFFLINE_GRACE_MS, useCollabStore, type ServerPlan } from './collabStore';
import type { PlanState } from './localPlanStore';

export interface SharedPlanState extends PlanState {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface Pending {
  cid: string;
  op: Op;
}

/** Remembered in this browser between visits. */
const PREFS_KEY = 'capacity-collab:v1';
const pendingKey = (planId: string) => `capacity-pending:${planId}`;
const MAX_UNDO = 100;
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

/**
 * The shared workspace session: the open plan as the server has it
 * (`confirmed`), plus this browser's edits not yet confirmed (`pending`),
 * re-applied on top so they show at once. Every server message updates
 * `confirmed`; pending edits are then replayed on it, so everyone ends up
 * with the server's order.
 */
class Session {
  confirmed: PlanData = createEmptyPlan();
  pending: Pending[] = [];
  /** Ops dispatched this tick, sent together as one change (one undo step). */
  private batch: Op[] = [];
  epoch?: number;
  seq?: number;
  planId?: string;
  private ws?: WebSocket;
  private retry = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private frame?: number;
  private nextCid = 0;
  /** Own batches that can be undone/redone, and which cids were undo/redo requests. */
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private cidKind = new Map<string, 'undo' | 'redo'>();
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

  // ── edits ──

  canEdit(): boolean {
    const c = this.collab;
    if (!c.me || !canFor(c.me.role).edit) return false;
    if (c.status === 'live' || c.status === 'connecting') return true;
    return c.status === 'offline' && !!c.offlineSince && Date.now() - c.offlineSince < OFFLINE_GRACE_MS;
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
    const op: Op = ops.length === 1 ? ops[0] : { t: 'group', ops };
    const p = { cid: this.cid(), op };
    this.pending.push(p);
    this.stash();
    this.redoStack = [];
    this.updateHistory();
    this.send({ t: 'op', cid: p.cid, op });
  }

  /** Sends a request whose outcome the caller wants (locks, reverts). */
  request(msg: { t: 'revert'; batchId: string } | { t: 'lock.add'; lock: NewLock } | { t: 'lock.remove'; id: string }): Promise<void> {
    const cid = this.cid();
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('You’re offline.'));
        return;
      }
      this.waiters.set(cid, (ok, m) => (ok ? resolve() : reject(new Error(m))));
      this.send({ ...msg, cid } as ClientMsg);
    });
  }

  undo() {
    const batchId = this.undoStack.pop();
    if (!batchId) return;
    this.updateHistory();
    const cid = this.cid();
    this.cidKind.set(cid, 'undo');
    this.send({ t: 'revert', cid, batchId });
  }

  redo() {
    const batchId = this.redoStack.pop();
    if (!batchId) return;
    this.updateHistory();
    const cid = this.cid();
    this.cidKind.set(cid, 'redo');
    this.send({ t: 'revert', cid, batchId });
  }

  private updateHistory() {
    const can = this.canEdit();
    this.store().setState({ canUndo: can && this.undoStack.length > 0, canRedo: can && this.redoStack.length > 0 });
  }

  // ── connection ──

  open(planId: string, name: string) {
    this.close();
    this.planId = planId;
    this.confirmed = createEmptyPlan();
    this.epoch = undefined;
    this.seq = undefined;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = this.unstash(planId);
    this.store().setState({ plan: this.confirmed, meta: { id: planId, name, revision: 0 } });
    this.updateHistory();
    writePrefs({ lastPlanId: planId });
    this.collab.set({ status: 'connecting', loaded: false, locks: [], presence: {}, recent: {} });
    this.connect();
  }

  close() {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onclose = null;
      ws.close(1000);
    }
  }

  private connect() {
    const planId = this.planId;
    if (!planId) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/plans/${encodeURIComponent(planId)}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', proto: PROTOCOL_VERSION, ...(this.epoch ? { epoch: this.epoch } : {}), ...(this.seq !== undefined ? { lastSeq: this.seq } : {}) });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
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
      this.onClose(e.code, e.reason);
    };
  }

  private onClose(code: number, reason: string) {
    if (code === CLOSE.sessionExpired) return this.collab.set({ status: 'signed-out', statusMsg: 'Your sign-in expired.' });
    if (code === CLOSE.forbidden) return this.collab.set({ status: 'forbidden', statusMsg: reason || 'Your access was removed.' });
    if (code === CLOSE.protocol) return this.collab.set({ status: 'reload', statusMsg: 'The app was updated.' });
    if (code === CLOSE.archived) {
      this.collab.set({ status: 'archived', statusMsg: 'This plan was archived.' });
      void refreshPlans().catch(() => undefined);
      return;
    }
    const c = this.collab;
    this.collab.set({ status: 'offline', offlineSince: c.offlineSince ?? Date.now() });
    this.updateHistory();
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => void this.reconnect(), delay);
  }

  /** Before reconnecting, checks the sign-in is still good (Access may want a fresh login). */
  private async reconnect() {
    try {
      await api('/api/me');
    } catch (err) {
      if (err instanceof ApiError && err.signIn) return this.collab.set({ status: 'signed-out', statusMsg: 'Your sign-in expired.' });
      if (err instanceof ApiError && err.status === 403) return this.collab.set({ status: 'forbidden', statusMsg: err.message });
    }
    this.connect();
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private stash() {
    if (!this.planId) return;
    try {
      if (this.pending.length) sessionStorage.setItem(pendingKey(this.planId), JSON.stringify(this.pending));
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
    switch (msg.t) {
      case 'welcome': {
        this.retry = 0;
        const first = this.seq === undefined;
        this.confirmed = msg.full ?? applyPuts(this.confirmed, msg.puts ?? []);
        this.epoch = msg.epoch;
        this.seq = msg.seq;
        this.collab.set({
          status: 'live',
          loaded: true,
          statusMsg: undefined,
          offlineSince: undefined,
          me: msg.you,
          locks: msg.locks,
          presence: Object.fromEntries(msg.presence.map((p) => [p.connId, p])),
          thisWeek: msg.thisWeek,
        });
        this.store().setState({ meta: { id: msg.plan.id, name: msg.plan.name, revision: msg.seq } });
        // Edits made while away go (again) now; the server ignores ones it already has.
        for (const p of this.pending) this.send({ t: 'op', cid: p.cid, op: p.op });
        this.publish(true);
        this.updateHistory();
        if (first) this.collab.set({ recent: {} });
        return;
      }
      case 'applied': {
        const before = this.confirmed;
        this.confirmed = msg.full ?? applyPuts(this.confirmed, msg.puts);
        this.seq = msg.seq;
        this.store().setState({ meta: { ...this.store().getState().meta, revision: msg.seq } });
        if (msg.cid) {
          this.pending = this.pending.filter((p) => p.cid !== msg.cid);
          this.stash();
          const kind = this.cidKind.get(msg.cid);
          this.cidKind.delete(msg.cid);
          // Undoing makes a batch you can redo; anything else you did (redo included) can be undone.
          if (kind === 'undo') this.redoStack.push(msg.batch.batchId);
          else if (!msg.batch.op.startsWith('lock.')) this.undoStack = [...this.undoStack, msg.batch.batchId].slice(-MAX_UNDO);
          this.waiters.get(msg.cid)?.(true);
          this.waiters.delete(msg.cid);
          if (msg.skipped) {
            this.collab.toast(`${msg.skipped} change${msg.skipped === 1 ? '' : 's'} made since by someone else ${msg.skipped === 1 ? 'was' : 'were'} kept.`, 'info');
          }
        } else {
          this.markRecent(before, msg.puts, msg.batch.actor, msg.batch.ts);
        }
        this.updateHistory();
        this.publish(!msg.cid || this.pending.length > 0, msg.puts);
        return;
      }
      case 'ack':
        this.pending = this.pending.filter((p) => p.cid !== msg.cid);
        this.stash();
        this.waiters.get(msg.cid)?.(true);
        this.waiters.delete(msg.cid);
        this.publish(this.pending.length > 0);
        return;
      case 'rejected': {
        const was = this.pending.some((p) => p.cid === msg.cid);
        this.pending = this.pending.filter((p) => p.cid !== msg.cid);
        this.stash();
        this.cidKind.delete(msg.cid);
        const w = this.waiters.get(msg.cid);
        this.waiters.delete(msg.cid);
        if (w) w(false, msg.msg);
        else this.collab.toast(msg.msg);
        if (was) this.publish(true);
        this.updateHistory();
        return;
      }
      case 'locks':
        this.collab.set({ locks: msg.locks });
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

  /** Remembers which cells someone else just changed, to mark them for a while. */
  private markRecent(before: PlanData, puts: Put[], email: string, ts: number) {
    const prev = new Map(before.assignments.map((a) => [a.id, a]));
    const recent = { ...this.collab.recent };
    const cutoff = Date.now() - RECENT_MS;
    for (const [k, v] of Object.entries(recent)) if (v.ts < cutoff) delete recent[k];
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
   * Shows the confirmed plan with pending edits replayed on it. When nothing
   * is pending and the server agrees with what's on screen, the screen's plan
   * object is kept, so nothing re-renders for your own confirmed edit.
   */
  private publish(force: boolean, puts?: Put[]) {
    const s = this.store();
    const shown = s.getState().plan;
    if (!force && this.pending.length === 0 && puts && this.agrees(shown, puts)) {
      this.confirmed = shown;
      return;
    }
    if (this.frame !== undefined) return;
    const run = () => {
      this.frame = undefined;
      const next = this.pending.reduce((p, x) => applyOp(p, x.op), this.confirmed);
      s.setState({ plan: next });
    };
    if (typeof requestAnimationFrame === 'function') this.frame = requestAnimationFrame(run);
    else run();
  }

  private agrees(shown: PlanData, puts: Put[]): boolean {
    const merged = applyPuts(shown, puts);
    return merged === shown || deepEqual(merged, shown);
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

// ── workspace actions used by the shared-mode UI ──

/** Checks who you are and loads the plan list, then opens the last plan used (or the first). */
export async function bootShared() {
  const collab = useCollabStore.getState();
  try {
    const { me } = await api<{ me: SharedMe }>('/api/me');
    const { plans } = await api<{ plans: ServerPlan[] }>('/api/plans');
    collab.set({ me, plans });
    const last = readPrefs().lastPlanId;
    const plan = plans.find((p) => p.id === last) ?? plans[0];
    if (plan) getSession().open(plan.id, plan.name);
    else collab.set({ status: 'no-plan' });
  } catch (err) {
    const e = err instanceof ApiError ? err : new ApiError(0, String(err));
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

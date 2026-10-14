import { applyPuts, type Put } from '../domain/diff';
import { applyOp, type Op } from '../domain/ops';
import type { ClientMsg, ServerMsg } from '../domain/protocol';
import { isSideChange, PROTOCOL_VERSION } from '../domain/protocol';
import { createEmptyPlan } from '../domain/sampleData';
import type { PlanData } from '../domain/types';

export interface Pending {
  cid: string;
  op: Op;
}

const MAX_UNDO = 100;

/** What a server message meant, for the shell to act on (UI, toasts, waiters). */
export type Received =
  | { kind: 'welcome'; first: boolean; resend: ClientMsg[] }
  | { kind: 'own'; cid: string; batchId: string; skipped?: number }
  | { kind: 'theirs'; before: PlanData; puts: Put[]; actor: string; ts: number }
  | { kind: 'ack'; cid: string }
  | { kind: 'rejected'; cid: string; msg: string; wasPending: boolean }
  | { kind: 'other' };

/**
 * The browser side of syncing a plan, with no socket, timers or UI: the plan
 * as the server has it (`confirmed`), this browser's edits not yet confirmed
 * (`pending`), and the undo/redo stacks of its own batches. What's shown is
 * always `confirmed` with the pending edits replayed on top, so every
 * browser converges on the server's order.
 */
export class SyncCore {
  confirmed: PlanData = createEmptyPlan();
  pending: Pending[] = [];
  epoch?: number;
  seq?: number;
  undoStack: string[] = [];
  redoStack: string[] = [];
  private cidKind = new Map<string, 'undo' | 'redo'>();
  private readonly newCid: () => string;

  constructor(newCid: () => string, pending: Pending[] = []) {
    this.newCid = newCid;
    this.pending = pending;
  }

  /** What to show: the confirmed plan with pending edits (and any not yet queued) replayed on it. */
  view(extra: Op[] = []): PlanData {
    const withPending = this.pending.reduce((p, x) => applyOp(p, x.op), this.confirmed);
    return extra.reduce(applyOp, withPending);
  }

  /** Queues a local edit; returns the message to send. A new edit ends the redo chain. */
  edit(op: Op): ClientMsg & { t: 'op' } {
    const p = { cid: this.newCid(), op };
    this.pending.push(p);
    this.redoStack = [];
    return { t: 'op', cid: p.cid, op };
  }

  hello(): ClientMsg {
    return {
      t: 'hello',
      proto: PROTOCOL_VERSION,
      ...(this.epoch !== undefined ? { epoch: this.epoch } : {}),
      ...(this.seq !== undefined ? { lastSeq: this.seq } : {}),
    };
  }

  /**
   * The revert message for undo/redo, or null if there's nothing to do. The
   * batch only leaves its stack when `canSend` is true, so nothing is lost
   * while disconnected.
   */
  takeRevert(which: 'undo' | 'redo', canSend: boolean): ClientMsg | null {
    const stack = which === 'undo' ? this.undoStack : this.redoStack;
    if (!stack.length || !canSend) return null;
    const batchId = stack.pop()!;
    const cid = this.newCid();
    this.cidKind.set(cid, which);
    return { t: 'revert', cid, batchId };
  }

  receive(msg: ServerMsg): Received {
    switch (msg.t) {
      case 'welcome': {
        const first = this.seq === undefined;
        this.confirmed = msg.full ?? applyPuts(this.confirmed, msg.puts ?? []);
        this.epoch = msg.epoch;
        this.seq = msg.seq;
        // Edits made while away go (again) now; the server ignores ones it already has.
        return { kind: 'welcome', first, resend: this.pending.map((p) => ({ t: 'op', cid: p.cid, op: p.op })) };
      }
      case 'applied': {
        const before = this.confirmed;
        this.confirmed = msg.full ?? applyPuts(this.confirmed, msg.puts);
        this.seq = msg.seq;
        if (!msg.cid) return { kind: 'theirs', before, puts: msg.puts, actor: msg.batch.actor, ts: msg.batch.ts };
        this.pending = this.pending.filter((p) => p.cid !== msg.cid);
        const kind = this.cidKind.get(msg.cid);
        this.cidKind.delete(msg.cid);
        // Undoing makes a batch you can redo; anything else you did (redo included) can be undone.
        if (kind === 'undo') this.redoStack.push(msg.batch.batchId);
        else if (!isSideChange(msg.batch.op)) this.undoStack = [...this.undoStack, msg.batch.batchId].slice(-MAX_UNDO);
        return { kind: 'own', cid: msg.cid, batchId: msg.batch.batchId, ...(msg.skipped ? { skipped: msg.skipped } : {}) };
      }
      case 'ack':
        this.pending = this.pending.filter((p) => p.cid !== msg.cid);
        this.cidKind.delete(msg.cid);
        return { kind: 'ack', cid: msg.cid };
      case 'rejected': {
        const wasPending = this.pending.some((p) => p.cid === msg.cid);
        this.pending = this.pending.filter((p) => p.cid !== msg.cid);
        this.cidKind.delete(msg.cid);
        return { kind: 'rejected', cid: msg.cid, msg: msg.msg, wasPending };
      }
      default:
        return { kind: 'other' };
    }
  }
}

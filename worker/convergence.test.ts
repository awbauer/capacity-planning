import { describe, expect, it } from 'vitest';
import { deepEqual } from '../src/domain/diff';
import type { Op } from '../src/domain/ops';
import type { ClientMsg, ServerMsg } from '../src/domain/protocol';
import { createSamplePlan } from '../src/domain/sampleData';
import type { PlanData } from '../src/domain/types';
import { addWeeks } from '../src/domain/weeks';
import { SyncCore } from '../src/sync/syncCore';
import { RoomEngine, type Result, type User } from './roomEngine';
import { nodeSql } from './test/nodeSql';

const NOW = '2026-10-05';

/** Small seeded PRNG (mulberry32), so failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
  };
}

interface Client {
  user: User;
  core: SyncCore;
  /** Messages on their way to the server (in order), and from it (in order). */
  outbox: ClientMsg[];
  inbox: ServerMsg[];
  connected: boolean;
  /** Welcomed: gets broadcasts (like PlanRoom's `ready`). */
  ready: boolean;
}

/**
 * A stand-in for PlanRoom: the same RoomEngine, and the same messages
 * (applied to everyone with the cid only to the sender, rejected/ack to the
 * sender), over per-client FIFO channels.
 */
function makeServer(seed: number) {
  const r = rng(seed);
  const room = new RoomEngine(nodeSql(), () => 1, (() => {
    let n = 0;
    return () => `b${++n}`;
  })());
  room.setPlanId('p');
  const admin: User = { email: 'admin@x', name: 'Admin', role: 'admin' };
  room.replacePlan(admin, createSamplePlan(NOW), 'seed');

  const clients: Client[] = ['a', 'b', 'c'].map((n) => {
    let i = 0;
    return {
      user: { email: `${n}@x`, name: n, role: 'editor' as const },
      core: new SyncCore(() => `${n}-${++i}`),
      outbox: [],
      inbox: [],
      connected: false,
      ready: false,
    };
  });

  const deliverResult = (from: Client, cid: string, res: Result) => {
    if (res.ok === 'dup' || res.ok === 'noop') return from.inbox.push({ t: 'ack', cid, dup: true, seq: res.seq });
    if (res.ok === false) return from.inbox.push({ t: 'rejected', cid, code: res.code, msg: res.msg });
    const base = {
      t: 'applied' as const,
      seq: res.seq,
      batch: res.batch,
      puts: res.full ? [] : res.puts,
      ...(res.full ? { full: res.full } : {}),
      ...(res.skipped !== undefined ? { skipped: res.skipped } : {}),
    };
    for (const c of clients) if (c.ready || c === from) c.inbox.push(c === from ? { ...base, cid } : base);
  };

  /** The server handles the next message from a client. */
  const serve = (c: Client) => {
    const msg = c.outbox.shift();
    if (!msg || !c.connected) return;
    if (msg.t === 'hello') {
      const up = room.catchUp(msg.epoch, msg.lastSeq);
      c.inbox.push({
        t: 'welcome',
        proto: 1,
        you: { ...c.user, owner: false, connId: c.user.email, color: '#000' },
        plan: { id: 'p', name: 'P', archived: false },
        epoch: room.epoch,
        seq: room.seq,
        ...up,
        locks: [],
        presence: [],
        thisWeek: NOW,
        timeZone: 'UTC',
      });
      c.ready = true;
    } else if (msg.t === 'op') deliverResult(c, msg.cid, room.apply(c.user, msg.cid, msg.op, NOW));
    else if (msg.t === 'revert') deliverResult(c, msg.cid, room.revert(c.user, msg.cid, msg.batchId, NOW));
  };

  const connect = (c: Client) => {
    c.connected = true;
    c.outbox = [c.core.hello()];
    c.inbox = [];
  };
  /** The connection drops: whatever was in flight either way is lost. */
  const drop = (c: Client) => {
    c.connected = false;
    c.ready = false;
    c.outbox = [];
    c.inbox = [];
  };
  /** The client handles its next message (welcome makes it resend pending edits). */
  const receive = (c: Client) => {
    const msg = c.inbox.shift();
    if (!msg) return;
    const res = c.core.receive(msg);
    if (res.kind === 'welcome') c.outbox.push(...res.resend);
  };

  /** A random edit based on what this client currently shows. */
  const randomOp = (view: PlanData): Op | null => {
    const roles = view.assignments;
    const projects = view.projects;
    const people = view.resources;
    const week = addWeeks(NOW, r.int(12) - 2);
    switch (r.int(8)) {
      case 0:
      case 1:
      case 2:
        if (!roles.length) return null;
        return { t: 'cells.set', edits: [{ roleId: r.pick(roles).id, weeks: [week, addWeeks(week, 1)], value: r.pick([0, 25, 50, 100]) }] };
      case 3:
        if (!projects.length) return null;
        return {
          t: 'role.add',
          role: {
            id: `r${r.int(1e9)}`,
            projectId: r.pick(projects).id,
            resourceId: people.length && r.next() < 0.5 ? r.pick(people).id : null,
            name: 'Role',
            tagIds: [],
            weekly: { [week]: 50 },
          },
        };
      case 4:
        return roles.length ? { t: 'role.delete', id: r.pick(roles).id } : null;
      case 5:
        return roles.length && people.length ? { t: 'role.assign', id: r.pick(roles).id, resourceId: r.next() < 0.3 ? null : r.pick(people).id } : null;
      case 6:
        return projects.length ? { t: 'project.update', id: r.pick(projects).id, p: { set: { name: `P${r.int(100)}` } }, shift: { from: week, weeks: r.int(3) - 1 } } : null;
      default:
        return r.next() < 0.3 && people.length ? { t: 'resource.delete', id: r.pick(people).id } : null;
    }
  };

  return { room, clients, connect, drop, serve, receive, randomOp, r };
}

describe('browsers converge on the server’s plan', () => {
  // SYNC_SEEDS=500 npx vitest run worker/convergence.test.ts for a longer run.
  const seeds = process.env.SYNC_SEEDS ? Array.from({ length: Number(process.env.SYNC_SEEDS) }, (_, i) => i + 1) : [1, 2, 3, 4, 5, 6, 7, 8];
  for (const seed of seeds) {
    it(`seed ${seed}: random edits, undo, delivery order and dropped connections`, () => {
      const s = makeServer(seed);
      const { clients, r } = s;
      for (const c of clients) s.connect(c);
      for (let step = 0; step < 400; step++) {
        const c = r.pick(clients);
        const roll = r.next();
        if (!c.connected) {
          if (roll < 0.3) s.connect(c);
          continue;
        }
        if (roll < 0.3) {
          const op = s.randomOp(c.core.view());
          if (op) c.outbox.push(c.core.edit(op));
        } else if (roll < 0.35) {
          const msg = c.core.takeRevert(r.next() < 0.7 ? 'undo' : 'redo', true);
          if (msg) c.outbox.push(msg);
        } else if (roll < 0.6) s.serve(c);
        else if (roll < 0.97) s.receive(c);
        else s.drop(c);
      }
      // Settle: everyone reconnects and every message is delivered.
      for (const c of clients) if (!c.connected) s.connect(c);
      for (let guard = 0; guard < 10_000 && clients.some((c) => c.outbox.length || c.inbox.length); guard++) {
        for (const c of clients) {
          s.serve(c);
          s.receive(c);
        }
      }
      const server = s.room.current();
      for (const c of clients) {
        expect(c.core.pending, `${c.user.email} has nothing left pending`).toEqual([]);
        expect(deepEqual(c.core.confirmed, server), `${c.user.email} confirmed = server`).toBe(true);
        expect(deepEqual(c.core.view(), server), `${c.user.email} shows the server's plan`).toBe(true);
      }
    });
  }

  it("keeps others' changes when your own confirmation arrives in the same batch (no shortcut over confirmed)", () => {
    const s = makeServer(42);
    const [a, b] = s.clients;
    s.connect(a);
    s.connect(b);
    s.serve(a);
    s.serve(b);
    s.receive(a);
    s.receive(b);
    // Bob changes a cell; Alice changes another; Alice receives both before drawing.
    b.outbox.push(b.core.edit({ t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: [NOW], value: 100 }] }));
    a.outbox.push(a.core.edit({ t: 'cells.set', edits: [{ roleId: 'sample-a2', weeks: [NOW], value: 25 }] }));
    s.serve(b);
    s.serve(a);
    s.receive(a);
    s.receive(a);
    const shown = a.core.view();
    expect(shown.assignments.find((x) => x.id === 'sample-a1')!.weekly[NOW]).toBe(100);
    expect(shown.assignments.find((x) => x.id === 'sample-a2')!.weekly[NOW]).toBe(25);
  });

  it('a reconnecting browser catches up and its resent edits apply once', () => {
    const s = makeServer(7);
    const [a, b] = s.clients;
    s.connect(a);
    s.connect(b);
    for (const c of [a, b]) {
      s.serve(c);
      s.receive(c);
    }
    a.outbox.push(a.core.edit({ t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: [NOW], value: 25 }] }));
    s.serve(a); // applied on the server…
    s.drop(a); // …but the confirmation is lost.
    b.outbox.push(b.core.edit({ t: 'cells.set', edits: [{ roleId: 'sample-a2', weeks: [NOW], value: 50 }] }));
    s.serve(b);
    s.connect(a);
    s.serve(a); // hello → catch-up
    s.receive(a); // welcome → resend
    s.serve(a); // the resent op is a duplicate
    s.receive(a);
    expect(a.core.pending).toEqual([]);
    expect(deepEqual(a.core.view(), s.room.current())).toBe(true);
    expect(s.room.seq).toBe(3);
  });

  it('undo while disconnected stays on the stack', () => {
    const core = new SyncCore(() => 'x');
    core.undoStack.push('b1');
    expect(core.takeRevert('undo', false)).toBeNull();
    expect(core.undoStack).toEqual(['b1']);
    expect(core.takeRevert('undo', true)).toMatchObject({ t: 'revert', batchId: 'b1' });
  });
});

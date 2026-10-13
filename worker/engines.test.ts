import { beforeEach, describe, expect, it } from 'vitest';
import { applyPuts, deepEqual } from '../src/domain/diff';
import type { Op } from '../src/domain/ops';
import { createSamplePlan } from '../src/domain/sampleData';
import { RoomEngine, type User } from './roomEngine';
import { nodeSql } from './test/nodeSql';
import { WorkspaceEngine } from './workspaceEngine';

const NOW = '2026-10-05';
const alice: User = { email: 'alice@x.com', name: 'Alice', role: 'admin' };
const bob: User = { email: 'bob@x.com', name: 'Bob', role: 'editor' };
const carol: User = { email: 'carol@x.com', name: 'Carol', role: 'viewer' };
const set = (roleId: string, weeks: string[], value: number): Op => ({ t: 'cells.set', edits: [{ roleId, weeks, value }] });

describe('RoomEngine', () => {
  let sql: ReturnType<typeof nodeSql>;
  let room: RoomEngine;
  let clock = 1_000;
  let ids = 0;

  beforeEach(() => {
    sql = nodeSql();
    clock = 1_000;
    ids = 0;
    room = new RoomEngine(sql, () => ++clock, () => `id${++ids}`);
    room.setPlanId('plan1');
    room.replacePlan(alice, createSamplePlan(NOW), 'Uploaded');
  });

  const reload = () => new RoomEngine(sql, () => ++clock, () => `id${++ids}`);

  it('records each edit as a batch, and reloads the same plan from storage', () => {
    const r = room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW);
    expect(r).toMatchObject({ ok: true, seq: 2, batch: { actor: 'bob@x.com', changeCount: 1 } });
    expect(deepEqual(reload().current(), room.current())).toBe(true);
    expect(reload().seq).toBe(2);
  });

  it('treats a resent op as a duplicate, not a second change', () => {
    room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW);
    expect(room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW)).toEqual({ ok: 'dup', seq: 2 });
    expect(room.seq).toBe(2);
  });

  it('rejects viewers, non-admin settings, invalid ops and unknown targets', () => {
    expect(room.apply(carol, 'c', set('sample-a1', [NOW], 100), NOW)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(room.apply(bob, 'c', { t: 'settings.update', set: { criticalThreshold: 150 } }, NOW)).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(room.apply(bob, 'c', { t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: [NOW], value: 33 }] }, NOW)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(room.apply(bob, 'c', set('nope', [NOW], 25), NOW)).toMatchObject({ ok: false, code: 'not_found' });
    expect(
      room.apply(bob, 'c', { t: 'role.assign', id: 'sample-a1', resourceId: 'res-ghost' }, NOW),
    ).toMatchObject({ ok: false, code: 'not_found' });
    expect(room.seq).toBe(1);
  });

  it('catches up a browser with what changed, or the whole plan', () => {
    const seen = room.current();
    room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW);
    room.apply(bob, 'c2', { t: 'resource.delete', id: 'res-sam' }, NOW);
    const up = room.catchUp(room.epoch, 1);
    expect(up.full).toBeUndefined();
    expect(deepEqual(applyPuts(seen, up.puts!), room.current())).toBe(true);
    expect(room.catchUp(room.epoch, 3)).toEqual({ puts: [] });
    expect(room.catchUp(room.epoch + 1, 3).full).toBeDefined();
    expect(room.catchUp(room.epoch, undefined).full).toBeDefined();
  });

  it("undoes a batch, keeping someone else's later edits", () => {
    const mine = room.apply(bob, 'c1', set('sample-a1', [NOW, '2026-10-12'], 100), NOW);
    room.apply(alice, 'c2', set('sample-a1', ['2026-10-12'], 25), NOW);
    if (mine.ok !== true) throw new Error('expected ok');
    const r = room.revert(bob, 'c3', mine.batch.batchId, NOW);
    expect(r).toMatchObject({ ok: true, skipped: 1, batch: { revertOf: mine.batch.batchId } });
    const weekly = room.current().assignments.find((a) => a.id === 'sample-a1')!.weekly;
    expect(weekly[NOW]).toBe(50);
    expect(weekly['2026-10-12']).toBe(25);
  });

  it('enforces locks for everyone but the owner, and lets admins remove them', () => {
    const l = room.addLock(alice, 'l1', { scope: 'project', id: 'lock1', projectId: 'proj-acme', note: 'SOW signed' });
    expect(l).toMatchObject({ ok: true, batch: { op: 'lock.add', summary: expect.stringContaining('SOW signed') } });
    const r = room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW);
    expect(r).toMatchObject({ ok: false, code: 'locked', lockIds: ['lock1'] });
    expect(r.ok === false && r.msg).toContain('alice@x.com');
    expect(room.apply(alice, 'c2', set('sample-a1', [NOW], 100), NOW)).toMatchObject({ ok: true });
    expect(room.removeLock(bob, 'c3', 'lock1')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(room.removeLock(alice, 'c4', 'lock1')).toMatchObject({ ok: true });
    expect(room.apply(bob, 'c5', set('sample-a1', [NOW], 25), NOW)).toMatchObject({ ok: true });
    expect(reload().locks()).toEqual([]);
  });

  it('locks past weeks for all but admins', () => {
    expect(room.addLock(bob, 'l0', { scope: 'past', id: 'p' })).toMatchObject({ ok: false, code: 'forbidden' });
    room.addLock(alice, 'l1', { scope: 'past', id: 'p' });
    expect(room.apply(bob, 'c1', set('sample-a1', ['2026-09-28'], 100), NOW)).toMatchObject({ ok: false, code: 'locked' });
    expect(room.apply(bob, 'c2', set('sample-a1', [NOW], 100), NOW)).toMatchObject({ ok: true });
    expect(room.apply(alice, 'c3', set('sample-a1', ['2026-09-28'], 100), NOW)).toMatchObject({ ok: true });
  });

  it('keeps cell history, newest first', () => {
    room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW);
    room.apply(alice, 'c2', set('sample-a1', [NOW], 25), NOW);
    const h = room.history({ roleId: 'sample-a1', weeks: [NOW] }).filter((e) => e.week === NOW);
    expect(h.map((e) => [e.actor, e.before, e.after])).toEqual([
      ['alice@x.com', 100, 25],
      ['bob@x.com', 50, 100],
    ]);
    const project = room.history({ kind: 'project', id: 'proj-acme' });
    expect(project.length).toBeGreaterThan(0);
  });

  it('lists batches for the activity index', () => {
    room.apply(bob, 'c1', set('sample-a1', [NOW], 100), NOW);
    const rows = room.activitySince(0);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[1]).toMatchObject({ planId: 'plan1', actor: 'bob@x.com', projectIds: ['proj-acme'] });
    expect(rows[1].resourceIds).toContain('res-alex');
  });
});

describe('WorkspaceEngine', () => {
  let ws: WorkspaceEngine;
  let clock = 0;
  let ids = 0;
  beforeEach(() => {
    clock = 0;
    ids = 0;
    ws = new WorkspaceEngine(nodeSql(), new Set(['alice@x.com']), () => (clock += 1000), () => `w${++ids}`);
  });

  it('creates people with the default role; owners are always admins', () => {
    expect(ws.touchUser('alice@x.com', 'Alice')).toMatchObject({ role: 'admin', owner: true });
    expect(ws.touchUser('bob@x.com', 'Bob')).toMatchObject({ role: 'viewer', owner: false, disabled: false });
    ws.setDefaultRole('alice@x.com', 'none');
    expect(ws.touchUser('dan@x.com', 'Dan')).toMatchObject({ disabled: true });
    expect(() => ws.updateUser('bob@x.com', 'alice@x.com', { role: 'viewer' })).toThrow(/owner/);
    expect(ws.updateUser('alice@x.com', 'bob@x.com', { role: 'editor' }).role).toBe('editor');
  });

  it('keeps plan names unique, and archives instead of deleting', () => {
    const a = ws.createPlan('bob@x.com', 'Q4');
    expect(() => ws.createPlan('bob@x.com', ' q4 ')).toThrow(/already exists/);
    ws.setArchived('alice@x.com', a.id, true);
    expect(ws.plans()).toEqual([]);
    expect(ws.plans(true)).toHaveLength(1);
    ws.createPlan('bob@x.com', 'Q4');
    expect(() => ws.setArchived('alice@x.com', a.id, false)).toThrow(/rename/);
  });

  it('indexes activity idempotently, filters it and pages through it', () => {
    const plan = ws.createPlan('bob@x.com', 'Q4');
    const row = (n: number, actor: string) => ({
      batchId: `b${n}`,
      seq: n,
      planId: plan.id,
      epoch: 1,
      actor,
      ts: 10_000 + n,
      op: 'cells.set',
      summary: `Set thing ${n}`,
      changeCount: 1,
      projectIds: n % 2 ? ['proj-a'] : [],
      resourceIds: [],
    });
    ws.recordActivity([row(1, 'bob@x.com'), row(2, 'alice@x.com'), row(3, 'bob@x.com')]);
    ws.recordActivity([row(3, 'bob@x.com')]);
    expect(ws.activity({}).entries.map((e) => e.batchId)).toEqual(['b3', 'b2', 'b1']);
    expect(ws.activity({ actor: 'bob@x.com' }).entries).toHaveLength(2);
    expect(ws.activity({ ref: 'proj-a' }).entries.map((e) => e.batchId)).toEqual(['b3', 'b1']);
    expect(ws.activity({ q: 'thing 2' }).entries.map((e) => e.batchId)).toEqual(['b2']);
    const page1 = ws.activity({ limit: 2 });
    expect(page1.entries.map((e) => e.batchId)).toEqual(['b3', 'b2']);
    expect(ws.activity({ limit: 2, cursor: page1.next }).entries.map((e) => e.batchId)).toEqual(['b1']);
    // Workspace events (plan created) only for admins' view.
    expect(ws.activity({ workspace: true }).entries.some((e) => e.op === 'plan')).toBe(true);
    expect(ws.activity({}).entries.some((e) => e.op === 'plan')).toBe(false);
    expect(ws.activity({}).entries[0].planName).toBe('Q4');
  });
});

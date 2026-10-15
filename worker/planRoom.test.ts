import { addWeeks } from '../src/domain/weeks';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
import { PlanRoom } from './planRoom';
import type { Env } from './env';
import { MAX_MESSAGE_BYTES } from '../src/domain/protocol';

afterEach(() => vi.unstubAllGlobals());

function harness(ready = false) {
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  const room = new PlanRoom({ setWebSocketAutoResponse: vi.fn() } as unknown as DurableObjectState, {} as Env);
  const ws = {
    deserializeAttachment: () => ({ email: 'editor@example.com', role: 'editor', exp: Date.now() + 60_000, ready }),
    close: vi.fn(),
    send: vi.fn(),
  } as unknown as WebSocket;
  return { room, ws };
}

describe('WebSocket input boundary', () => {
  it('ignores JSON primitives and arrays without throwing', async () => {
    const { room, ws } = harness();
    for (const value of [null, false, 42, 'hello', [], { t: null }]) {
      await expect(room.webSocketMessage(ws, JSON.stringify(value))).resolves.toBeUndefined();
    }
  });

  it('rejects missing or malformed mutation ids before touching storage', async () => {
    const { room, ws } = harness(true);
    for (const cid of [null, {}, [], '', 'x'.repeat(201)]) {
      await room.webSocketMessage(ws, JSON.stringify({ t: 'op', cid, op: { t: 'resource.delete', id: 'r1' } }));
    }
    expect(ws.close).toHaveBeenCalledTimes(5);
  });

  it('rejects malformed sync cursors before querying storage', async () => {
    const { room, ws } = harness();
    for (const lastSeq of ['1', {}, -1, 1.5]) {
      await room.webSocketMessage(ws, JSON.stringify({ t: 'hello', proto: 2, lastSeq }));
    }
    expect(ws.close).toHaveBeenCalledTimes(4);
  });

  it('measures message size as UTF-8 bytes, not JavaScript characters', async () => {
    const { room, ws } = harness(true);
    const message = JSON.stringify({ t: 'presence', view: '😀'.repeat(MAX_MESSAGE_BYTES / 4) });
    expect(message.length).toBeLessThan(MAX_MESSAGE_BYTES);
    await room.webSocketMessage(ws, message);
    expect(ws.close).toHaveBeenCalledWith(1009, 'Message too large');
  });

  it('does not accept edits before the protocol handshake', async () => {
    const { room, ws } = harness();
    await room.webSocketMessage(ws, JSON.stringify({ t: 'op', cid: 'c1', op: { t: 'resource.delete', id: 'r1' } }));
    expect(ws.close).toHaveBeenCalled();
  });
});

import { RoomEngine } from './roomEngine';
import { nodeSql } from './test/nodeSql';
import { createSamplePlan } from '../src/domain/sampleData';
import { schemas } from './mcp/inputs';

describe('agent room RPCs', () => {
  function agentRoom(archived = false) {
    vi.stubGlobal('WebSocketRequestResponsePair', class {});
    const engine = new RoomEngine(nodeSql());
    const user = { email: 'editor@example.com', name: 'Editor', role: 'editor' as const };
    engine.replacePlan({ ...user, role: 'admin' }, createSamplePlan('2026-10-12'), 'seed');
    const socket = { deserializeAttachment: () => ({ ...user, exp: Date.now() + 60_000, ready: true }), send: vi.fn() };
    const waitUntil = vi.fn();
    const room = new PlanRoom(
      {
        setWebSocketAutoResponse: vi.fn(),
        getWebSockets: () => [socket],
        waitUntil,
        storage: { get: async () => ({ name: 'Plan', archived }) },
      } as unknown as DurableObjectState,
      {} as Env,
    );
    Object.defineProperty(room, 'engine', { value: engine });
    const flush = vi.spyOn(room as unknown as { flush(): Promise<void> }, 'flush').mockResolvedValue();
    return { room, engine, user, socket, waitUntil, flush };
  }
  it('broadcasts cid-less changes, flushes indexes and supports dry-run/retry/undo', async () => {
    const { room, engine, user, socket, waitUntil, flush } = agentRoom();
    const seat = engine.current().assignments[0],
      week = room.snapshot().thisWeek;
    const args = schemas.set_allocation.parse({
      workstream: seat.projectId,
      role: seat.id,
      from: week,
      to: week,
      percent: 100,
      idempotencyKey: 'agent1',
    });
    const seq = engine.seq;
    const preview = await room.command(user, { tool: 'set_allocation', args: { ...args, dryRun: true } });
    expect(preview).toMatchObject({ ok: true, dryRun: true });
    expect(engine.seq).toBe(seq);
    expect(socket.send).not.toHaveBeenCalled();
    const result = await room.command(user, { tool: 'set_allocation', args });
    expect(result).toMatchObject({ ok: true, summary: expect.stringContaining('(via agent)') });
    const message = JSON.parse(socket.send.mock.calls[0][0]);
    expect(message.t).toBe('applied');
    expect(message.cid).toBeUndefined();
    expect(waitUntil).toHaveBeenCalled();
    expect(flush).toHaveBeenCalled();
    const retry = await room.command(user, { tool: 'set_allocation', args });
    expect(retry).toMatchObject({
      ok: true,
      duplicate: true,
      changeId: 'changeId' in result ? result.changeId : undefined,
    });
    expect(engine.seq).toBe(seq + 1);
    if ('changeId' in result && result.changeId)
      expect(await room.revertAs(user, result.changeId)).toMatchObject({ ok: true });
    expect(engine.current().assignments.find((r) => r.id === seat.id)?.weekly[week]).toBe(seat.weekly[week]);
  });
  it('rejects archived writes and viewer direct calls', async () => {
    const h = agentRoom(true);
    expect(
      await h.room.command(h.user, {
        tool: 'create_workstream',
        args: schemas.create_workstream.parse({ name: 'No' }),
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Archived') });
    const v = agentRoom();
    expect(
      await v.room.command(
        { ...v.user, role: 'viewer' },
        { tool: 'create_workstream', args: schemas.create_workstream.parse({ name: 'No' }) },
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Viewers') });
  });
  it('allows own undo only, except for admins, and validates dry-run comments without persisting', async () => {
    const { room, user, engine } = agentRoom();
    const created = await room.command(user, {
      tool: 'create_workstream',
      args: schemas.create_workstream.parse({ name: 'Agent project' }),
    });
    if (!('changeId' in created) || !created.changeId) throw new Error('Expected a saved change');
    expect(await room.revertAs({ ...user, email: 'other@example.com' }, created.changeId)).toMatchObject({ ok: false });
    expect(await room.revertAs({ ...user, email: 'other@example.com', role: 'admin' }, created.changeId)).toMatchObject(
      { ok: true },
    );
    const seq = engine.seq;
    expect(
      await room.commentAs(
        { ...user, role: 'viewer' },
        schemas.comment.parse({ workstream: engine.current().projects[0].id, body: 'Review', dryRun: true }),
      ),
    ).toMatchObject({ ok: true });
    expect(engine.seq).toBe(seq);
    expect(engine.threads()).toHaveLength(0);
  });
});

it('runs the agent workstream, staffing, people and comment lifecycle', async () => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  const engine = new RoomEngine(nodeSql());
  const user = { email: 'admin@example.com', name: 'Admin', role: 'admin' as const };
  engine.setPlanId('lifecycle');
  const room = new PlanRoom(
    {
      setWebSocketAutoResponse: vi.fn(),
      getWebSockets: () => [],
      waitUntil: vi.fn(),
      storage: { get: async () => ({ name: 'Lifecycle', archived: false }) },
    } as unknown as DurableObjectState,
    {} as Env,
  );
  Object.defineProperty(room, 'engine', { value: engine });
  vi.spyOn(room as unknown as { flush(): Promise<void> }, 'flush').mockResolvedValue();
  const week = room.snapshot().thisWeek;
  const call = async (tool: keyof typeof schemas, args: unknown) => {
    const result = await room.command(user, { tool, args: schemas[tool].parse(args) } as Parameters<
      typeof room.command
    >[1]);
    expect(result).toMatchObject({ ok: true });
    return result;
  };
  await call('create_workstream', {
    name: 'Agent lifecycle',
    externalId: 'CRM-AGENT',
    seller: 'New Seller',
    capabilities: ['New Capability'],
    createMissing: true,
    startWeek: week,
    endWeek: addWeeks(week, 3),
  });
  await call('upsert_person', {
    name: 'New Person',
    email: 'person@example.com',
    level: 'SM',
    title: 'Architect',
    capabilities: ['New Capability'],
  });
  await call('upsert_person', { person: 'person@example.com', title: 'Principal Architect' });
  await call('add_open_role', {
    workstream: 'CRM-AGENT',
    name: 'Architect',
    capabilities: ['New Capability'],
    percent: 50,
    from: week,
    to: addWeeks(week, 3),
  });
  const oldRole = room.snapshot().plan.assignments[0];
  await call('update_workstream', {
    workstream: 'CRM-AGENT',
    startWeek: addWeeks(week, 1),
    shiftStaffing: true,
    stage: 'won',
  });
  expect(room.snapshot().plan.assignments[0].weekly[addWeeks(week, 4)]).toBe(50);
  await call('assign_role', { workstream: 'CRM-AGENT', role: oldRole.id, person: 'person@example.com' });
  await call('set_allocation', {
    workstream: 'CRM-AGENT',
    person: 'person@example.com',
    percent: 100,
    from: addWeeks(week, 1),
    to: addWeeks(week, 2),
  });
  await call('create_workstream', { name: 'Destination', stage: 'won' });
  await call('move_person', {
    workstream: 'CRM-AGENT',
    person: 'person@example.com',
    toWorkstream: 'Destination',
    from: week,
  });
  await call('remove_from_workstream', {
    workstream: 'Destination',
    person: 'person@example.com',
    keepAsOpenRole: true,
  });
  expect(room.snapshot().plan.assignments[0].resourceId).toBeNull();
  const viewer = { ...user, email: 'viewer@example.com', role: 'viewer' as const };
  expect(
    await room.commentAs(
      viewer,
      schemas.comment.parse({ workstream: 'CRM-AGENT', body: 'Please review', mentions: [user.email] }),
    ),
  ).toMatchObject({ ok: true });
  const threadId = room.snapshot().threads[0].id;
  expect(await room.resolveAs(viewer, threadId, true)).toMatchObject({ ok: true });
  expect(await room.resolveAs(viewer, threadId, false)).toMatchObject({ ok: true });
  const removed = await call('delete_workstream', { workstream: 'Destination', confirmName: 'Destination' });
  if (!('changeId' in removed) || !removed.changeId) throw new Error('Missing change id');
  await call('undo_change', { changeId: removed.changeId });
  expect(room.snapshot().plan.projects.some((p) => p.name === 'Destination')).toBe(true);
});

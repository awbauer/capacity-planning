import { describe, expect, it } from 'vitest';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createSamplePlan } from '../../src/domain/sampleData';
import { applyOp } from '../../src/domain/ops';
import { checkReferences, parsePlan } from '../../src/domain/schema';
import { addWeeks } from '../../src/domain/weeks';
import { toRanges } from '../../src/domain/staffing';
import { RoomEngine, type User } from '../roomEngine';
import { nodeSql } from '../test/nodeSql';
import { buildCommand } from './commands';
import { schemas, type Command } from './inputs';
import { resolve, person } from './resolve';
import { impact } from './impact';
import { getAllocations, listIssues, listPeople, listWorkstreams, type Snapshot } from './read';
import { buildServer } from './server';
const now = '2026-10-12';
const user: User = {
  email: 'alex@example.com',
  name: 'Alex Rivera',
  role: 'editor',
};
const admin: User = { ...user, role: 'admin' };
function fixture() {
  const plan = createSamplePlan('2026-10-05');
  plan.resources[0].email = user.email;
  const snapshot: Snapshot = {
    plan,
    seq: 1,
    thisWeek: now,
    timeZone: 'Europe/London',
    locks: [],
    threads: [],
  };
  return { plan, snapshot };
}
function command(tool: Command['tool'], args: unknown) {
  return { tool, args: schemas[tool].parse(args) } as Command;
}
describe('agent commands', () => {
  it('moves future weeks without changing historic attribution, as one undo step', () => {
    const { plan } = fixture();
    const old = plan.assignments.find((a) => a.id === 'sample-a1')!;
    const destination = plan.projects.find((p) => p.id !== old.projectId)!;
    const built = buildCommand(
      plan,
      command('move_person', {
        workstream: old.projectId,
        role: old.id,
        toWorkstream: destination.id,
        from: now,
      }),
      now,
      user,
    );
    expect(built).not.toHaveProperty('error');
    if ('error' in built) return;
    const after = applyOp(plan, built.op);
    const kept = after.assignments.find((a) => a.id === old.id)!;
    expect(kept.resourceId).toBe(old.resourceId);
    expect(kept.weekly).toEqual(Object.fromEntries(Object.entries(old.weekly).filter(([w]) => w < now)));
    const moved = after.assignments.find(
      (a) =>
        a.id !== old.id && a.resourceId === old.resourceId && a.projectId === destination.id && a.name === old.name,
    )!;
    expect(moved.weekly).toEqual(Object.fromEntries(Object.entries(old.weekly).filter(([w]) => w >= now)));
    expect(built.op.t).toBe('group');
    expect(built.label).toContain('(via agent)');
    const engine = new RoomEngine(nodeSql());
    engine.replacePlan(admin, plan, 'seed');
    const result = engine.apply(user, 'move-1', built.op, now);
    expect(result.ok).toBe(true);
    if (result.ok === true) expect(engine.revert(user, 'undo', result.batch.batchId, now).ok).toBe(true);
    expect(engine.current().assignments.find((a) => a.id === old.id)).toEqual(old);
  });
  it('swaps a person and leaves prior weeks on the original role', () => {
    const { plan } = fixture(),
      seat = plan.assignments[0],
      replacement = plan.resources.find((r) => r.id !== seat.resourceId)!;
    const built = buildCommand(
      plan,
      command('assign_role', {
        workstream: seat.projectId,
        role: seat.id,
        person: replacement.id,
        from: now,
      }),
      now,
      user,
    );
    if ('error' in built) throw new Error(built.error);
    const after = applyOp(plan, built.op);
    expect(after.assignments.find((r) => r.id === seat.id)?.resourceId).toBe(seat.resourceId);
    expect(after.assignments.at(-1)?.resourceId).toBe(replacement.id);
    expect(Object.keys(after.assignments.at(-1)!.weekly).every((w) => w >= now)).toBe(true);
  });
  it('remove can preserve future demand as an open role', () => {
    const { plan } = fixture(),
      seat = plan.assignments[0];
    const built = buildCommand(
      plan,
      command('remove_from_workstream', {
        workstream: seat.projectId,
        role: seat.id,
        keepAsOpenRole: true,
      }),
      now,
      user,
    );
    if ('error' in built) throw new Error(built.error);
    const after = applyOp(plan, built.op);
    expect(after.assignments.at(-1)?.resourceId).toBeNull();
    expect(after.assignments.find((r) => r.id === seat.id)?.weekly['2026-10-05']).toBe(seat.weekly['2026-10-05']);
  });
  it('rejects past edits, off-step percentages, inverted/long ranges and wrong delete confirmation', () => {
    const { plan } = fixture();
    const seat = plan.assignments[0];
    expect(
      buildCommand(
        plan,
        command('set_allocation', {
          workstream: seat.projectId,
          role: seat.id,
          from: '2026-10-05',
          percent: 25,
        }),
        now,
        user,
      ),
    ).toMatchObject({ error: expect.stringContaining('use from ≥') });
    expect(
      schemas.set_allocation.safeParse({
        workstream: seat.projectId,
        role: seat.id,
        percent: 75,
      }).success,
    ).toBe(false);
    expect(
      schemas.set_allocation.safeParse({
        workstream: seat.projectId,
        role: seat.id,
        percent: 30,
      }).success,
    ).toBe(false);
    for (const [from, to] of [
      ['2026-10-19', now],
      [now, '2032-01-01'],
    ])
      expect(
        buildCommand(
          plan,
          command('set_allocation', {
            workstream: seat.projectId,
            role: seat.id,
            from,
            to,
            percent: 25,
          }),
          now,
          user,
        ),
      ).toHaveProperty('error');
    expect(
      buildCommand(
        plan,
        command('delete_workstream', {
          workstream: seat.projectId,
          confirmName: 'wrong',
        }),
        now,
        admin,
      ),
    ).toHaveProperty('error');
  });
  it('caps grouped operations and rejects duplicate Project IDs in the server validator', () => {
    const { plan } = fixture();
    const engine = new RoomEngine(nodeSql());
    engine.replacePlan(admin, plan, 'seed');
    const seat = plan.assignments[0];
    seat.weekly = Object.fromEntries(Array.from({ length: 210 }, (_, i) => [addWeeks(now, i), i % 2 ? 50 : 25]));
    const built = buildCommand(
      plan,
      command('assign_role', {
        workstream: seat.projectId,
        role: seat.id,
        person: plan.resources.find((r) => r.id !== seat.resourceId)!.id,
      }),
      now,
      user,
    );
    expect(built).toHaveProperty('error');
    plan.projects[0].externalId = ' ABC-1 ';
    plan.projects[1].externalId = 'abc-1';
    expect(checkReferences(plan)).toContain('already used');
    expect(() => parsePlan(plan)).toThrow('already used');
    engine.apply(
      admin,
      undefined,
      {
        t: 'project.update',
        id: plan.projects[0].id,
        p: { set: { externalId: 'ABC-1' } },
      },
      now,
    );
    expect(
      engine.apply(
        user,
        undefined,
        {
          t: 'project.update',
          id: plan.projects[1].id,
          p: { set: { externalId: 'abc-1' } },
        },
        now,
      ),
    ).toMatchObject({ ok: false, code: 'invalid' });
  });
});
describe('preview', () => {
  it('never changes storage and shares permission, reference, schema and lock validation with apply', () => {
    const { plan } = fixture(),
      engine = new RoomEngine(nodeSql());
    engine.replacePlan(admin, plan, 'seed');
    const op = {
      t: 'cells.set',
      edits: [{ roleId: plan.assignments[0].id, weeks: [now], value: 100 }],
    };
    const before = JSON.stringify(engine.current()),
      seq = engine.seq;
    expect(engine.preview(user, op, now).ok).toBe('noop');
    expect(JSON.stringify(engine.current())).toBe(before);
    expect(engine.seq).toBe(seq);
    engine.addLock({ ...admin, email: 'other@example.com' }, 'lock', {
      id: 'lock1',
      scope: 'project',
      projectId: plan.assignments[0].projectId,
      note: 'Frozen',
    });
    for (const [actor, input] of [
      [user, op],
      [{ ...user, role: 'viewer' as const }, op],
      [
        user,
        {
          t: 'project.update',
          id: plan.projects[0].id,
          p: { unset: ['name'] },
        },
      ],
    ] as const) {
      expect(engine.preview(actor, input, now)).toEqual(engine.apply(actor, undefined, input, now));
    }
  });
});
describe('resolution and analytics', () => {
  it('requires a unique match and resolves Project IDs, email and me', () => {
    const { plan } = fixture();
    expect(person(plan, 'me', user).email).toBe(user.email);
    expect(parsePlan(plan).resources[0].email).toBe(user.email);
    expect(() =>
      resolve(
        [
          { id: '1', name: 'Alex A' },
          { id: '2', name: 'Alex B' },
        ],
        'alex',
        'person',
      ),
    ).toThrow('Ambiguous');
    expect(
      resolve(
        [
          { id: '1', name: 'One' },
          { id: '2', name: 'One' },
        ],
        '2',
        'person',
      ).id,
    ).toBe('2');
    plan.projects[0].externalId = 'CRM-12';
    expect(
      listWorkstreams({ ...fixture().snapshot, plan }, schemas.list_workstreams.parse({ externalId: 'crm-12' }), user)
        .items,
    ).toHaveLength(1);
  });
  it('finds qualified open-role candidates before limiting the ranked results', () => {
    const { plan, snapshot } = fixture();
    const tag = plan.tags[0];
    plan.resources = Array.from({ length: 205 }, (_, i) => ({
      id: `candidate-${i}`,
      name: `Person ${i}`,
      tagIds: i === 204 ? [tag.id] : [],
    }));
    plan.projects = [
      { id: 'project', name: 'Project', status: 'won', sellerId: null, tagIds: [tag.id], startWeek: now, endWeek: now },
    ];
    plan.assignments = [
      { id: 'open', name: 'Open', resourceId: null, projectId: 'project', tagIds: [tag.id], weekly: { [now]: 50 } },
    ];
    const result = listIssues(
      { ...snapshot, plan },
      schemas.list_issues.parse({ from: now, to: now, type: 'open-role', withCandidates: true }),
    );
    expect(result.items[0]).toMatchObject({ candidates: [{ id: 'candidate-204' }] });
  });
  it('coalesces ranges across adjacent weeks and leaves gaps', () => {
    expect(toRanges({ '2026-10-05': 50, '2026-10-12': 50, '2026-10-26': 50 })).toEqual([
      { from: '2026-10-05', to: now, percent: 50 },
      { from: '2026-10-26', to: '2026-10-26', percent: 50 },
    ]);
  });
  it('filters people and allocation ranges, and reports added/cleared risks', () => {
    const { plan, snapshot } = fixture();
    const people = listPeople(
      snapshot,
      schemas.list_people.parse({
        text: plan.resources[0].name,
        from: now,
        to: now,
      }),
    );
    expect(people.items.map((r) => r.id)).toEqual([plan.resources[0].id]);
    const allocations = getAllocations(
      snapshot,
      schemas.get_allocations.parse({
        people: [plan.resources[0].id],
        from: now,
        to: now,
      }),
      user,
    );
    expect(
      allocations.items.every(
        (r) => r.person?.id === plan.resources[0].id && r.ranges.every((x) => x.from === now && x.to === now),
      ),
    ).toBe(true);
    const after = { ...plan, assignments: [] };
    const effect = impact(plan, after, now);
    expect(effect.added).toHaveLength(0);
    expect(impact(after, plan, now).added).toEqual(effect.cleared);
  });
});
describe('MCP transport', () => {
  async function request(role: User['role'], method: string, params?: unknown) {
    const handler = createMcpHandler(() =>
      buildServer({
        user: { ...user, role },
        execute: async (cmd) => ({ tool: cmd.tool, args: cmd.args }),
      }),
    );
    const res = await handler.fetch(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
    const text = await res.text();
    return JSON.parse(
      text.startsWith('event:') || text.startsWith('data:')
        ? text
            .split('\n')
            .find((l) => l.startsWith('data:'))!
            .slice(5)
        : text,
    );
  }
  it('initializes and serves all 20 tools to editors, only reads/comments to viewers', async () => {
    const init = await request('editor', 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.result.serverInfo.name).toBe('capacity-planning');
    const editor = await request('editor', 'tools/list', {}),
      viewer = await request('viewer', 'tools/list', {});
    expect(editor.result.tools).toHaveLength(20);
    expect(
      editor.result.tools.every(
        (t: { _meta: { ui: { resourceUri: string } } }) =>
          t._meta.ui.resourceUri === 'ui://capacity-planning/workspace.html',
      ),
    ).toBe(true);
    const resource = await request('viewer', 'resources/read', { uri: 'ui://capacity-planning/workspace.html' });
    expect(resource.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.result.contents[0].text).toContain('ui/initialize');
    expect(viewer.result.tools).toHaveLength(10);
    expect(
      viewer.result.tools.every(
        (t: { name: string; annotations: { readOnlyHint: boolean } }) =>
          t.name === 'comment' || t.annotations.readOnlyHint,
      ),
    ).toBe(true);
    const call = await request('editor', 'tools/call', {
      name: 'set_allocation',
      arguments: {
        workstream: 'CRM-12',
        person: 'me',
        from: '2026-10-14',
        to: '2026-10-16',
        percent: 25,
        dryRun: true,
      },
    });
    expect(JSON.parse(call.result.content[0].text).args.from).toBe(now);
    const refused = await request('viewer', 'tools/call', {
      name: 'set_allocation',
      arguments: { workstream: 'x', person: 'me', percent: 25 },
    });
    expect(refused.error || refused.result?.isError).toBeTruthy();
  });
});

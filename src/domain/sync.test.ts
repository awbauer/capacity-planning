import { describe, expect, it } from 'vitest';
import { applyPuts, deepEqual, diffPlans, planEntities, planFromEntities, toPuts } from './diff';
import { describeOp, changeRefs } from './describeOp';
import { brokenLocks, type Lock } from './locks';
import { parseOp } from './opSchema';
import { applyOp, type Op } from './ops';
import { canApply } from './permissions';
import { revertChanges } from './revert';
import { createEmptyPlan, createSamplePlan } from './sampleData';
import { checkReferences } from './schema';

const NOW = '2026-10-05';
const base = createSamplePlan(NOW);

/** One of every kind of op, against the sample plan. */
const OPS: Op[] = [
  { t: 'tag.add', tag: { id: 'tag-new', name: 'Heroku', color: '#2563eb' } },
  { t: 'tag.update', id: 'tag-dc', p: { set: { name: 'Data 360' } } },
  { t: 'tag.delete', id: 'tag-dc' },
  { t: 'seller.add', seller: { id: 'seller-new', name: 'Pat' } },
  { t: 'seller.update', id: 'seller-jordan', p: { set: { email: 'j@example.com' } } },
  { t: 'seller.delete', id: 'seller-jordan' },
  { t: 'resource.add', resource: { id: 'res-new', name: 'Quinn', tagIds: ['tag-dc'] } },
  { t: 'resource.update', id: 'res-alex', p: { set: { level: 'M' }, unset: ['role'] } },
  { t: 'resource.delete', id: 'res-alex' },
  { t: 'project.add', project: { id: 'proj-new', name: 'Umbrella', sellerId: null, status: 'pipeline', tagIds: [] } },
  { t: 'project.update', id: 'proj-contoso', p: { set: { startWeek: '2026-11-23' } }, shift: { from: '2026-11-02', weeks: 3 } },
  { t: 'project.delete', id: 'proj-contoso' },
  {
    t: 'role.add',
    role: { id: 'role-new', projectId: 'proj-acme', resourceId: null, name: 'Architect', tagIds: [], weekly: { '2026-10-12': 50 } },
  },
  { t: 'role.update', id: 'sample-role1', p: { set: { name: 'Lead' }, unset: ['level'] } },
  { t: 'role.assign', id: 'sample-role1', resourceId: 'res-morgan' },
  { t: 'role.delete', id: 'sample-a1' },
  { t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: ['2026-10-05', '2026-10-12', '2026-12-28'], value: 25 }] },
  { t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: ['2026-10-05'], value: 0 }] },
  { t: 'settings.update', set: { criticalThreshold: 160 }, targets: { D: 50, A: null } },
  { t: 'plan.replace', plan: createEmptyPlan() },
  {
    t: 'group',
    ops: [
      { t: 'tag.add', tag: { id: 'tag-x', name: 'X', color: '#2563eb' } },
      { t: 'resource.update', id: 'res-sam', p: { set: { tagIds: ['tag-x'] } } },
    ],
  },
];

describe('ops', () => {
  it('keeps untouched entities by reference', () => {
    const next = applyOp(base, { t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: [NOW], value: 100 }] });
    expect(next.resources).toBe(base.resources);
    expect(next.assignments.filter((a) => a.id !== 'sample-a1').every((a) => base.assignments.includes(a))).toBe(true);
  });

  it('applies every op to a valid plan', () => {
    for (const op of OPS) expect(checkReferences(applyOp(base, op)), op.t).toBeNull();
  });

  it('accepts every example op in the schema, and rejects bad ones', () => {
    for (const op of OPS) expect(parseOp(JSON.parse(JSON.stringify(op))), op.t).toHaveProperty('op');
    expect(parseOp({ t: 'cells.set', edits: [{ roleId: 'x', weeks: ['2026-10-06'], value: 25 }] })).toHaveProperty('error');
    expect(parseOp({ t: 'cells.set', edits: [{ roleId: 'x', weeks: [NOW], value: 30 }] })).toHaveProperty('error');
    expect(parseOp({ t: 'tag.delete', id: "x'; drop table" })).toHaveProperty('error');
    expect(parseOp({ t: 'tag.update', id: 'tag-dc', p: { set: { id: 'other' } } })).toHaveProperty('error');
    expect(parseOp({ t: 'nope' })).toHaveProperty('error');
  });
});

describe('diff and puts', () => {
  it('turns any before/after pair into puts that reproduce the after', () => {
    for (const op of OPS) {
      const after = applyOp(base, op);
      const changes = diffPlans(base, after);
      expect(changes.length, op.t).toBeGreaterThan(0);
      const rebuilt = applyPuts(base, toPuts(after, changes));
      expect(deepEqual(rebuilt, after), op.t).toBe(true);
    }
  });

  it('records allocation changes week by week', () => {
    const after = applyOp(base, OPS[16]);
    const cells = diffPlans(base, after).filter((c) => c.field === 'weekly');
    expect(cells.map((c) => [c.week, c.before, c.after])).toEqual([
      ['2026-10-05', 50, 25],
      ['2026-10-12', 50, 25],
      ['2026-12-28', 50, 25],
    ]);
    expect(cells[0].projectId).toBe('proj-acme');
  });

  it('records cascades: deleting a person opens their roles', () => {
    const changes = diffPlans(base, applyOp(base, { t: 'resource.delete', id: 'res-alex' }));
    expect(changes.filter((c) => c.kind === 'role').every((c) => c.field === 'resourceId' && c.after === null)).toBe(true);
    expect(changeRefs(changes, base).resourceIds).toContain('res-alex');
  });

  it('returns the same plan for no puts, and keeps equal entities', () => {
    expect(applyPuts(base, [])).toBe(base);
    const same = applyPuts(base, [{ k: 'tag', id: 'tag-dc', v: { ...base.tags.find((t) => t.id === 'tag-dc') } }]);
    expect(same.tags.find((t) => t.id === 'tag-dc')).toBe(base.tags.find((t) => t.id === 'tag-dc'));
  });

  it('stores and rebuilds a whole plan in order', () => {
    expect(planFromEntities(planEntities(base))).toEqual(base);
  });
});

describe('revert', () => {
  it('undoes any op exactly when nothing changed in between', () => {
    for (const op of OPS) {
      const after = applyOp(base, op);
      const { plan, skipped } = revertChanges(after, diffPlans(base, after));
      expect(skipped, op.t).toEqual([]);
      // Restored entities come back at the end of their list.
      const byId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));
      const norm = (p: typeof base) => ({ ...p, tags: byId(p.tags), sellers: byId(p.sellers), resources: byId(p.resources), projects: byId(p.projects), assignments: byId(p.assignments) });
      expect(deepEqual(norm(plan), norm(base)), op.t).toBe(true);
    }
  });

  it("keeps someone else's later edits", () => {
    const mine = applyOp(base, { t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: [NOW, '2026-10-12'], value: 100 }] });
    const changes = diffPlans(base, mine);
    const theirs = applyOp(mine, { t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: ['2026-10-12'], value: 25 }] });
    const { plan, skipped } = revertChanges(theirs, changes);
    const weekly = plan.assignments.find((a) => a.id === 'sample-a1')!.weekly;
    expect(weekly[NOW]).toBe(50); // mine undone
    expect(weekly['2026-10-12']).toBe(25); // theirs kept
    expect(skipped).toHaveLength(1);
  });

  it('brings back a deleted workstream with its roles', () => {
    const after = applyOp(base, { t: 'project.delete', id: 'proj-contoso' });
    expect(revertChanges(after, diffPlans(base, after)).plan.assignments.filter((a) => a.projectId === 'proj-contoso').length).toBe(
      base.assignments.filter((a) => a.projectId === 'proj-contoso').length,
    );
  });

  it('drops a restored role whose workstream has since been deleted', () => {
    const removed = applyOp(base, { t: 'role.delete', id: 'sample-role1' });
    const changes = diffPlans(base, removed);
    const later = applyOp(removed, { t: 'project.delete', id: 'proj-contoso' });
    const { plan } = revertChanges(later, changes);
    expect(checkReferences(plan)).toBeNull();
    expect(plan.assignments.some((a) => a.id === 'sample-role1')).toBe(false);
  });
});

describe('locks', () => {
  const lock = (l: Partial<Lock> & Pick<Lock, 'scope'>): Lock => ({ id: 'L', owner: 'owner@x', createdAt: 0, ...l }) as Lock;
  const bob = { email: 'bob@x', admin: false };
  const check = (op: Op, locks: Lock[], user = bob) => brokenLocks(diffPlans(base, applyOp(base, op)), base, locks, user, NOW);
  const setA1 = (week: string): Op => ({ t: 'cells.set', edits: [{ roleId: 'sample-a1', weeks: [week], value: 25 }] });

  it('blocks cells in a locked range for everyone but the owner', () => {
    const l = lock({ scope: 'cells', roleIds: ['sample-a1'], from: NOW, to: '2026-10-12' });
    expect(check(setA1(NOW), [l])).toHaveLength(1);
    expect(check(setA1('2026-10-19'), [l])).toHaveLength(0);
    expect(check(setA1(NOW), [l], { email: 'owner@x', admin: false })).toHaveLength(0);
  });

  it('freezes staffing on a locked workstream, including cascades, but not names', () => {
    const l = lock({ scope: 'project', projectId: 'proj-contoso' });
    expect(check({ t: 'resource.delete', id: 'res-alex' }, [l])).toHaveLength(1);
    expect(check({ t: 'project.update', id: 'proj-contoso', p: { set: { startWeek: '2026-11-23' } } }, [l])).toHaveLength(1);
    expect(check({ t: 'project.update', id: 'proj-contoso', p: { set: { name: 'Contoso 2' } } }, [l])).toHaveLength(0);
    expect(check({ t: 'tag.delete', id: 'tag-af' }, [l])).toHaveLength(0);
    expect(check({ t: 'role.update', id: 'sample-role1', p: { set: { name: 'X' } } }, [l])).toHaveLength(0);
    expect(check({ t: 'role.assign', id: 'sample-role1', resourceId: 'res-sam' }, [l])).toHaveLength(1);
  });

  it('locks past weeks for everyone but admins', () => {
    const l = lock({ scope: 'past' });
    expect(check(setA1('2026-09-28'), [l])).toHaveLength(1);
    expect(check(setA1(NOW), [l])).toHaveLength(0);
    expect(check(setA1('2026-09-28'), [l], { email: 'bob@x', admin: true })).toHaveLength(0);
  });
});

describe('permissions and summaries', () => {
  it('lets editors edit and only admins change settings or replace the plan', () => {
    expect(canApply('viewer', OPS[0])).toBe(false);
    expect(canApply('editor', OPS[0])).toBe(true);
    expect(canApply('editor', { t: 'settings.update', set: { criticalThreshold: 150 } })).toBe(false);
    expect(canApply('editor', { t: 'group', ops: [OPS[0], { t: 'plan.replace', plan: createEmptyPlan() }] })).toBe(false);
    expect(canApply('admin', { t: 'plan.replace', plan: createEmptyPlan() })).toBe(true);
  });

  it('describes edits in words', () => {
    expect(describeOp(OPS[16], base)).toMatch(/^Set Solution Architect › Alex Rivera on .* to 25%, 3 weeks/);
    expect(describeOp(OPS[14], base)).toMatch(/^Put Morgan Kim in Agentforce Architect › open on /);
    for (const op of OPS) expect(describeOp(op, base).length).toBeGreaterThan(5);
  });
});

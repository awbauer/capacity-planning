import { describe, expect, it } from 'vitest';
import { fromEditable, toEditable } from '../collab/mentionText';
import { SyncCore } from '../sync/syncCore';
import {
  anchorLabel,
  anchorSchema,
  commentBody,
  excerpt,
  isOpenThread,
  lastActivity,
  MAX_MENTIONS,
  mentionToken,
  parseMentions,
  plainBody,
  rawExcerpt,
  threadsOnCell,
  type Thread,
} from './comments';
import { isSideChange } from './protocol';
import { createSamplePlan } from './sampleData';

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 't1',
  anchor: { kind: 'cells', roleId: 'r1', from: '2026-10-05', to: '2026-10-26' },
  createdBy: 'a@x.com',
  createdAt: 1,
  comments: [{ id: 'c1', author: 'a@x.com', body: 'hi', mentions: [], createdAt: 1 }],
  ...over,
});

describe('mentions', () => {
  it('finds each mentioned email once, lowercased, ignoring malformed tokens', () => {
    expect(parseMentions(`${mentionToken('Bob@X.com')} and <@bob@x.com>, <@carol@x.com> <@not-an-email> <@@x>`)).toEqual([
      'bob@x.com',
      'carol@x.com',
    ]);
  });

  it('shows mentions as names', () => {
    const names: Record<string, string> = { 'bob@x.com': 'Bob' };
    expect(plainBody('Hi <@bob@x.com>, ask <@zed@x.com>', (e) => names[e] ?? e)).toBe('Hi @Bob, ask @zed@x.com');
    expect(excerpt('a\n\nb   c', 80)).toBe('a b c');
    expect(excerpt('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('cuts raw excerpts without splitting a mention token', () => {
    const body = `${'x'.repeat(295)} <@bob@x.com> more`;
    expect(rawExcerpt(body)).toBe(`${'x'.repeat(295)} …`);
    expect(rawExcerpt('short')).toBe('short');
  });

  it('limits bodies and mentions', () => {
    expect(commentBody.safeParse('  ').success).toBe(false);
    expect(commentBody.safeParse('x'.repeat(4001)).success).toBe(false);
    const many = Array.from({ length: MAX_MENTIONS + 1 }, (_, i) => mentionToken(`p${i}@x.com`)).join(' ');
    expect(commentBody.safeParse(many).success).toBe(false);
  });

  it('turns typed @Name and @email into tokens and back', () => {
    const people = [
      { email: 'bob@x.com', name: 'Bob' },
      { email: 'bob.s@x.com', name: 'Bob Smith' },
    ];
    expect(fromEditable('Hi @Bob Smith and @Bob, cc @bob@x.com; not a@Bob or @Bobby', people)).toBe(
      'Hi <@bob.s@x.com> and <@bob@x.com>, cc <@bob@x.com>; not a@Bob or @Bobby',
    );
    expect(toEditable('Hi <@bob.s@x.com> and <@zed@x.com>', people)).toBe('Hi @Bob Smith and @zed@x.com');
  });
});

describe('threads', () => {
  it('finds threads on a cell at any zoom', () => {
    const t = thread();
    expect(threadsOnCell([t], 'r1', ['2026-10-12'])).toEqual([t]);
    expect(threadsOnCell([t], 'r1', ['2026-09-28', '2026-10-05'])).toEqual([t]);
    expect(threadsOnCell([t], 'r1', ['2026-11-02'])).toEqual([]);
    expect(threadsOnCell([t], 'r2', ['2026-10-12'])).toEqual([]);
  });

  it('knows when a thread last had activity and whether it counts as open', () => {
    const t = thread({
      comments: [
        { id: 'c1', author: 'a@x.com', body: 'hi', mentions: [], createdAt: 1, editedAt: 9 },
        { id: 'c2', author: 'b@x.com', body: '', mentions: [], createdAt: 5, deleted: { by: 'z@x.com', at: 7 } },
      ],
    });
    expect(lastActivity(t)).toEqual({ ts: 9, actor: 'a@x.com' });
    expect(lastActivity({ ...t, resolvedAt: 12, resolvedBy: 'r@x.com' })).toEqual({ ts: 12, actor: 'r@x.com' });
    expect(isOpenThread(t)).toBe(true);
    expect(isOpenThread({ ...t, resolvedAt: 12 })).toBe(false);
    expect(isOpenThread({ ...t, comments: [t.comments[1]] })).toBe(false);
  });

  it('labels anchors, including deleted things', () => {
    const plan = createSamplePlan('2026-10-05');
    expect(anchorLabel(plan, { kind: 'role', roleId: 'sample-a1' })).toMatch(/› Alex Rivera on /);
    expect(anchorLabel(plan, { kind: 'role', roleId: 'gone' })).toBe('a deleted role');
    expect(anchorLabel(plan, { kind: 'resource', resourceId: 'res-alex' })).toBe('Alex Rivera');
    expect(anchorLabel(plan, { kind: 'project', projectId: 'gone' })).toBe('Workstream (deleted)');
  });

  it('validates anchors', () => {
    expect(anchorSchema.safeParse({ kind: 'cells', roleId: 'r1', from: '2026-10-05', to: '2026-10-12' }).success).toBe(true);
    expect(anchorSchema.safeParse({ kind: 'cells', roleId: 'r1', from: '2026-10-12', to: '2026-10-05' }).success).toBe(false);
    expect(anchorSchema.safeParse({ kind: 'cells', roleId: 'r1', from: '2026-10-06', to: '2026-10-12' }).success).toBe(false);
    expect(anchorSchema.safeParse({ kind: 'project', projectId: '<script>' }).success).toBe(false);
  });
});

describe('comment batches and undo', () => {
  it('never puts lock or comment batches on the undo stack', () => {
    expect(isSideChange('comment.add') && isSideChange('lock.add') && !isSideChange('cells.set')).toBe(true);
    let n = 0;
    const core = new SyncCore(() => `c${++n}`);
    const batch = (op: string, batchId: string) => ({ batchId, seq: 1, actor: 'a@x.com', ts: 1, op, summary: '', changeCount: 0 });
    core.receive({ t: 'applied', seq: 1, batch: batch('comment.add', 'b1'), cid: 'x1', puts: [] });
    core.receive({ t: 'applied', seq: 2, batch: batch('comment.resolve', 'b2'), cid: 'x2', puts: [] });
    core.receive({ t: 'applied', seq: 3, batch: batch('cells.set', 'b3'), cid: 'x3', puts: [] });
    expect(core.undoStack).toEqual(['b3']);
  });
});

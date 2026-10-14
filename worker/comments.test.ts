import { beforeEach, describe, expect, it } from 'vitest';
import { mentionToken, type CommentAdd, type MentionNotice, type ThreadIndexRow } from '../src/domain/comments';
import { createSamplePlan } from '../src/domain/sampleData';
import { parseSender } from './env';
import { mentionEmail, threadLink } from './mail';
import { RoomEngine, type User } from './roomEngine';
import { nodeSql } from './test/nodeSql';
import { MAIL_ATTEMPTS, MAIL_DELAY_MS, WorkspaceEngine } from './workspaceEngine';

const NOW = '2026-10-05';
const alice: User = { email: 'alice@x.com', name: 'Alice', role: 'admin' };
const bob: User = { email: 'bob@x.com', name: 'Bob', role: 'editor' };
const carol: User = { email: 'carol@x.com', name: 'Carol', role: 'viewer' };

const cell = { kind: 'cells' as const, roleId: 'sample-a1', from: NOW, to: NOW };
const start = (threadId: string, commentId: string, body: string, anchor: CommentAdd['anchor'] = cell): CommentAdd => ({
  threadId,
  commentId,
  anchor,
  body,
});
const reply = (threadId: string, commentId: string, body: string): CommentAdd => ({ threadId, commentId, body });

describe('RoomEngine comments', () => {
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

  it('lets anyone, viewers included, start a thread and reply; each is recorded as a batch with refs', () => {
    const r = room.addComment(carol, 'c1', start('t1', 'k1', `Is this right? ${mentionToken('Bob@x.com')}`));
    expect(r).toMatchObject({ ok: true, seq: 2, batch: { op: 'comment.add', actor: 'carol@x.com', changeCount: 0 } });
    if (r.ok !== true) throw new Error();
    expect(r.thread).toMatchObject({ id: 't1', anchor: cell, createdBy: 'carol@x.com' });
    expect(r.thread!.comments[0]).toMatchObject({ id: 'k1', mentions: ['bob@x.com'] });
    expect(r.batch.summary).toMatch(/^Commented on .* › Alex Rivera on .*: “Is this right\? @bob@x.com”$/);
    expect(room.addComment(bob, 'c2', reply('t1', 'k2', 'Yes'))).toMatchObject({ ok: true, seq: 3 });
    const [row] = room.activitySince(1).slice(-1);
    expect(row).toMatchObject({ op: 'comment.add', threadId: 't1', projectIds: ['proj-acme'], resourceIds: ['res-alex'] });
    // Plan data is untouched, and the threads survive a reload.
    expect(reload().threads()).toEqual(room.threads());
    expect(reload().thread('t1')!.comments.map((c) => c.id)).toEqual(['k1', 'k2']);
  });

  it('treats a resent comment as a duplicate', () => {
    room.addComment(bob, 'c1', start('t1', 'k1', 'Hi'));
    expect(room.addComment(bob, 'c1', start('t1', 'k1', 'Hi'))).toEqual({ ok: 'dup', seq: 2 });
    expect(room.addComment(bob, 'c9', start('t1', 'k9', 'Again'))).toMatchObject({ ok: false, code: 'duplicate' });
    expect(room.addComment(bob, 'c8', reply('t1', 'k1', 'Same id'))).toMatchObject({ ok: false, code: 'duplicate' });
  });

  it('rejects anchors that point at nothing and replies to missing threads', () => {
    expect(room.addComment(bob, 'c1', start('t1', 'k1', 'Hi', { kind: 'role', roleId: 'nope' }))).toMatchObject({ code: 'not_found' });
    expect(room.addComment(bob, 'c2', reply('t2', 'k2', 'Hi'))).toMatchObject({ code: 'not_found' });
    expect(room.addComment(bob, 'c3', start('t3', 'k3', 'Row', { kind: 'project', projectId: 'proj-acme' }))).toMatchObject({ ok: true });
    expect(room.addComment(bob, 'c4', start('t4', 'k4', 'Person', { kind: 'resource', resourceId: 'res-alex' }))).toMatchObject({ ok: true });
  });

  it('only the author edits; the author or an admin deletes; the text before is kept for admins', () => {
    room.addComment(bob, 'c1', start('t1', 'k1', 'Typo hree'));
    expect(room.editComment(carol, 'c2', 't1', 'k1', 'x')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(room.editComment(alice, 'c3', 't1', 'k1', 'x')).toMatchObject({ ok: false, code: 'forbidden' });
    const e = room.editComment(bob, 'c4', 't1', 'k1', 'Typo here');
    expect(e).toMatchObject({ ok: true, batch: { op: 'comment.edit' } });
    if (e.ok !== true) throw new Error();
    expect(e.thread!.comments[0]).toMatchObject({ body: 'Typo here', editedAt: expect.any(Number) });
    expect(room.editComment(bob, 'c5', 't1', 'k1', 'Typo here')).toMatchObject({ ok: 'noop' });
    expect(room.batch(e.batch.batchId, true)!.comment).toEqual({ commentId: 'k1', threadId: 't1', before: 'Typo hree', after: 'Typo here' });
    expect(room.batch(e.batch.batchId, false)!.comment).toBeUndefined();

    expect(room.deleteComment(carol, 'c6', 't1', 'k1')).toMatchObject({ ok: false, code: 'forbidden' });
    const d = room.deleteComment(alice, 'c7', 't1', 'k1');
    expect(d).toMatchObject({ ok: true, batch: { op: 'comment.delete', summary: expect.stringMatching(/^Deleted a comment by bob@x.com on /) } });
    if (d.ok !== true) throw new Error();
    expect(d.thread!.comments[0]).toMatchObject({ body: '', mentions: [], deleted: { by: 'alice@x.com' } });
    expect(room.batch(d.batch.batchId, true)!.comment).toMatchObject({ before: 'Typo here', after: null });
    expect(room.editComment(bob, 'c8', 't1', 'k1', 'back')).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('anyone resolves and reopens; a reply to a resolved thread reopens it', () => {
    room.addComment(bob, 'c1', start('t1', 'k1', 'Hi'));
    expect(room.setResolved(carol, 'c2', 't1', true)).toMatchObject({ ok: true, batch: { op: 'comment.resolve' }, thread: { resolvedBy: 'carol@x.com' } });
    expect(room.setResolved(bob, 'c3', 't1', true)).toMatchObject({ ok: 'noop' });
    expect(room.setResolved(bob, 'c4', 't1', false)).toMatchObject({ ok: true, batch: { op: 'comment.reopen' } });
    room.setResolved(bob, 'c5', 't1', true);
    const r = room.addComment(carol, 'c6', reply('t1', 'k2', 'Not done'));
    expect(r).toMatchObject({ ok: true, batch: { summary: expect.stringMatching(/^Replied to and reopened/) } });
    if (r.ok !== true) throw new Error();
    expect(r.thread!.resolvedAt).toBeUndefined();
  });

  it('keeps a thread on a deleted role, labelled as such', () => {
    room.addComment(bob, 'c1', start('t1', 'k1', 'Hi', { kind: 'role', roleId: 'sample-a1' }));
    room.apply(bob, 'c2', { t: 'role.delete', id: 'sample-a1' }, NOW);
    expect(room.thread('t1')).toBeDefined();
    expect(room.threadOutbox().threads[0].label).toBe('a deleted role');
  });

  it('queues changed threads and new mentions for the workspace, and clears only what was sent', () => {
    room.addComment(bob, 'c1', start('t1', 'k1', `${mentionToken('carol@x.com')} ${mentionToken('alice@x.com')} look`));
    let out = room.threadOutbox();
    expect(out.threads).toEqual([expect.objectContaining({ threadId: 't1', mentions: ['carol@x.com', 'alice@x.com'], commentCount: 1 })]);
    expect(out.notices.map((n) => n.email)).toEqual(['carol@x.com', 'alice@x.com']);
    // A change while the flush is in flight keeps the thread dirty.
    room.addComment(carol, 'c2', reply('t1', 'k2', 'ok'));
    room.threadOutboxSent(out);
    expect(room.threadOutboxEmpty).toBe(false);
    out = room.threadOutbox();
    expect(out.threads[0].commentCount).toBe(2);
    expect(out.notices).toEqual([]);
    room.threadOutboxSent(out);
    expect(room.threadOutboxEmpty).toBe(true);

    // An edit notifies only people newly mentioned; a delete retracts.
    room.editComment(bob, 'c3', 't1', 'k1', `${mentionToken('carol@x.com')} ${mentionToken('dan@x.com')} look`);
    out = room.threadOutbox();
    expect(out.notices.map((n) => n.email)).toEqual(['dan@x.com']);
    room.threadOutboxSent(out);
    room.deleteComment(bob, 'c4', 't1', 'k1');
    out = room.threadOutbox();
    expect(out.retracted).toEqual(['k1']);
    expect(out.threads[0].mentions).toEqual([]);
    room.threadOutboxSent(out);
    room.reindexThreads();
    expect(room.threadOutbox().threads.map((t) => t.threadId)).toEqual(['t1']);
  });

  it('comment batches have nothing to undo', () => {
    const r = room.addComment(bob, 'c1', start('t1', 'k1', 'Hi'));
    if (r.ok !== true) throw new Error();
    expect(room.revert(bob, 'c2', r.batch.batchId, NOW)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('WorkspaceEngine mentions', () => {
  let ws: WorkspaceEngine;
  let clock = 0;
  let ids = 0;
  let planId = '';

  const row = (threadId: string, over: Partial<ThreadIndexRow> = {}): ThreadIndexRow => ({
    threadId,
    label: `Thread ${threadId}`,
    resolved: false,
    createdBy: 'alice@x.com',
    createdAt: clock,
    lastTs: clock,
    lastActor: 'alice@x.com',
    lastExcerpt: `Hi ${mentionToken('bob@x.com')}`,
    commentCount: 1,
    mentions: ['bob@x.com'],
    ...over,
  });
  const notice = (email: string, commentId: string, over: Partial<MentionNotice> = {}): MentionNotice => ({
    email,
    threadId: 't1',
    commentId,
    actor: 'alice@x.com',
    ts: clock,
    label: 'Architect › Alex on Acme',
    excerpt: `Hi ${mentionToken(email)}`,
    ...over,
  });

  beforeEach(() => {
    clock = 0;
    ids = 0;
    ws = new WorkspaceEngine(nodeSql(), new Set(['alice@x.com']), () => (clock += 1000), () => `w${++ids}`);
    ws.touchUser('alice@x.com', 'Alice');
    ws.touchUser('bob@x.com', 'Bob');
    planId = ws.createPlan('alice@x.com', 'Plan A').id;
  });

  it('lists threads that mention someone, by status, with unread until read', () => {
    ws.indexThreads(planId, [row('t1'), row('t2', { resolved: true }), row('t3', { mentions: ['carol@x.com'] })], [], [], false);
    expect(ws.mentions('bob@x.com', { status: 'all' }).entries.map((e) => e.threadId)).toEqual(['t2', 't1']);
    expect(ws.mentions('bob@x.com', { status: 'open' }).entries).toEqual([expect.objectContaining({ threadId: 't1', unread: true, planName: 'Plan A' })]);
    expect(ws.mentions('bob@x.com', { status: 'resolved' }).entries.map((e) => e.threadId)).toEqual(['t2']);
    expect(ws.mentionCounts('bob@x.com')).toEqual({ open: 1, unreadOpen: 1 });
    ws.markRead('bob@x.com', planId, 't1');
    expect(ws.mentionCounts('bob@x.com')).toEqual({ open: 1, unreadOpen: 0 });
    // New activity by someone else makes it unread again; your own doesn't.
    ws.indexThreads(planId, [row('t1', { lastTs: clock + 5000, lastActor: 'bob@x.com' })], [], [], false);
    expect(ws.mentionCounts('bob@x.com').unreadOpen).toBe(0);
    ws.indexThreads(planId, [row('t1', { lastTs: clock + 9000 })], [], [], false);
    expect(ws.mentionCounts('bob@x.com').unreadOpen).toBe(1);
    // Indexing is idempotent and replaces who's mentioned.
    ws.indexThreads(planId, [row('t1', { mentions: [] })], [], [], false);
    expect(ws.mentions('bob@x.com', {}).entries.map((e) => e.threadId)).toEqual(['t2']);
    // Archived plans drop out.
    ws.setArchived('alice@x.com', planId, true);
    expect(ws.mentions('bob@x.com', {}).entries).toEqual([]);
  });

  it('pages newest first', () => {
    for (let i = 0; i < 5; i++) ws.indexThreads(planId, [row(`t${i}`, { lastTs: 100 + i })], [], [], false);
    const p1 = ws.mentions('bob@x.com', { limit: 2 });
    expect(p1.entries.map((e) => e.threadId)).toEqual(['t4', 't3']);
    const p2 = ws.mentions('bob@x.com', { limit: 2, cursor: p1.next });
    expect(p2.entries.map((e) => e.threadId)).toEqual(['t2', 't1']);
    const p3 = ws.mentions('bob@x.com', { limit: 2, cursor: p2.next });
    expect(p3.entries.map((e) => e.threadId)).toEqual(['t0']);
    expect(p3.next).toBeUndefined();
  });

  it('suggests only people with access', () => {
    ws.inviteUser('alice@x.com', 'dan@x.com', 'viewer');
    ws.updateUser('alice@x.com', 'dan@x.com', { disabled: true });
    expect(ws.people().map((p) => p.email)).toEqual(['alice@x.com', 'bob@x.com']);
  });

  it('records the thread of a comment batch in the activity log', () => {
    ws.recordActivity([
      { batchId: 'b1', planId, epoch: 1, seq: 2, actor: 'bob@x.com', ts: 5, op: 'comment.add', summary: 'Commented', changeCount: 0, projectIds: [], resourceIds: [], threadId: 't1' },
    ]);
    expect(ws.activity({ planId }).entries[0]).toMatchObject({ batchId: 'b1', threadId: 't1' });
  });

  describe('mention emails', () => {
    it('queues mentions only of people with access, not the author, and only when mail is on', () => {
      ws.indexThreads(planId, [row('t1')], [notice('bob@x.com', 'k1')], [], false);
      expect(ws.nextMailAt()).toBeNull();
      ws.indexThreads(
        planId,
        [row('t1')],
        [notice('bob@x.com', 'k1'), notice('alice@x.com', 'k1'), notice('stranger@evil.com', 'k1')],
        [],
        true,
      );
      clock += MAIL_DELAY_MS;
      const due = ws.dueMail();
      expect(due.map((d) => d.email)).toEqual(['bob@x.com']);
      expect(due[0].items[0]).toMatchObject({ planName: 'Plan A', actorName: 'Alice', text: 'Hi @Bob' });
    });

    it('waits, then sends one email per person for everything queued', () => {
      ws.indexThreads(planId, [row('t1')], [notice('bob@x.com', 'k1')], [], true);
      expect(ws.dueMail()).toEqual([]);
      ws.indexThreads(planId, [row('t2')], [notice('bob@x.com', 'k2', { threadId: 't2' })], [], true);
      clock += MAIL_DELAY_MS;
      const [d] = ws.dueMail();
      expect(d.items.map((i) => i.commentId)).toEqual(['k1', 'k2']);
      ws.mailDone(d.email, ['k1', 'k2']);
      expect(ws.nextMailAt()).toBeNull();
    });

    it('drops mentions read first, deleted, or of people who turned emails off', () => {
      ws.indexThreads(planId, [row('t1')], [notice('bob@x.com', 'k1')], [], true);
      ws.markRead('bob@x.com', planId, 't1');
      expect(ws.nextMailAt()).toBeNull();
      ws.indexThreads(planId, [row('t1')], [notice('bob@x.com', 'k2')], [], true);
      ws.indexThreads(planId, [], [], ['k2'], true);
      expect(ws.nextMailAt()).toBeNull();
      ws.setMentionEmails('bob@x.com', false);
      expect(ws.mentionEmails('bob@x.com')).toBe(false);
      ws.indexThreads(planId, [row('t1')], [notice('bob@x.com', 'k3')], [], true);
      expect(ws.nextMailAt()).toBeNull();
    });

    it('retries with backoff, then gives up', () => {
      ws.indexThreads(planId, [row('t1')], [notice('bob@x.com', 'k1')], [], true);
      for (let i = 1; i < MAIL_ATTEMPTS; i++) {
        clock += MAIL_DELAY_MS * 2 ** i;
        expect(ws.dueMail()).toHaveLength(1);
        ws.mailRetry('bob@x.com', ['k1']);
        expect(ws.nextMailAt()).not.toBeNull();
      }
      clock += MAIL_DELAY_MS * 2 ** MAIL_ATTEMPTS;
      ws.dueMail();
      ws.mailRetry('bob@x.com', ['k1']);
      expect(ws.nextMailAt()).toBeNull();
    });
  });
});

describe('mention email', () => {
  const item = { planId: 'p 1', planName: 'Plan <A>', threadId: 't1', commentId: 'k1', actor: 'a@x.com', actorName: 'Ann', label: 'Role › Al', text: 'Look <script>', ts: 1 };

  it('escapes what people wrote and links to the thread', () => {
    const m = mentionEmail({ email: 'b@x.com', name: 'B', items: [item] }, 'https://app.example.com/');
    expect(m.subject).toBe('Ann mentioned you in Plan <A>');
    expect(m.html).toContain('Look &lt;script&gt;');
    expect(m.html).not.toContain('<script>');
    expect(m.text).toContain('https://app.example.com/#comment=p%201/t1');
    expect(threadLink('https://x.com', 'p', 't')).toBe('https://x.com/#comment=p/t');
  });

  it('sums up several mentions in the subject', () => {
    const m = mentionEmail({ email: 'b@x.com', name: 'B', items: [item, { ...item, commentId: 'k2' }] }, 'https://x.com');
    expect(m.subject).toBe('You were mentioned 2 times by Ann');
  });

  it('reads the sender as an address or "Name <address>"', () => {
    expect(parseSender('n@x.com')).toBe('n@x.com');
    expect(parseSender('Capacity Planning <n@x.com>')).toEqual({ email: 'n@x.com', name: 'Capacity Planning' });
    expect(parseSender('"Cap" <n@x.com>')).toEqual({ email: 'n@x.com', name: 'Cap' });
  });
});

describe('workspace time zone', () => {
  it('defaults to New York, rejects unknown zones, and logs a change', () => {
    const ws = new WorkspaceEngine(nodeSql(), new Set(['alice@x.com']));
    expect(ws.timeZone).toBe('America/New_York');
    expect(() => ws.setTimeZone('alice@x.com', 'Mars/Olympus')).toThrow(/isn’t a time zone/);
    ws.setTimeZone('alice@x.com', 'Europe/London');
    expect(ws.timeZone).toBe('Europe/London');
    expect(ws.activity({ workspace: true }).entries[0]).toMatchObject({ op: 'settings', summary: 'Set the workspace time zone to Europe/London' });
  });

  it('is kept by each plan room, New York until told otherwise', () => {
    const sql = nodeSql();
    const room = new RoomEngine(sql);
    expect(room.timeZone).toBe('America/New_York');
    room.timeZone = 'Asia/Tokyo';
    expect(new RoomEngine(sql).timeZone).toBe('Asia/Tokyo');
  });
});

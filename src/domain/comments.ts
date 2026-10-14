import { z } from 'zod';
import { entityId, weekKey } from './opSchema';
import type { Assignment, PlanData, WeekKey } from './types';
import { formatWeekRange } from './weeks';

/**
 * What a comment thread is about: some weeks of one role (cells), or a whole
 * role, workstream or person row. Anchors use entity ids, so a thread
 * follows its row through renames and comes back with an undone delete.
 */
export type CommentAnchor =
  | { kind: 'cells'; roleId: string; from: WeekKey; to: WeekKey }
  | { kind: 'role'; roleId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'resource'; resourceId: string };

export interface Comment {
  id: string;
  /** Email. */
  author: string;
  /** Plain text; mentions are `<@email>` tokens. Empty once deleted. */
  body: string;
  /** Emails mentioned in the body. */
  mentions: string[];
  createdAt: number;
  editedAt?: number;
  /** Deleted comments keep their place in the thread but not their text. */
  deleted?: { by: string; at: number };
}

export interface Thread {
  id: string;
  anchor: CommentAnchor;
  createdBy: string;
  createdAt: number;
  resolvedBy?: string;
  resolvedAt?: number;
  comments: Comment[];
}

export const MAX_BODY = 4000;
export const MAX_MENTIONS = 20;
export const MAX_COMMENTS_PER_THREAD = 200;
export const MAX_THREADS_PER_PLAN = 2000;

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/;
const TOKEN = /<@([^\s<>]{1,320})>/g;

/** The `<@email>` token for a mention. */
export const mentionToken = (email: string) => `<@${email.toLowerCase()}>`;

/** The distinct emails a body mentions, lowercased, in order of first mention. */
export function parseMentions(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TOKEN)) {
    const email = m[1].toLowerCase();
    if (EMAIL.test(email)) seen.add(email);
  }
  return [...seen];
}

/** Splits a body into text and mentions, for showing it. */
export function bodyParts(body: string): ({ text: string } | { mention: string })[] {
  const parts: ({ text: string } | { mention: string })[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const email = m[1].toLowerCase();
    if (!EMAIL.test(email)) continue;
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ mention: email });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** A body as plain text, mentions shown as @Name. */
export function plainBody(body: string, nameOf: (email: string) => string = (e) => e): string {
  return bodyParts(body)
    .map((p) => ('mention' in p ? `@${nameOf(p.mention)}` : p.text))
    .join('');
}

/** A one-line excerpt of a body. */
export function excerpt(body: string, max = 80, nameOf?: (email: string) => string): string {
  const flat = plainBody(body, nameOf).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const isResolved = (t: Thread) => t.resolvedAt !== undefined;

/** Comments still showing their text. */
export const liveComments = (t: Thread) => t.comments.filter((c) => !c.deleted);

/** A thread whose every comment was deleted: kept for the record, but not shown in lists or counted. */
export const isEmptyThread = (t: Thread) => liveComments(t).length === 0;

/** Threads that count as open: unresolved, with something left in them. */
export const isOpenThread = (t: Thread) => !isResolved(t) && !isEmptyThread(t);

/** Everyone mentioned in the thread's live comments. */
export const threadMentions = (t: Thread): string[] => [...new Set(liveComments(t).flatMap((c) => c.mentions))];

/** When something last happened in a thread (a comment, an edit, resolving). */
export function lastActivity(t: Thread): { ts: number; actor: string } {
  let best = { ts: t.createdAt, actor: t.createdBy };
  for (const c of t.comments) {
    const candidates: [number | undefined, string][] = [
      [c.createdAt, c.author],
      [c.editedAt, c.author],
      [c.deleted?.at, c.deleted?.by ?? c.author],
    ];
    for (const [ts, actor] of candidates) if (ts !== undefined && ts >= best.ts) best = { ts, actor };
  }
  if (t.resolvedAt !== undefined && t.resolvedAt >= best.ts) best = { ts: t.resolvedAt, actor: t.resolvedBy ?? best.actor };
  return best;
}

/** The role an anchor belongs to, if any. */
export const anchorRoleId = (a: CommentAnchor): string | undefined =>
  a.kind === 'cells' || a.kind === 'role' ? a.roleId : undefined;

/** Whether a thread is on one of these weeks of a role. */
export function anchorOnCell(a: CommentAnchor, roleId: string, weeks: WeekKey[]): boolean {
  return a.kind === 'cells' && a.roleId === roleId && weeks.some((w) => w >= a.from && w <= a.to);
}

/** Threads on one cell (a role's weeks: one, or a month or quarter of them). */
export const threadsOnCell = (threads: Thread[], roleId: string, weeks: WeekKey[]) =>
  threads.filter((t) => anchorOnCell(t.anchor, roleId, weeks));

/** Threads on a row as a whole (not its cells). */
export function threadsOnRow(threads: Thread[], row: { kind: 'role' | 'project' | 'resource'; id: string }): Thread[] {
  return threads.filter((t) => {
    const a = t.anchor;
    if (row.kind === 'role') return a.kind === 'role' && a.roleId === row.id;
    if (row.kind === 'project') return a.kind === 'project' && a.projectId === row.id;
    return a.kind === 'resource' && a.resourceId === row.id;
  });
}

export const sameAnchor = (a: CommentAnchor, b: CommentAnchor) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the thing an anchor points at exists in the plan. */
export function anchorExists(plan: PlanData, a: CommentAnchor): boolean {
  switch (a.kind) {
    case 'cells':
    case 'role':
      return plan.assignments.some((x) => x.id === a.roleId);
    case 'project':
      return plan.projects.some((x) => x.id === a.projectId);
    case 'resource':
      return plan.resources.some((x) => x.id === a.resourceId);
  }
}

/** The workstreams and people an anchor touches (for the activity log's filters). */
export function anchorRefs(plan: PlanData, a: CommentAnchor): { projectIds: string[]; resourceIds: string[] } {
  if (a.kind === 'project') return { projectIds: [a.projectId], resourceIds: [] };
  if (a.kind === 'resource') return { projectIds: [], resourceIds: [a.resourceId] };
  const role = plan.assignments.find((x) => x.id === a.roleId);
  return { projectIds: role ? [role.projectId] : [], resourceIds: role?.resourceId ? [role.resourceId] : [] };
}

/** What an anchor points at, e.g. "Architect › Jane on Acme, Mar 2 – Mar 27, 2026". */
export function anchorLabel(plan: PlanData, a: CommentAnchor): string {
  const project = (id: string) => plan.projects.find((p) => p.id === id)?.name;
  const role = (id: string) => {
    const r = plan.assignments.find((x) => x.id === id);
    if (!r) return 'a deleted role';
    return `${roleName(plan, r)} on ${project(r.projectId) ?? 'a deleted workstream'}`;
  };
  switch (a.kind) {
    case 'cells':
      return `${role(a.roleId)}, ${formatWeekRange(a.from, a.to)}`;
    case 'role':
      return role(a.roleId);
    case 'project':
      return `Workstream ${project(a.projectId) ?? '(deleted)'}`;
    case 'resource':
      return `${plan.resources.find((r) => r.id === a.resourceId)?.name ?? 'A deleted person'}`;
  }
}

function roleName(plan: PlanData, r: Assignment): string {
  const person = r.resourceId ? (plan.resources.find((p) => p.id === r.resourceId)?.name ?? '?') : 'open';
  return `${r.name || 'Unnamed role'} › ${person}`;
}

// ── messages from browsers ──

export const anchorSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('cells'), roleId: entityId, from: weekKey, to: weekKey })
    .refine((a) => a.from <= a.to, 'from must not be after to'),
  z.strictObject({ kind: z.literal('role'), roleId: entityId }),
  z.strictObject({ kind: z.literal('project'), projectId: entityId }),
  z.strictObject({ kind: z.literal('resource'), resourceId: entityId }),
]);

export const commentBody = z
  .string()
  .max(MAX_BODY, `comments are at most ${MAX_BODY} characters`)
  .refine((s) => s.trim().length > 0, 'a comment needs some text')
  .refine((s) => parseMentions(s).length <= MAX_MENTIONS, `at most ${MAX_MENTIONS} people can be mentioned in one comment`);

export const commentAddSchema = z.strictObject({
  threadId: entityId,
  commentId: entityId,
  /** Only when starting a thread. */
  anchor: anchorSchema.optional(),
  body: commentBody,
});
export const commentEditSchema = z.strictObject({ threadId: entityId, commentId: entityId, body: commentBody });
export const commentDeleteSchema = z.strictObject({ threadId: entityId, commentId: entityId });
export const threadResolveSchema = z.strictObject({ threadId: entityId, resolved: z.boolean() });

export type CommentAdd = z.infer<typeof commentAddSchema>;

/** What the workspace keeps about a thread, for the Mentions inbox. */
export interface ThreadIndexRow {
  threadId: string;
  label: string;
  resolved: boolean;
  createdBy: string;
  createdAt: number;
  lastTs: number;
  lastActor: string;
  /** The last comment's start, mention tokens intact, and who wrote it (not necessarily lastActor: a resolve is activity too). */
  lastExcerpt: string;
  lastCommentBy?: string;
  commentCount: number;
  mentions: string[];
  resolvedBy?: string;
  resolvedAt?: number;
}

/** A new mention, for notifying the person mentioned. */
export interface MentionNotice {
  email: string;
  threadId: string;
  commentId: string;
  actor: string;
  ts: number;
  label: string;
  /** The comment's start, mention tokens intact. */
  excerpt: string;
}

/** The start of a body, tokens intact (shown later with names, via `excerpt`). */
export function rawExcerpt(body: string, max = 300): string {
  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  const open = cut.lastIndexOf('<@');
  return `${open > cut.lastIndexOf('>') ? cut.slice(0, open) : cut}…`;
}

export function indexRow(plan: PlanData, t: Thread): ThreadIndexRow {
  const last = lastActivity(t);
  const live = liveComments(t);
  const lastComment = live[live.length - 1];
  return {
    threadId: t.id,
    label: anchorLabel(plan, t.anchor),
    resolved: isResolved(t),
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    lastTs: last.ts,
    lastActor: last.actor,
    lastExcerpt: lastComment ? rawExcerpt(lastComment.body) : '',
    ...(lastComment ? { lastCommentBy: lastComment.author } : {}),
    commentCount: live.length,
    mentions: threadMentions(t),
    ...(t.resolvedAt !== undefined ? { resolvedAt: t.resolvedAt, resolvedBy: t.resolvedBy ?? '' } : {}),
  };
}

import { DurableObject } from 'cloudflare:workers';
import type { UserRole } from '../src/domain/permissions';
import type { MentionNotice, ThreadIndexRow } from '../src/domain/comments';
import { mailEnabled, owners, parseSender, roomStub, type Env } from './env';
import { mentionEmail } from './mail';
import type { ActivityRow } from './roomEngine';
import { doSql } from './doSql';
import { WorkspaceEngine, type ActivityQuery, type DefaultRole, type MentionStatus } from './workspaceEngine';

/** Email Service errors worth trying again. */
const RETRYABLE = new Set(['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_INTERNAL_SERVER_ERROR', 'E_DELIVERY_FAILED']);

/** The single workspace object: people and roles, the plan list, and the consolidated activity log. */
export class Workspace extends DurableObject<Env> {
  private engine?: WorkspaceEngine;

  private get ws(): WorkspaceEngine {
    this.engine ??= new WorkspaceEngine(doSql(this.ctx), owners(this.env));
    return this.engine;
  }

  touchUser(email: string, name: string) {
    return this.ws.touchUser(email, name);
  }

  users() {
    return this.ws.users();
  }

  defaultRole() {
    return this.ws.defaultRole;
  }

  setDefaultRole(actor: string, role: DefaultRole) {
    this.ws.setDefaultRole(actor, role);
  }

  /** Changes a role or access, and tells every open plan so connected browsers update at once. */
  async updateUser(actor: string, email: string, patch: { role?: UserRole; disabled?: boolean }) {
    const user = this.ws.updateUser(actor, email, patch);
    await this.broadcastRole(email, user.disabled ? null : user.role);
    return user;
  }

  inviteUser(actor: string, email: string, role: UserRole) {
    return this.ws.inviteUser(actor, email, role);
  }

  plans(includeArchived: boolean) {
    return this.ws.plans(includeArchived);
  }

  plan(id: string) {
    return this.ws.plan(id);
  }

  abandonPlan(id: string) {
    this.ws.abandonPlan(id);
  }

  createPlan(actor: string, name: string, note?: string) {
    return this.ws.createPlan(actor, name, note);
  }

  async renamePlan(actor: string, id: string, name: string) {
    const plan = this.ws.renamePlan(actor, id, name);
    await roomStub(this.env, id).setMeta(plan.name, !!plan.archivedAt);
    return plan;
  }

  async setArchived(actor: string, id: string, archived: boolean) {
    const plan = this.ws.setArchived(actor, id, archived);
    await roomStub(this.env, id).setMeta(plan.name, !!plan.archivedAt);
    return plan;
  }

  recordActivity(rows: ActivityRow[]) {
    this.ws.recordActivity(rows);
  }

  activity(query: ActivityQuery) {
    return this.ws.activity(query);
  }

  clearActivity(planId: string) {
    this.ws.clearActivity(planId);
  }

  // ── comments ──

  people() {
    return this.ws.people();
  }

  async indexThreads(planId: string, threads: ThreadIndexRow[], notices: MentionNotice[], retracted: string[]) {
    const next = this.ws.indexThreads(planId, threads, notices, retracted, mailEnabled(this.env));
    if (next !== null) await this.scheduleMail(next);
  }

  mentions(email: string, q: { status?: MentionStatus; cursor?: string; limit?: number }) {
    return { ...this.ws.mentions(email, q), counts: this.ws.mentionCounts(email) };
  }

  mentionCounts(email: string) {
    return this.ws.mentionCounts(email);
  }

  markRead(email: string, planId: string, threadId: string) {
    this.ws.markRead(email, planId, threadId);
  }

  prefs(email: string) {
    return { mentionEmails: this.ws.mentionEmails(email), mail: mailEnabled(this.env) };
  }

  setMentionEmails(email: string, on: boolean) {
    this.ws.setMentionEmails(email, on);
    return this.prefs(email);
  }

  private async scheduleMail(at: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || at < current) await this.ctx.storage.setAlarm(at);
  }

  /** Sends the mention emails that are due. */
  async alarm() {
    if (!mailEnabled(this.env)) return;
    const env = this.env;
    for (const d of this.ws.dueMail()) {
      const ids = d.items.map((i) => i.commentId);
      const { subject, text, html } = mentionEmail(d, env.APP_URL!);
      try {
        await env.EMAIL!.send({ from: parseSender(env.MAIL_FROM!), to: { email: d.email, name: d.name }, subject, text, html });
        this.ws.mailDone(d.email, ids);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        console.error('Mention email failed', code, (err as Error).message);
        if (RETRYABLE.has(code)) this.ws.mailRetry(d.email, ids);
        else this.ws.mailDone(d.email, ids);
      }
    }
    const next = this.ws.nextMailAt();
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  private async broadcastRole(email: string, role: UserRole | null) {
    await Promise.allSettled(this.ws.plans().map((p) => roomStub(this.env, p.id).setUserRole(email, role)));
  }
}

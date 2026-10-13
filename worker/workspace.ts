import { DurableObject } from 'cloudflare:workers';
import type { UserRole } from '../src/domain/permissions';
import { owners, roomStub, type Env } from './env';
import type { ActivityRow } from './roomEngine';
import { doSql } from './doSql';
import { WorkspaceEngine, type ActivityQuery, type DefaultRole } from './workspaceEngine';

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

  private async broadcastRole(email: string, role: UserRole | null) {
    await Promise.allSettled(this.ws.plans().map((p) => roomStub(this.env, p.id).setUserRole(email, role)));
  }
}

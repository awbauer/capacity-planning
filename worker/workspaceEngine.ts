import { sameName } from '../src/domain/plans';
import type { UserRole } from '../src/domain/permissions';
import type { Me } from '../src/domain/protocol';
import type { ActivityRow } from './roomEngine';
import { metaGet, metaSet, migrate, one, type Sql, type SqlValue } from './sql';

const MIGRATIONS = [
  `
  CREATE TABLE users (
    email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, last_seen_at INTEGER);
  CREATE TABLE plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, archived_at INTEGER);
  CREATE TABLE activity (
    batch_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, epoch INTEGER NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
    actor TEXT NOT NULL, op TEXT NOT NULL, summary TEXT NOT NULL, change_count INTEGER NOT NULL, revert_of TEXT);
  CREATE INDEX activity_ts ON activity (ts DESC, batch_id);
  CREATE INDEX activity_plan ON activity (plan_id, ts DESC);
  CREATE INDEX activity_actor ON activity (actor, ts DESC);
  CREATE TABLE activity_refs (kind TEXT NOT NULL, ref_id TEXT NOT NULL, batch_id TEXT NOT NULL, PRIMARY KEY (kind, ref_id, batch_id));
  `,
];

/** Who new people get when they first sign in: a role, or no access until an admin grants one. */
export type DefaultRole = UserRole | 'none';

export interface UserRow {
  email: string;
  name: string;
  role: UserRole;
  disabled: boolean;
  owner: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface PlanRow {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
}

export interface ActivityEntry {
  batchId: string;
  planId: string;
  /** '' for workspace events (roles, plans). */
  planName: string;
  seq: number;
  ts: number;
  actor: string;
  op: string;
  summary: string;
  changeCount: number;
  revertOf: string | null;
}

export interface ActivityQuery {
  planId?: string;
  actor?: string;
  /** A workstream or person id the change touched. */
  ref?: string;
  op?: string;
  from?: number;
  to?: number;
  q?: string;
  /** Opaque cursor from the previous page. */
  cursor?: string;
  limit?: number;
  /** Include workspace events (admins only). */
  workspace?: boolean;
}

const toUser = (r: Record<string, SqlValue>, owners: Set<string>): UserRow => ({
  email: String(r.email),
  name: String(r.name),
  role: owners.has(String(r.email)) ? 'admin' : (String(r.role) as UserRole),
  disabled: !owners.has(String(r.email)) && Number(r.disabled) === 1,
  owner: owners.has(String(r.email)),
  createdAt: Number(r.created_at),
  lastSeenAt: r.last_seen_at === null ? null : Number(r.last_seen_at),
});

const toPlan = (r: Record<string, SqlValue>): PlanRow => ({
  id: String(r.id),
  name: String(r.name),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
  archivedAt: r.archived_at === null ? null : Number(r.archived_at),
});

/** Last-seen is only written when it's this stale, to keep sign-ins cheap. */
const SEEN_EVERY_MS = 5 * 60_000;

/**
 * The workspace: who can do what, the list of plans, and an index of every
 * change in every plan (the consolidated activity log). Runs in the single
 * Workspace Durable Object.
 */
export class WorkspaceEngine {
  private readonly sql: Sql;
  private readonly owners: Set<string>;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(sql: Sql, owners: Set<string>, now: () => number = Date.now, newId: () => string = () => crypto.randomUUID()) {
    this.sql = sql;
    this.owners = owners;
    this.now = now;
    this.newId = newId;
    migrate(sql, MIGRATIONS);
  }

  get defaultRole(): DefaultRole {
    return (metaGet(this.sql, 'default_role') as DefaultRole | undefined) ?? 'viewer';
  }

  setDefaultRole(actor: string, role: DefaultRole) {
    if (role === this.defaultRole) return;
    metaSet(this.sql, 'default_role', role);
    this.event(actor, 'settings', `Set the role for new people to ${role === 'none' ? 'no access' : role}`);
  }

  /** Records a sign-in and returns who they are, creating them with the default role the first time. */
  touchUser(email: string, name: string): Me & { disabled: boolean } {
    const now = this.now();
    let row = one(this.sql.all('SELECT * FROM users WHERE email = ?', email));
    if (!row) {
      const def = this.defaultRole;
      this.sql.all(
        'INSERT INTO users (email, name, role, disabled, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
        email,
        name || email,
        def === 'none' ? 'viewer' : def,
        def === 'none' && !this.owners.has(email) ? 1 : 0,
        now,
        now,
      );
      row = one(this.sql.all('SELECT * FROM users WHERE email = ?', email))!;
    } else if (row.last_seen_at === null || now - Number(row.last_seen_at) > SEEN_EVERY_MS || (name && name !== row.name)) {
      this.sql.all('UPDATE users SET last_seen_at = ?, name = ? WHERE email = ?', now, name || String(row.name), email);
    }
    const u = toUser(row, this.owners);
    return { email: u.email, name: name || u.name, role: u.role, owner: u.owner, disabled: u.disabled };
  }

  user(email: string): UserRow | undefined {
    const row = one(this.sql.all('SELECT * FROM users WHERE email = ?', email));
    return row ? toUser(row, this.owners) : undefined;
  }

  users(): UserRow[] {
    return this.sql.all('SELECT * FROM users ORDER BY name COLLATE NOCASE').map((r) => toUser(r, this.owners));
  }

  /** Changes someone's role or access. Owners (OWNER_EMAILS) can't be changed. Returns the updated user. */
  updateUser(actor: string, email: string, patch: { role?: UserRole; disabled?: boolean }): UserRow {
    if (this.owners.has(email)) throw new Error(`${email} is a workspace owner (OWNER_EMAILS) and is always an admin.`);
    const before = this.user(email);
    if (!before) throw new Error(`No one with the email ${email} has signed in yet.`);
    const role = patch.role ?? before.role;
    const disabled = patch.disabled ?? before.disabled;
    this.sql.all('UPDATE users SET role = ?, disabled = ? WHERE email = ?', role, disabled ? 1 : 0, email);
    const parts = [
      role !== before.role && `changed ${email} from ${before.role} to ${role}`,
      disabled !== before.disabled && `${disabled ? 'removed access for' : 'restored access for'} ${email}`,
    ].filter(Boolean);
    if (parts.length) this.event(actor, 'user', parts.join('; ').replace(/^./, (c) => c.toUpperCase()));
    return this.user(email)!;
  }

  /** Adds someone before they've signed in, so they get a role other than the default. */
  inviteUser(actor: string, email: string, role: UserRole): UserRow {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new Error('That isn’t an email address.');
    // Role changes go through updateUser (which open connections hear about), never through an invite.
    if (this.user(clean)) throw new Error(`${clean} already has an account; change their role or access in the table.`);
    this.sql.all(
      'INSERT INTO users (email, name, role, disabled, created_at, last_seen_at) VALUES (?, ?, ?, 0, ?, NULL)',
      clean,
      clean,
      role,
      this.now(),
    );
    this.event(actor, 'user', `Added ${clean} as ${role}`);
    return this.user(clean)!;
  }

  /**
   * Removes a plan created moments ago whose content then failed to save
   * (it has no history yet), along with its "created" event.
   */
  abandonPlan(id: string) {
    this.sql.transaction(() => {
      const events = this.sql.all<{ batch_id: string }>(
        "SELECT batch_id FROM activity_refs WHERE kind = 'plan' AND ref_id = ?",
        id,
      );
      for (const e of events) {
        this.sql.all("DELETE FROM activity WHERE batch_id = ? AND plan_id = ''", e.batch_id);
        this.sql.all('DELETE FROM activity_refs WHERE batch_id = ?', e.batch_id);
      }
      this.sql.all('DELETE FROM plans WHERE id = ?', id);
    });
  }

  plans(includeArchived = false): PlanRow[] {
    return this.sql
      .all(`SELECT * FROM plans ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name COLLATE NOCASE`)
      .map(toPlan);
  }

  plan(id: string): PlanRow | undefined {
    const row = one(this.sql.all('SELECT * FROM plans WHERE id = ?', id));
    return row ? toPlan(row) : undefined;
  }

  private nameTaken(name: string, exceptId?: string) {
    return this.plans().some((p) => p.id !== exceptId && sameName(p.name, name));
  }

  createPlan(actor: string, name: string, note?: string): PlanRow {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) throw new Error('A plan needs a name.');
    if (this.nameTaken(trimmed)) throw new Error(`A plan called “${trimmed}” already exists.`);
    const id = this.newId();
    this.sql.all('INSERT INTO plans (id, name, created_by, created_at) VALUES (?, ?, ?, ?)', id, trimmed, actor, this.now());
    this.event(actor, 'plan', `Created plan “${trimmed}”${note ? ` ${note}` : ''}`, id);
    return this.plan(id)!;
  }

  renamePlan(actor: string, id: string, name: string): PlanRow {
    const plan = this.plan(id);
    if (!plan) throw new Error('No such plan.');
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed) throw new Error('A plan needs a name.');
    if (this.nameTaken(trimmed, id)) throw new Error(`A plan called “${trimmed}” already exists.`);
    if (trimmed === plan.name) return plan;
    this.sql.all('UPDATE plans SET name = ? WHERE id = ?', trimmed, id);
    this.event(actor, 'plan', `Renamed plan “${plan.name}” to “${trimmed}”`, id);
    return this.plan(id)!;
  }

  setArchived(actor: string, id: string, archived: boolean): PlanRow {
    const plan = this.plan(id);
    if (!plan) throw new Error('No such plan.');
    if (!archived && this.nameTaken(plan.name, id)) throw new Error(`Another plan is now called “${plan.name}”; rename it first.`);
    if (!!plan.archivedAt === archived) return plan;
    this.sql.all('UPDATE plans SET archived_at = ? WHERE id = ?', archived ? this.now() : null, id);
    this.event(actor, 'plan', `${archived ? 'Archived' : 'Restored'} plan “${plan.name}”`, id);
    return this.plan(id)!;
  }

  /** Adds batches to the activity index. Idempotent: rows already there are left as they are. */
  recordActivity(rows: ActivityRow[]) {
    this.sql.transaction(() => {
      for (const r of rows) {
        this.sql.all(
          `INSERT OR IGNORE INTO activity (batch_id, plan_id, epoch, seq, ts, actor, op, summary, change_count, revert_of)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.batchId,
          r.planId,
          r.epoch,
          r.seq,
          r.ts,
          r.actor,
          r.op,
          r.summary.slice(0, 1000),
          r.changeCount,
          r.revertOf ?? null,
        );
        for (const id of r.projectIds) this.sql.all('INSERT OR IGNORE INTO activity_refs VALUES (?, ?, ?)', 'project', id, r.batchId);
        for (const id of r.resourceIds) this.sql.all('INSERT OR IGNORE INTO activity_refs VALUES (?, ?, ?)', 'resource', id, r.batchId);
      }
    });
  }

  /** The consolidated change log, newest first, a page at a time. */
  activity(query: ActivityQuery): { entries: ActivityEntry[]; next?: string } {
    const where: string[] = [];
    const binds: SqlValue[] = [];
    if (!query.workspace) where.push("a.plan_id <> ''");
    if (query.planId !== undefined) {
      where.push('a.plan_id = ?');
      binds.push(query.planId);
    }
    if (query.actor) {
      where.push('a.actor = ?');
      binds.push(query.actor);
    }
    if (query.op) {
      where.push('a.op = ?');
      binds.push(query.op);
    }
    if (query.from !== undefined) {
      where.push('a.ts >= ?');
      binds.push(query.from);
    }
    if (query.to !== undefined) {
      where.push('a.ts < ?');
      binds.push(query.to);
    }
    if (query.q) {
      where.push("a.summary LIKE ? ESCAPE '\\'");
      binds.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (query.ref) {
      where.push('a.batch_id IN (SELECT batch_id FROM activity_refs WHERE ref_id = ?)');
      binds.push(query.ref);
    }
    if (query.cursor) {
      const [ts, id] = query.cursor.split('~');
      where.push('(a.ts < ? OR (a.ts = ? AND a.batch_id < ?))');
      binds.push(Number(ts), Number(ts), id ?? '');
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 1000);
    const rows = this.sql.all(
      `SELECT a.*, COALESCE(p.name, '') AS plan_name FROM activity a LEFT JOIN plans p ON p.id = a.plan_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.ts DESC, a.batch_id DESC LIMIT ?`,
      ...binds,
      limit + 1,
    );
    const entries = rows.slice(0, limit).map((r) => ({
      batchId: String(r.batch_id),
      planId: String(r.plan_id),
      planName: String(r.plan_name),
      seq: Number(r.seq),
      ts: Number(r.ts),
      actor: String(r.actor),
      op: String(r.op),
      summary: String(r.summary),
      changeCount: Number(r.change_count),
      revertOf: r.revert_of === null ? null : String(r.revert_of),
    }));
    const last = entries[entries.length - 1];
    return { entries, ...(rows.length > limit && last ? { next: `${last.ts}~${last.batchId}` } : {}) };
  }

  /** Drops a plan's index entries (before reindexing it from the plan itself). */
  clearActivity(planId: string) {
    this.sql.transaction(() => {
      this.sql.all('DELETE FROM activity_refs WHERE batch_id IN (SELECT batch_id FROM activity WHERE plan_id = ?)', planId);
      this.sql.all('DELETE FROM activity WHERE plan_id = ?', planId);
    });
  }

  /** A workspace-level event (roles, plans, settings) in the activity log. */
  private event(actor: string, op: string, summary: string, planRef?: string) {
    const batchId = this.newId();
    this.sql.all(
      `INSERT INTO activity (batch_id, plan_id, epoch, seq, ts, actor, op, summary, change_count, revert_of)
       VALUES (?, '', 0, 0, ?, ?, ?, ?, 0, NULL)`,
      batchId,
      this.now(),
      actor,
      op,
      summary,
    );
    if (planRef) this.sql.all('INSERT OR IGNORE INTO activity_refs VALUES (?, ?, ?)', 'plan', planRef, batchId);
  }
}

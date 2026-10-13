import { DurableObject } from 'cloudflare:workers';
import { colorFor } from '../src/domain/colors';
import type { EntityKind } from '../src/domain/diff';
import { newLockSchema } from '../src/domain/opSchema';
import type { UserRole } from '../src/domain/permissions';
import {
  CLOSE,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type ClientMsg,
  type Presence,
  type ServerMsg,
} from '../src/domain/protocol';
import type { PlanData } from '../src/domain/types';
import { toWeekKey } from '../src/domain/weeks';
import { doSql } from './doSql';
import { workspaceStub, type Env } from './env';
import { RoomEngine, type Result, type User } from './roomEngine';

/** What each connection carries through hibernation. */
interface Conn {
  connId: string;
  email: string;
  name: string;
  role: UserRole;
  owner: boolean;
  /** Access token expiry (epoch ms). */
  exp: number;
  color: string;
  ready: boolean;
  view?: string;
  sel?: Presence['sel'];
}


/** Retry flushing the activity index this long after a failure. */
const FLUSH_RETRY_MS = 30_000;

/**
 * One plan: its state and change log (RoomEngine), and everyone who has it
 * open, over hibernating WebSockets. Edits are applied here one at a time,
 * so there's a single order everyone agrees on.
 */
export class PlanRoom extends DurableObject<Env> {
  private engine?: RoomEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private get room(): RoomEngine {
    this.engine ??= new RoomEngine(doSql(this.ctx));
    return this.engine;
  }

  private thisWeek(): string {
    const tz = this.env.TIMEZONE || 'UTC';
    let ymd: string;
    try {
      ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch {
      ymd = new Date().toISOString().slice(0, 10);
    }
    const [y, m, d] = ymd.split('-').map(Number);
    return toWeekKey(new Date(y, m - 1, d));
  }

  // ── WebSocket connections ──

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const h = (k: string) => request.headers.get(k) ?? '';
    this.room.setPlanId(h('X-Plan-Id'));
    const [client, server] = Object.values(new WebSocketPair());
    const email = h('X-User-Email');
    const conn: Conn = {
      connId: crypto.randomUUID(),
      email,
      name: decodeURIComponent(h('X-User-Name')) || email,
      role: h('X-User-Role') as UserRole,
      owner: h('X-User-Owner') === '1',
      exp: Number(h('X-User-Exp')) || Date.now() + 3600_000,
      color: colorFor(email),
      ready: false,
    };
    this.ctx.acceptWebSocket(server, [`u:${email}`]);
    server.serializeAttachment(conn);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const conn = ws.deserializeAttachment() as Conn;
    if (Date.now() > conn.exp) {
      ws.close(CLOSE.sessionExpired, 'Your sign-in expired');
      return;
    }
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) {
      ws.close(1009, 'Message too large');
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data) as ClientMsg;
    } catch {
      return;
    }
    try {
      await this.handle(ws, conn, msg);
    } catch (err) {
      // Never leave a browser waiting: a failed change is reported back as rejected.
      console.error('PlanRoom message failed', err);
      if ('cid' in msg && typeof msg.cid === 'string') {
        this.send(ws, { t: 'rejected', cid: msg.cid, code: 'invalid', msg: 'The server couldn’t apply that change.' });
      }
    }
  }

  private async handle(ws: WebSocket, conn: Conn, msg: ClientMsg) {
    const user: User = { email: conn.email, name: conn.name, role: conn.role };
    switch (msg.t) {
      case 'hello': {
        if (msg.proto !== PROTOCOL_VERSION) {
          ws.close(CLOSE.protocol, 'The app was updated; reload');
          return;
        }
        const catchUp = this.room.catchUp(msg.epoch, msg.lastSeq);
        const meta = await this.planMeta();
        if (meta.archived) {
          ws.close(CLOSE.archived, 'This plan was archived');
          return;
        }
        this.send(ws, {
          t: 'welcome',
          proto: PROTOCOL_VERSION,
          you: { email: conn.email, name: conn.name, role: conn.role, owner: conn.owner, connId: conn.connId, color: conn.color },
          plan: { id: this.room.planId ?? '', name: meta.name, archived: meta.archived },
          epoch: this.room.epoch,
          seq: this.room.seq,
          ...catchUp,
          locks: this.room.locks(),
          presence: this.others(ws).filter((c) => c.ready).map(presenceOf),
          thisWeek: this.thisWeek(),
        });
        conn.ready = true;
        ws.serializeAttachment(conn);
        this.broadcast({ t: 'presence', presence: presenceOf(conn) }, ws);
        return;
      }
      case 'op':
        this.finish(ws, msg.cid, this.room.apply(user, msg.cid, msg.op, this.thisWeek()));
        return;
      case 'revert':
        this.finish(ws, msg.cid, this.room.revert(user, msg.cid, String(msg.batchId), this.thisWeek()));
        return;
      case 'lock.add': {
        const parsed = newLockSchema.safeParse(msg.lock);
        if (!parsed.success) {
          this.send(ws, { t: 'rejected', cid: msg.cid, code: 'invalid', msg: 'Invalid lock' });
          return;
        }
        this.finish(ws, msg.cid, this.room.addLock(user, msg.cid, parsed.data));
        return;
      }
      case 'lock.remove':
        this.finish(ws, msg.cid, this.room.removeLock(user, msg.cid, String(msg.id)));
        return;
      case 'presence': {
        conn.view = typeof msg.view === 'string' ? msg.view.slice(0, 40) : undefined;
        const sel = msg.sel;
        conn.sel =
          sel && Array.isArray(sel.roleIds) && typeof sel.from === 'string' && typeof sel.to === 'string'
            ? { roleIds: sel.roleIds.slice(0, 200).map(String), from: sel.from.slice(0, 10), to: sel.to.slice(0, 10) }
            : undefined;
        ws.serializeAttachment(conn);
        if (conn.ready) this.broadcast({ t: 'presence', presence: presenceOf(conn) }, ws);
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private leave(ws: WebSocket) {
    const conn = ws.deserializeAttachment() as Conn | null;
    if (conn) this.broadcast({ t: 'presence.leave', connId: conn.connId }, ws);
  }

  /** Sends the outcome of a change: to everyone if applied (with the cid only to its sender), else to the sender. */
  private finish(ws: WebSocket, cid: string, result: Result) {
    if (result.ok === 'dup' || result.ok === 'noop') {
      this.send(ws, { t: 'ack', cid, dup: true, seq: result.seq });
      return;
    }
    if (result.ok === false) {
      this.send(ws, { t: 'rejected', cid, code: result.code, msg: result.msg, ...(result.lockIds ? { lockIds: result.lockIds } : {}) });
      return;
    }
    const base: ServerMsg = {
      t: 'applied',
      seq: result.seq,
      batch: result.batch,
      puts: result.full ? [] : result.puts,
      ...(result.full ? { full: result.full } : {}),
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
    };
    const forOthers = JSON.stringify(base);
    for (const other of this.ctx.getWebSockets()) {
      const c = other.deserializeAttachment() as Conn | null;
      if (!c?.ready && other !== ws) continue;
      try {
        other.send(other === ws ? JSON.stringify({ ...base, cid }) : forOthers);
      } catch {
        // Closed in the meantime.
      }
    }
    if (result.locks) this.broadcast({ t: 'locks', locks: result.locks });
    this.ctx.waitUntil(this.flush());
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Closed in the meantime.
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const c = ws.deserializeAttachment() as Conn | null;
      if (!c?.ready) continue;
      try {
        ws.send(text);
      } catch {
        // Closed in the meantime.
      }
    }
  }

  private others(except: WebSocket): Conn[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except)
      .map((ws) => ws.deserializeAttachment() as Conn | null)
      .filter((c): c is Conn => !!c);
  }

  private async planMeta(): Promise<{ name: string; archived: boolean }> {
    const cached = await this.ctx.storage.get<{ name: string; archived: boolean }>('plan_meta');
    if (cached) return cached;
    const id = this.room.planId;
    const plan = id ? await workspaceStub(this.env).plan(id) : undefined;
    const meta = { name: plan?.name ?? 'Plan', archived: !!plan?.archivedAt };
    await this.ctx.storage.put('plan_meta', meta);
    return meta;
  }

  // ── activity index ──

  /** Sends batches not yet in the workspace's activity log; retries by alarm on failure. */
  private async flush() {
    try {
      for (;;) {
        const rows = this.room.activitySince(this.room.flushedSeq, 200);
        if (rows.length === 0) return;
        await workspaceStub(this.env).recordActivity(rows);
        this.room.flushedSeq = rows[rows.length - 1].seq;
      }
    } catch {
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + FLUSH_RETRY_MS);
    }
  }

  async alarm() {
    await this.flush();
  }

  // ── called by the Worker and the Workspace (RPC) ──

  /** Creates the plan's content (new plan or upload), recorded as one change by `actor`. */
  init(planId: string, actor: { email: string; name: string }, plan: PlanData | null, summary: string) {
    this.room.setPlanId(planId);
    if (plan) {
      const r = this.room.replacePlan({ ...actor, role: 'editor' }, plan, summary);
      if (r.ok === true) this.ctx.waitUntil(this.flush());
    }
    return { seq: this.room.seq };
  }

  history(q: { roleId: string; weeks?: string[] } | { kind: EntityKind; id: string }) {
    return this.room.history(q);
  }

  batch(batchId: string) {
    return this.room.batch(batchId) ?? null;
  }

  exportPlan() {
    return { plan: this.room.current(), seq: this.room.seq };
  }

  /** A role change from the workspace: update open connections, or close them if access was removed. */
  setUserRole(email: string, role: UserRole | null) {
    for (const ws of this.ctx.getWebSockets(`u:${email}`)) {
      if (role === null) {
        ws.close(CLOSE.forbidden, 'Your access was removed');
        continue;
      }
      const conn = ws.deserializeAttachment() as Conn;
      ws.serializeAttachment({ ...conn, role });
      this.send(ws, { t: 'role', role });
    }
  }

  async setMeta(name: string, archived: boolean) {
    await this.ctx.storage.put('plan_meta', { name, archived });
    if (archived) for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE.archived, 'This plan was archived');
    else this.broadcast({ t: 'meta', name, archived });
  }

  /** Rebuilds this plan's entries in the activity log from its own history. */
  async reindex() {
    const id = this.room.planId;
    if (!id) return;
    await workspaceStub(this.env).clearActivity(id);
    this.room.flushedSeq = 0;
    await this.flush();
  }
}

const presenceOf = (c: Conn): Presence => ({
  connId: c.connId,
  email: c.email,
  name: c.name,
  color: c.color,
  ...(c.view ? { view: c.view } : {}),
  ...(c.sel ? { sel: c.sel } : {}),
});

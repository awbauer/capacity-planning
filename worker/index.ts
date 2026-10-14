import type { Me } from '../src/domain/protocol';
import { checkReferences } from '../src/domain/schema';
import type { PlanData } from '../src/domain/types';
import { devAuthAllowed, identify, sameOrigin, type Identity } from './auth';
import { roomStub, workspaceStub, type Env } from './env';
import {
  activityQuery,
  body,
  createPlanBody,
  csvCell,
  fail,
  HttpError,
  inviteBody,
  json,
  patchPlanBody,
  patchUserBody,
  requireRole,
  settingsBody,
} from './http';

export { PlanRoom } from './planRoom';
export { Workspace } from './workspace';

type Ctx = { env: Env; me: Me; identity: Identity; url: URL; request: Request };

async function planOr404(env: Env, id: string) {
  const plan = await workspaceStub(env).plan(id);
  if (!plan) throw new HttpError(404, 'No such plan.');
  return plan;
}

async function route(c: Ctx): Promise<Response> {
  const { env, me, url, request } = c;
  const ws = workspaceStub(env);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const m = (re: RegExp) => path.match(re);

  if (path === '/api/me' && method === 'GET') {
    return json({ me, defaultRole: me.role === 'admin' ? await ws.defaultRole() : undefined });
  }

  if (path === '/api/plans' && method === 'GET') {
    const all = url.searchParams.get('archived') === '1' && me.role === 'admin';
    return json({ plans: await ws.plans(all) });
  }
  if (path === '/api/plans' && method === 'POST') {
    requireRole(me, 'editor');
    const b = await body(request, createPlanBody);
    const plan = b.plan as PlanData | undefined;
    const problem = plan && checkReferences(plan);
    if (problem) throw new HttpError(400, problem);
    const row = await ws.createPlan(me.email, b.name, b.note);
    try {
      await roomStub(env, row.id).init(row.id, { email: me.email, name: me.name }, plan ?? null, `Started plan “${row.name}”${b.note ? ` ${b.note}` : ''}`);
    } catch (err) {
      // Nothing was saved: don't leave an empty plan holding the name.
      await ws.abandonPlan(row.id);
      throw err;
    }
    return json({ plan: row }, 201);
  }

  let r = m(/^\/api\/plans\/([\w-]{1,64})$/);
  if (r && method === 'GET') return json({ plan: await planOr404(env, r[1]) });
  if (r && method === 'PATCH') {
    requireRole(me, 'admin');
    const b = await body(request, patchPlanBody);
    await planOr404(env, r[1]);
    let row = b.name ? await ws.renamePlan(me.email, r[1], b.name) : undefined;
    if (b.archived !== undefined) row = await ws.setArchived(me.email, r[1], b.archived);
    return json({ plan: row ?? (await ws.plan(r[1])) });
  }

  r = m(/^\/api\/plans\/([\w-]{1,64})\/ws$/);
  if (r && method === 'GET') {
    if (request.headers.get('Upgrade') !== 'websocket') return fail(426, 'Expected a WebSocket');
    const plan = await planOr404(env, r[1]);
    if (plan.archivedAt) return fail(410, 'This plan was archived.');
    // A fresh request: nothing the browser sent besides the upgrade reaches the room.
    const headers = new Headers({
      Upgrade: 'websocket',
      'X-Plan-Id': plan.id,
      'X-User-Email': me.email,
      'X-User-Name': encodeURIComponent(me.name),
      'X-User-Role': me.role,
      'X-User-Owner': me.owner ? '1' : '0',
      'X-User-Exp': String(c.identity.exp),
    });
    for (const k of ['Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Extensions', 'Sec-WebSocket-Protocol']) {
      const v = request.headers.get(k);
      if (v) headers.set(k, v);
    }
    return roomStub(env, plan.id).fetch(new Request(url.toString(), { headers }));
  }

  r = m(/^\/api\/plans\/([\w-]{1,64})\/history$/);
  if (r && method === 'GET') {
    await planOr404(env, r[1]);
    const p = url.searchParams;
    const roleId = p.get('roleId');
    const kind = p.get('kind');
    const id = p.get('id');
    const room = roomStub(env, r[1]);
    if (roleId) return json({ history: await room.history({ roleId, weeks: (p.get('weeks') ?? '').split(',').filter(Boolean) }) });
    if (kind && id && ['tag', 'seller', 'resource', 'project', 'role', 'settings'].includes(kind)) {
      return json({ history: await room.history({ kind: kind as 'project', id }) });
    }
    return fail(400, 'Give roleId (and weeks), or kind and id.');
  }

  r = m(/^\/api\/plans\/([\w-]{1,64})\/batches\/([\w-]{1,64})$/);
  if (r && method === 'GET') {
    await planOr404(env, r[1]);
    const b = await roomStub(env, r[1]).batch(r[2]);
    return b ? json(b) : fail(404, 'No such change.');
  }

  r = m(/^\/api\/plans\/([\w-]{1,64})\/export$/);
  if (r && method === 'GET') {
    const plan = await planOr404(env, r[1]);
    const { plan: data, seq } = await roomStub(env, r[1]).exportPlan();
    return json({ name: plan.name, revision: seq, ...data });
  }

  r = m(/^\/api\/plans\/([\w-]{1,64})\/reindex$/);
  if (r && method === 'POST') {
    requireRole(me, 'admin');
    await planOr404(env, r[1]);
    await roomStub(env, r[1]).reindex();
    return json({ ok: true });
  }

  if (path === '/api/activity' && method === 'GET') return json(await ws.activity(activityQuery(url, me)));
  if (path === '/api/activity.csv' && method === 'GET') {
    const q = { ...activityQuery(url, me), limit: 1000 };
    const lines = ['When (UTC),Plan,Who,What,Type,Changes'];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const { entries, next } = await ws.activity({ ...q, ...(cursor ? { cursor } : {}) });
      for (const e of entries) {
        lines.push([new Date(e.ts).toISOString(), e.planName || '(workspace)', e.actor, e.summary, e.op, e.changeCount].map(csvCell).join(','));
      }
      if (!next) break;
      cursor = next;
    }
    return new Response(lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (path === '/api/users' && method === 'GET') {
    requireRole(me, 'admin');
    return json({ users: await ws.users(), defaultRole: await ws.defaultRole() });
  }
  if (path === '/api/users' && method === 'POST') {
    requireRole(me, 'admin');
    const b = await body(request, inviteBody);
    return json({ user: await ws.inviteUser(me.email, b.email, b.role) }, 201);
  }
  r = m(/^\/api\/users\/([^/]{1,320})$/);
  if (r && method === 'PATCH') {
    requireRole(me, 'admin');
    const email = decodeURIComponent(r[1]).toLowerCase();
    if (email === me.email) throw new HttpError(400, 'You can’t change your own role or access.');
    return json({ user: await ws.updateUser(me.email, email, await body(request, patchUserBody)) });
  }
  if (path === '/api/settings' && method === 'PUT') {
    requireRole(me, 'admin');
    const b = await body(request, settingsBody);
    await ws.setDefaultRole(me.email, b.defaultRole);
    return json({ defaultRole: b.defaultRole });
  }

  return fail(404, 'Not found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // Local development only: sign in as anyone (see README).
    if (url.pathname === '/api/dev/login') {
      if (!devAuthAllowed(env, url)) return fail(404, 'Not found');
      const email = (url.searchParams.get('as') ?? '').trim().toLowerCase();
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.searchParams.get('next') ?? '/',
          'Set-Cookie': `dev_user=${encodeURIComponent(email)}; Path=/; SameSite=Lax${email ? '' : '; Max-Age=0'}`,
        },
      });
    }

    if (!sameOrigin(request)) return fail(403, 'Cross-site request blocked.');
    const auth = await identify(request, env);
    if (!auth.ok) return fail(auth.status, auth.msg);
    try {
      const me = await workspaceStub(env).touchUser(auth.identity.email, auth.identity.name);
      if (me.disabled) {
        return fail(403, `${me.email} doesn’t have access to the shared workspace. Ask an admin to add you.`);
      }
      const { disabled: _d, ...who } = me;
      return await route({ env, me: who, identity: auth.identity, url, request });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      const msg = err instanceof Error ? err.message : String(err);
      // Errors thrown by the workspace's own checks come back over RPC as plain errors.
      return fail(400, msg);
    }
  },
} satisfies ExportedHandler<Env>;

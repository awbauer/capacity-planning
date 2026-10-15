import { createMcpHandler } from '@modelcontextprotocol/server';
import { identify } from '../auth';
import { roomStub, workspaceStub, type Env } from '../env';
import { fail } from '../http';
import { weekInZone } from '../../src/domain/weeks';
import { buildServer, READ_TOOLS } from './server';
import { getContext, page, read } from './read';
import { person, resolve, workstream } from './resolve';
import type { Command } from './inputs';
const MAX_BYTES = 256 * 1024;
export async function handleMcp(request: Request, env: Env, ctx?: Pick<ExecutionContext, 'access'>): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail(403, 'Cross-site request blocked.');
  // Read incrementally: Content-Length is not trusted and may be absent.
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return fail(413, 'MCP body exceeds 256 KB.');
      }
      chunks.push(next.value);
    }
  }
  const auth = await identify(request, env, ctx);
  if (!auth.ok) return fail(auth.status, auth.msg);
  const ws = workspaceStub(env),
    me = await ws.touchUser(auth.identity.email, auth.identity.name);
  if (me.disabled) return fail(403, 'Your workspace access is disabled.');
  const user = { email: me.email, name: me.name, role: me.role };
  const execute = async (cmd: Command): Promise<unknown> => {
    const plans = await ws.plans(user.role === 'admin');
    const active = plans.filter((p) => !p.archivedAt);
    if (cmd.tool === 'get_context' && !cmd.args.plan && active.length !== 1) {
      const timeZone = await ws.timeZone();
      return {
        user,
        plans: page(plans, cmd.args.limit),
        thisWeek: weekInZone(timeZone),
        timeZone,
        allocationSteps: [0, 25, 50, 100],
        selectPlan: 'Provide plan (id or name) to get plan-specific context.',
      };
    }
    const plan = cmd.args.plan ? resolve(plans, cmd.args.plan, 'plan') : active.length === 1 ? active[0] : undefined;
    if (!plan)
      throw new Error(
        `Select a plan: ${
          active
            .slice(0, 10)
            .map((p) => `${p.name} (${p.id})`)
            .join(', ') || 'no active plans'
        }`,
      );
    const readOnly = (READ_TOOLS as readonly string[]).includes(cmd.tool);
    if (!readOnly && plan.archivedAt) throw new Error('Archived plans are read-only.');
    if (!readOnly && user.role === 'viewer' && cmd.tool !== 'comment') throw new Error('Viewers can’t edit.');
    const room = roomStub(env, plan.id);
    if (!readOnly) return room.command(user, cmd);
    const snapshot = await room.snapshot();
    if (cmd.tool === 'get_context')
      return {
        ...getContext(snapshot, user),
        plans: page(plans, cmd.args.limit),
      };
    if (cmd.tool === 'get_activity') {
      const a = cmd.args;
      if (a.mentions) {
        const result = await ws.mentions(user.email, {
          cursor: a.cursor,
          limit: a.limit,
        });
        return { ...result, truncated: !!result.next };
      }
      const ref = a.workstream
        ? workstream(snapshot.plan, a.workstream).id
        : a.person
          ? person(snapshot.plan, a.person, user).id
          : undefined;
      const result = await ws.activity({
        planId: plan.id,
        ref,
        cursor: a.cursor,
        limit: a.limit,
        workspace: user.role === 'admin',
      });
      return { ...result, truncated: !!result.next };
    }
    return read(snapshot, cmd, user);
  };
  const payload = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  const forwarded = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: payload }),
  });
  return createMcpHandler(() => buildServer({ user, execute })).fetch(forwarded);
}

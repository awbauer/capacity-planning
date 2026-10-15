import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { handleMcp } from './route';
import { createSamplePlan } from '../../src/domain/sampleData';
const sample = createSamplePlan('2026-10-12');
function env(disabled = false) {
  const touchUser = vi.fn(async (email: string, name: string) => ({
    email,
    name,
    role: 'viewer',
    disabled,
  }));
  const workspace = {
    touchUser,
    plans: async () => [{ id: 'one', name: 'One' }],
    timeZone: async () => 'UTC',
  };
  const room = {
    snapshot: async () => ({
      plan: sample,
      seq: 1,
      thisWeek: '2026-10-12',
      timeZone: 'UTC',
      threads: [],
      locks: [],
    }),
  };
  return {
    value: {
      DEV_AUTH: '1',
      WORKSPACE: { idFromName: () => 'ws', get: () => workspace },
      PLAN_ROOM: { idFromName: () => 'room', get: () => room },
    } as unknown as Env,
    touchUser,
  };
}
const request = (body = '{}', headers = {}) =>
  new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Dev-User': 'viewer@example.com',
      ...headers,
    },
    body,
  });
describe('MCP HTTP boundary', () => {
  it('blocks foreign origins and oversized bodies before authentication', async () => {
    const h = env();
    expect((await handleMcp(request('{}', { Origin: 'https://evil.test' }), h.value)).status).toBe(403);
    expect((await handleMcp(request('x'.repeat(256 * 1024 + 1)), h.value)).status).toBe(413);
    expect(h.touchUser).not.toHaveBeenCalled();
  });
  it('reads current access each request and refuses disabled people', async () => {
    const h = env(true);
    const res = await handleMcp(request(), h.value);
    expect(res.status).toBe(403);
    expect(res.headers.has('WWW-Authenticate')).toBe(false);
    expect(h.touchUser).toHaveBeenCalledWith('viewer@example.com', 'Viewer');
  });
  it('accepts an origin-less local MCP call and exposes viewer tools', async () => {
    const h = env();
    const res = await handleMcp(
      request(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      ),
      h.value,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('get_context');
    expect(h.touchUser).toHaveBeenCalledTimes(1);
  });
});

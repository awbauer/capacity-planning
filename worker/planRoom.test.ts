import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));
import { PlanRoom } from './planRoom';
import type { Env } from './env';
import { MAX_MESSAGE_BYTES } from '../src/domain/protocol';

afterEach(() => vi.unstubAllGlobals());

function harness(ready = false) {
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  const room = new PlanRoom({ setWebSocketAutoResponse: vi.fn() } as unknown as DurableObjectState, {} as Env);
  const ws = {
    deserializeAttachment: () => ({ email: 'editor@example.com', role: 'editor', exp: Date.now() + 60_000, ready }),
    close: vi.fn(),
    send: vi.fn(),
  } as unknown as WebSocket;
  return { room, ws };
}

describe('WebSocket input boundary', () => {
  it('ignores JSON primitives and arrays without throwing', async () => {
    const { room, ws } = harness();
    for (const value of [null, false, 42, 'hello', [], { t: null }]) {
      await expect(room.webSocketMessage(ws, JSON.stringify(value))).resolves.toBeUndefined();
    }
  });

  it('rejects missing or malformed mutation ids before touching storage', async () => {
    const { room, ws } = harness(true);
    for (const cid of [null, {}, [], '', 'x'.repeat(201)]) {
      await room.webSocketMessage(ws, JSON.stringify({ t: 'op', cid, op: { t: 'resource.delete', id: 'r1' } }));
    }
    expect(ws.close).toHaveBeenCalledTimes(5);
  });

  it('rejects malformed sync cursors before querying storage', async () => {
    const { room, ws } = harness();
    for (const lastSeq of ['1', {}, -1, 1.5]) {
      await room.webSocketMessage(ws, JSON.stringify({ t: 'hello', proto: 2, lastSeq }));
    }
    expect(ws.close).toHaveBeenCalledTimes(4);
  });

  it('measures message size as UTF-8 bytes, not JavaScript characters', async () => {
    const { room, ws } = harness(true);
    const message = JSON.stringify({ t: 'presence', view: '😀'.repeat(MAX_MESSAGE_BYTES / 4) });
    expect(message.length).toBeLessThan(MAX_MESSAGE_BYTES);
    await room.webSocketMessage(ws, message);
    expect(ws.close).toHaveBeenCalledWith(1009, 'Message too large');
  });

  it('does not accept edits before the protocol handshake', async () => {
    const { room, ws } = harness();
    await room.webSocketMessage(ws, JSON.stringify({ t: 'op', cid: 'c1', op: { t: 'resource.delete', id: 'r1' } }));
    expect(ws.close).toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** getMode() resolves once per page, so each test loads a fresh copy of the module against a fake window. */
async function load(search: string, saved?: string, override = false) {
  vi.resetModules();
  const local = new Map<string, string>(saved ? [['capacity-mode:v1', saved]] : []);
  const session = new Map<string, string>(override ? [['capacity-mode:local-this-session', '1']] : []);
  const store = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  const loc = { href: `https://app.test/plan${search}#x`, pathname: '/plan', search, hash: '#x', reload: vi.fn() };
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
    const u = new URL(url, 'https://app.test');
    loc.search = u.search;
    loc.href = `https://app.test${url}`;
  });
  vi.stubGlobal('window', { localStorage: store(local), sessionStorage: store(session), location: loc, history: { state: null, replaceState } });
  const mode = await import('./mode');
  return { mode, local, session, loc, replaceState };
}

describe('?sync= URL parameter', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('understands on/off and common spellings, and ignores anything else', () => {
    return load('').then(({ mode }) => {
      for (const v of ['on', 'ON', 'shared', '1', 'true']) expect(mode.parseSyncParam(v)).toBe('shared');
      for (const v of ['off', 'local', '0', 'false']) expect(mode.parseSyncParam(v)).toBe('local');
      for (const v of ['', 'maybe', null]) expect(mode.parseSyncParam(v)).toBeNull();
    });
  });

  it('turns sync on, saves it like the switch, and clears the param and the session override', async () => {
    const { mode, local, session, loc, replaceState } = await load('?sync=on&week=3', undefined, true);
    expect(mode.getMode()).toBe('shared');
    expect(local.get('capacity-mode:v1')).toBe('shared');
    expect(session.has('capacity-mode:local-this-session')).toBe(false);
    expect(loc.search).toBe('?week=3');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(loc.href.endsWith('#x')).toBe(true);
  });

  it('turns sync off for a browser that had it on', async () => {
    const { mode, local } = await load('?sync=off', 'shared');
    expect(mode.getMode()).toBe('local');
    expect(local.get('capacity-mode:v1')).toBe('local');
  });

  it('leaves the saved choice alone for an unknown value, but still removes the param', async () => {
    const { mode, local, loc } = await load('?sync=banana', 'shared');
    expect(mode.getMode()).toBe('shared');
    expect(local.get('capacity-mode:v1')).toBe('shared');
    expect(loc.search).toBe('');
  });

  it('does nothing without the param', async () => {
    const { mode, replaceState } = await load('?week=3', 'shared');
    expect(mode.getMode()).toBe('shared');
    expect(replaceState).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getTheme, THEME_KEY } from './theme';

const fakeStorage = (value: string | null) => ({ getItem: (k: string) => (k === THEME_KEY ? value : null) });

describe('theme preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to auto and ignores anything it does not know', () => {
    expect(getTheme()).toBe('auto'); // no window at all (Node)
    vi.stubGlobal('window', { localStorage: fakeStorage(null) });
    expect(getTheme()).toBe('auto');
    vi.stubGlobal('window', { localStorage: fakeStorage('purple') });
    expect(getTheme()).toBe('auto');
    vi.stubGlobal('window', { localStorage: fakeStorage('dark') });
    expect(getTheme()).toBe('dark');
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); } } });
    expect(getTheme()).toBe('auto');
  });

  it('forces light or dark on the page, and leaves auto to the system', () => {
    const root = { dataset: {} as DOMStringMap } as HTMLElement;
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    applyTheme('auto', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});

import { useSyncExternalStore } from 'react';

/** Auto follows the system's light/dark setting. Saved per browser, in both modes. */
export type Theme = 'auto' | 'light' | 'dark';

export const THEME_KEY = 'capacity-theme:v1';
const THEMES: Theme[] = ['auto', 'light', 'dark'];

const storage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export function getTheme(): Theme {
  let v: string | null | undefined;
  try {
    v = storage()?.getItem(THEME_KEY);
  } catch {
    v = undefined;
  }
  return THEMES.includes(v as Theme) ? (v as Theme) : 'auto';
}

/** Light or dark forces that theme; auto leaves it to the system (see styles.css and index.html). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

const listeners = new Set<() => void>();

export function setTheme(theme: Theme) {
  try {
    storage()?.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: it still applies to this page.
  }
  applyTheme(theme);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    applyTheme(getTheme());
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export const useTheme = (): Theme => useSyncExternalStore(subscribe, getTheme, () => 'auto');

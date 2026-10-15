/**
 * Shared by default; local plans remain available through Manage → Settings.
 */
export type AppMode = 'local' | 'shared';

export const MODE_KEY = 'capacity-mode:v1';
/** Session-only "work locally" override when the shared workspace can't be reached. */
export const LOCAL_OVERRIDE_KEY = 'capacity-mode:local-this-session';

const storage = (kind: 'localStorage' | 'sessionStorage'): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window[kind];
  } catch {
    return undefined;
  }
};

/** The mode the shared-workspace switch is set to in this browser. */
export function getPreferredMode(): AppMode {
  return storage('localStorage')?.getItem(MODE_KEY) === 'local' ? 'local' : 'shared';
}

/** `?sync=on|off` (also shared/local, 1/0, true/false) in the address bar. */
export const SYNC_PARAM = 'sync';

/** The mode a `?sync=` value asks for, or null when it isn't one we know. */
export function parseSyncParam(value: string | null): AppMode | null {
  switch (value?.trim().toLowerCase()) {
    case 'on':
    case 'shared':
    case '1':
    case 'true':
      return 'shared';
    case 'off':
    case 'local':
    case '0':
    case 'false':
      return 'local';
    default:
      return null;
  }
}

/**
 * Applies `?sync=` as the same per-browser switch as Manage → Settings, then
 * removes it from the address bar so a reload or a shared link doesn't keep
 * re-applying it. Runs before the mode is first read, so no reload is needed.
 */
function applySyncParam() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SYNC_PARAM)) return;
    const mode = parseSyncParam(url.searchParams.get(SYNC_PARAM));
    url.searchParams.delete(SYNC_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (!mode) return;
    storage('localStorage')?.setItem(MODE_KEY, mode);
    storage('sessionStorage')?.removeItem(LOCAL_OVERRIDE_KEY);
  } catch {
    // Without storage or history the param simply has no effect.
  }
}

let resolved: AppMode | undefined;

/** The mode this page runs in. Fixed for the page's lifetime; switching reloads. */
export function getMode(): AppMode {
  if (!resolved) {
    applySyncParam();
    const override = storage('sessionStorage')?.getItem(LOCAL_OVERRIDE_KEY) === '1' || isNoBackend();
    resolved = override ? 'local' : getPreferredMode();
  }
  return resolved;
}

export const hasExplicitMode = () => ['local', 'shared'].includes(storage('localStorage')?.getItem(MODE_KEY) ?? '');
export const isNoBackend = () => storage('sessionStorage')?.getItem(LOCAL_OVERRIDE_KEY) === 'no-backend';
export function noBackendThisSession() {
  storage('sessionStorage')?.setItem(LOCAL_OVERRIDE_KEY, 'no-backend');
  window.location.reload();
}

export const isShared = () => getMode() === 'shared';

/** Turns the shared workspace on or off for this browser, then reloads. */
export function setPreferredMode(mode: AppMode) {
  storage('localStorage')?.setItem(MODE_KEY, mode);
  storage('sessionStorage')?.removeItem(LOCAL_OVERRIDE_KEY);
  window.location.reload();
}

/** Uses this browser's plans for the rest of the session (shared workspace unreachable). */
export function workLocallyThisSession() {
  storage('sessionStorage')?.setItem(LOCAL_OVERRIDE_KEY, '1');
  window.location.reload();
}

/** True when the switch says shared but this session fell back to local. */
export function isLocalOverride(): boolean {
  return getPreferredMode() === 'shared' && getMode() === 'local';
}

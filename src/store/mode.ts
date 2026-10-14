/**
 * Local (default): plans live in this browser only, as before.
 * Shared: plans live in the shared workspace (opt-in per browser).
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
  return storage('localStorage')?.getItem(MODE_KEY) === 'shared' ? 'shared' : 'local';
}

let resolved: AppMode | undefined;

/** The mode this page runs in. Fixed for the page's lifetime; switching reloads. */
export function getMode(): AppMode {
  if (!resolved) {
    const override = storage('sessionStorage')?.getItem(LOCAL_OVERRIDE_KEY) === '1';
    resolved = !override && getPreferredMode() === 'shared' ? 'shared' : 'local';
  }
  return resolved;
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

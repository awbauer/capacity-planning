/** A failed call to the shared workspace. */
export class ApiError extends Error {
  readonly status: number;
  /** Access wants a fresh sign-in (it redirected the request). */
  readonly signIn: boolean;
  readonly noBackend: boolean;
  constructor(status: number, message: string, signIn = false, noBackend = false) {
    super(message);
    this.status = status;
    this.signIn = signIn;
    this.noBackend = noBackend;
  }
}

/**
 * Calls the shared workspace's API. Redirects aren't followed: Access
 * answers an expired session with a redirect to its login page, which a
 * fetch can't follow, so that's reported as `signIn`.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      redirect: 'manual',
      credentials: 'same-origin',
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the shared workspace.');
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new ApiError(401, 'Your sign-in has expired.', true);
  }
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('application/json')) {
    // e.g. the app's own index.html: no Worker behind /api (a static deploy, or `vite preview`).
    throw new ApiError(res.status >= 500 ? res.status : 0, 'The shared workspace isn’t available here.', false, true);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, res.status === 401);
  return body;
}

/** Downloads a file from the API (export, CSV). */
export async function apiDownload(path: string, filename: string) {
  const res = await fetch(path, { redirect: 'manual', credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

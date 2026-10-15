// Runs the browser end-to-end suites.
//   npm run test:e2e          against a running `npm run dev` (or BASE_URL)
//   npm run test:e2e:serve    starts a fresh dev server (clean local storage) and stops it after
// The shared-workspace suite needs DEV_AUTH=1 and OWNER_EMAILS=alice@example.com in .dev.vars
// (copied from .dev.vars.example when missing). Screenshots and downloads go to work/e2e/.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const BASE_URL = serve ? 'http://localhost:5173' : (process.env.BASE_URL || 'http://localhost:5173');
const out = path.join(root, 'work', 'e2e');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, BASE_URL }, ...opts });
    p.on('exit', (code) => resolve(code ?? 1));
  });

async function waitFor(url, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't come up`);
}

let server;
let stateDir;
if (serve) {
  // Refuse to run destructive shared-workspace tests against an existing dev session.
  let occupied = false;
  try { await fetch(BASE_URL); occupied = true; } catch { /* no server */ }
  if (occupied) throw new Error(`${BASE_URL} is already in use; stop that server before running --serve.`);
  if (!existsSync(path.join(root, '.dev.vars'))) copyFileSync(path.join(root, '.dev.vars.example'), path.join(root, '.dev.vars'));
  mkdirSync(path.join(root, 'work'), { recursive: true });
  stateDir = mkdtempSync(path.join(root, 'work', 'e2e-state-'));
  server = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true, env: { ...process.env, CAPACITY_E2E_STATE_DIR: stateDir } });
}
let code = 1;
try {
  await waitFor(BASE_URL);
  code = await run('node', ['e2e/local.e2e.cjs', out]);
  if (code === 0) code = await run('node', ['e2e/shared-workspace.e2e.cjs', out]);
  if (code === 0) code = await run('node', ['e2e/adversarial.e2e.cjs', out]);
  if (code === 0) code = await run('node', ['e2e/mcp-cards.e2e.cjs', out]);
} finally {
  if (server) {
    if (server.exitCode === null && server.signalCode === null) {
      process.kill(-server.pid, 'SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
    }
  }
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
}
process.exit(code);

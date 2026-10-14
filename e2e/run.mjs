// Runs the browser end-to-end suites.
//   npm run test:e2e          against a running `npm run dev` (or BASE_URL)
//   npm run test:e2e:serve    starts a fresh dev server (clean local storage) and stops it after
// The shared-workspace suite needs DEV_AUTH=1 and OWNER_EMAILS=alice@example.com in .dev.vars
// (copied from .dev.vars.example when missing). Screenshots go to e2e/shots/.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const out = path.join(root, 'e2e');

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
if (serve) {
  if (!existsSync(path.join(root, '.dev.vars'))) copyFileSync(path.join(root, '.dev.vars.example'), path.join(root, '.dev.vars'));
  rmSync(path.join(root, '.wrangler', 'state'), { recursive: true, force: true });
  server = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
}
let code = 1;
try {
  await waitFor(BASE_URL);
  code = await run('node', ['e2e/local.e2e.cjs', out]);
  if (code === 0) code = await run('node', ['e2e/shared-workspace.e2e.cjs', out]);
} finally {
  if (server) process.kill(-server.pid, 'SIGTERM');
}
process.exit(code);

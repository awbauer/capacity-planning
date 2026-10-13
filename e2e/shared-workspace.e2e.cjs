const { chromium } = require('playwright');
const path = require('path');
// Usage: start `npm run dev` with DEV_AUTH=1 and OWNER_EMAILS=alice@example.com in .dev.vars (fresh .wrangler/state),
// then: NODE_PATH=$(npm root -g) node e2e/shared-workspace.e2e.cjs <screenshot-dir>
// Uses a globally installed Playwright and Chromium (not a project dependency).
const SP = process.argv[2] || require('os').tmpdir();
require('fs').mkdirSync(path.join(SP, 'shots'), { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const shot = (page, name) => page.screenshot({ path: path.join(SP, 'shots', name + '.png') });
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('ok -', msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, msg, timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await fn()) return assert(true, msg);
    } catch {}
    if (Date.now() - t0 > timeout) return assert(false, msg);
    await sleep(100);
  }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function user(email, { shared = true } = {}) {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${email}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && !/WebSocket|Failed to load resource/.test(m.text()) && errors.push(`${email}: ${m.text()}`));
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (page.nextPrompt ?? d.defaultValue()) : undefined));
    page.apiCalls = 0;
    page.apiUrls = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/') && !r.url().includes('/api/dev/login')) { page.apiCalls++; page.apiUrls.push(r.url()); } });
    page.wsBlocked = false;
    await page.routeWebSocket((u) => u.pathname.startsWith('/api/plans/'), (ws) => (page.wsBlocked ? ws.close() : ws.connectToServer()));
    if (email) await page.goto(`${BASE}/api/dev/login?as=${encodeURIComponent(email)}`);
    else await page.goto(BASE);
    if (shared) {
      await page.evaluate((planId) => {
        localStorage.setItem('capacity-mode:v1', 'shared');
        if (planId) localStorage.setItem('capacity-collab:v1', JSON.stringify({ lastPlanId: planId, uploadOffered: true }));
      }, global.planId);
      await page.reload();
    }
    return page;
  }
  const row = (page, id) => page.locator(`[id="row-a:${id}"]`);
  const cell = (page, id, i) => row(page, id).locator('td.cell.edit').nth(i);
  const val = (loc) => loc.getAttribute('data-value').then(Number);

  // ── Local mode is untouched and makes no API calls ──
  const alice = await user('alice@example.com', { shared: false });
  await alice.getByRole('button', { name: 'Manage', exact: true }).click();
  await alice.getByRole('button', { name: 'Settings & data' }).click();
  await alice.getByRole('button', { name: 'Load sample data' }).click();
  await alice.waitForTimeout(300);
  assert(alice.apiCalls === 0, 'local mode: no API calls ' + JSON.stringify(alice.apiUrls));
  const localBefore = await alice.evaluate(() => localStorage.getItem('capacity-plan:v1'));
  await shot(alice, 'c01-local-settings');

  // ── Alice opts in; her browser's plans are offered for upload ──
  await alice.getByRole('switch', { name: 'Use the shared workspace in this browser' }).click();
  await alice.waitForSelector('text=Upload plans from this browser');
  await shot(alice, 'c02-upload-offer');
  await alice.getByRole('button', { name: 'Upload', exact: true }).click();
  await alice.waitForSelector('.toolbar');
  await alice.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  await alice.waitForSelector('.grid');
  assert((await alice.evaluate(() => localStorage.getItem('capacity-plan:v1'))) === localBefore, 'switching modes left local plans byte-for-byte unchanged');
  assert(await alice.locator('.mode-badge.mode-shared').count() === 1, 'toolbar shows Shared');
  await until(() => alice.locator('.conn-pill.conn-live').count().then((n) => n === 1), 'connected live');
  assert(await row(alice, 'sample-a1').count() === 1, 'uploaded plan opens with its roles');
  global.planId = await alice.evaluate(() => JSON.parse(localStorage.getItem('capacity-collab:v1')).lastPlanId);
  await shot(alice, 'c03-shared-grid');

  // ── Bob and Carol sign in: viewers by default ──
  const bob = await user('bob@example.com');
  const carol = await user('carol@example.com');
  for (const [p, n] of [[bob, 'bob'], [carol, 'carol']]) {
    await p.waitForSelector('.grid');
    assert(await p.locator('.app.view-only').count() === 1, `${n} starts read-only (viewer)`);
    assert(await p.getByRole('button', { name: '+ New workstream' }).count() === 0, `${n} sees no add buttons`);
  }
  const before = await val(cell(carol, 'sample-a1', 3));
  await cell(carol, 'sample-a1', 3).dblclick();
  await carol.waitForTimeout(300);
  assert((await val(cell(carol, 'sample-a1', 3))) === before, 'a viewer’s double-click changes nothing');
  await until(() => carol.locator('.toast').count().then((n) => n > 0), 'viewer is told they have view-only access');

  // Presence: everyone sees everyone.
  await until(() => alice.locator('.presence-bar .avatar').count().then((n) => n === 3), 'Alice sees Bob and Carol online');

  // ── Alice makes Bob an editor; it applies live ──
  await alice.getByRole('button', { name: 'Manage', exact: true }).click();
  await alice.getByRole('button', { name: 'People & access' }).click();
  await alice.getByLabel('Role for bob@example.com').selectOption('editor');
  await until(() => bob.locator('.app.view-only').count().then((n) => n === 0), 'Bob becomes an editor without reloading');
  await shot(alice, 'c04-users');
  await alice.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  await alice.waitForSelector('.grid');

  // ── Realtime edit ──
  const c3 = await val(cell(alice, 'sample-a1', 3));
  await cell(bob, 'sample-a1', 3).dblclick();
  const after = await val(cell(bob, 'sample-a1', 3));
  assert(after !== c3, `Bob's edit shows at once for Bob (${c3} → ${after})`);
  await until(() => val(cell(alice, 'sample-a1', 3)).then((v) => v === after), 'Alice sees Bob’s edit live');
  await until(() => cell(alice, 'sample-a1', 3).getAttribute('class').then((c) => c.includes('recent')), 'Alice’s grid marks the cell Bob changed');

  // Presence of a selection.
  await cell(bob, 'sample-a1', 5).click();
  await until(() => cell(alice, 'sample-a1', 5).getAttribute('class').then((c) => c.includes('presence')), 'Alice sees which cell Bob selected');
  await shot(alice, 'c05-presence-recent');

  // ── Per-user undo keeps others' later edits ──
  const a6 = await val(cell(alice, 'sample-a1', 6));
  await cell(alice, 'sample-a1', 6).dblclick();
  await until(() => val(cell(bob, 'sample-a1', 6)).then((v) => v !== a6), 'Bob sees Alice’s edit');
  await cell(bob, 'sample-a1', 7).dblclick();
  const b7 = await val(cell(bob, 'sample-a1', 7));
  await until(() => val(cell(alice, 'sample-a1', 7)).then((v) => v === b7), 'Alice sees Bob’s next edit');
  await alice.locator('.grid-scroll').focus();
  await alice.keyboard.press('Control+z');
  await until(() => val(cell(alice, 'sample-a1', 6)).then((v) => v === a6), 'Alice’s undo reverts her own edit');
  assert((await val(cell(alice, 'sample-a1', 7))) === b7, '…and keeps Bob’s later edit');
  await until(() => val(cell(bob, 'sample-a1', 6)).then((v) => v === a6), 'Bob sees the undo');

  // ── Locks ──
  alice.nextPrompt = 'SOW signed';
  await cell(alice, 'sample-a1', 4).click({ button: 'right' });
  await alice.waitForSelector('.cell-menu');
  await shot(alice, 'c06-cell-menu');
  await alice.locator('.cell-menu').getByRole('menuitem', { name: /Lock workstream/ }).click();
  await until(() => cell(bob, 'sample-a1', 4).getAttribute('class').then((c) => c.includes('locked')), 'Bob sees the workstream locked');
  const b4 = await val(cell(bob, 'sample-a1', 4));
  await cell(bob, 'sample-a1', 4).dblclick();
  await bob.waitForTimeout(400);
  assert((await val(cell(bob, 'sample-a1', 4))) === b4, 'Bob can’t change a locked cell');
  await until(() => bob.locator('.toast', { hasText: 'locked by alice@example.com' }).count().then((n) => n > 0), 'Bob is told who locked it and why');
  await shot(bob, 'c07-locked');
  await cell(alice, 'sample-a1', 4).dblclick();
  await until(() => val(cell(bob, 'sample-a1', 4)).then((v) => v !== b4), 'the lock’s owner can still edit');
  // Deleting someone in the locked workstream is refused (a cascade).
  bob.nextPrompt = undefined;

  // ── Cell history ──
  await cell(alice, 'sample-a1', 3).click({ button: 'right' });
  await alice.locator('.cell-menu').getByRole('menuitem', { name: /History of this cell/ }).click();
  await alice.waitForSelector('.history-item');
  assert(await alice.locator('.history-item', { hasText: 'bob@example.com' }).count() > 0, 'cell history shows Bob’s change');
  await shot(alice, 'c08-cell-history');
  await alice.keyboard.press('Escape');

  // ── Consolidated activity log ──
  await carol.getByRole('button', { name: 'Activity', exact: true }).click();
  await carol.waitForSelector('.activity-table');
  const lines = await carol.locator('.activity-row').allInnerTexts();
  assert(lines.some((l) => l.includes('bob@example.com') && l.includes('Set')), 'activity lists Bob’s edit');
  assert(lines.some((l) => l.includes('Locked workstream') && l.includes('SOW signed')), 'activity lists the lock with its note');
  assert(lines.some((l) => l.includes('Undid')), 'activity lists the undo');
  assert(!lines.some((l) => l.includes('Changed bob@example.com')), 'viewers don’t see workspace events');
  await carol.locator('.activity-row.clickable').first().click();
  await carol.waitForSelector('.change-list li');
  await shot(carol, 'c09-activity');

  // ── Demote Bob live: read-only again ──
  await alice.getByRole('button', { name: 'Manage', exact: true }).click();
  await alice.getByRole('button', { name: 'People & access' }).click();
  await alice.getByLabel('Role for bob@example.com').selectOption('viewer');
  await until(() => bob.locator('.app.view-only').count().then((n) => n === 1), 'demoting Bob makes him read-only at once');

  // ── Offline: edits queue and go out on reconnect; read-only after the grace period ──
  for (const p of [alice, carol]) {
    await p.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
    await p.waitForSelector('.grid');
  }
  alice.wsBlocked = true;
  await alice.evaluate(async () => (await import('/src/store/sharedPlanStore.ts')).getSession()['ws'].close());
  await until(() => alice.locator('.conn-pill.conn-offline').count().then((n) => n === 1), 'Alice shows as reconnecting');
  const v9 = await val(cell(carol, 'sample-a1', 9));
  await cell(alice, 'sample-a1', 9).dblclick();
  const mine9 = await val(cell(alice, 'sample-a1', 9));
  assert(mine9 !== v9, 'an edit while briefly offline shows for Alice at once');
  await sleep(800);
  assert((await val(cell(carol, 'sample-a1', 9))) === v9, '…but hasn’t reached Carol yet');
  alice.wsBlocked = false;
  await until(() => val(cell(carol, 'sample-a1', 9)).then((v) => v === mine9), 'the queued edit reaches Carol after reconnecting', 20000);
  await until(() => alice.locator('.conn-pill.conn-live').count().then((n) => n === 1), 'Alice is live again', 20000);
  alice.wsBlocked = true;
  await alice.evaluate(async () => (await import('/src/store/sharedPlanStore.ts')).getSession()['ws'].close());
  await until(() => alice.locator('.app.view-only').count().then((n) => n === 1), 'after 30s offline the grid goes read-only', 40000);
  await shot(alice, 'c11-offline-readonly');
  alice.wsBlocked = false;
  await until(() => alice.locator('.app.view-only').count().then((n) => n === 0), 'editing comes back with the connection', 40000);

  // ── Gate: the shared workspace unreachable ──
  const dave = await user('dave@example.com', { shared: false });
  await dave.evaluate(() => localStorage.setItem('capacity-mode:v1', 'shared'));
  await dave.route('**/api/me', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await dave.reload();
  await dave.waitForSelector('text=Can’t reach the shared workspace');
  await shot(dave, 'c10-unreachable');
  await dave.getByRole('button', { name: 'Work locally this session' }).click();
  await dave.waitForSelector('.grid, .empty');
  assert(await dave.locator('text=Local (this session)').count() === 1, 'working locally shows a Local (this session) badge');

  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

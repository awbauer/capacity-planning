const { chromium } = require('playwright');
const path = require('path');
// Shared workspace, three people: run with npm run test:e2e (see e2e/run.mjs). Needs DEV_AUTH=1 and
// OWNER_EMAILS=alice@example.com in .dev.vars and a fresh .wrangler/state.
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

  // ── A viewer on an empty workspace is told why they can't create a plan ──
  const zoe = await user('zoe@example.com');
  await zoe.waitForSelector('text=No plans in the shared workspace yet');
  assert(await zoe.getByText('zoe@example.com').count() > 0, 'the empty-workspace screen says who you are');
  assert(await zoe.getByText(/view-only access/).count() > 0, '…and that view-only access is why you can’t create plans');
  assert(await zoe.getByRole('button', { name: 'New plan…' }).count() === 0, 'viewers get no New plan button');
  await shot(zoe, 'c00-viewer-no-plans');
  await zoe.context().close();

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
    assert(await p.getByRole('button', { name: '+ Workstream', exact: true }).count() === 0, `${n} sees no add buttons`);
    assert(await p.locator('.bar-handle').count() === 0, `${n} gets no drag handles on bars`);
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

  // ── Editing a workstream through its dialog (it sends the whole workstream as the patch) ──
  await alice.getByRole('button', { name: 'Sales Cloud Rollout', exact: true }).click();
  await alice.getByRole('button', { name: 'Edit workstream' }).click();
  await alice.locator('dialog[open] input[required]').first().fill('Sales Cloud Rollout 2');
  await alice.getByRole('button', { name: 'Save', exact: true }).click();
  await until(() => bob.getByRole('button', { name: 'Sales Cloud Rollout 2', exact: true }).count().then((n) => n === 1), 'a workstream edited in its dialog reaches Bob');
  await alice.waitForTimeout(500);
  assert(await alice.getByRole('button', { name: 'Sales Cloud Rollout 2', exact: true }).count() > 0, '…and stays changed for Alice (not rolled back)');
  await alice.keyboard.press('Escape');

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

  // ── Comments: a thread on a cell, @mentions, the Mentions inbox, resolving ──
  await cell(alice, 'sample-a1', 2).click({ button: 'right' });
  await alice.locator('.cell-menu').getByRole('menuitem', { name: /Comment/ }).click();
  const box = alice.locator('.comments-panel textarea');
  await box.fill('Can we confirm this, @Bo');
  await alice.waitForSelector('.mention-list');
  await alice.keyboard.press('Enter');
  await box.pressSequentially('please?');
  await alice.keyboard.press('Control+Enter');
  await alice.waitForSelector('.comments-panel .comment');
  assert(await alice.locator('.comments-panel .mention', { hasText: '@Bob' }).count() === 1, 'a picked @mention shows as the person’s name');
  const threadId = await alice.locator('.comments-panel .thread[data-thread]').first().getAttribute('data-thread');
  await until(() => cell(alice, 'sample-a1', 2).locator('.comment-mark').count().then((n) => n === 1), 'the cell gets a comment marker');
  await until(() => cell(bob, 'sample-a1', 2).locator('.comment-mark').count().then((n) => n === 1), 'Bob sees the marker live');
  const mentionsTab = (p) => p.getByRole('button', { name: /^Mentions/ });
  await until(() => mentionsTab(bob).locator('.count-alert').innerText().then((t) => t === '1'), 'Bob’s Mentions badge shows 1', 10000);
  await shot(alice, 'c12-comment-thread');

  await mentionsTab(bob).click();
  await until(() => bob.locator('.mentions-table tr.unread').count().then((n) => n === 1), 'the thread is listed unresolved and unread');
  assert(await bob.getByRole('checkbox', { name: /Email me when I’m mentioned/ }).isChecked(), 'mention emails are on by default when the server sends them');
  await shot(bob, 'c13-mentions');
  await bob.locator('.mentions-table tr.unread').click();
  await bob.waitForSelector('.comments-panel .thread');
  assert(await bob.locator('.grid').count() === 1, 'opening it goes to the grid with the thread open');
  await until(() => mentionsTab(bob).locator('.count-alert').count().then((n) => n === 0), 'reading it clears the badge', 10000);
  await bob.locator('.comments-panel textarea').fill('Confirmed with the client.');
  await bob.getByRole('button', { name: 'Reply', exact: true }).click();
  await until(() => alice.locator('.comments-panel .comment').count().then((n) => n === 2), 'Alice sees Bob’s reply live');
  await bob.getByRole('button', { name: 'Resolve', exact: true }).click();
  await until(() => alice.locator('.comments-panel .thread.resolved').count().then((n) => n === 1), 'Alice sees the thread resolved');
  await until(() => cell(alice, 'sample-a1', 2).locator('.comment-mark').count().then((n) => n === 0), 'resolved threads leave no cell marker');
  await mentionsTab(bob).click();
  await bob.getByRole('button', { name: 'Resolved', exact: true }).click();
  await until(() => bob.locator('.mentions-table tbody tr').count().then((n) => n === 1), 'the thread moves to Bob’s Resolved tab');

  // A viewer comments on a row; authors edit and delete their own.
  await carol.getByRole('button', { name: 'Workstreams', exact: true }).first().click();
  await carol.waitForSelector('.grid');
  await row(carol, 'sample-a1').locator('.row-comment').click();
  assert(await carol.locator('.comments-panel .thread.resolved').count() === 1, 'a role’s comments include its cells’ threads');
  await carol.getByRole('textbox', { name: 'Start a new thread…' }).fill('Who covers this when Alex is out?');
  await carol.getByRole('button', { name: 'Comment', exact: true }).click();
  await until(() => row(alice, 'sample-a1').locator('.row-comment.has').count().then((n) => n === 1), 'a viewer can comment on a row; Alice sees its count');
  await alice.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await alice.locator('.comments-panel .comment textarea').fill('Can we confirm this one, @Bob?');
  await alice.getByRole('button', { name: 'Save', exact: true }).click();
  await until(() => alice.locator('.comments-panel .comment', { hasText: '(edited)' }).count().then((n) => n === 1), 'an edited comment says so');
  await alice.getByRole('button', { name: 'Close comments' }).click();
  const carolThread = carol.locator('.thread', { hasText: 'Who covers this' });
  const carolThreadId = await carolThread.getAttribute('data-thread');
  await carolThread.getByRole('textbox', { name: 'Reply…' }).fill('Also for December.');
  await carolThread.getByRole('button', { name: 'Reply', exact: true }).click();
  const ct = carol.locator(`.thread[data-thread="${carolThreadId}"]`);
  await until(() => ct.locator('.comment').count().then((n) => n === 2), 'Carol replies to her own thread');
  assert(await carol.locator('.thread.resolved').getByRole('button', { name: 'Edit', exact: true }).count() === 0, 'nobody else’s comments can be edited');
  await ct.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await until(() => ct.locator('.comment.deleted', { hasText: 'Comment deleted' }).count().then((n) => n === 1), 'a deleted comment leaves a placeholder');
  await ct.getByRole('button', { name: 'Delete', exact: true }).click();
  await until(() => row(alice, 'sample-a1').locator('.row-comment.has').count().then((n) => n === 0), 'a thread with every comment deleted no longer counts');
  await shot(carol, 'c14-row-comment');

  // The activity log has every comment change, with no Undo.
  await carol.getByRole('button', { name: 'Activity', exact: true }).click();
  await carol.waitForSelector('.activity-table');
  await until(
    () => carol.locator('.activity-row').allInnerTexts().then((l) => l.some((x) => x.includes('Commented on')) && l.some((x) => x.includes('Resolved the thread')) && l.some((x) => x.includes('Deleted a comment'))),
    'activity lists comments, resolving and deleting',
  );
  await carol.locator('.activity-row.clickable', { hasText: 'Commented on' }).first().click();
  await carol.waitForSelector('text=Open thread');
  assert(await carol.getByRole('button', { name: 'Undo this change' }).count() === 0, 'comment changes can’t be undone');

  // A link to the thread (as in a mention email) opens it.
  await bob.goto(`${BASE}/#comment=${global.planId}/${threadId}`);
  await bob.waitForSelector(`.comments-panel .thread[data-thread="${threadId}"]`);
  assert(!(await bob.evaluate(() => location.hash)), 'a comment link opens the thread (and leaves the address bar clean)');
  await bob.getByRole('button', { name: 'Close comments' }).click();

  // ── Workspace time zone: admins set it, everyone's open tab follows ──
  for (const p of [alice, carol]) {
    await p.getByRole('button', { name: 'Manage', exact: true }).click();
    await p.getByRole('button', { name: 'Settings & data' }).click();
  }
  const zoneSelect = (p) => p.getByLabel('Workspace time zone');
  assert((await zoneSelect(carol).inputValue()) === 'America/New_York', 'the time zone starts as America/New_York');
  assert(await zoneSelect(carol).isDisabled(), 'only admins can change the time zone');
  await zoneSelect(alice).selectOption('Asia/Tokyo');
  await until(() => zoneSelect(carol).inputValue().then((v) => v === 'Asia/Tokyo'), 'a new time zone reaches Carol’s open tab live');
  await alice.getByRole('button', { name: 'Activity', exact: true }).click();
  await alice.locator('.activity-filters select[aria-label="Plan"]').selectOption('');
  await until(() => alice.locator('.activity-row', { hasText: 'Set the workspace time zone to Asia/Tokyo' }).count().then((n) => n === 1), 'the change is in Activity');
  await shot(carol, 'c15-time-zone');
  await alice.getByRole('button', { name: 'Manage', exact: true }).click();
  await alice.getByRole('button', { name: 'Settings & data' }).click();
  await zoneSelect(alice).selectOption('America/New_York');
  await until(() => zoneSelect(carol).inputValue().then((v) => v === 'America/New_York'), 'and back');

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

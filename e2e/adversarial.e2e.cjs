const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE_URL || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const admin = await browser.newPage();
    await admin.goto(`${BASE}/api/dev/login?as=alice@example.com`);
    const result = await admin.evaluate(async () => {
      const call = (path, method = 'GET', body) => fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const malformed = [];
      for (const path of ['/api/activity?limit=NaN', '/api/activity?from=Infinity', '/api/mentions?limit=1.5', '/api/mentions?cursor=bad']) {
        malformed.push((await call(path)).status);
      }
      const { currentWeek, addWeeks } = await import('/src/domain/weeks.ts');
      const week = currentWeek();
      const w = (n) => addWeeks(week, n);
      const plan = { version: 4, tags: [], sellers: [], resources: [], projects: [{ id: 'qa-project', name: 'QA', status: 'won', sellerId: null, tagIds: [] }], assignments: [{ id: 'qa-role', name: 'QA role', projectId: 'qa-project', resourceId: null, tagIds: [], weekly: { [w(0)]: 50, [w(1)]: 50 } }], settings: { overallocationThreshold: 100, criticalThreshold: 149 } };
      const created = await (await call('/api/plans', 'POST', { name: `Adversarial ${Date.now()}`, plan })).json();
      const editorEmail = `qa-editor-${Date.now()}@example.com`;
      const user = await call('/api/users', 'POST', { email: editorEmail, role: 'editor' });
      if (!user.ok) throw new Error(await user.text());
      return { id: created.plan.id, editorEmail, malformed, week, target: w(2) };
    });
    assert.deepEqual(result.malformed, [400, 400, 400, 400]);
    console.log('ok - malformed pagination and time filters return 400');
    await admin.evaluate(async ({ id, target }) => {
      localStorage.setItem('capacity-mode:v1', 'shared');
      localStorage.setItem('capacity-collab:v1', JSON.stringify({ lastPlanId: id, uploadOffered: true }));
      const { PROTOCOL_VERSION } = await import('/src/domain/protocol.ts');
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/api/plans/${id}/ws`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket QA timed out')); }, 10_000);
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', proto: PROTOCOL_VERSION }));
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.t === 'welcome') {
            ws.send('null'); // Valid JSON, invalid protocol envelope: the connection must survive it.
            ws.send(JSON.stringify({ t: 'lock.add', cid: 'qa-lock', lock: { scope: 'cells', id: 'qa-lock', roleIds: ['qa-role'], from: target, to: target } }));
          }
          if (msg.t === 'applied' && msg.cid === 'qa-lock') { clearTimeout(timer); ws.close(); resolve(); }
          if (msg.t === 'rejected') { clearTimeout(timer); ws.close(); reject(new Error(msg.msg)); }
        };
        ws.onerror = (e) => { clearTimeout(timer); reject(e); };
      });
    }, result);
    console.log('ok - malformed WebSocket JSON does not break subsequent valid requests');

    const editor = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await editor.goto(`${BASE}/api/dev/login?as=${encodeURIComponent(result.editorEmail)}`);
    await editor.evaluate(({ id }) => {
      localStorage.setItem('capacity-mode:v1', 'shared');
      localStorage.setItem('capacity-collab:v1', JSON.stringify({ lastPlanId: id, uploadOffered: true }));
    }, result);
    await editor.reload();
    await editor.waitForSelector('.conn-live');
    await editor.evaluate(async (week) => {
      const { useUIStore } = await import('/src/store/uiStore.ts');
      useUIStore.getState().setAnchor(week);
      useUIStore.getState().setCellStyle('bars');
      useUIStore.getState().setExpanded('p:qa-project', true);
    }, result.week);
    const cells = editor.locator('[id="row-a:qa-role"] td.cell.edit');
    await cells.first().waitFor();
    const before = await admin.evaluate(async (id) => (await (await fetch(`/api/plans/${id}/export`)).json()).assignments, result.id);
    const a = await cells.nth(0).boundingBox();
    const b = await cells.nth(2).boundingBox();
    await editor.keyboard.down('Alt');
    await editor.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await editor.mouse.down();
    await editor.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await editor.mouse.up();
    await editor.keyboard.up('Alt');
    await editor.waitForTimeout(500);
    const after = await admin.evaluate(async (id) => (await (await fetch(`/api/plans/${id}/export`)).json()).assignments, result.id);
    assert.deepEqual(after, before, 'a move into a locked destination must preserve the entire source booking');
    console.log('ok - dragging into a locked destination preserves the source booking');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });

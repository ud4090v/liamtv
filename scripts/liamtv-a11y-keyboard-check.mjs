#!/usr/bin/env node
/**
 * LiamTV runtime keyboard-accessibility check (LIA-32).
 *
 * Proves that a KEYBOARD user can reach and operate the child screen-time
 * limit and the child-safety settings on the live parent-control surfaces.
 *
 * Zero npm dependencies. Drives headless Chrome over the DevTools Protocol
 * using Node's built-in globalThis.WebSocket / globalThis.fetch.
 *
 * Why this file exists: a prior static + runtime audit (LIA-31) found that the
 * sleep-timer pills were `div`s with no role, no tabindex and no key handler,
 * so a keyboard user could not set the screen-time limit at all. That audit
 * used EMPTY api stubs, which rendered zero playlist cards -- and therefore
 * could not see that the editor view itself was unreachable. The populated
 * fixture below is mandatory: without it this test would pass while the
 * product is still keyboard-dead.
 *
 * Exit code 0 = all assertions passed. Non-zero = at least one failed.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
// BASE_URL lets the same assertions run against a DEPLOYED surface instead of
// the local files. LIA-34 criterion 3 requires exactly that: proving the fix
// reached production cannot be done by testing a local checkout. When set, the
// local static server is not started and the real deployed API is used.
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const RESULT_FILE = process.env.RESULT_FILE || '/tmp/liamtv-a11y-keyboard-result.json';
const DEPLOYED = BASE_URL !== '';

// ── Populated fixture ───────────────────────────────────────────────────────
// Two real-looking playlists so playlist-card elements actually render.
const PLAYLISTS_FIXTURE = {
  playlists: [
    { name: 'danny-go', title: 'Danny Go', videoCount: 12, thumb: '' },
    { name: 'lego', title: 'Lego', videoCount: 25, thumb: '' },
  ],
};
const PLAYLIST_FIXTURE = {
  videos: [],
  settings: { channelName: 'danny-go', playOrder: 'sequence', sleepTimer: 30 },
};

// ── Result tracking ─────────────────────────────────────────────────────────
const results = [];
let failed = 0;

function assert(name, ok, detail = '') {
  const pass = !!ok;
  if (!pass) failed++;
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static server with benign /api stubs ───────────────────────────────────
function startServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) return res.end(body);
      return res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (url === '/api/playlists' || url === '/api/playlists.js') {
      return send(200, PLAYLISTS_FIXTURE);
    }
    if (url === '/api/playlist' || url === '/api/playlist.js') {
      return send(200, PLAYLIST_FIXTURE);
    }
    if (url.startsWith('/api/')) return send(200, {});
    const file = path.join(REPO_ROOT, url === '/' ? 'manage.html' : url.replace(/^\//, ''));
    if (!file.startsWith(REPO_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(404, 'not found', 'text/plain');
    }
    send(200, fs.readFileSync(file), 'text/html; charset=utf-8');
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ── Chrome launch ───────────────────────────────────────────────────────────
function launchChrome() {
  return new Promise((resolve, reject) => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liamtv-a11y-'));
    const chrome = spawn(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let wsUrl = null;
    const timer = setTimeout(() => reject(new Error('Chrome did not start within 20s')), 20000);
    const onData = (d) => {
      const m = String(d).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m && !wsUrl) {
        wsUrl = m[1];
        clearTimeout(timer);
        resolve({ chrome, wsUrl, userDir });
      }
    };
    chrome.stderr.on('data', onData);
    chrome.stdout.on('data', onData);
    chrome.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── CDP client (flat protocol: browser socket + attached target session) ────
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const session = {
      sessionId: null,
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          const payload = { id: msgId, method, params };
          // Browser-level commands go without a sessionId; page-domain
          // commands ride the attached target session.
          if (session.sessionId && !method.startsWith('Target.')) payload.sessionId = session.sessionId;
          ws.send(JSON.stringify(payload));
        });
      },
      close() { try { ws.close(); } catch { /* ignore */ } },
    };
    ws.addEventListener('open', async () => {
      try {
        const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
        session.sessionId = sessionId;
        resolve(session);
      } catch (e) {
        reject(e);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.code}: ${msg.error.message}`));
        else res(msg.result);
      }
    });
  });
}

// ── Page helpers ───────────────────────────────────────────────────────────
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails;
    const desc = ex.exception?.description || ex.text || 'unknown';
    throw new Error('JS error: ' + String(desc).slice(0, 500));
  }
  return r.result?.value;
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await sleep(2200);
}

// NOTE: rawKeyDown does NOT trigger the browser's default activation of a
// focused control. A prior audit produced false negatives by using it.
// keyDown WITH text is required.
async function pressTab(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Tab', code: 'Tab', keyCode: 9, windowsVirtualKeyCode: 9, text: '\t',
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Tab', code: 'Tab', keyCode: 9, windowsVirtualKeyCode: 9,
  });
  await sleep(40);
}

async function pressEnter(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', keyCode: 13, windowsVirtualKeyCode: 13, text: '\r',
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', keyCode: 13, windowsVirtualKeyCode: 13,
  });
  await sleep(140);
}

const FOCUS_DESC = `(() => {
  const a = document.activeElement;
  if (!a) return 'NONE';
  if (a === document.body) return 'BODY';
  const id = a.id ? '#' + a.id : '';
  const cls = (typeof a.className === 'string' && a.className) ? '.' + a.className.trim().split(/\\s+/).join('.') : '';
  const role = a.getAttribute('role') ? '[role=' + a.getAttribute('role') + ']' : '';
  const dm = (a.dataset && a.dataset.min !== undefined) ? '[min=' + a.dataset.min + ']' : '';
  const label = a.getAttribute('aria-label') || (a.textContent || '').trim().slice(0, 24);
  return a.tagName.toLowerCase() + id + cls + role + dm + ' | "' + label + '"';
})()`;

async function focusedDesc(cdp) {
  return evaluate(cdp, FOCUS_DESC);
}

async function tabSweep(cdp, steps) {
  await evaluate(cdp, 'document.activeElement && document.activeElement.blur(); true');
  const seq = [];
  for (let i = 0; i < steps; i++) {
    await pressTab(cdp);
    const d = await focusedDesc(cdp);
    if (!seq.length || seq[seq.length - 1] !== d) seq.push(d);
  }
  return seq;
}

// Wait until a selector matches. A deployed surface needs its real assets,
// its real API round-trip and its own first paint, so a fixed sleep is not
// enough: without this, a slow load is indistinguishable from a keyboard-dead
// surface, and the run reports dozens of false accessibility failures.
async function waitForSelector(cdp, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await evaluate(cdp,
      `document.querySelectorAll(${JSON.stringify(selector)}).length`);
    if (n > 0) return n;
    await sleep(250);
  }
  return 0;
}

async function focusElement(cdp, selector) {
  return evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  })()`);
}

async function axName(cdp, selector) {
  // Use DOM.getDocument + DOM.querySelector to get a nodeId, then read the AX tree.
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const ax = nodes.find((n) => n.role && n.role.value) || nodes[0];
  if (!ax) return null;
  const name = ax.name?.value;
  return { name: name == null ? '' : name, role: ax.role?.value || '' };
}

// Hidden subtrees are excluded from the accessibility tree, so a control
// inside a collapsed panel reports role "none" and an empty name. Reveal
// every display:none element for the duration of the accessible-name audit
// so the name computation itself is what is under test.
async function revealHidden(cdp) {
  return evaluate(cdp, `(() => {
    window.__a11yRevealed = [];
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' && el.offsetParent === null) {
        window.__a11yRevealed.push(el);
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
      }
    }
    return window.__a11yRevealed.length;
  })()`);
}

async function restoreHidden(cdp) {
  return evaluate(cdp, `(() => {
    for (const el of (window.__a11yRevealed || [])) {
      el.style.display = '';
      el.style.visibility = '';
      el.style.opacity = '';
    }
    window.__a11yRevealed = [];
    return true;
  })()`);
}

async function clickAt(cdp, selector) {
  // Scroll the target into view first: elementFromPoint returns null for
  // coordinates outside the viewport, and the settings panel is taller than
  // the window, so the timer pills sit below the fold.
  await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  await sleep(120);
  const box = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
  if (!box || box.w === 0) return { ok: false, reason: 'no box' };
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
    });
  }
  await sleep(140);
  const hit = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'MISSING';
    const r = el.getBoundingClientRect();
    const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hitEl ? (hitEl === el ? 'SELF' : hitEl.tagName.toLowerCase() + '.' + (hitEl.className || '')) : 'NULL';
  })()`);
  return { ok: true, hit, box };
}

// ── The test body ──────────────────────────────────────────────────────────
async function testSurface(cdp, base, file, label, safetyFields) {
  console.log(`\n── ${label} (${file}) ───────────────────────────────`);
  await navigate(cdp, `${base}/${file}`);
  // The surface must actually render before its keyboard semantics can be
  // asserted. A surface that never renders is a FAILURE, not a reason to
  // report every downstream assertion as broken.
  const rendered = await waitForSelector(cdp, '.playlist-card', DEPLOYED ? 25000 : 8000);
  assert(`${label}: playlist cards rendered (populated fixture)`, rendered >= 1, `cards=${rendered}`);

  // --- 1. HOME VIEW IS NOT A KEYBOARD DEAD END ---
  const home = await evaluate(cdp, `(() => {
    const card = document.querySelector('.playlist-card');
    const newCard = document.querySelector('.new-card');
    return {
      cards: document.querySelectorAll('.playlist-card').length,
      newCards: document.querySelectorAll('.new-card').length,
      cardTabindex: card ? card.getAttribute('tabindex') : null,
      cardRole: card ? card.getAttribute('role') : null,
      newTabindex: newCard ? newCard.getAttribute('tabindex') : null,
      viewEditor: getComputedStyle(document.getElementById('view-editor')).display,
    };
  })()`);

  assert(`${label}: new-card rendered`, home.newCards >= 1, `newCards=${home.newCards}`);
  assert(`${label}: playlist card has role="button"`, home.cardRole === 'button', `role=${home.cardRole}`);
  assert(`${label}: playlist card is focusable (tabindex=0)`, home.cardTabindex === '0', `tabindex=${home.cardTabindex}`);
  assert(`${label}: new-card is focusable (tabindex=0)`, home.newTabindex === '0', `tabindex=${home.newTabindex}`);

  const homeSweep = await tabSweep(cdp, 45);
  const reachedCard = homeSweep.some((d) => d.includes('.playlist-card'));
  const reachedNew = homeSweep.some((d) => d.includes('.new-card'));
  assert(`${label}: Tab sweep reaches a playlist card`, reachedCard, `sweep=${homeSweep.length} steps`);
  assert(`${label}: Tab sweep reaches the new-card`, reachedNew);
  assert(`${label}: Tab sweep is not a dead end`, !homeSweep.every((d) => d === 'BODY'), `first=${homeSweep[0]}`);

  // --- 1b. THE DELETE BUTTON IS KEYBOARD-REACHABLE ---
  // .playlist-card-del is display:none and was revealed only by
  // .playlist-card:hover, so a keyboard user could never reach Delete at
  // all: :hover does not exist without a pointing device. The :focus-within
  // reveal makes the button visible while focus is inside the card, which
  // also puts it back into the sequential focus order. The assertion checks
  // the ORDER, not just presence -- a del button that was merely present in
  // the DOM but unreachable would still fail here.
  const cardIdx = homeSweep.findIndex((d) => d.includes('.playlist-card'));
  const delIdx = homeSweep.findIndex((d) => d.includes('.playlist-card-del'));
  assert(`${label}: delete button is in the tab order`,
    delIdx !== -1, delIdx === -1 ? 'never reached by Tab' : `reached at step ${delIdx}`);
  assert(`${label}: delete button is reachable only AFTER the card takes focus`,
    delIdx !== -1 && cardIdx !== -1 && delIdx > cardIdx,
    `card@${cardIdx} del@${delIdx}`);
  const delVisible = await evaluate(cdp, `(() => {
    const card = document.querySelector('.playlist-card');
    const del = card && card.querySelector('.playlist-card-del');
    if (!del) return null;
    card.focus();
    return getComputedStyle(del).display;
  })()`);
  assert(`${label}: delete button is revealed when the card has focus`,
    delVisible && delVisible !== 'none', `display=${delVisible}`);

  // --- 2. KEYBOARD OPENS THE EDITOR VIEW ---
  const focusedCard = await focusElement(cdp, '.playlist-card');
  assert(`${label}: playlist card can take focus`, focusedCard);
  await pressEnter(cdp);
  await sleep(700);
  const editorOpen = await evaluate(cdp, `getComputedStyle(document.getElementById('view-editor')).display`);
  assert(`${label}: Enter on a card opens the editor view`, editorOpen !== 'none', `display=${editorOpen}`);

  // --- 3. SETTINGS TAB IS KEYBOARD-OPERABLE ---
  // The sleep-timer pills live INSIDE #panel-settings, which is
  // display:none until the settings tab is activated. A keyboard user must
  // therefore be able to reach and open the settings tab BEFORE the pills
  // are reachable at all. This ordering is the point of the test.
  const focusTab = await focusElement(cdp, '#tab-settings');
  assert(`${label}: settings tab can take focus`, focusTab);
  await pressEnter(cdp);
  await sleep(300);
  const settingsOpen = await evaluate(cdp, `(() => ({
    panel: getComputedStyle(document.getElementById('panel-settings')).display,
    expanded: (document.getElementById('tab-settings')||{}).getAttribute
      ? document.getElementById('tab-settings').getAttribute('aria-expanded') : null,
  }))()`);
  assert(`${label}: Enter on the settings tab opens the settings panel`, settingsOpen.panel !== 'none',
    `display=${settingsOpen.panel}`);
  assert(`${label}: settings tab reports aria-expanded=true`, settingsOpen.expanded === 'true',
    `aria-expanded=${settingsOpen.expanded}`);

  // --- 4. ALL SIX TIMER PILLS ARE KEYBOARD REACHABLE ---
  const editorSweep = await tabSweep(cdp, 45);
  const pillReached = new Set();
  for (const d of editorSweep) {
    const m = d.match(/\.timer-pill[^\[]*\[min=(\d+)\]/);
    if (m) pillReached.add(m[1]);
  }
  assert(`${label}: all 6 sleep-timer pills are Tab-reachable`, pillReached.size === 6,
    `reached=${[...pillReached].sort((a, b) => a - b).join(',')}`);

  // --- 5. KEYBOARD SETS THE SCREEN-TIME LIMIT ---
  const focus30 = await focusElement(cdp, '.timer-pill[data-min="30"]');
  assert(`${label}: 30-minute pill can take focus`, focus30);
  await pressEnter(cdp);
  await sleep(300);
  const timerState = await evaluate(cdp, `(() => ({
    sleepTimer: (typeof settings !== 'undefined' && settings) ? settings.sleepTimer : null,
    pressed: [...document.querySelectorAll('.timer-pill')].map(p => p.getAttribute('aria-pressed')),
    mins: [...document.querySelectorAll('.timer-pill')].map(p => p.getAttribute('data-min')),
    labels: [...document.querySelectorAll('.timer-pill')].map(p => p.getAttribute('aria-label')),
  }))()`);
  assert(`${label}: Enter on the pill sets settings.sleepTimer=30`, timerState.sleepTimer === 30,
    `sleepTimer=${timerState.sleepTimer}`);
  const pressedMap = {};
  timerState.mins.forEach((m, i) => { pressedMap[m] = timerState.pressed[i]; });
  assert(`${label}: aria-pressed=true only on the selected pill`,
    pressedMap['30'] === 'true' && Object.entries(pressedMap).filter(([k]) => k !== '30').every(([, v]) => v === 'false'),
    JSON.stringify(pressedMap));
  assert(`${label}: every timer pill has an accessible name`,
    timerState.labels.every((l) => l && l.length > 0), JSON.stringify(timerState.labels));

  // --- 6. CHILD-SAFETY FIELDS ARE KEYBOARD REACHABLE ---
  const safetySweep = await tabSweep(cdp, 45);
  const missing = safetyFields.filter((id) => !safetySweep.some((d) => d.includes(`#${id}`)));
  assert(`${label}: all ${safetyFields.length} child-safety fields are Tab-reachable`, missing.length === 0,
    missing.length ? `missing=${missing.join(',')}` : 'all reached');

  // --- 7. EVERY SELECT HAS AN ACCESSIBLE NAME ---
  const selectIds = await evaluate(cdp,
    `[...document.querySelectorAll('select')].map(s => s.id || s.name || '(no-id)')`);
  assert(`${label}: page has selects to check`, selectIds.length >= 1, `selects=${selectIds.join(',')}`);
  // Hidden subtrees are excluded from the accessibility tree, so reveal them
  // for the duration of this audit -- otherwise a select inside a collapsed
  // panel reports role "none" and an empty name regardless of its label.
  const revealed = await revealHidden(cdp);
  for (const id of selectIds) {
    const ax = await axName(cdp, `select#${id}`);
    assert(`${label}: select #${id} has an accessible name`,
      ax && ax.name && ax.name.trim().length > 0, ax ? `name="${ax.name}" role=${ax.role}` : 'AX tree unavailable');
  }
  await restoreHidden(cdp);
  console.log(`     (revealed ${revealed} hidden elements for the AX audit)`);

  // --- 8. MOUSE PATH STILL WORKS ---
  const before = await evaluate(cdp, `settings ? settings.sleepTimer : null`);
  const click = await clickAt(cdp, '.timer-pill[data-min="60"]');
  const after = await evaluate(cdp, `settings ? settings.sleepTimer : null`);
  assert(`${label}: mouse click on a pill updates sleepTimer`,
    click.ok && after === 60, `before=${before} after=${after} hit=${click.hit}`);
  assert(`${label}: mouse hit-test lands on the pill itself`,
    click.hit === 'SELF', `elementFromPoint=${click.hit}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 LiamTV A11y Keyboard Check — LIA-32');
  const { server, port } = DEPLOYED ? { server: null, port: null } : await startServer();
  const base = DEPLOYED ? BASE_URL : `http://127.0.0.1:${port}`;
  console.log(DEPLOYED ? `  🌐 Target: deployed surface ${base}` : `  📡 Local server on port ${port}`);
  const { chrome, wsUrl, userDir } = await launchChrome();
  console.log(`  🌐 Chrome CDP ready`);
  const cdp = await cdpConnect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');

  try {
    // ── POSITIVE CONTROL ───────────────────────────────────────────────────
    // Without this, "Enter did nothing" is indistinguishable from a broken
    // harness. A prior audit had exactly that false-negative bug. If the
    // control fails the whole run must fail loudly.
    console.log('\n── POSITIVE CONTROL (harness self-test) ──────────');
    await navigate(cdp, `${base}/manage.html`);
    const ctrl = await evaluate(cdp, `(() => {
      window.__ctrlClicks = 0;
      const b = document.createElement('button');
      b.id = '__ctrlButton';
      b.textContent = 'control';
      b.addEventListener('click', () => { window.__ctrlClicks++; });
      document.body.appendChild(b);
      b.focus();
      return document.activeElement === b;
    })()`);
    assert('control: synthetic native button takes focus', ctrl);
    await pressEnter(cdp);
    const ctrlClicks = await evaluate(cdp, 'window.__ctrlClicks');
    assert('control: Enter on a native button generates a click', ctrlClicks === 1, `clicks=${ctrlClicks}`);
    if (ctrlClicks !== 1) {
      throw new Error('POSITIVE CONTROL FAILED — the key-event harness is not delivering Enter. '
        + 'Results would be false negatives. Aborting.');
    }
    await evaluate(cdp, `(() => { const b = document.getElementById('__ctrlButton'); if (b) b.remove(); return true; })()`);

    await testSurface(cdp, base, 'manage.html', 'manage.html',
      ['contentFilters', 'blacklistedChannels', 'minWatchCount', 'skipThreshold']);
    // playlist-manager.html has no #blacklistedChannels control (it manages
    // playlists, not per-playlist channel blacklists) -- assert the fields
    // that surface actually exposes rather than a shared list.
    await testSurface(cdp, base, 'playlist-manager.html', 'playlist-manager.html',
      ['contentFilters', 'minWatchCount', 'skipThreshold']);

    // ── tv-player viewport (WCAG 1.4.4) ────────────────────────────────────
    console.log('\n── tv-player.html (viewport zoom) ───────────────');
    await navigate(cdp, `${base}/tv-player.html`);
    await waitForSelector(cdp, 'body', 15000);
    const vp = await evaluate(cdp, `(() => {
      const m = document.querySelector('meta[name="viewport"]');
      return m ? m.getAttribute('content') : null;
    })()`);
    assert('tv-player: viewport does not block pinch/text zoom',
      vp && !/user-scalable\s*=\s*no/i.test(vp) && !/maximum-scale\s*=\s*1(\.0)?\b/i.test(vp),
      `content="${vp}"`);
  } finally {
    try { cdp.close(); } catch { /* ignore */ }
    chrome.kill('SIGKILL');
    if (server) server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`RESULT: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailed assertions:');
    for (const r of results.filter((x) => !x.pass)) console.log(`  ❌ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const out = { total: results.length, passed, failed, results };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(out, null, 2));
  console.log(`  📄 ${RESULT_FILE}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ Test harness crashed:', e && e.message ? e.message : e);
  process.exit(2);
});

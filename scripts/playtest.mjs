// Drives the real UI in ?demo=1 mode with Playwright: board, filters,
// post → reply → Mine, pickup board, suggest, dark mode, desktop. Writes
// screenshots to OUT (default: ./playtest-out) and fails on any console
// error. Run:  NODE_PATH=<dir with playwright> node scripts/playtest.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.OUT || join(ROOT, 'playtest-out');
mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
async function page({ width = 390, height = 844, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  // a 404 from the real project just means the SQL isn't pasted yet (not_ready) — not a bug
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return p;
}
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
const must = (cond, msg) => { if (!cond) { errors.push(`[assert] ${msg}`); } };

// ---------------------------------------------------------------- board
let p = await page();
await p.goto(`${base}?demo=1`);
await p.waitForSelector('.card');
must((await p.$$('.card')).length >= 6, 'demo board shows cards');
await shot(p, '01-board-light');
// sport filter chip
await p.click('.chip:has-text("Climbing")');
await p.waitForTimeout(150);
must((await p.$$('.card')).length === 1, 'climbing filter leaves one card');
must((await p.textContent('.card .name')) === 'Maya', 'climbing card is Maya');
must(await p.$('.card .tag:has-text("Women only")'), 'women-only tag shown');
await shot(p, '02-board-filtered');
await p.click('.chip:has-text("All")');

// ------------------------------------------------------------- post flow
await p.click('#fab');
await p.waitForSelector('#sheet-post[open]');
await shot(p, '03-post-sheet');
await p.click('#sheet-post button:has-text("Post it")');
await p.waitForTimeout(100);
must(await p.$('#sheet-post .field.bad'), 'validation marks missing fields');
await p.click('#sheet-post .opt:has-text("Tennis")');
await p.click('#sheet-post .opt:has-text("3.5")');
await p.click('#sheet-post .opt:has-text("Casual")');
await p.click('#sheet-post .opt:has-text("Weekday evenings")');
await p.click('#sheet-post .opt:has-text("South End")');
await p.fill('#sheet-post input[name="name"]', 'Stephen');
await p.fill('#sheet-post input[name="note"]', 'Looking for a regular hit. Check www.spam.example out');
await p.fill('#sheet-post input[name="email"]', 'stephen@example.com');
await p.click('#sheet-post .switch');
await p.waitForTimeout(250);
must(!(await p.$('#sheet-post .field.bad')), 'errors clear once fields are filled');
await shot(p, '04-post-filled');
await p.click('#sheet-post button:has-text("Post it")');
await p.waitForSelector('.toast.show');
await p.waitForSelector('.card .tag:has-text("Yours")');
const firstNote = await p.textContent('.card:first-child .note');
must(!/spam\.example/.test(firstNote), 'URL stripped from public note');
must((await p.textContent('.card:first-child .name')) === 'Stephen', 'new call is first');
await shot(p, '05-board-after-post');

// --------------------------------------------------------- reply + mine
// reply to Priya's call (second card now)
await p.click('.card:nth-child(2) button:has-text("Reply")');
await p.waitForSelector('#sheet-reply[open]');
await p.fill('#sheet-reply input[name="name"]', 'Stephen');
await p.fill('#sheet-reply textarea[name="note"]', 'Tuesday at Leddy works for me!');
await p.fill('#sheet-reply input[name="contact"]', 'stephen@example.com');
await shot(p, '06-reply-sheet');
await p.click('#sheet-reply button:has-text("Send")');
await p.waitForSelector('.toast.show');
await p.waitForTimeout(200);
must(/1 reply/.test(await p.textContent('.card:nth-child(2) .when')), 'reply count shows');
// own call: Manage → Mine
await p.click('#open-mine');
await p.waitForSelector('#sheet-mine[open] .mine-section');
const mineText = await p.textContent('#sheet-mine');
must(/Your calls/.test(mineText) && /Replies you sent/.test(mineText), 'Mine shows calls + sent');
must(/13 days left|14 days left/.test(mineText), 'days left shown');
await shot(p, '07-mine');
await p.click('#sheet-mine button:has-text("Found someone")');
await p.waitForSelector('.toast.show');
await p.waitForTimeout(300);
must(!(await p.$('.card .tag:has-text("Yours")')), 'closed call leaves the board');
await p.keyboard.press('Escape');

// ------------------------------------------------------------ pickup
await p.click('#tab-pickup');
await p.waitForSelector('.card.pick');
must((await p.$$('.card.pick')).length >= 15, 'pickup board has curated entries');
must((await p.textContent('.group-head')) === 'Basketball', 'grouped by pickup sport name');
must((await p.textContent('#fab')) === 'Suggest a game', 'fab relabels');
await shot(p, '08-pickup');
await p.click('.chip:has-text("Running")');
await p.waitForTimeout(100);
must((await p.$$('.card.pick')).length === 4, 'running filter → 4');
await p.click('#fab');
await p.waitForSelector('#sheet-suggest[open]');
await p.fill('#sheet-suggest input[name="name"]', 'Oakledge sunrise swim');
await p.click('#sheet-suggest .opt:has-text("Other")');
await p.fill('#sheet-suggest input[name="venue"]', 'Oakledge Park');
await p.fill('#sheet-suggest input[name="schedule"]', 'Saturdays 7am, summer');
await p.click('#sheet-suggest .opt:has-text("Just show up")');
await shot(p, '09-suggest');
await p.click('#sheet-suggest button:has-text("Suggest it")');
await p.waitForSelector('.toast.show');
await p.click('#open-mine');
await p.waitForSelector('#sheet-mine[open] .mine-section');
must(/Games you suggested/.test(await p.textContent('#sheet-mine')), 'suggestion listed in Mine');
await p.keyboard.press('Escape');
await p.click('#open-rules');
await p.waitForSelector('#sheet-rules[open]');
await shot(p, '10-rules');
await p.context().close();

// --------------------------------------------------- dark + desktop
p = await page({ dark: true });
await p.goto(`${base}?demo=1&sport=all`);
await p.waitForSelector('.card');
await shot(p, '11-board-dark');
await p.click('#tab-pickup'); await p.waitForSelector('.card.pick'); await shot(p, '12-pickup-dark');
await p.context().close();
p = await page({ width: 1280, height: 900 });
await p.goto(`${base}?demo=1`);
await p.waitForSelector('.card');
await shot(p, '13-desktop');
await p.click('#fab'); await p.waitForSelector('#sheet-post[open]'); await shot(p, '14-desktop-sheet');
await p.context().close();

// -------------------------------------------- live mode without SQL
// (network → 404 from a real project is 'not_ready'; here the static server
// has no /rest, so fetch fails or 404s — the board must fail soft either way)
p = await page();
await p.goto(base);
await p.waitForSelector('.empty, .card', { timeout: 8000 });
must(await p.$('.empty'), 'live mode without backend shows a soft message');
await p.click('#tab-pickup'); await p.waitForSelector('.card.pick');
must((await p.$$('.card.pick')).length >= 15, 'pickup board works with no backend');
await shot(p, '15-live-not-ready');
await p.context().close();

await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`playtest ok — screenshots in ${OUT}`);

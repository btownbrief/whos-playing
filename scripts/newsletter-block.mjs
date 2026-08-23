// Renders up to N open calls as a newsletter block (markdown by default,
// --html for Beehiiv paste). Reads the PUBLIC wp_board() RPC — the same
// projection the site shows, no private columns — so it can run anywhere.
//   node scripts/newsletter-block.mjs            # 3 calls, markdown
//   node scripts/newsletter-block.mjs --html 5   # 5 calls, html
import { sportName, postMeta, boardView } from '../js/core.js';

const SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const APP = 'https://play.btownbrief.com/whos-playing/';
const html = process.argv.includes('--html');
const n = Number(process.argv.find((a) => /^\d+$/.test(a)) || 3);

const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wp_board`, {
  method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}',
});
if (!res.ok) { console.error(`wp_board: http ${res.status} (SQL not pasted yet?)`); process.exit(1); }
const posts = boardView(await res.json(), { nowMs: Date.now() });
const pick = posts.slice(0, n);
const total = posts.length;
const line = (p) => `${p.name} wants a ${sportName(p.sport).toLowerCase()} partner — ${postMeta(p)}${p.note ? `. “${p.note}”` : ''}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

if (!total) {
  console.log(html
    ? `<p><strong>Who's playing?</strong> Nobody's posted a call this week — if you want a tennis, pickleball, climbing, or running partner, <a href="${APP}">post yours</a>; it takes twenty seconds.</p>`
    : `**Who's playing?** Nobody's posted a call this week — if you want a tennis, pickleball, climbing, or running partner, [post yours](${APP}); it takes twenty seconds.`);
  process.exit(0);
}
if (html) {
  console.log(`<p><strong>Who's playing this week</strong> — ${total} ${total === 1 ? 'person is' : 'people are'} looking for a partner on <a href="${APP}">Who's Playing</a>:</p>`);
  console.log('<ul>' + pick.map((p) => `<li>${esc(line(p))} → <a href="${APP}?sport=${p.sport}">reply</a></li>`).join('') + '</ul>');
} else {
  console.log(`**Who's playing this week** — ${total} ${total === 1 ? 'person is' : 'people are'} looking for a partner on [Who's Playing](${APP}):\n`);
  for (const p of pick) console.log(`- ${line(p)} → [reply](${APP}?sport=${p.sport})`);
}

// WHO'S PLAYING — backend client. Same Supabase project + publishable key
// as the whole Btown fleet (leaderboard, rooms, party, lake-breath); the
// wp_* RPCs are brand-new and live in supabase/whos-playing-SETUP.sql.
// Until Stephen pastes that file, every call fails with code 'not_ready'
// and the UI says so plainly instead of erroring.
//
// Two transports behind one `backend()`:
//   network (default) — fetch to /rest/v1/rpc/<fn>
//   ?demo=1           — the in-memory FakeBackend with sample calls
// The per-device token is minted once, kept in localStorage, and only ever
// stored hashed on the server. It is the only "account" there is.

import { FakeBackend, seedDemo } from './fake-backend.js';

const SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const NOTIFY_FN = 'wp-notify'; // optional edge function; see supabase/functions/wp-notify

export class NetError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'NetError';
    this.code = code;
    this.detail = detail;
  }
}

const params = () => new URLSearchParams(globalThis.location?.search ?? '');
export const isDemo = () => params().get('demo') === '1';

function stored(key, make) {
  try {
    let v = localStorage.getItem(key);
    if (!v) { v = make(); localStorage.setItem(key, v); }
    return v;
  } catch {
    return make(); // private mode with storage blocked: a session-only identity
  }
}
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const token = () => stored('wp-token', () => hex(16));
export const rememberedName = () => { try { return localStorage.getItem('wp-name') || ''; } catch { return ''; } };
export const rememberName = (n) => { try { localStorage.setItem('wp-name', String(n).slice(0, 24)); } catch { /* fine */ } };
export const rememberedEmail = () => { try { return localStorage.getItem('wp-email') || ''; } catch { return ''; } };
export const rememberEmail = (e) => { try { localStorage.setItem('wp-email', String(e).slice(0, 120)); } catch { /* fine */ } };

async function networkRpc(fn, args) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new NetError('offline');
  }
  if (res.status === 404) throw new NetError('not_ready');
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const raw = (body && body.message) || `http_${res.status}`;
    throw new NetError(String(raw).split(':')[0].trim());
  }
  // the moderator RPCs report a wrong secret as a body, not a raise, so the
  // server-side failure counter survives (see the SQL); same error to callers
  if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string') {
    throw new NetError(body.error);
  }
  return body;
}

let demo = null;
export function backend() {
  if (isDemo()) {
    if (!demo) demo = seedDemo(new FakeBackend({ modSecret: 'demo' }));
    return { rpc: (fn, args) => demo.rpc(fn, args).catch((e) => { throw new NetError(e.code || 'error'); }) };
  }
  return { rpc: networkRpc };
}

// Best-effort "someone replied" email. Fire-and-forget: the reply is
// already saved; this only asks the (optional) edge function to tell the
// poster. Missing function, missing key, or any failure → silence, which
// is the documented baseline (they see replies in Mine).
export function notify(replyId) {
  if (isDemo() || !replyId) return;
  try {
    fetch(`${SUPABASE_URL}/functions/v1/${NOTIFY_FN}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply_id: replyId }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* fine */ }
}

// Plain-language copy for every error code the backend can return.
export function explain(err) {
  const code = err && err.code ? err.code : 'error';
  return ({
    offline: "You're offline. Try again in a moment.",
    not_ready: "The board isn't switched on yet. Check back soon.",
    slow_down: "That's plenty for today — try again tomorrow.",
    too_many_open: 'You have five open calls already. Close one first.',
    own_post: "That's your own call.",
    not_found: 'That call is gone.',
    too_soon: 'You can extend a call in its last week.',
    bad_post: "Something's missing — check the highlighted fields.",
    bad_reply: "Something's missing — check the highlighted fields.",
    bad_suggestion: "Something's missing — check the highlighted fields.",
    bad_secret: "That's not the moderator secret.",
    bad_token: 'This browser lost its identity. Reload and try again.',
  })[code] || "Something went wrong. Try again.";
}

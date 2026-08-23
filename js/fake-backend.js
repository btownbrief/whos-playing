// WHO'S PLAYING — an in-memory backend that mirrors supabase/whos-playing-
// SETUP.sql op for op: same RPC names, same error codes, same limits, same
// shapes. It runs the ?demo=1 mode in the browser (seeded with a few
// sample calls so Stephen can see the board before the SQL is pasted) and
// it is what scripts/test-core.mjs drives in Node. No DOM, no fetch;
// `now` is injected.
//
// If a rule changes here it must change in the SQL too, and vice versa.

import {
  POST_DAYS, validatePost, validateReply, validateSuggestion, validToken,
} from './core.js';

const RATE = { postsPerDay: 3, openPosts: 5, repliesPerDay: 10, suggestionsPerDay: 3 };
const HIDE_AT_REPORTS = 3;
const DAY = 86400000;

export class BackendError extends Error {
  constructor(code) { super(code); this.name = 'BackendError'; this.code = code; }
}

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export class FakeBackend {
  constructor({ now = () => Date.now(), modSecret = null } = {}) {
    this.now = now;
    this.modSecret = modSecret;
    this.posts = [];        // {id, token, name, sport, level, intent, times, place, note, women_only, email, status, reports, created_at, closed_at}
    this.replies = [];      // {id, post_id, token, name, note, contact, created_at, seen, notified}
    this.reports = [];      // {post_id, token}
    this.suggestions = [];  // {id, token, name, sport, venue, schedule, door, link, note, status, created_at}
  }

  iso(ms = this.now()) { return new Date(ms).toISOString(); }

  checkToken(t) { if (!validToken(t)) throw new BackendError('bad_token'); }

  sweep() {
    const cutoff = this.now() - POST_DAYS * DAY;
    for (const p of this.posts) {
      if (p.status === 'open' && Date.parse(p.created_at) < cutoff) {
        p.status = 'closed'; p.closed_at = this.iso();
      }
    }
    // replies ride along with their post; closed posts are pruned after 30 days
    const prune = this.now() - 30 * DAY;
    this.posts = this.posts.filter((p) => !(p.status !== 'open' && Date.parse(p.created_at) < prune));
    const live = new Set(this.posts.map((p) => p.id));
    this.replies = this.replies.filter((r) => live.has(r.post_id));
  }

  publicPost(p) {
    return {
      id: p.id, name: p.name, sport: p.sport, level: p.level, intent: p.intent,
      times: p.times, place: p.place, note: p.note, women_only: p.women_only,
      status: p.status, created_at: p.created_at,
      reply_count: this.replies.filter((r) => r.post_id === p.id).length,
    };
  }

  async rpc(fn, args = {}) {
    const m = this[`op_${fn.replace(/^wp_/, '')}`];
    if (!m) throw new BackendError('not_ready');
    return m.call(this, args);
  }

  // ------------------------------------------------------------ public
  op_board() {
    this.sweep();
    return this.posts.filter((p) => p.status === 'open')
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((p) => this.publicPost(p));
  }

  op_post({ p_token, p_post }) {
    this.checkToken(p_token);
    const v = validatePost(p_post);
    if (!v.ok) throw new BackendError('bad_post');
    this.sweep();
    const dayAgo = this.now() - DAY;
    const mine = this.posts.filter((p) => p.token === p_token);
    if (mine.filter((p) => Date.parse(p.created_at) > dayAgo).length >= RATE.postsPerDay) throw new BackendError('slow_down');
    if (mine.filter((p) => p.status === 'open').length >= RATE.openPosts) throw new BackendError('too_many_open');
    const row = { id: uid(), token: p_token, ...v.value, status: 'open', reports: 0, created_at: this.iso(), closed_at: null };
    this.posts.push(row);
    return { id: row.id };
  }

  op_reply({ p_post, p_token, p_reply }) {
    this.checkToken(p_token);
    const v = validateReply(p_reply);
    if (!v.ok) throw new BackendError('bad_reply');
    this.sweep();
    const post = this.posts.find((p) => p.id === p_post);
    if (!post || post.status !== 'open') throw new BackendError('not_found');
    if (post.token === p_token) throw new BackendError('own_post');
    const dayAgo = this.now() - DAY;
    const existing = this.replies.find((r) => r.post_id === p_post && r.token === p_token);
    if (!existing && this.replies.filter((r) => r.token === p_token && Date.parse(r.created_at) > dayAgo).length >= RATE.repliesPerDay) {
      throw new BackendError('slow_down');
    }
    if (existing) {
      Object.assign(existing, v.value, { created_at: this.iso(), seen: false, notified: false });
      return { id: existing.id };
    }
    const row = { id: uid(), post_id: p_post, token: p_token, ...v.value, created_at: this.iso(), seen: false, notified: false };
    this.replies.push(row);
    return { id: row.id };
  }

  op_mine({ p_token }) {
    this.checkToken(p_token);
    this.sweep();
    const posts = this.posts.filter((p) => p.token === p_token)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((p) => ({
        ...this.publicPost(p), email: p.email,
        replies: this.replies.filter((r) => r.post_id === p.id)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .map((r) => ({ id: r.id, name: r.name, note: r.note, contact: r.contact, created_at: r.created_at, seen: r.seen })),
      }));
    for (const r of this.replies) if (posts.some((p) => p.id === r.post_id)) r.seen = true;
    const suggestions = this.suggestions.filter((s) => s.token === p_token)
      .map(({ id, name, sport, venue, schedule, door, status, created_at }) => ({ id, name, sport, venue, schedule, door, status, created_at }));
    const sent = this.replies.filter((r) => r.token === p_token).map((r) => {
      const p = this.posts.find((x) => x.id === r.post_id);
      return { id: r.id, post_id: r.post_id, to: p ? p.name : '', sport: p ? p.sport : '', note: r.note, created_at: r.created_at, open: Boolean(p && p.status === 'open') };
    });
    return { posts, suggestions, sent };
  }

  op_mine_peek({ p_token }) {
    this.checkToken(p_token);
    const mine = new Set(this.posts.filter((p) => p.token === p_token).map((p) => p.id));
    return { unseen: this.replies.filter((r) => mine.has(r.post_id) && !r.seen).length };
  }

  op_close({ p_post, p_token }) {
    this.checkToken(p_token);
    const post = this.posts.find((p) => p.id === p_post && p.token === p_token);
    if (!post) throw new BackendError('not_found');
    if (post.status === 'open') { post.status = 'closed'; post.closed_at = this.iso(); }
    return {};
  }

  op_report({ p_post, p_token }) {
    this.checkToken(p_token);
    const post = this.posts.find((p) => p.id === p_post);
    if (!post || post.status !== 'open') throw new BackendError('not_found');
    if (post.token === p_token) throw new BackendError('own_post');
    if (this.reports.some((r) => r.post_id === p_post && r.token === p_token)) return {};
    this.reports.push({ post_id: p_post, token: p_token });
    post.reports += 1;
    if (post.reports >= HIDE_AT_REPORTS) post.status = 'hidden';
    return {};
  }

  op_suggest({ p_token, p_suggestion }) {
    this.checkToken(p_token);
    const v = validateSuggestion(p_suggestion);
    if (!v.ok) throw new BackendError('bad_suggestion');
    const dayAgo = this.now() - DAY;
    if (this.suggestions.filter((s) => s.token === p_token && Date.parse(s.created_at) > dayAgo).length >= RATE.suggestionsPerDay) {
      throw new BackendError('slow_down');
    }
    const row = { id: uid(), token: p_token, ...v.value, status: 'pending', created_at: this.iso() };
    this.suggestions.push(row);
    return { id: row.id };
  }

  // Approved community suggestions, merged by the client with data/pickup.json.
  op_pickup() {
    return this.suggestions.filter((s) => s.status === 'approved')
      .map(({ id, name, sport, venue, schedule, door, link, note, created_at }) =>
        ({ id, name, sport, venue, schedule, door, link, note, source: 'community', last_checked: created_at.slice(0, 10) }));
  }

  // --------------------------------------------------------- moderation
  modOk(s) { return Boolean(this.modSecret) && s === this.modSecret; }

  op_mod_queue({ p_secret }) {
    if (!this.modOk(p_secret)) throw new BackendError('bad_secret');
    this.sweep();
    return {
      posts: this.posts.filter((p) => p.status !== 'closed')
        .sort((a, b) => b.reports - a.reports || Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((p) => ({ ...this.publicPost(p), reports: p.reports, email: p.email })),
      suggestions: this.suggestions.filter((s) => s.status === 'pending')
        .map(({ id, name, sport, venue, schedule, door, link, note, status, created_at }) => ({ id, name, sport, venue, schedule, door, link, note, status, created_at })),
      approved: this.suggestions.filter((s) => s.status === 'approved')
        .map(({ id, name, sport, venue, schedule, door, link, note, status, created_at }) => ({ id, name, sport, venue, schedule, door, link, note, status, created_at })),
    };
  }

  op_mod_post({ p_secret, p_post, p_action }) {
    if (!this.modOk(p_secret)) throw new BackendError('bad_secret');
    const i = this.posts.findIndex((p) => p.id === p_post);
    if (i < 0) throw new BackendError('not_found');
    if (p_action === 'delete') {
      this.posts.splice(i, 1);
      this.replies = this.replies.filter((r) => r.post_id !== p_post);
    } else if (p_action === 'hide') {
      this.posts[i].status = 'hidden';
    } else if (p_action === 'restore') {
      this.posts[i].status = 'open'; this.posts[i].reports = 0; this.posts[i].closed_at = null;
      this.reports = this.reports.filter((r) => r.post_id !== p_post);
    } else {
      throw new BackendError('bad_action');
    }
    return {};
  }

  op_mod_suggest({ p_secret, p_id, p_action }) {
    if (!this.modOk(p_secret)) throw new BackendError('bad_secret');
    const s = this.suggestions.find((x) => x.id === p_id);
    if (!s) throw new BackendError('not_found');
    if (p_action === 'approve') s.status = 'approved';
    else if (p_action === 'reject') s.status = 'rejected';
    else if (p_action === 'delete') this.suggestions = this.suggestions.filter((x) => x.id !== p_id);
    else throw new BackendError('bad_action');
    return {};
  }
}

// Sample calls for ?demo=1 — obviously fictional names, all "posted" in
// the last few days relative to `now`.
export function seedDemo(backend) {
  const t = backend.now();
  const mk = (token, hoursAgo, post) => {
    const saved = backend.now;
    backend.now = () => t - hoursAgo * 3600000;
    const { id } = backend.op_post({ p_token: token, p_post: post });
    backend.now = saved;
    return id;
  };
  const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32), E = 'e'.repeat(32);
  mk(A, 2,  { sport: 'tennis', level: 2, intent: 'casual', times: ['wk-pm'], place: 'South End', name: 'Priya', note: 'Rusty but fun. Leddy or the high school courts.', women_only: false, email: '' });
  mk(B, 5,  { sport: 'pickleball', level: 1, intent: 'casual', times: ['wk-am', 'weekend'], place: 'New North End', name: 'Dan', note: 'Learning. Have paddles and balls to share.', women_only: false, email: '' });
  mk(C, 9,  { sport: 'climbing', level: 1, intent: 'practice', times: ['wk-pm'], place: 'Downtown / Hill', name: 'Maya', note: 'Need a belay partner for Tuesday nights at Petra.', women_only: true, email: '' });
  mk(D, 26, { sport: 'running', level: 1, intent: 'company', times: ['wk-am'], place: 'Old North End', name: 'Theo', note: 'Easy 4–5 miles on the bike path before work.', women_only: false, email: '' });
  mk(E, 50, { sport: 'golf', level: 1, intent: 'casual', times: ['weekend'], place: 'Williston', name: 'Marcus', note: 'Walking nine on a Sunday morning. Beers after optional.', women_only: false, email: '' });
  mk(A, 70, { sport: 'cycling', level: 1, intent: 'company', times: ['weekend'], place: 'Shelburne', name: 'Priya', note: 'Shelburne to Charlotte loop, no-drop.', women_only: false, email: '' });
  mk(B, 98, { sport: 'disc-golf', level: 1, intent: 'casual', times: ['wk-pm', 'weekend'], place: 'Anywhere nearby', name: 'Dan', note: '', women_only: false, email: '' });
  return backend;
}

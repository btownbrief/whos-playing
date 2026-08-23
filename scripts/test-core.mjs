// Who's Playing — tests for the pure core and the in-memory backend that
// mirrors the SQL. Run: node --test scripts/test-core.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPORTS, PLACES, sportsForMonth, cleanText, validatePost, validateReply,
  validateSuggestion, boardView, postMeta, timeAgo, daysLeft, sportCounts, POST_DAYS,
} from '../js/core.js';
import { FakeBackend, seedDemo } from '../js/fake-backend.js';

const T0 = Date.parse('2026-08-23T18:00:00Z');
const tok = (c) => c.repeat(32);
const goodPost = {
  sport: 'tennis', level: 2, intent: 'casual', times: ['wk-pm'], place: 'South End',
  name: 'Priya', note: 'Rusty but fun', women_only: false, email: '',
};

test('catalog is internally consistent', () => {
  const ids = new Set();
  for (const s of SPORTS) {
    assert.match(s.id, /^[a-z0-9-]{1,24}$/);
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`); ids.add(s.id);
    assert.ok(s.levels.length >= 2 && s.levels.length <= 10, s.id);
    assert.ok(['warm', 'cold', 'all'].includes(s.season));
  }
  assert.ok(PLACES.every((p) => p.length <= 40));
});

test('season ordering leads with the season without hiding anything', () => {
  const jan = sportsForMonth(0), jul = sportsForMonth(6);
  assert.equal(jan.length, SPORTS.length);
  assert.equal(jan[0].season, 'cold');
  assert.equal(jul[0].season, 'warm');
  assert.equal(new Set(jan.map((s) => s.id)).size, SPORTS.length);
});

test('cleanText strips control chars, collapses space, drops URLs, clips', () => {
  assert.equal(cleanText('  hi\tthere\n\n  '), 'hi there');
  assert.equal(cleanText('call me at https://evil.example/x or www.spam.io ok'), 'call me at or ok');
  assert.equal(cleanText('abcdef', 3), 'abc');
});

test('validatePost accepts a good call and rejects each bad field', () => {
  const ok = validatePost(goodPost);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.value.name, 'Priya');
  const bad = (patch) => validatePost({ ...goodPost, ...patch });
  assert.ok('sport' in bad({ sport: 'curling' }).errors);
  assert.ok('level' in bad({ level: 9 }).errors);
  assert.ok('level' in bad({ level: '2' }).errors);
  assert.ok('intent' in bad({ intent: 'hostile' }).errors);
  assert.ok('times' in bad({ times: ['never'] }).errors);
  assert.ok('place' in bad({ place: 'Montpelier' }).errors);
  assert.ok('name' in bad({ name: '   ' }).errors);
  assert.ok('email' in bad({ email: 'nope' }).errors);
  assert.ok(bad({ email: 'Priya@Example.com' }).ok);
  assert.equal(bad({ email: 'Priya@Example.com' }).value.email, 'priya@example.com');
  assert.equal(bad({ times: ['weekend', 'wk-am', 'weekend'] }).value.times.join(), 'wk-am,weekend');
  assert.equal(bad({ note: 'x'.repeat(500) }).value.note.length, 140);
});

test('validateReply and validateSuggestion', () => {
  assert.ok(validateReply({ name: 'Dan', note: 'Hi! Tuesday works.', contact: 'dan@example.com' }).ok);
  assert.ok('contact' in validateReply({ name: 'Dan', note: 'Hi', contact: 'x' }).errors);
  assert.ok('note' in validateReply({ name: 'Dan', note: '', contact: 'dan@example.com' }).errors);
  const s = validateSuggestion({ name: 'Leddy pickleball', sport: 'pickleball', venue: 'Leddy Park', schedule: 'Most evenings', door: 'open', link: 'https://example.com', note: '' });
  assert.ok(s.ok, JSON.stringify(s.errors));
  assert.ok('link' in validateSuggestion({ name: 'X game', sport: 'soccer', venue: 'Y', schedule: 'Z', door: 'open', link: 'example.com' }).errors);
  assert.ok('door' in validateSuggestion({ name: 'X game', sport: 'soccer', venue: 'Y', schedule: 'Z', door: 'secret' }).errors);
});

test('boardView filters, sorts newest first, drops expired and closed', () => {
  const posts = [
    { id: 1, sport: 'tennis', status: 'open', created_at: new Date(T0 - 3600e3).toISOString() },
    { id: 2, sport: 'golf', status: 'open', created_at: new Date(T0 - 60e3).toISOString() },
    { id: 3, sport: 'tennis', status: 'closed', created_at: new Date(T0).toISOString() },
    { id: 4, sport: 'tennis', status: 'open', created_at: new Date(T0 - (POST_DAYS + 1) * 86400e3).toISOString() },
  ];
  assert.deepEqual(boardView(posts, { nowMs: T0 }).map((p) => p.id), [2, 1]);
  assert.deepEqual(boardView(posts, { sport: 'tennis', nowMs: T0 }).map((p) => p.id), [1]);
  assert.equal(sportCounts(posts, T0).get('tennis'), 1);
});

test('postMeta, timeAgo, daysLeft read the way the card shows them', () => {
  assert.equal(postMeta({ sport: 'tennis', level: 2, intent: 'casual', times: ['wk-pm', 'weekend'], place: 'South End' }),
    '3.5 · Casual · Weekday evenings, Weekends · South End');
  assert.equal(timeAgo(new Date(T0 - 30e3).toISOString(), T0), 'just now');
  assert.equal(timeAgo(new Date(T0 - 5 * 60e3).toISOString(), T0), '5m ago');
  assert.equal(timeAgo(new Date(T0 - 3 * 3600e3).toISOString(), T0), '3h ago');
  assert.equal(timeAgo(new Date(T0 - 26 * 3600e3).toISOString(), T0), 'yesterday');
  assert.equal(daysLeft({ created_at: new Date(T0 - 13.5 * 86400e3).toISOString() }, T0), 1);
});

test('backend: post → board → reply → mine → close, with privacy intact', async () => {
  let now = T0;
  const be = new FakeBackend({ now: () => now, modSecret: 's3cret' });
  const { id } = await be.rpc('wp_post', { p_token: tok('a'), p_post: { ...goodPost, email: 'priya@example.com' } });
  const board = await be.rpc('wp_board');
  assert.equal(board.length, 1);
  assert.ok(!('email' in board[0]), 'email must never be public');
  assert.equal(board[0].reply_count, 0);
  await assert.rejects(be.rpc('wp_reply', { p_post: id, p_token: tok('a'), p_reply: { name: 'Me', note: 'hi', contact: 'me@example.com' } }), /own_post/);
  const r = await be.rpc('wp_reply', { p_post: id, p_token: tok('b'), p_reply: { name: 'Dan', note: 'Tuesday?', contact: '802-555-0100' } });
  assert.equal(r.has_email, true);
  assert.equal((await be.rpc('wp_board'))[0].reply_count, 1);
  const mine = await be.rpc('wp_mine', { p_token: tok('a') });
  assert.equal(mine.posts[0].replies[0].contact, '802-555-0100');
  assert.equal(mine.posts[0].replies[0].seen, false);
  assert.equal((await be.rpc('wp_mine', { p_token: tok('a') })).posts[0].replies[0].seen, true);
  const sent = await be.rpc('wp_mine', { p_token: tok('b') });
  assert.equal(sent.sent[0].to, 'Priya');
  // replying again from the same device updates, doesn't duplicate
  await be.rpc('wp_reply', { p_post: id, p_token: tok('b'), p_reply: { name: 'Dan', note: 'Or Wednesday', contact: '802-555-0100' } });
  assert.equal((await be.rpc('wp_board'))[0].reply_count, 1);
  await assert.rejects(be.rpc('wp_close', { p_post: id, p_token: tok('b') }), /not_found/);
  await be.rpc('wp_close', { p_post: id, p_token: tok('a') });
  assert.equal((await be.rpc('wp_board')).length, 0);
  await assert.rejects(be.rpc('wp_reply', { p_post: id, p_token: tok('c'), p_reply: { name: 'C', note: 'late', contact: 'c@example.com' } }), /not_found/);
});

test('backend: rate limits, expiry, reports, tokens', async () => {
  let now = T0;
  const be = new FakeBackend({ now: () => now });
  await assert.rejects(be.rpc('wp_post', { p_token: 'short', p_post: goodPost }), /bad_token/);
  await assert.rejects(be.rpc('wp_post', { p_token: tok('a'), p_post: { ...goodPost, sport: 'nope' } }), /bad_post/);
  for (let i = 0; i < 3; i++) await be.rpc('wp_post', { p_token: tok('a'), p_post: goodPost });
  await assert.rejects(be.rpc('wp_post', { p_token: tok('a'), p_post: goodPost }), /slow_down/);
  now += 86400e3 + 1;
  await be.rpc('wp_post', { p_token: tok('a'), p_post: goodPost });
  await be.rpc('wp_post', { p_token: tok('a'), p_post: goodPost });
  await assert.rejects(be.rpc('wp_post', { p_token: tok('a'), p_post: goodPost }), /too_many_open/);
  assert.equal((await be.rpc('wp_board')).length, 5);
  // three reports hide a call; own reports don't count; repeat reports don't stack
  const [first] = await be.rpc('wp_board');
  await assert.rejects(be.rpc('wp_report', { p_post: first.id, p_token: tok('a') }), /own_post/);
  await be.rpc('wp_report', { p_post: first.id, p_token: tok('b') });
  await be.rpc('wp_report', { p_post: first.id, p_token: tok('b') });
  await be.rpc('wp_report', { p_post: first.id, p_token: tok('c') });
  assert.equal((await be.rpc('wp_board')).length, 5);
  await be.rpc('wp_report', { p_post: first.id, p_token: tok('d') });
  assert.equal((await be.rpc('wp_board')).length, 4);
  // expiry
  now += (POST_DAYS + 1) * 86400e3;
  assert.equal((await be.rpc('wp_board')).length, 0);
  assert.equal((await be.rpc('wp_mine', { p_token: tok('a') })).posts.every((p) => p.status !== 'open'), true);
});

test('backend: suggestions wait for approval, then show on the pickup feed', async () => {
  const be = new FakeBackend({ now: () => T0, modSecret: 'pw' });
  const sug = { name: 'Leddy pickleball', sport: 'pickleball', venue: 'Leddy Park', schedule: 'Evenings', door: 'open', link: '', note: '' };
  const { id } = await be.rpc('wp_suggest', { p_token: tok('a'), p_suggestion: sug });
  assert.equal((await be.rpc('wp_pickup')).length, 0);
  await assert.rejects(be.rpc('wp_mod_queue', { p_secret: 'wrong' }), /bad_secret/);
  const q = await be.rpc('wp_mod_queue', { p_secret: 'pw' });
  assert.equal(q.suggestions.length, 1);
  await be.rpc('wp_mod_suggest', { p_secret: 'pw', p_id: id, p_action: 'approve' });
  const feed = await be.rpc('wp_pickup');
  assert.equal(feed.length, 1);
  assert.equal(feed[0].source, 'community');
  assert.equal((await be.rpc('wp_mine', { p_token: tok('a') })).suggestions[0].status, 'approved');
});

test('backend: moderator can hide, restore, delete a call', async () => {
  const be = new FakeBackend({ now: () => T0, modSecret: 'pw' });
  const { id } = await be.rpc('wp_post', { p_token: tok('a'), p_post: goodPost });
  await be.rpc('wp_mod_post', { p_secret: 'pw', p_post: id, p_action: 'hide' });
  assert.equal((await be.rpc('wp_board')).length, 0);
  await be.rpc('wp_mod_post', { p_secret: 'pw', p_post: id, p_action: 'restore' });
  assert.equal((await be.rpc('wp_board')).length, 1);
  assert.ok('email' in (await be.rpc('wp_mod_queue', { p_secret: 'pw' })).posts[0]);
  await be.rpc('wp_mod_post', { p_secret: 'pw', p_post: id, p_action: 'delete' });
  assert.equal((await be.rpc('wp_board')).length, 0);
});

test('demo seed produces a believable board', async () => {
  const be = seedDemo(new FakeBackend({ now: () => T0 }));
  const board = await be.rpc('wp_board');
  assert.ok(board.length >= 6);
  assert.ok(board.every((p) => p.status === 'open'));
  assert.equal(board[0].name, 'Priya');
});

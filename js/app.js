// WHO'S PLAYING — the UI. Renders and dispatches; every rule lives in
// core.js and every network call in net.js. No innerHTML with user text:
// everything is built with h() and textContent.

import {
  SPORTS, PICKUP_SPORTS, INTENTS, TIMES, PLACES, DOORS, LIMITS,
  sportById, sportName, pickupSportName, intentLabel, doorLabel, sportsForMonth,
  validatePost, validateReply, validateSuggestion,
  boardView, pickupView, sportCounts, postMeta, timeAgo, daysLeft,
} from './core.js';
import {
  backend, token, isDemo, notify, explain,
  rememberedName, rememberName, rememberedEmail, rememberEmail,
} from './net.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } },
};
const myPostIds = () => new Set(JSON.parse(store.get('wp-my-posts', '[]')));
const demoIds = new Set();
const rememberMyPost = (id) => { if (isDemo()) { demoIds.add(id); return; } const s = myPostIds(); s.add(id); store.set('wp-my-posts', JSON.stringify([...s].slice(-50))); };

// tiny element builder: h('div', {class:'x', onclick}, 'text', node, ...)
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

// ------------------------------------------------------------------ state
const params = new URLSearchParams(location.search);
const state = {
  view: ['partners', 'pickup'].includes(params.get('view')) ? params.get('view') : store.get('wp-view', 'partners'),
  sport: params.get('sport') || store.get('wp-sport', 'all'),
  posts: null,          // null = loading, [] = loaded
  boardError: null,
  pickup: null,
  mine: null,
};
const be = backend();

// ------------------------------------------------------------------ toast
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ----------------------------------------------------------------- sheets
function openSheet(id) {
  const d = $(id);
  if (!d.open) d.showModal();
  d.querySelector('.sheet-inner').scrollTop = 0;
}
function closeSheet(id) { const d = $(id); if (d.open) d.close(); }
for (const d of document.querySelectorAll('dialog.sheet')) {
  // tap the backdrop (outside the inner panel) to dismiss
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
}

function sheetHead(titleId, title, sheetId, closeLabel = 'Cancel') {
  return [
    h('div', { class: 'grab' }),
    h('div', { class: 'sheet-head' },
      h('h2', { id: titleId }, title),
      h('button', { class: 'close', type: 'button', onclick: () => closeSheet(sheetId) }, closeLabel)),
  ];
}

// A field with pill options. single: value; multi: Set.
function optField({ label, options, value, multi = false, onChange, hint, name }) {
  const box = h('div', { class: 'field', dataset: { field: name } });
  const opts = h('div', { class: 'opts', role: multi ? 'group' : 'radiogroup', 'aria-label': label });
  const render = () => {
    clear(opts);
    for (const o of options) {
      const pressed = multi ? value.has(o.id) : value.v === o.id;
      opts.append(h('button', {
        type: 'button', class: 'opt', 'aria-pressed': String(pressed),
        onclick: () => {
          if (multi) { value.has(o.id) ? value.delete(o.id) : value.add(o.id); }
          else value.v = o.id;
          clearError(box); render(); onChange && onChange();
        },
      }, o.label));
    }
  };
  render();
  box.append(h('span', { class: 'label' }, label), opts);
  if (hint) box.append(h('div', { class: 'hint' }, hint));
  return box;
}
function textField({ label, name, value = '', placeholder, max, hint, multiline, type = 'text', autocomplete }) {
  const input = multiline
    ? h('textarea', { class: 'input', name, placeholder, maxlength: max, autocomplete })
    : h('input', { class: 'input', name, type, placeholder, maxlength: max, autocomplete, autocapitalize: type === 'email' ? 'off' : 'words' });
  input.value = value;
  const box = h('div', { class: 'field', dataset: { field: name } }, h('label', { class: 'label' }, label, input));
  input.addEventListener('input', () => clearError(box));
  if (hint) box.append(h('div', { class: 'hint' }, hint));
  return box;
}
function clearError(field) { field.classList.remove('bad'); field.querySelector('.err')?.remove(); }
function showErrors(root, errors) {
  for (const f of root.querySelectorAll('.field')) {
    f.classList.remove('bad');
    f.querySelector('.err')?.remove();
    const msg = errors[f.dataset.field];
    if (msg) { f.classList.add('bad'); f.append(h('div', { class: 'err' }, msg)); }
  }
  const first = root.querySelector('.field.bad');
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ------------------------------------------------------------- post sheet
function openPost(presetSport) {
  const inner = $('post-inner');
  clear(inner);
  const draft = {
    sport: { v: presetSport && presetSport !== 'all' ? presetSport : null },
    level: { v: null }, intent: { v: null }, times: new Set(), place: { v: store.get('wp-place') || null },
    women_only: false,
  };
  const month = new Date().getMonth();
  const levelSlot = h('div');
  const renderLevel = () => {
    clear(levelSlot);
    const s = sportById(draft.sport.v);
    if (!s) return;
    draft.level = draft.level.s === s.id ? draft.level : { v: null, s: s.id };
    levelSlot.append(optField({
      label: 'Your level', name: 'level',
      options: s.levels.map((l, i) => ({ id: i, label: l })), value: draft.level,
    }));
  };
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } });
  form.append(
    optField({ label: 'Sport', name: 'sport', options: sportsForMonth(month).map((s) => ({ id: s.id, label: s.name })), value: draft.sport, onChange: renderLevel }),
    levelSlot,
    optField({ label: 'Looking for', name: 'intent', options: INTENTS, value: draft.intent }),
    optField({ label: 'When', name: 'times', options: TIMES, value: draft.times, multi: true }),
    optField({ label: 'Where you are based', name: 'place', options: PLACES.map((p) => ({ id: p, label: p })), value: draft.place }),
    textField({ label: 'Your first name', name: 'name', value: rememberedName(), placeholder: 'First name', max: LIMITS.name, autocomplete: 'given-name' }),
    textField({ label: 'Anything else', name: 'note', placeholder: 'e.g. I have a guest pass at the EDGE. Rusty but fun.', max: LIMITS.note, hint: `${LIMITS.note} characters. No links.` }),
    textField({ label: 'Email for reply alerts (optional)', name: 'email', value: rememberedEmail(), type: 'email', placeholder: 'you@example.com', max: LIMITS.email, autocomplete: 'email',
      hint: 'Private. Only used to tell you someone replied. Replies also show up under Mine.' }),
    h('div', { class: 'toggle' },
      h('div', {}, h('div', { class: 't-label' }, 'Only women should reply'), h('div', { class: 't-hint' }, 'Shows as a small tag on your call.')),
      h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Only women should reply',
        onclick: (e) => { draft.women_only = !draft.women_only; e.currentTarget.setAttribute('aria-checked', String(draft.women_only)); } })),
    h('div', { class: 'actions' },
      h('div', { class: 'form-err', id: 'post-err' }),
      h('button', { class: 'btn primary', type: 'submit', id: 'post-submit' }, 'Post it')),
    h('p', { class: 'sheet-foot' }, 'Your call stays on the board for 14 days, or until you close it. Anyone can reply; only you see the replies.'),
  );
  renderLevel();
  inner.append(...sheetHead('post-title', "I'm looking to play", 'sheet-post'), form);

  async function submit() {
    const fd = new FormData(form);
    const input = {
      sport: draft.sport.v, level: draft.level.v, intent: draft.intent.v, times: [...draft.times], place: draft.place.v,
      name: fd.get('name'), note: fd.get('note'), email: fd.get('email'), women_only: draft.women_only,
    };
    const v = validatePost(input);
    showErrors(form, v.errors);
    $('post-err').textContent = '';
    if (!v.ok) return;
    const btn = $('post-submit'); btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const { id } = await be.rpc('wp_post', { p_token: token(), p_post: v.value });
      rememberMyPost(id);
      if (!isDemo()) { rememberName(v.value.name); rememberEmail(v.value.email); store.set('wp-place', v.value.place); store.set('wp-posted', '1'); }
      closeSheet('sheet-post');
      state.sport = 'all'; setView('partners');
      toast("Posted. It's on the board for 14 days.");
      await loadBoard();
    } catch (err) {
      $('post-err').textContent = explain(err);
      btn.disabled = false; btn.textContent = 'Post it';
    }
  }
  openSheet('sheet-post');
}

// ------------------------------------------------------------ reply sheet
function openReply(post) {
  const inner = $('reply-inner');
  clear(inner);
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } });
  form.append(
    h('p', { class: 'sheet-sub' }, `${sportName(post.sport)} · ${postMeta(post)}`),
    post.note ? h('p', { class: 'sheet-sub' }, `“${post.note}”`) : null,
    textField({ label: 'Your first name', name: 'name', value: rememberedName(), placeholder: 'First name', max: LIMITS.name, autocomplete: 'given-name' }),
    textField({ label: 'Your note', name: 'note', multiline: true, placeholder: 'Hi! Tuesday or Thursday evening works for me — I usually play at Leddy.', max: LIMITS.replyNote }),
    textField({ label: 'How they can reach you', name: 'contact', placeholder: 'Email, phone, or Instagram', max: LIMITS.contact, hint: `Only ${post.name} sees this.` }),
    h('div', { class: 'actions' },
      h('div', { class: 'form-err', id: 'reply-err' }),
      h('button', { class: 'btn primary', type: 'submit', id: 'reply-submit' }, 'Send')),
    h('p', { class: 'sheet-foot' }, 'Something off about this call? ',
      h('button', { type: 'button', class: 'btn danger', style: 'font-size:13px;padding:0', onclick: () => report(post) }, 'Report it'), '.'),
  );
  inner.append(...sheetHead('reply-title', `Reply to ${post.name}`, 'sheet-reply'), form);

  async function submit() {
    const fd = new FormData(form);
    const v = validateReply({ name: fd.get('name'), note: fd.get('note'), contact: fd.get('contact') });
    showErrors(form, v.errors);
    $('reply-err').textContent = '';
    if (!v.ok) return;
    const btn = $('reply-submit'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await be.rpc('wp_reply', { p_post: post.id, p_token: token(), p_reply: v.value });
      if (!isDemo()) rememberName(v.value.name);
      if (r) notify(r.id); // the edge function decides whether there's anyone to email
      closeSheet('sheet-reply');
      toast(`Sent. ${post.name} will see your note and contact.`);
      await loadBoard();
    } catch (err) {
      $('reply-err').textContent = explain(err);
      btn.disabled = false; btn.textContent = 'Send';
    }
  }
  openSheet('sheet-reply');
}

async function report(post) {
  try {
    await be.rpc('wp_report', { p_post: post.id, p_token: token() });
    closeSheet('sheet-reply');
    toast('Thanks. Three reports hide a call; Stephen sees every one.');
  } catch (err) { toast(explain(err)); }
}

// ---------------------------------------------------------- suggest sheet
function openSuggest() {
  const inner = $('suggest-inner');
  clear(inner);
  const draft = { sport: { v: state.view === 'pickup' && state.sport !== 'all' ? state.sport : null }, door: { v: null } };
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } });
  form.append(
    h('p', { class: 'sheet-sub' }, 'A standing game or group a newcomer could show up to. Stephen checks each one before it goes on the board.'),
    textField({ label: 'What is it called', name: 'name', placeholder: 'e.g. Tuesday night pickup at Leddy', max: LIMITS.suggestName }),
    optField({ label: 'Sport', name: 'sport', options: PICKUP_SPORTS.map((s) => ({ id: s.id, label: s.name })), value: draft.sport }),
    textField({ label: 'Where', name: 'venue', placeholder: 'Venue or park', max: LIMITS.venue }),
    textField({ label: 'When', name: 'schedule', placeholder: 'e.g. Tuesdays 6–8pm, May–Oct', max: LIMITS.schedule }),
    optField({ label: 'Can a newcomer just show up?', name: 'door', options: DOORS, value: draft.door }),
    textField({ label: 'Link (optional)', name: 'link', type: 'url', placeholder: 'https://…', max: LIMITS.link, hint: 'A page, group, or post that confirms it.' }),
    textField({ label: 'Anything else', name: 'note', placeholder: 'Cost, who runs it, how to ask first', max: LIMITS.suggestNote }),
    h('div', { class: 'actions' },
      h('div', { class: 'form-err', id: 'suggest-err' }),
      h('button', { class: 'btn primary', type: 'submit', id: 'suggest-submit' }, 'Suggest it')),
  );
  inner.append(...sheetHead('suggest-title', 'Suggest a game', 'sheet-suggest'), form);

  async function submit() {
    const fd = new FormData(form);
    const v = validateSuggestion({ name: fd.get('name'), sport: draft.sport.v, venue: fd.get('venue'), schedule: fd.get('schedule'), door: draft.door.v, link: fd.get('link'), note: fd.get('note') });
    showErrors(form, v.errors);
    $('suggest-err').textContent = '';
    if (!v.ok) return;
    const btn = $('suggest-submit'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await be.rpc('wp_suggest', { p_token: token(), p_suggestion: v.value });
      if (!isDemo()) store.set('wp-posted', '1');
      closeSheet('sheet-suggest');
      toast("Thanks. It'll show up once it's checked.");
    } catch (err) {
      $('suggest-err').textContent = explain(err);
      btn.disabled = false; btn.textContent = 'Suggest it';
    }
  }
  openSheet('sheet-suggest');
}

// ------------------------------------------------------------- mine sheet
async function openMine() {
  const inner = $('mine-inner');
  clear(inner);
  inner.append(...sheetHead('mine-title', 'Mine', 'sheet-mine', 'Done'), h('p', { class: 'status' }, 'Looking…'));
  openSheet('sheet-mine');
  let mine;
  try { mine = await be.rpc('wp_mine', { p_token: token() }); }
  catch (err) { inner.lastChild.textContent = explain(err); return; }
  state.mine = mine; setBadge(0);
  clear(inner);
  inner.append(...sheetHead('mine-title', 'Mine', 'sheet-mine', 'Done'));
  const now = Date.now();
  if (!mine.posts.length && !mine.sent.length && !mine.suggestions.length) {
    inner.append(h('div', { class: 'empty' }, h('strong', {}, 'Nothing yet'), 'Calls you post, replies you send, and games you suggest show up here — on this device.'));
    return;
  }
  if (mine.posts.length) {
    const sec = h('div', { class: 'mine-section' }, h('h3', {}, 'Your calls'));
    for (const p of mine.posts) {
      const open = p.status === 'open';
      const card = h('article', { class: `card${open ? '' : ' closed'}` },
        h('div', { class: 'who' }, h('span', { class: 'name' }, sportName(p.sport)), h('span', { class: 'state' }, open ? `${daysLeft(p, now)} days left` : p.status === 'hidden' ? 'hidden' : 'closed')),
        h('div', { class: 'meta' }, postMeta(p)),
        p.note ? h('p', { class: 'note' }, p.note) : null,
      );
      if (!p.replies.length) card.append(h('p', { class: 'note', style: 'color:var(--ink-3)' }, open ? 'No replies yet.' : 'No replies.'));
      for (const r of p.replies) {
        card.append(h('div', { class: `reply${r.seen ? '' : ' unseen'}` },
          h('div', { class: 'r-head' }, h('span', { class: 'r-name' }, r.name), h('span', { class: 'r-when' }, timeAgo(r.created_at, now))),
          h('p', { class: 'r-note' }, r.note),
          h('div', { class: 'r-contact' }, r.contact)));
      }
      if (open) {
        card.append(h('div', { class: 'foot' }, h('span', { class: 'when' }, p.email ? `Alerts to ${p.email}` : 'No email on file — check back here.'),
          h('button', { type: 'button', class: 'btn', onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true;
            try { await be.rpc('wp_close', { p_post: p.id, p_token: token() }); toast('Closed. Nice.'); await loadBoard(); openMine(); }
            catch (err) { toast(explain(err)); btn.disabled = false; }
          } }, 'Found someone')));
      }
      sec.append(card);
    }
    inner.append(sec);
  }
  if (mine.sent.length) {
    const sec = h('div', { class: 'mine-section' }, h('h3', {}, 'Replies you sent'));
    for (const r of mine.sent) {
      sec.append(h('article', { class: `card${r.open ? '' : ' closed'}` },
        h('div', { class: 'who' }, h('span', { class: 'name' }, `To ${r.to}`), h('span', { class: 'sport' }, sportName(r.sport)), h('span', { class: 'state' }, r.open ? timeAgo(r.created_at, now) : 'call closed')),
        h('p', { class: 'note' }, r.note)));
    }
    sec.append(h('p', { class: 'hint', style: 'font-size:13px;color:var(--ink-3)' }, "If they're interested, they'll reach out using the contact you left."));
    inner.append(sec);
  }
  if (mine.suggestions.length) {
    const sec = h('div', { class: 'mine-section' }, h('h3', {}, 'Games you suggested'));
    for (const s of mine.suggestions) {
      sec.append(h('article', { class: 'card pick' },
        h('div', { class: 'who' }, h('span', { class: 'name' }, s.name), h('span', { class: 'state' }, s.status === 'approved' ? 'on the board' : s.status === 'pending' ? 'waiting for a check' : 'not added')),
        h('div', { class: 'venue' }, `${pickupSportName(s.sport)} · ${s.venue}`), h('div', { class: 'sched' }, s.schedule)));
    }
    inner.append(sec);
  }
}
function setBadge(n) { $('open-mine').dataset.badge = n > 0 ? '1' : '0'; }
async function checkBadge() {
  if (store.get('wp-posted') !== '1') return;
  try {
    const mine = await be.rpc('wp_mine_peek', { p_token: token() });
    setBadge(mine.unseen || 0);
  } catch { /* no peek RPC: fall back silently */ }
}

// ------------------------------------------------------------------ views
function setView(v) {
  state.view = v; store.set('wp-view', v);
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  $('fab').textContent = v === 'pickup' ? 'Suggest a game' : "I'm looking to play";
  if (v === 'pickup' && state.pickup === null) loadPickup();
  // a sport picked on one board carries over only if it exists on the other
  const valid = v === 'pickup' ? PICKUP_SPORTS.some((s) => s.id === state.sport) : SPORTS.some((s) => s.id === state.sport);
  if (!valid) state.sport = 'all';
  render();
}
function setSport(id) { state.sport = id; store.set('wp-sport', id); render(); }

function renderChips() {
  const box = $('chips');
  clear(box);
  const now = Date.now();
  let items;
  if (state.view === 'partners') {
    const counts = sportCounts(state.posts || [], now);
    items = [{ id: 'all', label: 'All', n: boardView(state.posts || [], { nowMs: now }).length },
      ...sportsForMonth(new Date().getMonth()).map((s) => ({ id: s.id, label: s.name, n: counts.get(s.id) || 0 }))];
  } else {
    const present = new Map();
    for (const e of state.pickup || []) present.set(e.sport, (present.get(e.sport) || 0) + 1);
    items = [{ id: 'all', label: 'All', n: (state.pickup || []).length },
      ...PICKUP_SPORTS.filter((s) => present.has(s.id)).map((s) => ({ id: s.id, label: s.name, n: present.get(s.id) }))];
  }
  for (const it of items) {
    const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.sport === it.id), onclick: () => setSport(it.id) }, it.label);
    if (it.n) chip.append(h('span', { class: 'n' }, String(it.n)));
    box.append(chip);
  }
  const sel = box.querySelector('[aria-pressed="true"]');
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function postCard(p, now, mine) {
  const card = h('article', { class: 'card', dataset: { id: p.id } },
    h('div', { class: 'who' },
      h('span', { class: 'name' }, p.name),
      h('span', { class: 'sport' }, sportName(p.sport)),
      p.women_only ? h('span', { class: 'tag' }, 'Women only') : null,
      mine ? h('span', { class: 'tag' }, 'Yours') : null),
    h('div', { class: 'meta' }, postMeta(p)),
    p.note ? h('p', { class: 'note' }, p.note) : null,
    h('div', { class: 'foot' },
      h('span', { class: 'when' }, timeAgo(p.created_at, now), p.reply_count ? ` · ${p.reply_count} ${p.reply_count === 1 ? 'reply' : 'replies'}` : ''),
      mine
        ? h('button', { type: 'button', class: 'btn', onclick: openMine }, 'Manage')
        : h('button', { type: 'button', class: 'btn primary', onclick: () => openReply(p) }, 'Reply')));
  return card;
}

function pickupCard(e) {
  const door = e.door || 'open';
  const card = h('article', { class: 'card pick' },
    h('div', { class: 'name' }, e.name),
    h('div', { class: 'venue' }, e.venue + (e.area ? ` · ${e.area}` : '')),
    h('div', { class: 'sched' }, e.schedule),
    e.note ? h('p', { class: 'note' }, e.note) : null,
    h('div', { class: 'row' },
      h('span', { class: `door ${door}` }, doorLabel(door)),
      e.cost ? h('span', { class: 'cost' }, e.cost) : null,
      e.link ? h('a', { class: 'src', href: e.link, target: '_blank', rel: 'noopener' }, 'Details ↗') : null),
    e.last_checked ? h('div', { class: 'checked' }, `Checked ${new Date(e.last_checked + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}${e.source === 'community' ? ' · suggested by a reader' : ''}`) : null,
  );
  return card;
}

function render() {
  renderChips();
  const list = $('list'); clear(list);
  const status = $('status'); status.textContent = '';
  const now = Date.now();
  if (state.view === 'partners') {
    if (state.boardError) {
      list.append(h('div', { class: 'empty' }, h('strong', {}, explain(state.boardError)),
        state.boardError.code === 'not_ready' ? 'The pickup games board works in the meantime.' : '',
        h('div', {}, h('button', { type: 'button', class: 'btn', onclick: loadBoard }, 'Try again'))));
      return;
    }
    if (state.posts === null) { status.textContent = 'Loading…'; return; }
    const rows = boardView(state.posts, { sport: state.sport, nowMs: now });
    if (!rows.length) {
      const name = state.sport === 'all' ? '' : sportName(state.sport);
      list.append(h('div', { class: 'empty' },
        h('strong', {}, name ? `Nobody's posted for ${name.toLowerCase()} yet` : "Nobody's looking right now"),
        'Be the first. It takes about twenty seconds.',
        h('div', {}, h('button', { type: 'button', class: 'btn primary', onclick: () => openPost(state.sport) }, "I'm looking to play"))));
      return;
    }
    const mine = isDemo() ? demoIds : myPostIds();
    for (const p of rows) list.append(postCard(p, now, mine.has(p.id)));
    if (isDemo()) status.textContent = 'Demo board — sample calls, nothing is saved.';
  } else {
    if (state.pickup === null) { status.textContent = 'Loading…'; return; }
    const rows = pickupView(state.pickup, { sport: state.sport });
    if (!rows.length) {
      list.append(h('div', { class: 'empty' }, h('strong', {}, 'Nothing listed yet'), 'Know a standing game? Suggest it and Stephen will check it.',
        h('div', {}, h('button', { type: 'button', class: 'btn primary', onclick: openSuggest }, 'Suggest a game'))));
      return;
    }
    let last = null;
    for (const e of rows) {
      if (e.sport !== last) { list.append(h('div', { class: 'group-head' }, pickupSportName(e.sport))); last = e.sport; }
      list.append(pickupCard(e));
    }
    status.textContent = 'Door policy is set by whoever runs the game, not by us. Schedules change — tap Details before you go.';
  }
}

// ------------------------------------------------------------------- data
async function loadBoard() {
  state.boardError = null;
  try { state.posts = await be.rpc('wp_board'); }
  catch (err) { state.boardError = err; state.posts = []; }
  render();
}
let pickupLoading = false;
async function loadPickup() {
  if (pickupLoading) return;
  pickupLoading = true;
  const [staticRes, liveRes] = await Promise.allSettled([
    fetch('data/pickup.json', { cache: 'no-cache' }).then((r) => r.json()),
    be.rpc('wp_pickup'),
  ]);
  const curated = staticRes.status === 'fulfilled' ? (staticRes.value.entries || []) : [];
  const live = liveRes.status === 'fulfilled' && Array.isArray(liveRes.value) ? liveRes.value : [];
  state.pickup = [...curated, ...live];
  pickupLoading = false;
  render();
}

// ------------------------------------------------------------------- wire
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => setView(b.dataset.view));
$('fab').addEventListener('click', () => (state.view === 'pickup' ? openSuggest() : openPost(state.sport)));
$('open-mine').addEventListener('click', openMine);
$('open-rules').addEventListener('click', (e) => { e.preventDefault(); openSheet('sheet-rules'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'partners') loadBoard(); });

setView(state.view);
loadBoard();
loadPickup();
checkBadge();

// WHO'S PLAYING — the pure core. No DOM, no fetch, no clocks (time is an
// argument). Everything the UI and the backend agree on lives here: the
// sport catalog, the option lists, the validators (mirrored one-for-one by
// supabase/whos-playing-SETUP.sql), and the board's filter/sort rules.
// scripts/test-core.mjs exercises all of it in plain Node.

export const APP = 'whos-playing';
export const APP_NAME = "Who's Playing";
export const POST_DAYS = 14;            // an open call lasts this long
export const LIMITS = {
  name: 24, note: 140, email: 120,
  replyNote: 280, contact: 120,
  suggestName: 60, venue: 80, schedule: 120, link: 200, suggestNote: 200,
};

// season: 'warm' (roughly Apr–Oct), 'cold' (Nov–Mar), or 'all'. The chip
// row is re-ordered by season so the screen leads with what people are
// actually playing this month; nothing is ever hidden.
export const SPORTS = [
  { id: 'tennis',       name: 'Tennis',            season: 'warm', levels: ['New to it', '2.5–3.0', '3.5', '4.0', '4.5+'] },
  { id: 'pickleball',   name: 'Pickleball',        season: 'all',  levels: ['New to it', 'Social', '3.5', '4.0', '4.5+'] },
  { id: 'running',      name: 'Running',           season: 'all',  levels: ['11+ min/mi', '9–10 min/mi', '8 min/mi', '7 min/mi or faster'] },
  { id: 'climbing',     name: 'Climbing',          season: 'all',  levels: ['Top-rope 5.6–5.9', 'Top-rope 5.10s', 'Lead 5.11+', 'Boulder V0–V2', 'Boulder V3–V5', 'Boulder V6+'] },
  { id: 'golf',         name: 'Golf',              season: 'warm', levels: ['Just for fun', 'Bogey golfer', 'Breaks 90', 'Single digit'] },
  { id: 'disc-golf',    name: 'Disc golf',         season: 'warm', levels: ['New to it', 'Casual', 'League', 'Tournament'] },
  { id: 'cycling',      name: 'Cycling',           season: 'warm', levels: ['Casual, ~12 mph', 'Steady, ~15 mph', 'Fast, 18+ mph', 'Gravel / MTB'] },
  { id: 'swimming',     name: 'Open-water swim',   season: 'warm', levels: ['Short and close to shore', 'Half mile', 'A mile or more'] },
  { id: 'paddling',     name: 'Kayak / SUP',       season: 'warm', levels: ['Calm water only', 'Fine in chop'] },
  { id: 'squash',       name: 'Squash',            season: 'all',  levels: ['New to it', 'Casual', 'Club player', 'Ladder'] },
  { id: 'racquetball',  name: 'Racquetball',       season: 'all',  levels: ['New to it', 'Casual', 'Club player', 'Ladder'] },
  { id: 'table-tennis', name: 'Table tennis',      season: 'all',  levels: ['Basement', 'Decent', 'Club', 'Tournament'] },
  { id: 'basketball',   name: 'Basketball 1-on-1', season: 'all',  levels: ['Shootaround', 'Rec league', 'Played in high school', 'Played in college'] },
  { id: 'skiing',       name: 'Ski / ride',        season: 'cold', levels: ['Green', 'Blue', 'Black', 'Glades and trees'] },
  { id: 'backcountry',  name: 'Backcountry',       season: 'cold', levels: ['New, no avalanche cert', 'AIARE 1', 'AIARE 2+'] },
  { id: 'xc-ski',       name: 'Cross-country ski', season: 'cold', levels: ['Easy loops', 'Steady', 'Skate ski'] },
  { id: 'skating',      name: 'Skating / pond hockey', season: 'cold', levels: ['Wobbly', 'Comfortable', 'Played hockey'] },
  { id: 'hiking',       name: 'Hike / snowshoe',   season: 'all',  levels: ['Easy', 'Moderate', 'Big days'] },
  { id: 'other',        name: 'Something else',    season: 'all',  levels: ['Beginner', 'Intermediate', 'Advanced'] },
];

export const INTENTS = [
  { id: 'casual',   label: 'Casual' },
  { id: 'compete',  label: 'Competitive' },
  { id: 'practice', label: 'Practice' },
  { id: 'company',  label: 'Company' },
];

export const TIMES = [
  { id: 'wk-am',   label: 'Weekday mornings' },
  { id: 'wk-day',  label: 'Weekday daytime' },
  { id: 'wk-pm',   label: 'Weekday evenings' },
  { id: 'weekend', label: 'Weekends' },
];

export const PLACES = [
  'Downtown / Hill', 'Old North End', 'New North End', 'South End',
  'Winooski', 'South Burlington', 'Essex', 'Williston', 'Colchester',
  'Shelburne', 'Anywhere nearby',
];

// Door policy for a standing game — set by whoever runs it, never by us.
export const DOORS = [
  { id: 'open',    label: 'Just show up' },
  { id: 'ask',     label: 'Ask first' },
  { id: 'members', label: 'Members' },
  { id: 'full',    label: 'Full right now' },
];

// Pickup sports are the team/group games that live on the board only.
export const PICKUP_SPORTS = [
  { id: 'basketball', name: 'Basketball' }, { id: 'soccer', name: 'Soccer' },
  { id: 'ultimate', name: 'Ultimate' }, { id: 'volleyball', name: 'Volleyball' },
  { id: 'hockey', name: 'Hockey' }, { id: 'skating', name: 'Skating' },
  { id: 'pickleball', name: 'Pickleball' }, { id: 'tennis', name: 'Tennis' },
  { id: 'squash', name: 'Squash' }, { id: 'racquetball', name: 'Racquetball' },
  { id: 'running', name: 'Running' }, { id: 'cycling', name: 'Cycling' },
  { id: 'disc-golf', name: 'Disc golf' }, { id: 'climbing', name: 'Climbing' },
  { id: 'table-tennis', name: 'Table tennis' }, { id: 'xc-ski', name: 'Cross-country ski' },
  { id: 'other', name: 'Other' },
];

// The masthead photo follows the season. Photos are Stephen's, from the
// City Guide; focus = object-position for the crop.
export const MASTHEADS = [
  { id: 'winter', src: 'assets/img/shore-winter.jpg', focus: '50% 62%', alt: 'First light over Lake Champlain, snow along the shore' },
  { id: 'fall',   src: 'assets/img/park-fall.jpg',    focus: '50% 38%', alt: 'Maples in full color over a Burlington park' },
  { id: 'summer', src: 'assets/img/field-dusk.jpg',   focus: '50% 72%', alt: 'A soccer game under the lights at Virtue Field as the sky goes blue' },
];
export function mastheadFor(month) {
  if (month === 11 || month <= 2) return MASTHEADS[0];
  if (month === 9 || month === 10) return MASTHEADS[1];
  return MASTHEADS[2];
}

export const sportById = (id) => SPORTS.find((s) => s.id === id) || null;
export const sportName = (id) =>
  (sportById(id) || PICKUP_SPORTS.find((s) => s.id === id) || { name: id }).name;
export const pickupSportName = (id) => (PICKUP_SPORTS.find((s) => s.id === id) || { name: id }).name;
export const intentLabel = (id) => (INTENTS.find((i) => i.id === id) || { label: id }).label;
export const timeLabel = (id) => (TIMES.find((t) => t.id === id) || { label: id }).label;
export const doorLabel = (id) => (DOORS.find((d) => d.id === id) || { label: id }).label;

// Nov–Mar lead with cold sports; Apr–Oct with warm. 'all' sports keep
// their catalog order among themselves. month is 0-based (Date#getMonth).
export function sportsForMonth(month) {
  const cold = month <= 2 || month >= 10;
  const rank = (s) => (s.season === 'all' ? 1 : (s.season === 'cold') === cold ? 0 : 2);
  return SPORTS.map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map((x) => x.s);
}

// --------------------------------------------------------------- cleaning
// Mirrors the SQL: control characters → space, whitespace collapsed,
// trimmed. URLs are stripped from the public text fields so the board can
// never be used as a link farm; contact info is the only place a link
// belongs and that's private to the poster.
export function cleanText(s, max) {
  let t = String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\s+/g, ' ').trim();
  return max ? t.slice(0, max) : t;
}
export function cleanContact(s) {
  return String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.contact);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const looksLikeEmail = (s) => EMAIL_RE.test(String(s ?? '').trim());
const TOKEN_RE = /^[a-f0-9]{32}$/;
export const validToken = (t) => TOKEN_RE.test(String(t ?? ''));

// ------------------------------------------------------------- validation
// Each validator returns { ok, errors: {field: message}, value } where value
// is the cleaned record the backend should receive.
export function validatePost(input) {
  const errors = {};
  const sport = sportById(input?.sport);
  if (!sport) errors.sport = 'Pick a sport.';
  const level = typeof input?.level === 'number' ? input.level : -1;
  if (sport && !(level >= 0 && level < sport.levels.length)) errors.level = 'Pick your level.';
  const intent = INTENTS.some((i) => i.id === input?.intent) ? input.intent : null;
  if (!intent) errors.intent = 'What are you looking for?';
  const times = Array.from(new Set((input?.times || []).filter((t) => TIMES.some((x) => x.id === t))));
  if (!times.length) errors.times = 'When can you play?';
  const place = PLACES.includes(input?.place) ? input.place : null;
  if (!place) errors.place = 'Where are you based?';
  const name = cleanText(input?.name, LIMITS.name);
  if (name.length < 1) errors.name = 'Your first name.';
  const note = cleanText(input?.note, LIMITS.note);
  const emailRaw = String(input?.email ?? '').trim().slice(0, LIMITS.email);
  if (emailRaw && !looksLikeEmail(emailRaw)) errors.email = "That email doesn't look right.";
  const value = {
    sport: sport?.id, level, intent, times: TIMES.filter((t) => times.includes(t.id)).map((t) => t.id),
    place, name, note, women_only: Boolean(input?.women_only), email: emailRaw.toLowerCase(),
  };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function validateReply(input) {
  const errors = {};
  const name = cleanText(input?.name, LIMITS.name);
  if (name.length < 1) errors.name = 'Your first name.';
  const note = cleanText(input?.note, LIMITS.replyNote);
  if (note.length < 1) errors.note = 'Say hello — even a sentence.';
  const contact = cleanContact(input?.contact);
  if (contact.length < 3) errors.contact = 'How should they reach you?';
  return { ok: Object.keys(errors).length === 0, errors, value: { name, note, contact } };
}

export function validateSuggestion(input) {
  const errors = {};
  const name = cleanText(input?.name, LIMITS.suggestName);
  if (name.length < 2) errors.name = 'What is it called?';
  const sport = PICKUP_SPORTS.some((s) => s.id === input?.sport) ? input.sport : null;
  if (!sport) errors.sport = 'Pick a sport.';
  const venue = cleanText(input?.venue, LIMITS.venue);
  if (venue.length < 2) errors.venue = 'Where is it?';
  const schedule = cleanText(input?.schedule, LIMITS.schedule);
  if (schedule.length < 2) errors.schedule = 'When does it happen?';
  const door = DOORS.some((d) => d.id === input?.door) ? input.door : null;
  if (!door) errors.door = 'Can a newcomer just show up?';
  let link = String(input?.link ?? '').trim().slice(0, LIMITS.link);
  if (link && !/^https?:\/\/\S+$/i.test(link)) errors.link = 'Links need to start with http:// or https://';
  const note = cleanText(input?.note, LIMITS.suggestNote);
  return { ok: Object.keys(errors).length === 0, errors, value: { name, sport, venue, schedule, door, link, note } };
}

// ------------------------------------------------------------------ board
export function isExpired(post, nowMs) {
  return nowMs - Date.parse(post.created_at) > POST_DAYS * 86400000;
}
export function boardView(posts, { sport = 'all', nowMs }) {
  return (posts || [])
    .filter((p) => p.status === 'open' && !(nowMs && isExpired(p, nowMs)))
    .filter((p) => sport === 'all' || p.sport === sport)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
export function pickupView(entries, { sport = 'all' }) {
  const list = (entries || []).filter((e) => sport === 'all' || e.sport === sport);
  const order = new Map(PICKUP_SPORTS.map((s, i) => [s.id, i]));
  return list.sort((a, b) =>
    (order.get(a.sport) ?? 99) - (order.get(b.sport) ?? 99) || a.name.localeCompare(b.name));
}
// Sports that currently have at least one open call, for the chip counts.
export function sportCounts(posts, nowMs) {
  const m = new Map();
  for (const p of boardView(posts, { nowMs })) m.set(p.sport, (m.get(p.sport) || 0) + 1);
  return m;
}

// "3.5 · Casual · Weekday evenings · South End"
export function postMeta(p) {
  const s = sportById(p.sport);
  const level = s ? s.levels[p.level] ?? '' : '';
  const times = (p.times || []).map(timeLabel).join(', ');
  return [level, intentLabel(p.intent), times, p.place].filter(Boolean).join(' · ');
}

export function timeAgo(iso, nowMs) {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function daysLeft(post, nowMs) {
  return Math.max(0, Math.ceil((Date.parse(post.created_at) + POST_DAYS * 86400000 - nowMs) / 86400000));
}

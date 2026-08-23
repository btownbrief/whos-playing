# Who's Playing — agent notes

Read `README.md` first. Stephen is non-technical — explain consequential
changes in plain language. Plain static site, no build step, ES modules.

## Rules that will trip you up

- **`js/core.js` is pure and that purity is the contract.** No DOM, no
  fetch, no `Date.now()` — time is an argument. Every validator there is
  mirrored one-for-one by `supabase/whos-playing-SETUP.sql` (`wp_clean`,
  `wp_valid_sport`, `wp_level_count`, `wp_valid_place`, limits, rate
  limits) and by `js/fake-backend.js`. **Change all three together**, and
  add a case to `scripts/test-core.mjs`. Adding a sport = add to `SPORTS`
  (and `PICKUP_SPORTS` if it's a group game) + the two SQL lists.
- **Privacy shape is load-bearing.** `email` on a post and `contact` on a
  reply are returned ONLY by `wp_mine` (token-gated) and `wp_mod_queue`
  (secret-gated). `wp_public()` is the only public projection; never add
  private columns to it or to `wp_board`. Public text fields are URL-stripped
  server-side (`wp_clean`) so the board can't become a link farm.
- **The device token is the only identity.** 32 hex chars minted in
  localStorage, stored hashed (sha256) server-side, never shown. There is no
  login and no recovery: a new browser is a new person. Don't add accounts.
- **Fail soft, never error-state.** No SQL yet → `not_ready` → "isn't
  switched on yet", and the pickup board keeps working from the static
  JSON. `?demo=1` runs the whole thing against `FakeBackend` with seeded
  calls and saves nothing.
- **Moderation is light by design.** Calls go live immediately (a classified
  that waits a day is useless); three reports auto-hide; `mod.html` (linked
  nowhere, bcrypt-gated via `wp_mod_hash`) can hide/restore/delete and
  approves suggested games. The secret lives in sessionStorage only. If you
  change the threshold, change the toast copy in `app.js` too.
- **Door policy is the organizer's word.** Never infer it; never add a
  "join" button. The app governs the listing, not the relationship.
- **Design doctrine: the board is the home screen, many dimensions → few
  controls.** A new facet goes on the card's meta line or in the post sheet,
  not as a new filter control. Sport chips are the only filter. One accent
  color, system type, dark mode by tokens only.
- **`data/pickup.json` must stay sourced.** Every entry: https link that
  states the schedule, `last_checked`, `source: "curated"`.
  `scripts/check-pickup.mjs` runs in CI. Community entries come from
  `wp_pickup()` (approved suggestions) and are merged on the client, never
  written into this file by code.
- **Honest threat model.** The anon key is public; a determined Sybil can
  post junk. Rate limits + validation + reports + the back room stop casual
  mischief. Don't present anything here as integrity-protected.

## Before you finish

```
node --test scripts/test-core.mjs
node scripts/check-pickup.mjs
for f in js/*.js; do node --check "$f"; done
NODE_PATH=<playwright dir> node scripts/playtest.mjs   # UI flow + screenshots
```

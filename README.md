# Who's Playing

Partners and pickup games in Burlington, Vermont. Two boards, one screen:

- **Looking to play** — short public "calls": *Priya · Tennis · 3.5 · Casual ·
  Weekday evenings · South End*. Anyone can reply; only the poster sees the
  replies (and the replier's contact). Calls last 14 days or until the
  poster taps "Found someone."
- **Pickup games** — standing drop-in games a newcomer could actually show
  up to, with the organizer's door policy (Just show up / Ask first /
  Members / Full right now). Curated in `data/pickup.json`; readers can
  suggest more, which wait for approval in `mod.html`.

Live (once deployed): https://play.btownbrief.com/whos-playing/ — try
`?demo=1` for a seeded sample board that saves nothing.

Plain static site, no build step, no accounts. Same Supabase project and
security model as the rest of the Btown fleet.

## Files

| | |
|---|---|
| `index.html`, `css/style.css` | the one screen, both boards, four sheets |
| `js/core.js` | **pure**: sport catalog, option lists, validators, board rules. Mirrored by the SQL. |
| `js/fake-backend.js` | in-memory twin of the SQL — runs `?demo=1` and the tests |
| `js/net.js` | Supabase RPC client, device token, plain-language error copy |
| `js/app.js` | UI only: renders and dispatches |
| `data/pickup.json` | curated standing games (every entry sourced + dated) |
| `mod.html` | the back room: reports, hide/delete, approve suggestions (linked from nowhere) |
| `supabase/whos-playing-SETUP.sql` | the whole backend; paste once |
| `supabase/functions/wp-notify/` | optional "someone replied" email (Resend) |
| `scripts/test-core.mjs` | core + backend-mirror tests (`node --test`) |
| `scripts/check-pickup.mjs` | pickup data stays sourced |
| `scripts/playtest.mjs` | Playwright run of the real UI in demo mode, with screenshots |

## Run it

```
node --test scripts/test-core.mjs
node scripts/check-pickup.mjs
python3 -m http.server 8000      # then open http://localhost:8000/?demo=1
NODE_PATH=/path/to/node_modules node scripts/playtest.mjs   # needs playwright
```

## Ship checklist (Stephen)

1. **Repo + Pages.** Create `btownbrief/whos-playing` on GitHub, push `main`,
   Settings → Pages → deploy from branch `main` / root. It appears at
   `play.btownbrief.com/whos-playing/` like every other arcade repo.
2. **Backend.** Supabase → SQL Editor. First make your moderator hash:
   `select extensions.crypt('YOUR-SECRET', extensions.gen_salt('bf', 10));`
   Paste the result into `wp_mod_hash()` in `supabase/whos-playing-SETUP.sql`,
   then paste and run the whole file. Until then the partner board says
   "isn't switched on yet" and the pickup board works anyway.
3. **Back room.** Open `/whos-playing/mod.html`, enter the secret. Bookmark it.
4. **Optional email alerts.** `supabase functions deploy wp-notify` +
   `supabase secrets set RESEND_API_KEY=… NOTIFY_FROM="Who's Playing <hello@btownbrief.com>"`
   (Resend needs the sending domain verified). Without it, replies simply
   wait under Mine — the app says so.
5. **Register it** (three places, like Table Talk taught us):
   - hub `index.html` + btown-brief `data/catalog.json` (a "Join in" card:
     *Who's Playing — find someone to play with, or find the game*),
   - `btownbrief.github.io/games.json` so the ⌘K palette and arcade know it
     (`{"slug":"whos-playing","name":"Who's Playing","emoji":"🎾","pitch":"Find someone to play with — or find the game. Partners and pickup sports, Burlington only.","section":"local-more","live":true,"leaderboard":false}`),
   - newsletter: link sport-filtered views, e.g. `?sport=pickleball`, `?view=pickup`.
6. **Keep `data/pickup.json` honest.** Every entry needs a source link that
   states the schedule and a `last_checked` date; `scripts/check-pickup.mjs`
   enforces the shape, you enforce the truth. Re-check before each season flips.

## Design rules

- The board is the home screen. You never answer a question to see what's
  there; filters are chips you *can* touch.
- Many dimensions, few controls: level, intent, when, where all live on the
  card as one line. New facets go in the card or in settings, not in a new
  control.
- No swipe deck, no open DMs, no GPS, no accounts. Reply = a note + how to
  reach you, visible to the poster alone.
- Door policy is the organizer's word, never ours. There is no "join" button
  — the board says where, when, and whether to ask first; showing up is the
  join.
- Nothing is vetted and the copy says so. Women-only is a poster's choice,
  shown as a tag.

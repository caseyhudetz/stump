# Stump

A civic web app for the Chicago 44th Ward. It finds parkway tree pits where
the city removed a tree but nobody filed a replanting request, so one person
can walk or bike the ward, confirm the pit is empty, and file a 311 planting
request from the pavement.

The user is the surveyor. Everything is built for one thumb, outdoors, on an
iPhone, possibly moving.

## Layout

    public/index.html   the app — HTML, CSS and JS in one file, no build
    public/match.js     the matching rules, shared by the page and the Worker
    src/worker.js       Worker: /api/marks, /api/watch, /api/patterns, the cron
    src/patterns.js     do saplings survive here — the analysis behind that page
    wrangler.jsonc      Worker name, KV binding, cron trigger
    test/               see "Tests" below

`public/index.html` is ~3,600 lines and deliberately single-file: served as
a static asset, no build step, readable end to end. Keep it that way.

`public/match.js` is the one exception, and it earns it: which removals count
as empty pits and what counts as a request already covering one are needed by
the page *and* by the nightly watch, and two copies of a rule that fiddly
drift. It is loaded twice — as a classic `<script>` before the page's own
script (so its functions are globals in time), and imported by the Worker at
bundle time. Hence the guarded `module.exports` at the bottom rather than an
`export` statement: `export` would break the script tag.

**Verify a bundle before pushing**: `node_modules/.bin/wrangler deploy
--dry-run`. Wrangler is a devDependency now, so a broken import is caught
here rather than by a failed deploy.

## Deploying

Cloudflare's **Git integration** deploys on push to `main`. It is bound to an
existing Worker service, so **renaming `name` in `wrangler.jsonc` does not
create a new Worker — it fails the build**. A new hostname means connecting
the repo to a new Worker in the dashboard. This has bitten before.

KV binding `MARKS`, namespace id in `wrangler.jsonc`. Without it `/api/marks`
answers 503 and the app falls back to device-local storage, which is a real
supported mode, not a broken one.

## Tests

    sh test/run.sh                 all of them (takes ~15 min)
    sh test/run.sh trail swipe     just those
    sh test/run.sh watch wlog      the Worker's own logic, seconds, no browser

First run fetches the map libraries from npm into `test/vendor/`
(gitignored). The runner starts its own static server on `$PORT` (8150).

20 suites. Most drive a real Chromium against the real page, stub the city's
API and the map libraries, and **print what they found rather than asserting
silently** — the output is meant to be read, and a suite ends with `page
errors: none` when it passed. `wlog` and `watch` are plain Node tests of the
Worker (merge logic, and the nightly watch with the city and Resend stubbed);
they need no browser and run in seconds. `chk` is a one-second syntax check;
run it after every edit before anything slower.

Suites are named for what they cover: `trail` (the audit trail), `swipe`
(sheet dismissal, the override), `link` (the third answer, photos), `spot`
(one-tap tasks, geocoding), `photo`/`across` (EXIF matching), `dup`
(duplicate detection), `keep` (reports surviving the city's data), `card`/
`sheet`/`vec` (the bottom card and the map), `queue`, `four`, `pop`, `tidy`,
`trim`, `third`, `watch` (the nightly alert) and `lives` (the survival
analysis).

## The nightly watch

A cron trigger (`0 13 * * *`, i.e. UTC — 8am Chicago in summer) runs
`scheduled` in the Worker. It asks the city what changed, finds empty pits
with no planting request nearby, drops any you have already answered in the
app, and emails the ones it has not mentioned before. State is a KV key,
`watched:v1`.

The first run **seeds that state and sends one confirmation line instead of
the whole backlog** — the backlog is not news, it is the app. It also
confirms the wiring, which is the one part that cannot be tested from a
sandbox that can reach neither the city nor a mail provider.

`GET /api/watch` is a dry run: it reports what it would send and writes
nothing, so it can be opened any time without silencing tomorrow's alert. It
also carries `diagnostics` — the binding names the Worker can actually see,
plus each secret masked to first characters, length and whether it has stray
whitespace. That list is the sharp tool: a secret saved in the dashboard but
absent from the running version simply will not appear in it, which separates
"Cloudflare did not deploy it" from "the value is wrong".

    ?test=1   sends one throwaway email now and hands back Resend's own
              status and body, so a rejected key or an unverified address
              fails with a reason. Touches no state.
    ?run=1    does the cron's job immediately, state and all.

Both are spaced five minutes apart via a KV timestamp. That is courtesy, not
security: the only address either can reach is the configured one.

Delivery is Resend. Two things must be set on the Worker, and neither belongs
in the repo:

    wrangler secret put RESEND_API_KEY
    wrangler secret put NOTIFY_TO         # the address to mail

`NOTIFY_FROM` defaults to `onboarding@resend.dev`, which Resend will send
from without you owning a domain, but only to a **verified** address — so
`NOTIFY_TO` has to be the one confirmed on the Resend account. With either
secret missing the watch still runs and simply has nowhere to send; that is
a supported state, logged, not a failure.

## Short lives — `/api/patterns`

Computed live, nothing stored, rendered as a page because it is meant to be
read. Three things, in descending order of how much you can trust them:

- **Repeat losses** — addresses with two or more removals. No matching of a
  planting to a removal at all, so almost nothing can go wrong with it.
- **Cohorts** — completed plantings per year, and how many of those addresses
  saw a removal within 1/2/3 years. Has a denominator, so it is a rate.
- **Planted then pulled** — the individual pairs. Leads, not findings.

Three limits are stated on the page itself and must stay there. **311 has no
tree identity**, so pairs are matched on address and one address can hold two
pits. **A planting request closing is a proxy for a tree going in**, not proof.
And the record only runs back a few years, so the only pairs visible are ones
where planting *and* loss both fall inside the window — which is why the page
must never report an average lifespan. That number is computable and would
describe nothing but the dead.

The confounder that would eat any finding is **emerald ash borer**: a block
with several removals may just be a block planted with ash in the 1970s. 311
carries no species. Chicago's street tree inventory does, and pairing the two
is the unexplored next step.

## The environment this runs in

Claude Code sessions here are sandboxed and **cannot reach CDNs, tile hosts,
`data.cityofchicago.org`, `nominatim.openstreetmap.org`, or `workers.dev`**.
npm *is* reachable. Consequences:

- Every external dependency in the app needs an automatic fallback, and each
  one is tested with the dependency stubbed as failing.
- Claims about the city's data cannot be checked live. The app computes them
  at runtime rather than hardcoding what the data "usually" looks like.
- Verification is Playwright against stubs, never a live fetch.

## Data

**Source.** Chicago 311 via SODA (`data.cityofchicago.org/resource/v6vf-nfxy`),
ward 44. Sites are Tree Removal Inspections, closed, minus addresses that
already have a Tree Planting Request. Planting requests are pulled whole
(open and closed) — the ward's median wait and the duplicate rate are
computed from them, not assumed.

**A mark** is one person's answer about one site, keyed by the removal's SR
number (or `spot:<base36>` for a pit the city has no row for):

    { state, at, by?, sr?, note?, site?, log? }

- `state` — `open | tree | none | req | wait`
- `site` — a snapshot, because **filing a request removes the site from the
  city's query**; without this, filing erased the record of having filed.
- `log` — capped event history, appended never rewritten, so the trail can
  say when the pit was found empty *and* when it was filed.

**Sync.** One KV key holds every mark. Last-write-wins per site by timestamp
— **except `log`, which is merged as a union**, because two phones each hold
half of what happened. Future timestamps are clamped server-side.

**Photos** live in IndexedDB on the device that took them, never in the mark.
The marks blob is downloaded whole on every sync. And a page cannot put a
file into another site's file picker, so a photo on the server would not help
at the 311 form anyway — the point of keeping it is knowing *which* photo.

## Decisions worth not relitigating

- **Vector basemap** (OpenFreeMap Positron via MapLibre + Leaflet). Raster
  tiles pixelate past their native zoom; a `maxNativeZoom` cap was the
  original bug. CARTO's tiles need an API key. Raster OSM is the fallback,
  behind a 7-second timer because **MapLibre fails a style silently**.
- **Never assert a photo's pit** unless one candidate is both close and
  clearly closer than the next — a phone fix cannot tell one side of a
  Chicago street from the other, and doing so read a fresh stump as an
  existing filing.
- **Inputs are ≥16px** or iOS zooms the page on focus.
- **Say each thing once.** Repeated wording across a card was a recurring
  complaint; check adjacent blocks before adding another sentence.
- **The record can be overruled.** A parkway holds two pits; the city's row
  holds one address. Wherever the app says "nothing to do here", it offers a
  way to disagree.

## Working preferences

- **Automerge is authorized**: commit, open a PR, merge, without asking.
  Branch is `claude/app-alignment-padding-map-9yv155`.
- Commit messages and PR bodies carry the *reasoning*, not just the change —
  `git log` is the design record for this project and is meant to be read.
  Prose, not bullet-point summaries of the diff.
- Say plainly when something was my own bug. Several were.
- Verify before claiming. Run the suites; quote what they printed.

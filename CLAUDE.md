# Stump

A civic web app for the Chicago 44th Ward. It finds parkway tree pits where
the city removed a tree but nobody filed a replanting request, so one person
can walk or bike the ward, confirm the pit is empty, and file a 311 planting
request from the pavement.

The user is the surveyor. Everything is built for one thumb, outdoors, on an
iPhone, possibly moving.

## Layout

    public/index.html   the whole app — HTML, CSS and JS in one file, no build
    src/worker.js       Cloudflare Worker: /api/marks, else serve public/
    wrangler.jsonc      Worker name and the KV binding
    test/               see "Tests" below

`public/index.html` is ~3,600 lines and deliberately single-file: it is
served as a static asset, has no build step, and can be read end to end.
Keep it that way unless there is a reason not to.

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

First run fetches the map libraries from npm into `test/vendor/`
(gitignored). The runner starts its own static server on `$PORT` (8150).

18 suites. Each drives a real Chromium against the real page, stubs the
city's API and the map libraries, and **prints what it found rather than
asserting silently** — the output is meant to be read, and a suite ends with
`page errors: none` when it passed. `wlog` is a plain Node unit test of the
Worker's merge logic. `chk` is a one-second syntax check; run it after every
edit before anything slower.

Suites are named for what they cover: `trail` (the audit trail), `swipe`
(sheet dismissal, the override), `link` (the third answer, photos), `spot`
(one-tap tasks, geocoding), `photo`/`across` (EXIF matching), `dup`
(duplicate detection), `keep` (reports surviving the city's data), `card`/
`sheet`/`vec` (the bottom card and the map), `queue`, `four`, `pop`, `tidy`,
`trim`, `third`.

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

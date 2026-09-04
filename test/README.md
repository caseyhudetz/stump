# Tests

    sh test/run.sh                 all 19 (roughly 15 minutes)
    sh test/run.sh trail swipe     just those
    node test/chk.js               syntax only, one second

The first run fetches Leaflet, MapLibre GL and the Leaflet–MapLibre plugin
from npm into `test/vendor/` (gitignored). `run.sh` starts its own static
server over `public/` on `$PORT`, default 8150.

## How these are written, and why

Each suite launches a real Chromium at an iPhone viewport, serves the real
page, and stubs three things: the city's SODA endpoint, the map libraries,
and `/api/marks`. Sessions that develop this app cannot reach any of those
hosts, so stubbing is not a convenience — it is the only way to run at all.
It also means every external dependency gets exercised in its failure mode,
which is how the map's raster fallback and the geocoder's manual fallback
came to be tested at all.

They **print rather than assert**. A suite writes out what it found, in
sentences, and ends with `page errors: none`. The runner treats a throw as a
failure and a missing "page errors: none" as a failure, but the output is
meant to be read by a person deciding whether the app is behaving — not
reduced to a green tick. Several real bugs were caught by a printed number
looking wrong rather than by an assertion firing.

Screenshots land in `test/vendor/` alongside the libraries, gitignored.

`wlog.mjs` and `watch.mjs` are different: plain Node tests of the Worker, no
browser, a couple of seconds each. `wlog` covers `clean` and `merge`; `watch`
drives the nightly alert with the city's API and Resend stubbed, and prints
the email it would have sent so the wording can be read rather than guessed
at. Both import a copy of `src/worker.js` written into `src/` — it has to be
there, because the Worker imports `../public/match.js` by relative path and a
temp directory would not resolve it. The copies are gitignored and deleted on
exit.

`node_modules/.bin/wrangler deploy --dry-run` is the other cheap check: it
bundles the Worker exactly as a deploy would, so a broken import or a
mistyped config key fails here instead of in production.

## Adding one

Copy the shortest suite that resembles what you need — `pop.js` for map
behaviour, `keep.js` for sync, `wlog.mjs` for the Worker. Fixtures are
inline: a few removal rows and planting rows shaped like the city's own JSON.
Build the fixture around the case you are actually testing, and put the real
situation in a comment, because in six months the numbers will not explain
themselves. Then add the name to the `suites=` list in `run.sh`.

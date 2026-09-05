/**
 * Stump — asset server, a tiny sync API, and a nightly watch.
 *
 * Everything that matches a file in /public is served as a static asset.
 * Anything else falls through to here; we claim /api/marks and /api/watch
 * and hand the rest back to the asset handler.
 *
 * Storage is a single KV key holding every mark, because this is one
 * person surveying one ward. If the MARKS binding is missing the API
 * reports that plainly and the app quietly stays on device-local storage,
 * so a deploy without the namespace still serves a working site.
 *
 * The matching rules are imported rather than restated — see public/match.js
 * for why they are shared with the page.
 */
import Match from '../public/match.js';
import Patterns from './patterns.js';

const KEY = 'marks:v1';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * A device with a fast clock could otherwise stamp a mark far in the future,
 * which would win every comparison forever and make that site permanently
 * unmarkable — the tap would appear to undo itself. Pull anything ahead of
 * server time back to now.
 */
function stampedNow(at, now) {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t > now) return new Date(now).toISOString();
  return at;
}

/**
 * Enough of the site to rebuild the report without the city's help. A site
 * leaves the 311 query the moment a planting request exists at the address,
 * which is exactly what filing one does, so a report that carried only an
 * id would erase itself the moment it succeeded.
 */
function cleanSite(s) {
  if (!s || typeof s !== 'object') return null;
  const lat = Number(s.lat), lng = Number(s.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const address = str(s.address, 80);
  if (!address) return null;
  const out = { address, lat, lng };
  for (const k of ['sortKey', 'zip', 'closed']) {
    const v = str(s[k], 60);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * What happened at this site, in order. The mark's own timestamp is
 * overwritten by each answer; this is not, so a filed request can still say
 * when the pit was found empty. Bounded on every axis a client could push
 * on: how many entries, how long each field is, and how far ahead a stamp
 * may sit.
 */
const LOG_MAX = 24;
const LOG_STATES = new Set(['open', 'tree', 'none', 'req', 'wait']);

function cleanLog(log, now) {
  if (!Array.isArray(log)) return null;
  const out = [];
  const seen = new Set();
  for (const e of log) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.s !== 'string' || !LOG_STATES.has(e.s)) continue;
    if (typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))) continue;
    const at = stampedNow(e.at, now);
    const key = e.s + '|' + at;
    if (seen.has(key)) continue;      // the same event from two devices
    seen.add(key);
    const one = { s: e.s, at };
    if (typeof e.sr === 'string' && e.sr.trim()) one.sr = e.sr.trim().slice(0, 40);
    out.push(one);
  }
  if (!out.length) return null;
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out.slice(-LOG_MAX);
}

/**
 * One mark, normalized. Only known fields survive, so a client cannot grow
 * the stored record arbitrarily — but `by` has to be carried through, or
 * attribution on a shared report would be dropped on the first sync.
 */
function clean(m, now) {
  const out = { state: m.state, at: stampedNow(m.at, now) };
  if (typeof m.by === 'string' && m.by.trim()) out.by = m.by.trim().slice(0, 40);
  // the 311 number for the planting request, so the audit trail survives sync
  if (typeof m.sr === 'string' && m.sr.trim()) out.sr = m.sr.trim().slice(0, 40);
  // what the person standing at the pit saw — several pits at one address,
  // a stump left in the ground — which nothing else in the record can say
  if (typeof m.note === 'string' && m.note.trim()) out.note = m.note.trim().slice(0, 200);
  const site = cleanSite(m.site);
  if (site) out.site = site;
  const log = cleanLog(m.log, now);
  if (log) out.log = log;
  return out;
}

/**
 * Last write wins per site, compared on the mark's own timestamp — except
 * for the log, which is a union. Two phones walking the same block each hold
 * a piece of what happened; picking one wholesale would throw the other
 * away, and an audit trail with a hole in it is worse than none.
 */
function merge(base, incoming) {
  const out = { ...base };
  const now = Date.now();
  for (const id of Object.keys(incoming || {})) {
    const next = incoming[id];
    if (!next || typeof next !== 'object' || typeof next.state !== 'string') continue;
    const stamped = clean(next, now);
    const cur = out[id];
    const both = cleanLog([...((cur && cur.log) || []), ...(stamped.log || [])], now);
    if (!cur || !cur.at || stamped.at >= cur.at) out[id] = stamped;
    if (both) out[id] = { ...out[id], log: both };
  }
  return out;
}

async function read(env) {
  const raw = await env.MARKS.get(KEY);
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};   // never let one bad write brick the list
  }
  if (!parsed || typeof parsed !== 'object') return {};
  // Normalize on the way out as well, so a future timestamp that predates
  // this guard heals itself instead of blocking that site forever.
  const now = Date.now();
  const out = {};
  for (const id of Object.keys(parsed)) {
    const m = parsed[id];
    if (!m || typeof m !== 'object' || typeof m.state !== 'string') continue;
    out[id] = clean(m, now);
  }
  return out;
}

async function handleMarks(request, env) {
  if (!env.MARKS) {
    return json({ error: 'no-store', detail: 'KV binding MARKS is not configured' }, 503);
  }

  if (request.method === 'GET') {
    return json({ marks: await read(env) });
  }

  if (request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    if (!body || typeof body.marks !== 'object' || body.marks === null) {
      return json({ error: 'expected {marks:{...}}' }, 400);
    }
    // Read-merge-write. KV is eventually consistent, so a true simultaneous
    // write from two devices could drop one edit; acceptable for one surveyor.
    const merged = merge(await read(env), body.marks);
    await env.MARKS.put(KEY, JSON.stringify(merged));
    return json({ marks: merged });
  }

  return json({ error: 'method-not-allowed' }, 405);
}

/* ============================================================
   THE NIGHTLY WATCH
   ============================================================
   The app can only tell you about a new empty pit once you open it. This
   goes the other way: once a day it asks the city what changed, and if a
   tree came out somewhere with nothing asked for near it, that is a place
   worth walking to and you hear about it.

   What it will not do is tell you twice. Every pit it has mentioned is
   remembered, so the mail is only ever the difference since yesterday —
   and pits you have already answered in the app are skipped outright,
   which the page cannot do for you because it does not know your marks
   until you open it. Here they are one KV read away. */

/* ---------- the wider pull, for the patterns report ----------
   The watch only needs six months. Asking whether saplings survive needs
   every tree request the city has for this ward, which is a different
   query and a much larger one — hence its own function and its own cap. */
const PATTERN_LIMIT = 50000;

async function allTreeWork(){
  const u = new URL(SODA);
  u.searchParams.set('$select',
    'sr_number,sr_type,status,created_date,closed_date,street_number,' +
    'street_direction,street_name,street_type,latitude,longitude');
  u.searchParams.set('$where', `ward=${WARD} AND sr_type like '%Tree%'`);
  u.searchParams.set('$limit', String(PATTERN_LIMIT));
  const res = await fetch(u, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Chicago open data returned ' + res.status);
  const rows = await res.json();
  // hitting the cap would silently truncate the analysis, so say so
  return { rows, truncated: rows.length >= PATTERN_LIMIT };
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Rendered as a page rather than JSON because it is a thing to read, on a
   phone, and because every number in it needs its caveat sitting next to
   it rather than in someone's memory. */
function patternsPage(r, origin){
  const row = p => `<tr>
    <td><b>${esc(p.address)}</b>${p.priorRemovals
      ? `<span class="flag">lost ${p.priorRemovals + 1} now</span>` : ''}</td>
    <td class="n">${p.gapMonths}</td>
    <td class="d">planted ${esc(p.plantedOn)}<br>asked ${esc(p.askedOn)}</td>
    <td class="d">${esc(p.plantedSr)}<br>${esc(p.removalSr)}</td>
  </tr>`;

  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stump · short lives</title>
<style>
  :root{color-scheme:light}
  body{margin:0;padding:1.1rem;background:#FCFBF7;color:#0B0B0C;
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;
    max-width:46rem;margin-inline:auto}
  h1{font-size:1.5rem;margin:.2rem 0 .1rem;letter-spacing:-.01em}
  h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;
    color:#6B6B63;margin:2.2rem 0 .5rem;font-weight:600}
  p{margin:.5rem 0}
  .lede{color:#4A4A44}
  .caveat{background:#FDF6EC;border-left:4px solid #C87A16;padding:.7rem .85rem;
    font-size:.82rem;line-height:1.6;margin:.7rem 0}
  table{border-collapse:collapse;width:100%;font-size:.85rem;margin-top:.4rem}
  th{text-align:left;font-size:.66rem;text-transform:uppercase;letter-spacing:.07em;
    color:#6B6B63;border-bottom:1px solid #DDD;padding:.35rem .4rem .3rem 0;font-weight:600}
  td{border-bottom:1px solid #EEE;padding:.5rem .4rem .5rem 0;vertical-align:top}
  td.n{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
  td.d{font-size:.72rem;color:#6B6B63;font-family:ui-monospace,monospace;white-space:nowrap}
  .flag{display:inline-block;margin-left:.45rem;padding:.05rem .35rem;background:#C87A16;
    color:#fff;font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;
    border-radius:2px;vertical-align:1px}
  .none{color:#6B6B63;font-style:italic}
  .foot{margin-top:2.5rem;font-size:.75rem;color:#6B6B63;border-top:1px solid #DDD;
    padding-top:.8rem}
  a{color:#0B0B0C}
</style>
<h1>Short lives</h1>
<p class="lede">Trees the city planted, and then was asked to take out again.
  ${r.rows.toLocaleString()} tree requests in the 44th Ward.${
  r.truncated ? ' <b>Truncated — the query hit its limit, so this is incomplete.</b>' : ''}</p>

<div class="caveat"><b>Read these as leads, not findings.</b> 311 has no tree
  identity — nothing links a planting to the removal of that same trunk — so
  these are matched on address, and one parkway address can hold two pits. A
  planting request closing is taken to mean a tree went in, which is a proxy,
  not a fact. And the record only runs back a few years, so this can only ever
  find trees that were <i>both</i> planted and lost inside that window. It says
  nothing about how long trees here last.</div>

<h2>Planted, then pulled — within three years</h2>
${r.shortLives.length ? `<table>
  <tr><th>Where</th><th>Months</th><th>When</th><th>Requests</th></tr>
  ${r.shortLives.map(row).join('')}
</table>` : `<p class="none">No completed planting in this data was followed by a
  removal request at the same address within three years.</p>`}

<h2>By planting year</h2>
<p class="lede">The denominator. Without it the list above is anecdotes.</p>
${r.cohorts.length ? `<table>
  <tr><th>Closed</th><th>Planted</th><th>Pulled ≤1y</th><th>≤2y</th><th>≤3y</th></tr>
  ${r.cohorts.map(c => `<tr><td>${esc(c.year)}</td><td class="n">${c.planted}</td>
    <td class="n">${c.in12}</td><td class="n">${c.in24}</td><td class="n">${c.in36}</td></tr>`).join('')}
</table>
<p class="caveat">Recent years are not comparable to older ones: a tree planted
  last year has not had three years in which to fail. Only read a column across
  rows old enough to have finished that window.</p>` : '<p class="none">No completed plantings found.</p>'}

<h2>Addresses that have lost more than one</h2>
<p class="lede">No planting-to-removal matching here at all — just places the city
  has been called out to twice or more. The least assumption-laden thing in this
  report, and the most worth walking to.</p>
${r.repeatLosses.length ? `<table>
  <tr><th>Where</th><th>Lost</th><th>When</th></tr>
  ${r.repeatLosses.slice(0, 60).map(c => `<tr><td><b>${esc(c.address)}</b></td>
    <td class="n">${c.n}</td><td class="d">${c.when.map(esc).join('<br>')}</td></tr>`).join('')}
</table>${r.repeatLosses.length > 60
  ? `<p class="lede">…and ${r.repeatLosses.length - 60} more.</p>` : ''}`
  : '<p class="none">No address has more than one removal on record.</p>'}

<h2>What the city records here</h2>
<table>
  <tr><th>Request type</th><th>Count</th><th>Still open</th><th>Range</th></tr>
  ${r.census.map(c => `<tr><td>${esc(c.type)}</td><td class="n">${c.n}</td>
    <td class="n">${c.open}</td><td class="d">${esc(c.first)} – ${esc(c.last)}</td></tr>`).join('')}
</table>
<p class="lede">The date range is the honest limit on everything above. Nothing
  planted before it can be followed here.</p>

<div class="caveat"><b>One confounder worth naming.</b> Chicago lost a great many
  ash trees to emerald ash borer. A block with several removals may not be a block
  that kills trees — it may be a block planted with one species in the 1970s that
  met a beetle. 311 records no species, so this report cannot tell those apart.
  The city's street tree inventory can, and pairing the two is the next step if
  any of this looks worth chasing.</div>

<p class="foot"><a href="${esc(origin)}/">← Stump</a> · computed live from the
  city's 311 data, nothing stored</p>`;
}

const SEEN_KEY = 'watched:v1';
const SODA = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const WARD = 44;
const LOOKBACK_MONTHS = 6;
const SEEN_MAX = 4000;      // ids only; the ward will not outgrow this

async function soda(where, select){
  const u = new URL(SODA);
  u.searchParams.set('$select', select);
  u.searchParams.set('$where', where);
  u.searchParams.set('$limit', '5000');
  const res = await fetch(u, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Chicago open data returned ' + res.status);
  return res.json();
}

async function cityLists(){
  const since = new Date();
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS);
  const from = since.toISOString().slice(0, 10);
  return Promise.all([
    soda(
      `ward=${WARD} AND sr_type='Tree Removal Inspection' AND status='Completed' ` +
      `AND closed_date > '${from}T00:00:00' AND latitude IS NOT NULL`,
      'sr_number,street_number,street_direction,street_name,street_type,zip_code,latitude,longitude,closed_date,created_date'
    ),
    soda(
      `ward=${WARD} AND sr_type='Tree Planting Request' AND created_date > '2023-01-01T00:00:00'`,
      'sr_number,street_number,street_direction,street_name,street_type,latitude,longitude,created_date,closed_date,status'
    )
  ]);
}

/* What the walk would be today: empty pits with nothing asked for nearby,
   minus anything already answered in the app. */
async function pitsWorthAVisit(env){
  const [removals, plantings] = await cityLists();
  const marks = env.MARKS ? await read(env) : {};
  const answered = new Set(Object.keys(marks).filter(id => {
    const st = marks[id] && marks[id].state;
    return st && st !== 'open';
  }));
  const pits = Match.unaskedPits(removals, plantings)
    .filter(s => !answered.has(s.id));
  return { pits, counted: removals.length };
}

const longDate = iso => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '';
};

function mailFor(pits, origin){
  const one = pits.length === 1;
  const subject = `Stump · ${pits.length} new empty pit${one ? '' : 's'} in the 44th Ward`;
  const lines = pits.map(s =>
    `${s.address}\n  removal ${s.id}, closed ${longDate(s.closed)}\n  ${origin}/?site=${encodeURIComponent(s.id)}`);
  const body =
    `${one ? 'A tree has' : pits.length + ' trees have'} come out with no planting ` +
    `request anywhere near${one ? ' it' : ' them'}.\n\n` +
    lines.join('\n\n') +
    `\n\nGo and look, then say what you found. If the pit is empty the app ` +
    `writes the 311 wording for you.\n`;
  return { subject, body };
}

const canSend = env => Boolean(env.RESEND_API_KEY && env.NOTIFY_TO);

/* Resend, because it will send to a verified address without you owning a
   domain. Missing key or address is not an error: the watch simply has
   nowhere to send, says so in the log, and the rest still runs. */
async function sendMail(env, subject, body){
  if (!canSend(env)){
    console.log('watch: nothing to send to (set RESEND_API_KEY and NOTIFY_TO)');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.RESEND_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || 'Stump <onboarding@resend.dev>',
      to: [env.NOTIFY_TO],
      subject,
      text: body
    })
  });
  if (!res.ok) console.log('watch: send failed', res.status, await res.text());
  return res.ok;
}

async function runWatch(env, origin){
  if (!env.MARKS) return { skipped: 'no KV binding' };

  /* Nowhere to send means nothing to remember. The seen list is a record of
     what you have been *told*, so a run that cannot tell you anything must
     not tick it forward — otherwise the backlog is silently marked as
     announced and the first real mail is a mail about nothing. That is
     exactly what happened the first time this shipped: the cron fired
     before the API key was in place, seeded all eighteen pits, and burned
     the one run whose whole job was to prove sending works. */
  if (!canSend(env)){
    console.log('watch: nothing to send to — leaving the record untouched');
    return { skipped: 'not configured' };
  }

  const rawSeen = await env.MARKS.get(SEEN_KEY);
  let seen = null;
  try { seen = rawSeen ? JSON.parse(rawSeen) : null; } catch { seen = null; }
  /* `seeded` is only written by a run that could actually send, so a list
     left behind by an unconfigured run heals itself rather than needing
     someone to go and delete a KV key by hand. */
  const first = !seen || !Array.isArray(seen.ids) || seen.seeded !== true;
  const known = new Set(first ? [] : seen.ids);

  const { pits } = await pitsWorthAVisit(env);
  const fresh = pits.filter(s => !known.has(s.id));

  /* The first run would otherwise mail every unwalked pit in the ward at
     once, which is not news, it is the app. So it records what is already
     there and sends one line confirming the wiring works — the one thing
     that cannot be checked without actually sending. */
  let sent = false;
  if (first){
    sent = await sendMail(env,
      `Stump · watching ${pits.length} empty pit${pits.length === 1 ? '' : 's'}`,
      `The nightly watch is on.\n\nRight now ${pits.length} pit${pits.length === 1 ? ' has' : 's have'} ` +
      `no planting request nearby and no answer from you yet. You will not get a list of ` +
      `those — they are already in the app, at ${origin}/.\n\n` +
      `From tomorrow you will hear from me only when a new one appears.\n`);
  } else if (fresh.length){
    const { subject, body } = mailFor(fresh, origin);
    sent = await sendMail(env, subject, body);
  }

  // Remember what was mentioned whether or not the mail got through: a
  // send that failed is worth one repeat tomorrow, not a daily rerun of
  // the same list forever.
  const ids = [...new Set([...known, ...pits.map(s => s.id)])].slice(-SEEN_MAX);
  await env.MARKS.put(SEEN_KEY,
    JSON.stringify({ at: new Date().toISOString(), seeded: true, ids }));

  return { first, watching: pits.length, fresh: fresh.map(s => s.id), sent };
}

export default {
  async fetch(request, env) {
    const { pathname, origin } = new URL(request.url);
    if (pathname === '/api/marks') return handleMarks(request, env);

    /* Do saplings survive here? Read-only, computed live, nothing kept. */
    if (pathname === '/api/patterns') {
      try {
        const { rows, truncated } = await allTreeWork();
        const within = Number(new URL(request.url).searchParams.get('within')) || 36;
        const r = Patterns.report(rows, { truncated, within });
        if (new URL(request.url).searchParams.get('format') === 'json') return json(r);
        return new Response(patternsPage(r, origin), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
        });
      } catch (err) {
        return json({ error: String(err && err.message || err) }, 502);
      }
    }

    /* A dry run of the watch, so the thing that only fires once a day can
       be looked at now. It reads the city and your marks and reports what
       it would send — it never mails and never writes the seen list, so it
       is safe to open and cannot silence tomorrow's alert. */
    if (pathname === '/api/watch') {
      try {
        const { pits } = await pitsWorthAVisit(env);
        const raw = env.MARKS ? await env.MARKS.get(SEEN_KEY) : null;
        let known = [];
        try { known = raw ? (JSON.parse(raw).ids || []) : []; } catch { known = []; }
        const fresh = pits.filter(s => !known.includes(s.id));
        let seeded = false;
        try { seeded = raw ? JSON.parse(raw).seeded === true : false; } catch { seeded = false; }
        return json({
          dryRun: true,
          configured: canSend(env),
          // an unconfigured run leaves this false, so the next configured
          // one still gets to introduce itself
          seeded,
          watching: pits.length,
          alreadyTold: seeded ? known.length : 0,
          wouldSend: fresh.length ? mailFor(fresh, origin) : null,
          pits: fresh.map(s => ({ id: s.id, address: s.address, closed: s.closed }))
        });
      } catch (err) {
        return json({ error: String(err && err.message || err) }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    // the Worker's own hostname is not in scope here, so the links in the
    // mail need it configured; the workers.dev URL is a fine default
    const origin = env.PUBLIC_ORIGIN || 'https://stump.caseymhudetz.workers.dev';
    ctx.waitUntil(runWatch(env, origin).then(
      r => console.log('watch:', JSON.stringify(r)),
      e => console.log('watch failed:', e && e.message)
    ));
  }
};

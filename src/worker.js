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

/* Resend, because it will send to a verified address without you owning a
   domain. Missing key or address is not an error: the watch simply has
   nowhere to send, says so in the log, and the rest still runs. */
async function sendMail(env, subject, body){
  if (!env.RESEND_API_KEY || !env.NOTIFY_TO){
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

  const rawSeen = await env.MARKS.get(SEEN_KEY);
  let seen = null;
  try { seen = rawSeen ? JSON.parse(rawSeen) : null; } catch { seen = null; }
  const first = !seen || !Array.isArray(seen.ids);
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
  await env.MARKS.put(SEEN_KEY, JSON.stringify({ at: new Date().toISOString(), ids }));

  return { first, watching: pits.length, fresh: fresh.map(s => s.id), sent };
}

export default {
  async fetch(request, env) {
    const { pathname, origin } = new URL(request.url);
    if (pathname === '/api/marks') return handleMarks(request, env);

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
        return json({
          dryRun: true,
          configured: Boolean(env.RESEND_API_KEY && env.NOTIFY_TO),
          watching: pits.length,
          alreadyTold: known.length,
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

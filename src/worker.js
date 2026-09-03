/**
 * Stump — asset server plus a tiny sync API.
 *
 * Everything that matches a file in /public is served as a static asset.
 * Anything else falls through to here; we only claim /api/marks and hand
 * the rest back to the asset handler.
 *
 * Storage is a single KV key holding every mark, because this is one
 * person surveying one ward. If the MARKS binding is missing the API
 * reports that plainly and the app quietly stays on device-local storage,
 * so a deploy without the namespace still serves a working site.
 */

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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/marks') return handleMarks(request, env);
    return env.ASSETS.fetch(request);
  }
};

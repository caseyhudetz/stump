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

/** Last write wins per site, compared on the mark's own timestamp. */
function merge(base, incoming) {
  const out = { ...base };
  const now = Date.now();
  for (const id of Object.keys(incoming || {})) {
    const next = incoming[id];
    if (!next || typeof next !== 'object' || typeof next.state !== 'string') continue;
    const stamped = { state: next.state, at: stampedNow(next.at, now) };
    const cur = out[id];
    if (!cur || !cur.at || stamped.at >= cur.at) out[id] = stamped;
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
    out[id] = { state: m.state, at: stampedNow(m.at, now) };
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

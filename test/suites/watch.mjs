/* The nightly watch: what it notices, what it refuses to mention twice,
   and what it does on the very first run. No browser — this is the Worker's
   own logic, driven with the city and the mail provider stubbed out. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The Worker is an ES module that imports ../public/match.js by relative
   path, so the copy we import has to sit in src/ or that import breaks. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const probe = join(root, 'src', '.probe.watch.mjs');
writeFileSync(probe, readFileSync(join(root, 'src/worker.js'), 'utf8'));
const worker = (await import(probe + '?v=' + Date.now())).default;
process.on('exit', () => { try { unlinkSync(probe); } catch {} });

const DAY = 86400000, now = Date.now();
const iso = d => new Date(d).toISOString().replace('Z', '');

const removal = (sr, num, street, days, lat, lng) => ({
  sr_number: sr, street_number: String(num), street_direction: 'W',
  street_name: street, street_type: 'Ave', zip_code: '60657',
  latitude: String(lat), longitude: String(lng), closed_date: iso(now - days * DAY)
});
const planting = (sr, num, street, days, lat, lng, status) => ({
  sr_number: sr, street_number: String(num), street_direction: 'W',
  street_name: street, street_type: 'Ave',
  latitude: String(lat), longitude: String(lng),
  created_date: iso(now - days * DAY), status: status || 'Open'
});

/* A ward with four removals:
   - 700 Buckingham  nothing asked for            -> a pit worth walking to
   - 800 Barry       a request 30 ft away         -> the city already knows
   - 900 Cornelia    nothing asked for            -> also worth walking to
   - 950 Cornelia    nothing asked for, but you
                     already said there's a tree  -> not news to you        */
const removals = [
  removal('SR26-A', 700, 'Buckingham', 3, 41.944, -87.650),
  removal('SR26-B', 800, 'Barry',      4, 41.938, -87.651),
  removal('SR26-C', 900, 'Cornelia',   5, 41.951, -87.658),
  removal('SR26-D', 950, 'Cornelia',   6, 41.953, -87.659)
];
const plantings = [
  planting('P-NEAR', 802, 'Barry', 2, 41.93808, -87.651)
];

const kv = (seed) => {
  const m = new Map(Object.entries(seed || {}));
  return { get: async k => (m.has(k) ? m.get(k) : null),
           put: async (k, v) => { m.set(k, v); },
           _dump: () => Object.fromEntries(m) };
};

let mails = [];
const stubFetch = (extraPlants) => {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('data.cityofchicago.org')) {
      const q = decodeURIComponent(u).replace(/\+/g, ' ');
      const rows = /Tree Planting Request/.test(q)
        ? plantings.concat(extraPlants || []) : removals;
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (u.includes('api.resend.com')) {
      mails.push(JSON.parse(opts.body));
      return new Response('{"id":"stub"}', { status: 200 });
    }
    throw new Error('unexpected fetch: ' + u);
  };
};

const marks = m => ({ 'marks:v1': JSON.stringify(m) });
const env = (store, mark) => ({
  MARKS: kv({ ...(store || {}), ...(mark ? marks(mark) : {}) }),
  RESEND_API_KEY: 'stub', NOTIFY_TO: 'you@example.com'
});
const fire = async (e) => {
  const ctx = { waitUntil: p => p };
  const held = [];
  await worker.scheduled({}, e, { waitUntil: p => held.push(p) });
  await Promise.all(held);
};

console.log('=== the first run does not mail you the whole ward ===');
mails = []; stubFetch();
let e = env(null, { 'SR26-D': { state: 'tree', at: iso(now) } });
await fire(e);
console.log('  mails sent    :', mails.length);
console.log('  subject       :', mails[0].subject);
console.log('  says why not  :', /will not get a list/.test(mails[0].text));
console.log('  counted       :', (mails[0].text.match(/Right now (\d+)/) || [])[1],
  '(700 Buckingham + 900 Cornelia; Barry has a request, 950 you already answered)');
const seen = JSON.parse(e.MARKS._dump()['watched:v1']);
console.log('  remembered    :', seen.ids.sort().join(', '));

console.log('\n=== the next run, with nothing new, says nothing ===');
mails = [];
await fire({ ...e, MARKS: kv({ ...e.MARKS._dump() }) });
console.log('  mails sent    :', mails.length, '(silence is the point)');

console.log('\n=== a tree comes out somewhere new ===');
mails = [];
const fresh = removal('SR26-NEW', 1000, 'Roscoe', 0, 41.9435, -87.6605);
removals.push(fresh);
let e2 = env(e.MARKS._dump(), { 'SR26-D': { state: 'tree', at: iso(now) } });
await fire(e2);
console.log('  mails sent    :', mails.length);
console.log('  subject       :', mails[0].subject);
console.log('  names it      :', /1000 W Roscoe Ave/.test(mails[0].text));
console.log('  cites the SR  :', /removal SR26-NEW/.test(mails[0].text));
console.log('  links to it   :', /\/\?site=SR26-NEW/.test(mails[0].text));
console.log('  only the new  :', !/Buckingham|Cornelia/.test(mails[0].text));
console.log('\n  the mail reads:\n');
console.log(mails[0].text.split('\n').map(l => '    ' + l).join('\n'));

console.log('\n=== and is not repeated tomorrow ===');
mails = [];
await fire({ ...e2, MARKS: kv({ ...e2.MARKS._dump() }) });
console.log('  mails sent    :', mails.length);

console.log('\n=== a pit the city has already been asked about is not news ===');
mails = [];
removals.push(removal('SR26-ASKED', 600, 'Aldine', 1, 41.9400, -87.6520));
const covered = planting('P-COVER', 602, 'Aldine', 0, 41.94008, -87.6520);
stubFetch([covered]);
await fire(env(e2.MARKS._dump(), null));
console.log('  mails sent    :', mails.length, '(a request 30 ft away covers it)');

console.log('\n=== the dry run reports without sending or forgetting ===');
mails = [];
stubFetch();
const e3 = env(null, null);
const res = await worker.fetch(new Request('https://stump.test/api/watch'), e3);
const body = await res.json();
console.log('  status        :', res.status);
console.log('  dryRun        :', body.dryRun, '· configured:', body.configured);
console.log('  watching      :', body.watching, 'pits');
console.log('  would send    :', body.wouldSend && body.wouldSend.subject);
console.log('  sent nothing  :', mails.length === 0);
console.log('  wrote nothing :', !e3.MARKS._dump()['watched:v1'],
  '(so it cannot silence the real run)');

console.log('\n=== an unconfigured run must not burn the first one ===');
/* What actually happened on the day this shipped: the cron fired before the
   API key was in place. The old code seeded all eighteen pits and sent
   nothing, so the run whose whole job was to prove sending works was spent
   in silence, and every pit was marked as announced. */
mails = []; stubFetch();
const e4 = { MARKS: kv({}) };
await fire(e4);
console.log('  mails sent    :', mails.length);
console.log('  remembered    :', e4.MARKS._dump()['watched:v1'] || '(nothing)',
  '(a run that cannot tell you anything has told you nothing)');

console.log('\n  and once the key arrives, it introduces itself properly');
const e4b = env(e4.MARKS._dump(), null);
await fire(e4b);
console.log('  mails sent    :', mails.length);
console.log('  subject       :', mails[0] && mails[0].subject);
console.log('  seeded now    :', JSON.parse(e4b.MARKS._dump()['watched:v1']).seeded);

console.log('\n=== and a list left by the old code heals itself ===');
// exactly the state on the live Worker: ids, no `seeded` flag
mails = [];
const stale = { 'watched:v1': JSON.stringify({ at: iso(now), ids:
  ['SR26-A','SR26-C','SR26-NEW','SR26-ASKED'] }) };
const e4c = env(stale, null);
await fire(e4c);
console.log('  treated as first:', /watching/.test((mails[0] || {}).subject || ''));
console.log('  subject         :', mails[0] && mails[0].subject);
console.log('  seeded now      :', JSON.parse(e4c.MARKS._dump()['watched:v1']).seeded,
  '(so it cannot happen twice)');

console.log('\n=== the city being down does not take the Worker with it ===');
globalThis.fetch = async () => new Response('nope', { status: 503 });
// configured, or the run would stop at the "nowhere to send" check above and
// never reach the city at all — which would pass for the wrong reason
const e5 = env(null, null);
let threw = false;
try { await fire(e5); } catch { threw = true; }
console.log('  threw         :', threw);
console.log('  wrote nothing :', !e5.MARKS._dump()['watched:v1']);
const bad = await worker.fetch(new Request('https://stump.test/api/watch'), e5);
console.log('  dry run says  :', bad.status, JSON.stringify(await bad.json()));

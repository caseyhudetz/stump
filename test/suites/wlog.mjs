/* The worker's half of the trail: it has to survive the round trip, refuse
   junk, and merge rather than choose when two phones both hold a piece. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The worker keeps its helpers private, which is right for a worker and
   inconvenient for a test. Rather than export them just to be tested, the
   source is re-emitted with an export line appended and imported from
   there — so what runs here is byte-for-byte what ships. The copy has to
   live in src/, because the worker imports ../public/match.js by relative
   path and a temp directory would not resolve it. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const probe = join(root, 'src', '.probe.wlog.mjs');
writeFileSync(probe, readFileSync(join(root, 'src/worker.js'), 'utf8') +
  '\nexport { clean, merge, cleanLog };\n');
const { clean, merge, cleanLog } = await import(probe + '?v=' + Date.now());
process.on('exit', () => { try { unlinkSync(probe); } catch {} });

const now = Date.now();
const t = n => new Date(now - n * 86400000).toISOString();

console.log('=== a log survives the round trip ===');
const m = { state:'req', at:t(1), sr:'SR26-99', log:[
  { s:'none', at:t(9) }, { s:'req', at:t(1), sr:'SR26-99' } ] };
const c = clean(m, now);
console.log('  kept          :', JSON.stringify(c.log));
console.log('  fields only   :', Object.keys(c).join(','));

console.log('\n=== junk does not get through ===');
const bad = clean({ state:'none', at:t(1), log:[
  { s:'wat', at:t(2) },                       // not a state
  { s:'none', at:'tomorrow' },                // not a date
  { s:'none', at:t(2), sr:'x'.repeat(200) },  // over-long
  { s:'req', at:new Date(now + 6e8).toISOString() },   // in the future
  'nope', null, 42
]}, now);
console.log('  survivors     :', JSON.stringify(bad.log));
console.log('  sr trimmed to :', (bad.log.find(e=>e.sr)||{}).sr.length, 'chars');
console.log('  future pulled back:', bad.log.every(e => Date.parse(e.at) <= now + 1000));

console.log('\n=== it is capped ===');
const many = clean({ state:'none', at:t(1),
  log: Array.from({length:80}, (_,i) => ({ s:'none', at:t(80-i) })) }, now);
console.log('  entries       :', many.log.length, '(cap 24)');
console.log('  keeps the recent end:', many.log[many.log.length-1].at === t(1));

console.log('\n=== two phones, one trail ===');
// phone A found the pit empty; phone B filed it, and never saw A's entry
const A = { 'SR26-1': { state:'none', at:t(9), log:[{ s:'none', at:t(9) }] } };
const B = { 'SR26-1': { state:'req', at:t(1), sr:'SR26-99',
  log:[{ s:'req', at:t(1), sr:'SR26-99' }] } };
const merged = merge(merge({}, A), B);
console.log('  state         :', merged['SR26-1'].state, '(the later write wins)');
console.log('  trail         :', merged['SR26-1'].log.map(e=>e.s).join(' -> '),
  '(neither half lost)');

console.log('\n  and the other way round');
const other = merge(merge({}, B), A);
console.log('  state         :', other['SR26-1'].state, '(still the later write)');
console.log('  trail         :', other['SR26-1'].log.map(e=>e.s).join(' -> '));
console.log('  number kept   :', other['SR26-1'].log.find(e=>e.sr) ? 'yes' : 'NO');

console.log('\n=== the same event twice is one event ===');
const dup = merge(merge({}, A), { 'SR26-1': { ...A['SR26-1'] } });
console.log('  entries       :', dup['SR26-1'].log.length);

console.log('\n=== a mark with no log is unchanged ===');
const plain = clean({ state:'tree', at:t(3) }, now);
console.log('  keys          :', Object.keys(plain).join(','), '(no empty log)');

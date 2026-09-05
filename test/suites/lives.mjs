/* Do saplings survive here? The analysis, driven over a fixture whose right
   answers are known, because the live version can only ever be eyeballed. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Patterns = createRequire(import.meta.url)(join(root, 'src/patterns.js'));

const row = (o) => ({
  sr_number: o.sr, sr_type: o.type, status: o.status || 'Completed',
  created_date: o.made, closed_date: o.done || '',
  street_number: String(o.num), street_direction: 'N', street_name: o.st,
  street_type: 'Ave', latitude: '41.94', longitude: '-87.65'
});
const PLANT = 'Tree Planting Request', PULL = 'Tree Removal Inspection';

/* Six addresses, each a case the report has to get right:

   100 Reta     planted Mar 2024, removal asked Jun 2025  -> 15 months, a lead
   200 Reta     planted 2019, removal asked 2025          -> 6 years, too long
   300 Reta     removal 2021, planted 2022, removal 2024  -> failed twice
   400 Reta     planted 2024, no removal after            -> a survivor
   500 Reta     removal asked BEFORE the planting only    -> the normal cycle
   600 Reta     two removals, never planted               -> repeat loss only  */
const rows = [
  row({ sr:'P-100', type:PLANT, num:100, st:'Reta', made:'2023-11-02', done:'2024-03-14' }),
  row({ sr:'R-100', type:PULL,  num:100, st:'Reta', made:'2025-06-20', status:'Open' }),

  row({ sr:'P-200', type:PLANT, num:200, st:'Reta', made:'2019-01-10', done:'2019-05-01' }),
  row({ sr:'R-200', type:PULL,  num:200, st:'Reta', made:'2025-04-02' }),

  row({ sr:'R-300a',type:PULL,  num:300, st:'Reta', made:'2021-03-01' }),
  row({ sr:'P-300', type:PLANT, num:300, st:'Reta', made:'2021-09-01', done:'2022-05-10' }),
  row({ sr:'R-300b',type:PULL,  num:300, st:'Reta', made:'2024-04-18' }),

  row({ sr:'P-400', type:PLANT, num:400, st:'Reta', made:'2023-10-01', done:'2024-04-01' }),

  row({ sr:'R-500', type:PULL,  num:500, st:'Reta', made:'2022-02-02' }),
  row({ sr:'P-500', type:PLANT, num:500, st:'Reta', made:'2022-06-01', done:'2023-01-15' }),

  row({ sr:'R-600a',type:PULL,  num:600, st:'Reta', made:'2020-05-05' }),
  row({ sr:'R-600b',type:PULL,  num:600, st:'Reta', made:'2023-08-08' }),

  // a planting request that was never completed must not count as a tree
  row({ sr:'P-700', type:PLANT, num:700, st:'Reta', made:'2023-01-01', status:'Open' }),
  row({ sr:'R-700', type:PULL,  num:700, st:'Reta', made:'2024-01-01' })
];

const r = Patterns.report(rows, {});

console.log('=== planted, then pulled ===');
for (const p of r.shortLives)
  console.log(`  ${p.address.padEnd(14)} ${String(p.gapMonths).padStart(5)} months` +
    `  planted ${p.plantedOn}  asked ${p.askedOn}` +
    (p.priorRemovals ? `  (lost ${p.priorRemovals + 1} now)` : ''));

const found = r.shortLives.map(p => p.plantedSr);
console.log('\n  the 15-month one is found  :', found.includes('P-100'));
console.log('  the 6-year one is not      :', !found.includes('P-200'), '(outside three years)');
console.log('  the survivor is not        :', !found.includes('P-400'));
console.log('  removal-then-planting is not:', !found.includes('P-500'),
  '(that is the ordinary cycle, not a failure)');
console.log('  an uncompleted request is not:', !found.includes('P-700'),
  '(nothing was planted, so nothing died)');
console.log('  the twice-lost one is flagged:',
  (r.shortLives.find(p => p.plantedSr === 'P-300') || {}).priorRemovals === 1);

console.log('\n=== by planting year ===');
for (const c of r.cohorts)
  console.log(`  ${c.year}  planted ${c.planted}   ≤1y ${c.in12}   ≤2y ${c.in24}   ≤3y ${c.in36}`);
const y24 = r.cohorts.find(c => c.year === '2024') || {};
console.log('  2024 counts both plantings :', y24.planted === 2, '(100 Reta and 400 Reta)');
console.log('  and only one of them failed:', y24.in24 === 1);

console.log('\n=== addresses that have lost more than one ===');
for (const c of r.repeatLosses) console.log(`  ${c.address.padEnd(14)} ${c.n}  ${c.when.join(', ')}`);
console.log('  needs no planting to match :',
  r.repeatLosses.some(c => /600/.test(c.address)));
console.log('  a single loss is not listed:', !r.repeatLosses.some(c => /100|200/.test(c.address)));

console.log('\n=== what the city records here ===');
for (const c of r.census) console.log(`  ${c.type.padEnd(24)} ${String(c.n).padStart(3)}  ` +
  `open ${c.open}  ${c.first} – ${c.last}`);

console.log('\n=== the shape holds up on nothing at all ===');
const empty = Patterns.report([], {});
console.log('  no rows       :', JSON.stringify({ short: empty.shortLives.length,
  cohorts: empty.cohorts.length, repeats: empty.repeatLosses.length,
  census: empty.census.length }));

console.log('\n=== and on rows with no address ===');
const junk = Patterns.report([{ sr_type: PLANT, status: 'Completed', closed_date: '2024-01-01' },
  { sr_type: PULL, created_date: '2025-01-01' }], {});
console.log('  survives      :', JSON.stringify({ short: junk.shortLives.length,
  repeats: junk.repeatLosses.length, cohortRows: junk.cohorts.length }),
  '(the cohort still counts the planting; it just has no address to match)');

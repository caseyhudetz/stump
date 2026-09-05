/* ============================================================
   SHORT LIVES
   ============================================================
   The app asks whether a pit is empty. This asks a harder question: when a
   tree does go in, does it stay?

   The method is deliberately narrow, because the data will not support a
   wide one. 311 has no tree identity — nothing links a planting to the
   removal of that same trunk — so the only handle is the address, and one
   parkway address can hold two pits. And the record only goes back a few
   years, so almost every tree removed today was planted long before any of
   it existed.

   What that rules out is any statement of the form "trees here last N
   years": the only planting-to-removal pairs the data can see are the ones
   where both ends fall inside the window, which is a sample containing
   nothing but failures. A mean computed over it would be a confident
   description of the dead.

   What it leaves is this: a planting request completed, and then a removal
   asked for at the same address afterwards. Each pair is a lead, not a
   finding. A short gap makes it a better lead. A prior removal at the same
   address makes it better still — that is a spot that has now failed twice,
   which is the pattern worth walking to. */

const Match = require('../public/match.js');

const MONTH = 30.44 * 86400000;
const isRemoval = t => /removal/i.test(t || '');
const isPlanting = t => /planting/i.test(t || '');
const isDone = s => /^completed/i.test(s || '');
const months = (a, b) => (Date.parse(b) - Date.parse(a)) / MONTH;

/* What tree work the city actually records here. Printed before anything
   else because every number below depends on which request types exist and
   how far back they run, and neither is worth assuming. */
function census(rows){
  const by = {};
  for (const r of rows){
    const t = r.sr_type || '(none)';
    const c = by[t] || (by[t] = { type: t, n: 0, open: 0, first: '', last: '' });
    c.n++;
    if (!isDone(r.status) && !/closed/i.test(r.status || '')) c.open++;
    const d = (r.created_date || '').slice(0, 10);
    if (d && (!c.first || d < c.first)) c.first = d;
    if (d && (!c.last || d > c.last)) c.last = d;
  }
  return Object.values(by).sort((a, b) => b.n - a.n);
}

/* Every completed planting followed by a removal at the same address,
   shortest gap first. `within` caps how long a gap still counts as the
   tree having failed young rather than simply having grown old. */
function shortLives(rows, within){
  const cap = within || 36;
  const byAddr = {};
  for (const r of rows){
    const k = Match.normAddr(r); if (!k) continue;
    (byAddr[k] = byAddr[k] || []).push(r);
  }

  const pairs = [];
  for (const k in byAddr){
    const here = byAddr[k];
    const planted = here.filter(r => isPlanting(r.sr_type) && isDone(r.status) && r.closed_date);
    const pulled  = here.filter(r => isRemoval(r.sr_type) && r.created_date);
    if (!planted.length || !pulled.length) continue;

    for (const p of planted){
      // the first removal asked for after this planting was closed
      const after = pulled
        .filter(r => r.created_date > p.closed_date)
        .sort((a, b) => a.created_date.localeCompare(b.created_date))[0];
      if (!after) continue;
      const gap = months(p.closed_date, after.created_date);
      if (!Number.isFinite(gap) || gap > cap) continue;

      // a removal before the planting is the ordinary cycle — a tree came
      // out and was replaced. Its presence means this address has now lost
      // two, which is the part worth knowing.
      const before = pulled.filter(r => r.created_date < p.closed_date).length;

      pairs.push({
        address: (r0 => r0.street_number + ' ' +
          Match.titleCase([r0.street_direction, r0.street_name, r0.street_type]
            .filter(Boolean).join(' ')))(p),
        plantedSr: p.sr_number, plantedOn: (p.closed_date || '').slice(0, 10),
        removalSr: after.sr_number, removalType: after.sr_type,
        askedOn: (after.created_date || '').slice(0, 10),
        removalStatus: after.status || '',
        gapMonths: Math.round(gap * 10) / 10,
        priorRemovals: before,
        lat: +p.latitude || +after.latitude || null,
        lng: +p.longitude || +after.longitude || null
      });
    }
  }
  return pairs.sort((a, b) => a.gapMonths - b.gapMonths);
}

/* The denominator, without which the list above is just anecdotes. For each
   year of completed plantings: how many were there, and how many of those
   addresses saw a removal asked for within one, two and three years. */
function cohorts(rows){
  const pairs = shortLives(rows, 120);
  const gapFor = {};
  for (const p of pairs){
    const k = p.plantedSr;
    if (gapFor[k] === undefined || p.gapMonths < gapFor[k]) gapFor[k] = p.gapMonths;
  }

  const by = {};
  for (const r of rows){
    if (!isPlanting(r.sr_type) || !isDone(r.status) || !r.closed_date) continue;
    const y = r.closed_date.slice(0, 4);
    const c = by[y] || (by[y] = { year: y, planted: 0, in12: 0, in24: 0, in36: 0 });
    c.planted++;
    const g = gapFor[r.sr_number];
    if (g === undefined) continue;
    if (g <= 12) c.in12++;
    if (g <= 24) c.in24++;
    if (g <= 36) c.in36++;
  }
  return Object.values(by).sort((a, b) => a.year.localeCompare(b.year));
}

/* Addresses that have lost more than one tree, whatever the timing. The
   least assumption-laden signal in here: no matching of a planting to a
   removal, just a place the city has been called out to repeatedly. */
function repeatLosses(rows){
  const by = {};
  for (const r of rows){
    if (!isRemoval(r.sr_type)) continue;
    const k = Match.normAddr(r); if (!k) continue;
    const c = by[k] || (by[k] = { address: '', n: 0, when: [] });
    c.address = r.street_number + ' ' +
      Match.titleCase([r.street_direction, r.street_name, r.street_type].filter(Boolean).join(' '));
    c.n++;
    c.when.push((r.created_date || '').slice(0, 10));
  }
  return Object.values(by).filter(c => c.n > 1)
    .map(c => ({ ...c, when: c.when.sort() }))
    .sort((a, b) => b.n - a.n || a.address.localeCompare(b.address));
}

function report(rows, opts){
  const o = opts || {};
  return {
    rows: rows.length,
    truncated: Boolean(o.truncated),
    census: census(rows),
    shortLives: shortLives(rows, o.within || 36),
    cohorts: cohorts(rows),
    repeatLosses: repeatLosses(rows)
  };
}

module.exports = { census, shortLives, cohorts, repeatLosses, report };

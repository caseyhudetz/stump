/* ============================================================
   THE MATCHING RULES
   ============================================================
   Which of the city's removals count as an empty pit, and what counts as a
   planting request already covering one. Both the page and the Worker have
   to answer those two questions the same way — the page to draw the map,
   the Worker to decide whether a nightly alert is worth sending — and two
   copies of a rule this fiddly would drift within a month.

   So it lives here, once, and is loaded twice:

     the page    <script src="/match.js"> before its own script, so these
                 land as globals before anything runs
     the Worker  import Match from '../public/match.js', bundled at deploy

   Which is why the exports at the bottom are guarded rather than an
   `export` statement: `export` would break the classic script tag, and the
   page's script runs at parse time, so it cannot wait for a module.

   Nothing in here touches the DOM, the network or the clock. That is the
   point — it is the part that can be tested without a browser, and the part
   both callers must agree on. */

const FT_PER_MI = 5280;

/* A site leaves the list only when a planting request sits at exactly the
   same street number. But the city geocodes to an address centroid, tree
   pits are 25-40 ft apart, and a request filed for 702 W does nothing to
   protect 700 W next door. So "nearby" is distance OR street number on the
   same street, which catches the case where the coordinates are loose. */
const DUP_FT = 150;
const DUP_NUMBERS = 10;   // five or so addresses either way

const rad = x => x * Math.PI / 180;

function milesBetween(a, b){
  const R = 3958.8;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* The key two city rows share when they describe the same address. Street
   type is deliberately left out: the same block appears as "Ave" and
   "AVE" and occasionally blank across the two datasets. */
function normAddr(r){
  const n = (r.street_number || '').replace(/^0+/, '');
  const d = (r.street_direction || '').toUpperCase();
  const s = (r.street_name || '').toUpperCase().trim();
  return (n && s) ? n + '|' + d + '|' + s : null;
}

function titleCase(str){
  const keep = { N:'N', S:'S', E:'E', W:'W', NE:'NE', NW:'NW', SE:'SE', SW:'SW' };
  return (str || '').split(/\s+/).map(w =>
    keep[w.toUpperCase()] || (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

/* One removal row from the city, in the shape the app uses. */
function siteFrom(r){
  const street = titleCase([r.street_direction, r.street_name, r.street_type].filter(Boolean).join(' '));
  return {
    id: r.sr_number,
    num: parseInt(r.street_number, 10) || 0,
    street,
    sortKey: (r.street_name || '').toUpperCase() + ' ' +
      String(parseInt(r.street_number, 10) || 0).padStart(6, '0'),
    streetKey: (r.street_name || '').toUpperCase().trim(),
    address: r.street_number + ' ' + street,
    zip: r.zip_code || '60657',
    lat: +r.latitude, lng: +r.longitude,
    closed: r.closed_date
  };
}

/* One planting request, likewise. */
function plantFrom(p){
  return {
    id: p.sr_number,
    address: p.street_number + ' ' +
      titleCase([p.street_direction, p.street_name, p.street_type].filter(Boolean).join(' ')),
    sortKey: (p.street_name || '').toUpperCase() + ' ' +
      String(parseInt(p.street_number, 10) || 0).padStart(6, '0'),
    num: parseInt(p.street_number, 10) || 0,
    streetKey: (p.street_name || '').toUpperCase().trim(),
    lat: +p.latitude, lng: +p.longitude,
    at: p.created_date, closed: p.closed_date || '', status: p.status || 'Open'
  };
}

const isOpenRequest = p => !/^completed/i.test(p.status || '');

/* Requests close enough to a pit that one of them may already cover it.
   `plants` are plantFrom shapes; the caller decides whether that list is
   open requests only (the app) or all of them (never, so far). */
function nearbyIn(site, plants, limit){
  if (!site || !plants || !plants.length || !Number.isFinite(+site.lat)) return [];
  return plants
    .map(p => ({ p, ft: milesBetween(site, p) * FT_PER_MI }))
    .filter(({ p, ft }) => ft <= DUP_FT ||
      (site.streetKey && site.streetKey === p.streetKey &&
       Math.abs((site.num || 0) - (p.num || 0)) <= DUP_NUMBERS))
    .sort((a, b) => a.ft - b.ft)
    .slice(0, limit || 4);
}

/* The whole rule, in one place: given the city's two lists, which removals
   are still empty pits and which have already been answered.

   A pit is answered when a planting request sits at its exact address and
   was filed after the removal closed — or is open now, whichever the data
   shows. Everything else is a site to go and look at.

   `confirmed` is not a leftover: a site leaves the live list the moment a
   request exists at its address, which is exactly what filing one does, so
   the request that removed it has to be handed back or the app would erase
   the record of having filed. */
function splitSites(removals, plantings){
  const plant = {};
  for (const p of plantings || []){
    const k = normAddr(p); if (!k) continue;
    (plant[k] = plant[k] || []).push(p);
  }
  const byAddr = {};
  for (const r of removals || []){
    const k = normAddr(r); if (!k || !r.closed_date) continue;
    if (!byAddr[k] || r.closed_date > byAddr[k].closed_date) byAddr[k] = r;
  }

  const sites = [], confirmed = {};
  for (const k in byAddr){
    const r = byAddr[k];
    const asked = (plant[k] || [])
      .filter(p => p.created_date > r.closed_date || isOpenRequest(p))
      .sort((a, b) => (a.created_date || '').localeCompare(b.created_date || ''));
    const site = siteFrom(r);
    if (asked.length){
      confirmed[site.id] = { ...site,
        plantedAt: asked[0].created_date, plantSr: asked[0].sr_number,
        plantStatus: asked[0].status || '',
        plantClosed: asked[0].closed_date || '' };
      continue;
    }
    sites.push(site);
  }
  return { sites, confirmed };
}

/* An empty pit with nothing asked for anywhere near it — the thing worth
   waking someone up for. Distinct from splitSites, which only checks the
   exact address: this also rules out a request next door. */
function unaskedPits(removals, plantings){
  const { sites } = splitSites(removals, plantings);
  const open = (plantings || []).filter(isOpenRequest).map(plantFrom)
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return sites.filter(s => !nearbyIn(s, open, 1).length);
}

/* Loaded as a classic script by the page (these become globals) and as a
   module by the Worker's bundler. The guard is what lets one file do both;
   see the note at the top. */
if (typeof module !== 'undefined' && module.exports){
  module.exports = { FT_PER_MI, DUP_FT, DUP_NUMBERS, rad, milesBetween, normAddr,
    titleCase, siteFrom, plantFrom, isOpenRequest, nearbyIn, splitSites, unaskedPits };
}

/* One line where three boxes said the same thing, a pill with room, and a
   checked pin that doesn't look like an eye. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = [
  { sr_number:'SR26-01764986', street_number:'517', street_direction:'W', street_name:'Barry',
    street_type:'Ave', zip_code:'60657', latitude:'41.938000', longitude:'-87.650000',
    closed_date:'2026-08-29T00:00:00.000' },
  { sr_number:'SR26-B', street_number:'649', street_direction:'W', street_name:'Briar',
    street_type:'Pl', zip_code:'60657', latitude:'41.940000', longitude:'-87.652000',
    closed_date:'2026-05-11T00:00:00.000' }
];
const plantings = [
  // one at 517 W Barry — the request the user filed, echoed back by the city
  { sr_number:'SR26-01764986', street_number:'517', street_direction:'W', street_name:'Barry',
    street_type:'Ave', latitude:'41.938000', longitude:'-87.650000',
    created_date:'2026-08-30T00:00:00.000', status:'Open' },
  { sr_number:'SR24-00219223', street_number:'643', street_direction:'W', street_name:'Briar',
    street_type:'Pl', latitude:'41.940140', longitude:'-87.652000',
    created_date:'2024-03-01T00:00:00.000', status:'Open' },
  { sr_number:'SR24-01546908', street_number:'655', street_direction:'W', street_name:'Briar',
    street_type:'Pl', latitude:'41.940210', longitude:'-87.652050',
    created_date:'2024-06-01T00:00:00.000', status:'Open' }
];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Planting Request/.test(u)) return r.fulfill({ json: plantings });
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js', contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl.css', r => r.fulfill({ path:'ml.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl@*/dist/maplibre-gl.js', r => r.fulfill({ path:'ml.js', contentType:'application/javascript' }));
  await p.route('**/leaflet-maplibre-gl.js', r => r.fulfill({ path:'mlleaf.js', contentType:'application/javascript' }));
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#f2f1ea'}}]} }));
  await p.route('**/api/marks', r => r.fulfill({ json:{ marks:{} } }));
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(2200);

  const cardText = () => p.$eval('#pitsheet', e=>e.textContent.replace(/\s+/g,' ').trim());
  const count = (t, re) => (t.match(re) || []).length;

  console.log('=== a filed site says each thing once ===');
  // the site leaves the live query once the city shows a request, so the
  // mark has to be in place before the load that restores it
  await p.evaluate(()=>{
    localStorage.setItem('stump.marks', JSON.stringify({
      'SR26-01764986': { state:'req', at:new Date().toISOString(), sr:'SR26-01764986',
        site:{ address:'517 W Barry Ave', sortKey:'BARRY 000517', zip:'60657',
               lat:41.938, lng:-87.650, closed:'2026-08-29T00:00:00.000' } } })); });
  await p.reload(); await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>pick('SR26-01764986')); await p.waitForTimeout(700);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  const t = await cardText();
  console.log('  pill             :', await p.$eval('#pitsheet .pkind', e=>e.textContent.trim()));
  console.log('  status line      :', await p.$eval('#pitsheet .statusline', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  SR appears       :', count(t, /SR26-01764986/g), 'time(s) in the card body');
  console.log('  no banner box    :', await p.evaluate(()=>!document.querySelector('#pitsheet .state')));
  console.log('  no city line     :', await p.evaluate(()=>!document.querySelector('#pitsheet .city')));
  console.log('  no "0 ft" line   :', await p.evaluate(()=>!document.querySelector('#pitsheet .nearline')));
  await p.screenshot({ path:'ti1-filed.png' });

  console.log('\n=== the pill has room ===');
  const gap = await p.evaluate(()=>{
    const k = document.querySelector('#pitsheet .pill').getBoundingClientRect();
    const h = document.querySelector('#pitsheet h3').getBoundingClientRect();
    return { pillH:Math.round(k.height), gap:Math.round(h.top - k.bottom) }; });
  console.log('  pill/heading     :', JSON.stringify(gap), gap.gap >= 4 ? '(clear)' : '(TIGHT)');

  console.log('\n=== an unchecked site with requests nearby says it once ===');
  await p.evaluate(()=>unpick()); await p.waitForTimeout(400);
  await p.evaluate(()=>pick('SR26-B')); await p.waitForTimeout(700);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  // the banner above the buttons went: the third answer already says this
  console.log('  said by the button:', await p.$eval('#pitsheet .act.knows', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  no banner too    :', await p.evaluate(()=>!document.querySelector('#pitsheet .nearline')));
  console.log('  no repeated para :', await p.evaluate(()=>!document.querySelector('#pitsheet .dhead')));
  console.log('  the list remains :', await p.$$eval('#pitsheet .dhit', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  const t2 = await cardText();
  console.log('  ages agree       :', (t2.match(/open [\d.]+ years/)||[])[0], '/',
    (t2.match(/requested [\d.]+ years ago/)||[])[0]);
  await p.screenshot({ path:'ti2-unchecked.png' });

  console.log('\n=== the checked pin is a quiet dot ===');
  await p.evaluate(()=>unpick()); await p.waitForTimeout(400);
  console.log('  styles           :', await p.evaluate(()=>{
    const el = document.querySelector('#map .pin.done');
    if (!el) return null;
    const c = getComputedStyle(el), a = getComputedStyle(el, '::after');
    return { size: c.width, bg: c.backgroundColor, innerDot: a.content !== 'none' && a.content !== '' };
  }));
  console.log('  unchecked size   :', await p.evaluate(()=>{
    const el = document.querySelector('#map .pin.open'); return el ? getComputedStyle(el).width : null; }));

  console.log('\n=== the full warning still stands where it decides something ===');
  await p.click('#tasksbtn'); await p.waitForTimeout(400);
  await p.click('#home'); await p.waitForTimeout(400);
  if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){ await p.click('#sortbtn'); await p.waitForTimeout(300); }
  await p.click('.chip[data-view="list"]'); await p.waitForTimeout(500);
  await p.click('#sortclose'); await p.waitForTimeout(400);
  const rows = await p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  await (await p.$$('#list .row'))[rows.findIndex(t=>/Briar/.test(t))].click(); await p.waitForTimeout(800);
  console.log('  on the site page :', await p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  full warning kept:', await p.evaluate(()=>!!document.querySelector('#detail .dhead')));
  console.log('  status line      :', await p.evaluate(()=>{
    const el = document.querySelector('#detail .statusline');
    return el ? el.textContent.replace(/\s+/g,' ').trim() : '(none — not checked yet)'; }));
  await p.screenshot({ path:'ti3-page.png', fullPage:true });

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

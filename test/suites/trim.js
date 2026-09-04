/* The map answers one question; the card is one column; the record keeps
   everything you looked at. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = [
  { sr_number:'SR26-A', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.946000', longitude:'-87.652000',
    closed_date:'2026-04-11T00:00:00.000' },
  { sr_number:'SR26-C', street_number:'950', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.947500', longitude:'-87.654000',
    closed_date:'2026-03-11T00:00:00.000' }
];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9441, longitude:-87.6501}, permissions:['geolocation'] });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Planting Request/.test(u)) return r.fulfill({ json: [] });
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js', contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl.css', r => r.fulfill({ path:'ml.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl@*/dist/maplibre-gl.js', r => r.fulfill({ path:'ml.js', contentType:'application/javascript' }));
  await p.route('**/leaflet-maplibre-gl.js', r => r.fulfill({ path:'mlleaf.js', contentType:'application/javascript' }));
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#f2f1ea'}}]} }));
  await p.route('**/tile.openstreetmap.org/**', r => r.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'), contentType:'image/png' }));
  let store = {};
  await p.route('**/api/marks', async r => {
    if (r.request().method() === 'PUT'){
      const body = JSON.parse(r.request().postData()||'{}');
      for (const [id,m] of Object.entries(body.marks||{})) store[id] = m;
    }
    return r.fulfill({ json:{ marks: store } });
  });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(2200);

  const box = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect();
    return { top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height) }; });

  console.log('=== the map starts under the nav ===');
  console.log('  count line gone  :', await p.evaluate(()=>!document.querySelector('.countrow')));
  console.log('  distance readout :', await p.evaluate(()=>!document.querySelector('#mebar')) ? 'gone' : 'STILL THERE');
  const bar = await box('.topbar'), mp = await box('#map');
  console.log('  topbar / map     :', JSON.stringify(bar), JSON.stringify(mp));
  console.log('  map right below  :', mp.top - bar.bottom < 24, `(gap ${mp.top - bar.bottom}px)`);
  console.log('  map is taller    :', mp.h, '(was 665)');

  console.log('\n=== the key asks one question ===');
  console.log('  legend           :', await p.$$eval('#legend span', e=>e.filter(x=>getComputedStyle(x).display!=='none').map(x=>x.textContent.trim())));
  console.log('  count moved into filters:', await p.evaluate(()=>!!document.querySelector('#sortpanel #count')));

  console.log('\n=== controls clear the credit line and the key ===');
  const ctls = [];
  for (const h of await p.$$('.mapctls .mapctl')){ if (await h.isHidden()) continue;
    const r = await h.boundingBox(); ctls.push(Math.round(r.y + r.height)); }
  const attr = await box('.leaflet-control-attribution').catch(()=>null);
  const lg = await box('#legend');
  console.log('  lowest control   :', Math.max(...ctls), '· legend top', lg.top, '· map bottom', mp.bottom);
  console.log('  above the key    :', Math.max(...ctls) < lg.top);
  console.log('  inside the map   :', Math.max(...ctls) < mp.bottom);
  await p.screenshot({ path:'t1-map.png' });

  console.log('\n=== two pin styles, whatever the state ===');
  await p.evaluate(async ()=>{
    marks['SR26-B'] = { state:'tree', at:new Date().toISOString() };
    marks['SR26-C'] = { state:'req', at:new Date().toISOString(), sr:'SR26-99' };
    await saveMarks(); repaint(); });
  await p.waitForTimeout(700);
  console.log('  pin classes      :', await p.evaluate(()=>
    [...document.querySelectorAll('#map .pin')].map(x=>x.className).sort()));

  console.log('\n=== the card is one column, details already open ===');
  await p.evaluate(()=>pick('SR26-A')); await p.waitForTimeout(800);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  console.log('  no Details toggle:', await p.evaluate(()=>!document.querySelector('#pitsheet summary')));
  console.log('  facts visible    :', await p.$$eval('#pitsheet .fact dt', e=>e.map(x=>x.textContent.trim())));
  console.log('  no full-page btn :', await p.evaluate(()=>!document.querySelector('#pitsheet .expand')));
  console.log('  no reporting-as  :', await p.evaluate(()=>!document.querySelector('#pitsheet .who')));
  const order = await p.$$eval('#pitsheet .restpart > *', e=>e.map(x=>x.className || x.tagName));
  console.log('  order            :', order);
  const note = await box('#pitsheet .notebtn'), quiet = await box('#pitsheet .quiet');
  const acts = await box('#pitsheet .choices');
  console.log('  note below buttons:', note.top > acts.top, '· links last:', quiet.top > note.top);
  await p.screenshot({ path:'t2-card.png' });

  console.log('\n=== a note on a tree gets kept ===');
  await p.evaluate(()=>unpick()); await p.waitForTimeout(400);
  await p.evaluate(()=>pick('SR26-B')); await p.waitForTimeout(700);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  await p.click('#pitsheet .notebtn'); await p.waitForTimeout(500);
  await p.fill('#pitsheet .noteinput', 'Checked Tuesday. Young honeylocust, doing fine. Talk to the owner about watering.');
  await p.click('#pitsheet .noteform button[type="submit"]'); await p.waitForTimeout(900);
  console.log('  note saved       :', (await p.$eval('#pitsheet .notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())).slice(0,50));

  console.log('\n=== the record has three sections ===');
  await p.evaluate(()=>{ marks['SR26-A'] = { state:'none', at:new Date().toISOString() }; saveMarks(); });
  await p.click('#tasksbtn'); await p.waitForTimeout(800);
  console.log('  sections         :', await p.$$eval('#tasklist .count', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  const rows = await p.$$eval('.donerow summary', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('  rows             :', rows);
  console.log('  reviewed shows what and when:', rows.some(t=>/Tree is there/.test(t)));
  await p.screenshot({ path:'t3-tasks.png', fullPage:true });
  const rev = (await p.$$('.donerow'))[rows.findIndex(t=>/Tree is there/.test(t))];
  await rev.click(); await p.waitForTimeout(500);
  console.log('  note in the record:', (await p.$eval('.donerow[open] .notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())).slice(0,50));
  console.log('  offers a recheck :', await p.$$eval('.donerow[open] .mini', e=>e.map(x=>x.textContent.trim())));
  await p.screenshot({ path:'t4-reviewed.png', fullPage:true });

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

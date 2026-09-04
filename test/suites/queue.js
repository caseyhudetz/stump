/* Empty pit, request already open: the third answer, judged against how
   long this ward actually takes. Plus the tightened Done list. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DAY = 86400000, now = Date.now();
const iso = d => new Date(d).toISOString().replace('Z','');

const removals = [
  // a request sits 29 ft away, five months old — inside the usual wait
  { sr_number:'SR26-A', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  // a request 29 ft away that is three years old
  { sr_number:'SR26-B', street_number:'800', street_direction:'W', street_name:'Roscoe',
    street_type:'St', zip_code:'60657', latitude:'41.940000', longitude:'-87.660000',
    closed_date:'2026-05-11T00:00:00.000' },
  // nothing near it
  { sr_number:'SR26-C', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date:'2026-04-11T00:00:00.000' }
];

// 20 completed requests with a ~7 month median, 3 dups, 2 open ones
const plantings = [
  ...Array.from({length:20}, (_,i) => ({
    sr_number:'P-C'+i, street_number:String(100+i), street_direction:'W', street_name:'Melrose',
    street_type:'St', latitude:'41.930000', longitude:'-87.640000',
    created_date: iso(now - (400 + i*10)*DAY),
    closed_date:  iso(now - (400 + i*10 - (180 + (i%9)*12))*DAY),
    status:'Completed' })),
  ...Array.from({length:3}, (_,i) => ({
    sr_number:'P-D'+i, street_number:String(300+i), street_direction:'W', street_name:'Melrose',
    street_type:'St', latitude:'41.930000', longitude:'-87.641000',
    created_date: iso(now - 300*DAY), closed_date: iso(now - 299*DAY), status:'Completed - Dup' })),
  { sr_number:'P-OPEN-NEW', street_number:'702', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', latitude:'41.944080', longitude:'-87.650000',
    created_date: iso(now - 150*DAY), status:'Open' },
  { sr_number:'P-OPEN-OLD', street_number:'802', street_direction:'W', street_name:'Roscoe',
    street_type:'St', latitude:'41.940080', longitude:'-87.660000',
    created_date: iso(now - 1100*DAY), status:'Open' }
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
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#eee'}}]} }));
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
  await p.waitForTimeout(1800);

  const chip = async (k,v) => {
    if (await p.$eval('#browse', e=>e.hasAttribute('hidden'))){ await p.click('.mark button'); await p.waitForTimeout(400); }
    if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){ await p.click('#sortbtn'); await p.waitForTimeout(250); }
    await p.click(`.chip[data-${k}="${v}"]`); await p.waitForTimeout(500);
    await p.click('#sortclose'); await p.waitForTimeout(400);
  };
  const openSite = async match => {
    const rows = await p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
    const i = rows.findIndex(t => t.includes(match));
    await (await p.$$('#list .row'))[i].click(); await p.waitForTimeout(800);
  };

  console.log('=== what the ward\'s own record says ===');
  console.log('  stats            :', await p.evaluate(()=>({
    completed: PLANT_STATS.n, medianDays: Math.round(PLANT_STATS.median),
    dupPct: Math.round(PLANT_STATS.dupShare*100) })), '(built ~7 month median, 3 of 25 dups)');

  console.log('\n=== the third answer stands beside the other two ===');
  await chip('view','list');
  await openSite('700 W Buckingham');
  console.log('  no interstitial  :', await p.evaluate(()=>!document.querySelector('.chooser')));
  console.log('  buttons          :', await p.$$eval('#dock .act', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  the third says   :', (await p.$eval('#dock .act.knows', e=>e.textContent.replace(/\s+/g,' ').trim())));
  console.log('  not flagged late :', await p.evaluate(()=>!document.querySelector('#dock .act.knows .late')));
  await p.screenshot({ path:'q1-three-new.png', fullPage:true });

  console.log('\n=== an old request reads differently ===');
  await p.click('#back'); await p.waitForTimeout(500);
  await openSite('800 W Roscoe');
  console.log('  the third says   :', (await p.$eval('#dock .act.knows', e=>e.textContent.replace(/\s+/g,' ').trim())));
  console.log('  flagged late     :', await p.evaluate(()=>!!document.querySelector('#dock .act.knows .late')));
  await p.screenshot({ path:'q2-three-old.png', fullPage:true });

  console.log('\n=== marking it as in the queue ===');
  await p.click('#dock .act.knows'); await p.waitForTimeout(900);
  console.log('  state            :', await p.evaluate(()=>stateOf(byId('SR26-B'))));
  console.log('  reads            :', await p.evaluate(()=>{
    const el = document.querySelector('#detail .statusline') || document.querySelector('#detail .state');
    return el ? el.textContent.replace(/\s+/g,' ').trim() : '(no line)'; }));
  console.log('  no task made     :', await p.evaluate(()=>tasks().length === 0));
  console.log('  synced field     :', JSON.stringify(store['SR26-B'] && store['SR26-B'].state));
  await p.click('#back'); await p.waitForTimeout(500);
  await chip('show','wait');
  console.log('  filter finds it  :', await p.evaluate(()=>filtered().length) + ' in queue');
  console.log('  list row         :', await p.$$eval('#list .row', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  await p.screenshot({ path:'q3-queue-filter.png' });

  console.log('\n=== asking again anyway still works ===');
  await chip('show','all');
  await openSite('700 W Buckingham');
  await p.click('#dock .act.no'); await p.waitForTimeout(1000);
  console.log('  went to tasks    :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  task made        :', await p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));

  console.log('\n=== the Done list is one line each ===');
  await p.click('[data-file]'); await p.waitForTimeout(400);
  await p.fill('.srinput','SR26-11112222');
  await p.click('.srform button[type="submit"]'); await p.waitForTimeout(900);
  console.log('  sections         :', await p.$$eval('#tasklist .count', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  done rows        :', await p.$$eval('.donerow summary', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  const h = await p.$eval('.donerow', e=>Math.round(e.getBoundingClientRect().height));
  console.log('  row height       :', h, h < 90 ? '(tight)' : '(TOO TALL)');
  console.log('  collapsed        :', await p.$eval('.donerow', e=>!e.hasAttribute('open')));
  await p.screenshot({ path:'q4-tasks.png', fullPage:true });

  await p.click('.donerow summary'); await p.waitForTimeout(500);
  console.log('  opens to detail  :', await p.$$eval('.donerow[open] .drbody .mini', e=>e.map(x=>x.textContent.trim())));
  console.log('  stays open after a repaint:', await p.evaluate(async ()=>{
    window.repaint(); await new Promise(r=>setTimeout(r,300));
    const d = document.querySelector('.donerow'); return d && d.hasAttribute('open'); }));
  await p.screenshot({ path:'q5-tasks-open.png', fullPage:true });

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

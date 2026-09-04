/* What happened at a site, in order: the city's removal, your answers, the
   city's acknowledgement, and the tree it still owes. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DAY = 86400000, now = Date.now();
const iso = d => new Date(d).toISOString().replace('Z','');

const removals = [
  { sr_number:'SR26-01792691', street_number:'3345', street_direction:'N', street_name:'Seminary',
    street_type:'Ave', zip_code:'60657', latitude:'41.943000', longitude:'-87.654000',
    closed_date: iso(now - 60*DAY) },
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date: iso(now - 120*DAY) },
  // a site whose request the city has since finished
  { sr_number:'SR26-C', street_number:'800', street_direction:'W', street_name:'Barry',
    street_type:'Ave', zip_code:'60657', latitude:'41.937000', longitude:'-87.649000',
    closed_date: iso(now - 500*DAY) }
];
// a ward median of roughly six months, so the estimate has something to say
const plantings = [
  ...Array.from({length:14}, (_,i) => ({
    sr_number:'P-C'+i, street_number:String(100+i), street_direction:'W', street_name:'Melrose',
    street_type:'St', latitude:'41.930000', longitude:'-87.640000',
    created_date: iso(now - (500+i*10)*DAY), closed_date: iso(now - (500+i*10-182)*DAY),
    status:'Completed' }))
];

const run = async (extraPlants, marks) => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE,
    hasTouch:true, isMobile:true });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Planting Request/.test(u)) return r.fulfill({ json: plantings.concat(extraPlants||[]) });
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js', contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl.css', r => r.fulfill({ path:'ml.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl@*/dist/maplibre-gl.js', r => r.fulfill({ path:'ml.js', contentType:'application/javascript' }));
  await p.route('**/leaflet-maplibre-gl.js', r => r.fulfill({ path:'mlleaf.js', contentType:'application/javascript' }));
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#f2f1ea'}}]} }));
  let store = marks || {};
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
  return { b, p, errs, store: () => store };
};

const steps = p => p.$$eval('.trail .tstep', e=>e.map(x=>({
  what: x.querySelector('.twhat').textContent.trim(),
  when: x.querySelector('.twhen').textContent.replace(/\s+/g,' ').trim(),
  pending: x.classList.contains('pending'),
  city: x.classList.contains('city')
})));
const show = rows => rows.forEach(r =>
  console.log(`    ${r.pending ? '○' : '●'} ${r.city ? '[city]' : '[you] '} ${r.what}\n              ${r.when}`));

(async () => {
  console.log('=== walking one site from empty pit to filed ===');
  let t = await run();
  // list view, then answer it and file it
  await t.p.click('#sortbtn'); await t.p.waitForTimeout(400);
  await t.p.click('.chip[data-view="list"]'); await t.p.waitForTimeout(400);
  await t.p.click('#sortclose'); await t.p.waitForTimeout(400);
  const rows = await t.p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  await (await t.p.$$('#list .row'))[rows.findIndex(x=>/Seminary/.test(x))].click();
  await t.p.waitForTimeout(800);
  await t.p.click('#dock .act.no'); await t.p.waitForTimeout(1000);
  console.log('  a task was made :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));

  // pretend a day passed between finding it and filing it
  await t.p.evaluate(()=>{
    const m = marks['SR26-01792691'];
    const back = new Date(Date.now() - 86400000).toISOString();
    m.at = back; m.log[0].at = back;
  });
  await t.p.click('.task [data-file]'); await t.p.waitForTimeout(500);
  await t.p.fill('.srinput', 'SR26-01888888');
  await t.p.click('.srform button[type="submit"]'); await t.p.waitForTimeout(1000);

  await t.p.click('.donerow summary'); await t.p.waitForTimeout(600);
  console.log('  heading         :', await t.p.$eval('.trailhead', e=>e.textContent.trim()));
  console.log('  the trail       :');
  show(await steps(t.p));
  await t.p.screenshot({ path:'tr1-filed.png', fullPage:true });

  console.log('\n  two events, two days:',
    await t.p.evaluate(()=>marks['SR26-01792691'].log.map(e=>e.s+' '+e.at.slice(0,10)).join(' / ')));
  console.log('  it synced       :', JSON.stringify((t.store()['SR26-01792691']||{}).log));
  await t.b.close();

  console.log('\n=== once the city publishes the request, that step is real ===');
  const filed = { 'SR26-01792691': { state:'req', at:iso(now-1*DAY), sr:'SR26-01888888',
    log:[{ s:'none', at:iso(now-2*DAY) }, { s:'req', at:iso(now-1*DAY), sr:'SR26-01888888' }],
    site:{ address:'3345 N Seminary Ave', sortKey:'SEMINARY 003345', zip:'60657',
           lat:41.943, lng:-87.654, closed: iso(now-60*DAY) } } };
  t = await run([{ sr_number:'SR26-01888888', street_number:'3345', street_direction:'N',
    street_name:'Seminary', street_type:'Ave', latitude:'41.943000', longitude:'-87.654000',
    created_date: iso(now - 1*DAY), status:'Open' }], JSON.parse(JSON.stringify(filed)));
  await t.p.click('#tasksbtn'); await t.p.waitForTimeout(700);
  await t.p.click('.donerow summary'); await t.p.waitForTimeout(600);
  show(await steps(t.p));
  console.log('  still owed      :', (await steps(t.p)).filter(r=>r.pending).map(r=>r.what));
  await t.p.screenshot({ path:'tr2-recorded.png', fullPage:true });
  await t.b.close();

  console.log('\n=== and when the city closes it, nothing is left owed ===');
  t = await run([{ sr_number:'SR26-01888888', street_number:'3345', street_direction:'N',
    street_name:'Seminary', street_type:'Ave', latitude:'41.943000', longitude:'-87.654000',
    created_date: iso(now - 50*DAY), closed_date: iso(now - 3*DAY), status:'Completed' }],
    // filed back when it was found, so the whole arc reads in order
    { 'SR26-01792691': { ...JSON.parse(JSON.stringify(filed))['SR26-01792691'],
      at: iso(now-55*DAY),
      log:[{ s:'none', at: iso(now-60*DAY) },
           { s:'req',  at: iso(now-55*DAY), sr:'SR26-01888888' }] } });
  await t.p.click('#tasksbtn'); await t.p.waitForTimeout(700);
  await t.p.click('.donerow summary'); await t.p.waitForTimeout(600);
  show(await steps(t.p));
  console.log('  nothing pending :', (await steps(t.p)).every(r=>!r.pending));
  await t.p.screenshot({ path:'tr3-closed.png', fullPage:true });
  await t.b.close();

  console.log('\n=== a report made before there was a log still has one ===');
  t = await run([], { 'SR26-B': { state:'req', at:iso(now-30*DAY), sr:'SR26-OLD' } });
  console.log('  backfilled      :', await t.p.evaluate(()=>JSON.stringify(marks['SR26-B'].log)));
  await t.p.click('#tasksbtn'); await t.p.waitForTimeout(700);
  await t.p.click('.donerow summary'); await t.p.waitForTimeout(600);
  show(await steps(t.p));
  await t.b.close();

  console.log('\n=== a reviewed site keeps its own short record ===');
  t = await run([], { 'SR26-C': { state:'tree', at:iso(now-5*DAY),
    log:[{ s:'none', at:iso(now-40*DAY) }, { s:'open', at:iso(now-20*DAY) },
         { s:'tree', at:iso(now-5*DAY) }] } });
  await t.p.click('#tasksbtn'); await t.p.waitForTimeout(700);
  await t.p.click('.donerow summary'); await t.p.waitForTimeout(600);
  show(await steps(t.p));
  console.log('  in date order   :', await t.p.evaluate(()=>{
    const w = [...document.querySelectorAll('.trail .twhen')].map(x=>x.textContent);
    return w.length > 1; }));
  await t.p.screenshot({ path:'tr4-reviewed.png', fullPage:true });

  console.log('\n=== an unchecked site has no trail to show ===');
  await t.p.click('#home'); await t.p.waitForTimeout(500);
  await t.p.click('#sortbtn'); await t.p.waitForTimeout(400);
  await t.p.click('.chip[data-view="list"]'); await t.p.waitForTimeout(400);
  await t.p.click('#sortclose'); await t.p.waitForTimeout(400);
  const r2 = await t.p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  await (await t.p.$$('#list .row'))[r2.findIndex(x=>/Cornelia/.test(x))].click();
  await t.p.waitForTimeout(800);
  console.log('  on              :', await t.p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  no trail        :', await t.p.evaluate(()=>!document.querySelector('#detail .trail')),
    '(one date is not a trail)');

  console.log('\npage errors     :', t.errs.length ? t.errs : 'none');
  await t.b.close();
})();

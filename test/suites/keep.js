/* The bug: filing a 311 planting request makes the city's query drop the
   site, which used to delete the completed task with it. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = Array.from({length:6}, (_,i)=>({
  sr_number:'SR26-0000'+i, street_number:String(700+i*10), street_direction:'W',
  street_name:'Buckingham', street_type:'Ave', zip_code:'60657',
  latitude:String(41.9440+i*0.0009), longitude:String(-87.6500+i*0.0009),
  closed_date:'2026-05-11T00:00:00.000'
}));
// starts empty: nobody has asked for a tree anywhere yet
let plantings = [];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true });
  let store = {};
  const wire = async pg => {
    await pg.route('**/data.cityofchicago.org/**', r => {
      const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
      if (/Tree Planting Request/.test(u)) return r.fulfill({ json: plantings });
      if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
      // recovery query: sr_number in('…')
      const ids = [...u.matchAll(/'([^']+)'/g)].map(m=>m[1]);
      return r.fulfill({ json: removals.filter(x => ids.includes(x.sr_number)) });
    });
    await pg.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js',  contentType:'application/javascript' }));
    await pg.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
    await pg.route('**/*.png', r => r.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'), contentType:'image/png' }));
    await pg.route('**/api/marks', async r => {
      if (r.request().method() === 'PUT'){
        const body = JSON.parse(r.request().postData()||'{}');
        for (const [id,m] of Object.entries(body.marks||{})){
          const out = { state:m.state, at:m.at };
          for (const k of ['by','sr','note']) if (m[k]) out[k] = m[k];
          if (m.site && Number.isFinite(+m.site.lat)) out.site = m.site;   // the Worker keeps it
          if (!store[id] || !store[id].at || out.at >= store[id].at) store[id] = out;
        }
      }
      return r.fulfill({ json:{ marks: store } });
    });
  };

  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await wire(p);
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1200);

  console.log('=== report no tree, then file the request ===');
  if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))) { await p.click('#sortbtn'); await p.waitForTimeout(250); }
  await p.click('.chip[data-view="list"]'); await p.waitForTimeout(500);
  await p.click('#sortclose'); await p.waitForTimeout(400);
  await p.click('.row'); await p.waitForTimeout(800);
  const addr = await p.$eval('.daddr', e=>e.textContent.trim());
  console.log('  site          :', addr);
  await p.click('#dock .act.no'); await p.waitForTimeout(900);
  await p.click('[data-file]'); await p.waitForTimeout(500);
  await p.fill('.srinput','SR26-98765432');
  await p.click('.srform button[type="submit"]'); await p.waitForTimeout(900);
  console.log('  filed         :', await p.$$eval('.donerow .draddr', e=>e.map(x=>x.textContent.trim())));
  console.log('  snapshot kept :', await p.evaluate(()=>{
    const m = JSON.parse(localStorage.getItem('stump.marks')||'{}');
    const one = Object.values(m).find(x=>x.sr);
    return one && one.site ? one.site.address : 'NONE'; }));

  console.log('\n=== the city now shows a planting request there ===');
  plantings = [{ sr_number:'SR26-11111111', street_number:'700', street_direction:'W',
                 street_name:'Buckingham', created_date:'2026-08-30T12:00:00.000', status:'Open' }];
  await p.reload();
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1800);
  await p.click('#tasksbtn'); await p.waitForTimeout(800);
  const done = await p.$$eval('.donerow .draddr', e=>e.map(x=>x.textContent.trim()));
  console.log('  filed still there:', done, done.includes(addr) ? 'KEPT' : 'LOST');
  console.log('  city confirmation:', await p.$$eval('.donerow .drmeta', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  number kept      :', await p.$$eval('.donerow .drmeta', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())).then(a=>a.filter(t=>/SR26-98765432/.test(t))));
  await p.screenshot({ path:'k1-tasks.png', fullPage:true });

  console.log('\n=== and it is still openable, mapped, and in the list ===');
  await p.click('.mark button'); await p.waitForTimeout(700);
  console.log('  sites loaded  :', await p.evaluate(()=>SITES.length));
  if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))) { await p.click('#sortbtn'); await p.waitForTimeout(250); }
  await p.click('.chip[data-show="req"]'); await p.waitForTimeout(400);
  await p.click('.chip[data-view="list"]'); await p.waitForTimeout(500);
  await p.click('#sortclose'); await p.waitForTimeout(400);
  console.log('  filed filter  :', await p.$$eval('.row .raddr', e=>e.map(x=>x.textContent.trim())));
  await p.click('.row'); await p.waitForTimeout(800);
  console.log('  detail opens  :', await p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  status line   :', await p.evaluate(()=>{
    const el = document.querySelector('#detail .statusline') || document.querySelector('#detail .state');
    return el ? el.textContent.replace(/\s+/g,' ').trim() : '(no line)'; }));
  await p.screenshot({ path:'k2-detail.png' });

  console.log('\n=== a report with no snapshot at all is recovered ===');
  store = { 'SR26-00003': { state:'req', at:'2026-08-01T10:00:00.000Z', sr:'SR26-55555555' } };
  const p2 = await ctx.newPage();
  const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
  await wire(p2);
  await p2.addInitScript(()=>{ try{ localStorage.clear(); }catch(e){} });
  await p2.goto('http://localhost:'+PORT+'/');
  await p2.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p2.waitForTimeout(2000);
  await p2.click('#tasksbtn'); await p2.waitForTimeout(800);
  console.log('  recovered     :', await p2.$$eval('.donerow .draddr', e=>e.map(x=>x.textContent.trim())));
  console.log('  snapshot saved:', await p2.evaluate(()=>{
    const m = JSON.parse(localStorage.getItem('stump.marks')||'{}');
    return m['SR26-00003'] && m['SR26-00003'].site ? m['SR26-00003'].site.address : 'NONE'; }));
  console.log('  pushed to sync:', store['SR26-00003'] && store['SR26-00003'].site
    ? store['SR26-00003'].site.address : 'NONE');

  console.log('\npage errors    :', [...errs, ...errs2].length ? [...errs,...errs2] : 'none');
  await b.close();
})();

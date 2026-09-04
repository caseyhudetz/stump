const { chromium } = require('playwright');
const SITES = Array.from({length:12}, (_,i)=>({
  sr_number:'SR'+i, street_number:String(700+i*10), street_direction:'W',
  street_name:['Buckingham','Cornelia','Sheffield'][i%3], street_type:'Ave',
  zip_code:'60657', latitude:String(41.9440+i*0.0009), longitude:String(-87.6500+i*0.0009),
  closed_date:'2026-05-11T00:00:00.000'
}));
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PORT = process.env.PORT || '8150';

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9446, longitude:-87.6502}, permissions:['geolocation'] });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r =>
    r.fulfill({ json: r.request().url().includes('Removal') ? SITES : [] }));
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js',  contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');
  await p.route('**/*.png', r => r.fulfill({ body: PNG, contentType:'image/png' }));
  // in-memory sync server, so notes can be checked across a round trip
  let store = {};
  await p.route('**/api/marks', async r => {
    if (r.request().method() === 'PUT'){
      const body = JSON.parse(r.request().postData()||'{}');
      for (const [id,m] of Object.entries(body.marks||{})){
        // mimic the Worker: only known fields survive
        const out = { state:m.state, at:m.at };
        if (m.by) out.by = String(m.by).slice(0,40);
        if (m.sr) out.sr = String(m.sr).slice(0,40);
        if (m.note) out.note = String(m.note).slice(0,200);
        if (!store[id] || !store[id].at || out.at >= store[id].at) store[id] = out;
      }
    }
    return r.fulfill({ json:{ marks: store } });
  });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1500);

  const view = () => p.evaluate(() => {
    const b = window.__map ? null : null;   // no globals; read from Leaflet's DOM instead
    return null;
  });
  /* What the map is showing now. Reading it off the loaded tiles lags —
     Leaflet keeps the old ones in the DOM after a pan — so ask the map. */
  const mapBounds = () => p.evaluate(() => {
    if (!window.map) return null;
    const b = map.getBounds();
    return { zoom: map.getZoom(),
             west:+b.getWest().toFixed(4), east:+b.getEast().toFixed(4),
             north:+b.getNorth().toFixed(4), south:+b.getSouth().toFixed(4) };
  });

  // the filter panel stays open once opened, so only open it when it is shut
  const pick = async (pg, v) => {
    if (await pg.$eval('#browse', e=>e.hasAttribute('hidden'))){
      await pg.click('.mark button'); await pg.waitForTimeout(400);
    }
    if (await pg.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){
      await pg.click('#sortbtn'); await pg.waitForTimeout(250);
    }
    await pg.click(`.chip[data-view="${v}"]`); await pg.waitForTimeout(600);
    await pg.click('#sortclose'); await pg.waitForTimeout(400);
  };

  console.log('=== 1. opens on East Lakeview, not on home ===');
  const v0 = await mapBounds();
  console.log('  visible        :', JSON.stringify(v0));
  // Diversey 41.9325 .. Irving Park 41.9545 should both be in frame
  console.log('  covers Diversey:', v0 && v0.south <= 41.9330);
  console.log('  covers Irving P:', v0 && v0.north >= 41.9540);
  console.log('  not home-zoom  :', v0 && v0.zoom <= 14, '(zoom', v0 && v0.zoom, ')');
  await p.screenshot({ path:'f4-1-open.png' });

  console.log('\n=== 2. recenter button on the main map ===');
  const rc = await p.$eval('#mecenter', e => { const r=e.getBoundingClientRect();
    const m=document.querySelector('#map').getBoundingClientRect();
    return { w:Math.round(r.width), h:Math.round(r.height), overMap: r.top>m.top && r.bottom<=m.bottom+1,
             onScreen: r.top>=0 && r.bottom<=innerHeight }; });
  console.log('  size/placement :', JSON.stringify(rc));
  await pick(p, 'list');
  console.log('  hidden in list :', await p.$eval('#mecenter', e=>!e.offsetParent));
  await pick(p, 'map');

  await p.click('#mecenter'); await p.waitForTimeout(1800);
  const v1 = await mapBounds();
  console.log('  after tap      :', JSON.stringify(v1));
  console.log('  zoomed in on me:', v1 && v1.zoom >= 17);
  console.log('  you-dot drawn  :', await p.evaluate(()=>!!document.querySelector('#map .pin.me')));
  console.log('  button is blue :', await p.$eval('#mecenter', e=>e.classList.contains('on')));
  await p.screenshot({ path:'f4-2-recentered.png' });

  // pan away, then press it again — the biking case
  await p.evaluate(()=>{ const m=document.querySelector('#map'); const r=m.getBoundingClientRect();
    return null; });
  await p.evaluate(()=>map.panBy([0, -260], { animate:false }));
  await p.waitForTimeout(700);
  const vPan = await mapBounds();
  console.log('  offered again  :', await p.$eval('#mecenter', e=>!!e.offsetParent));
  await p.click('#mecenter'); await p.waitForTimeout(1800);
  const vBack = await mapBounds();
  console.log('  panned away    :', vPan && vPan.north, '-> recentered', vBack && vBack.north,
              '(moved back:', JSON.stringify(vPan)!==JSON.stringify(vBack), ')');

  console.log('\n=== 3. notes on a report ===');
  await pick(p, 'list');
  await p.click('.row'); await p.waitForTimeout(900);
  const addr = await p.$eval('.daddr', e=>e.textContent.trim());
  console.log('  site           :', addr);
  console.log('  note affordance:', (await p.$eval('.notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())));
  await p.click('.notebtn'); await p.waitForTimeout(400);
  console.log('  editor open    :', await p.evaluate(()=>!!document.querySelector('.noteform .noteinput')));
  console.log('  focused        :', await p.evaluate(()=>document.activeElement.classList.contains('noteinput')));
  await p.fill('.noteinput', 'Three empty pits at this address, not one. Stump still in the middle one.');
  // a sync pull mid-typing must not wipe the draft
  await p.evaluate(()=>window.repaint && window.repaint()); await p.waitForTimeout(300);
  console.log('  draft survives repaint:', JSON.stringify((await p.$eval('.noteinput', e=>e.value)).slice(0,30)));
  await p.click('.noteform button[type="submit"]'); await p.waitForTimeout(800);
  console.log('  saved & shown  :', (await p.$eval('.notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())).slice(0,60));
  await p.screenshot({ path:'f4-3-note.png' });

  console.log('\n=== 4. the note follows the report ===');
  await p.click('#dock .act.no'); await p.waitForTimeout(1000);
  console.log('  on tasks       :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  note on card   :', (await p.$eval('.task .notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())).slice(0,60));
  console.log('  survives mark  :', await p.evaluate(()=>{
    const m=JSON.parse(localStorage.getItem('stump.marks')||'{}');
    return Object.values(m).some(x=>x.note && x.state==='none'); }));
  const pkt = await p.$$eval('.task .fval p', e=>e.map(x=>x.textContent));
  console.log('  in 311 wording :', pkt.some(t=>/Noted on site: Three empty pits/.test(t)));
  await p.screenshot({ path:'f4-4-task.png', fullPage:true });

  console.log('\n=== 5. the note survives the sync round trip ===');
  const synced = Object.values(store).find(m=>m.note);
  console.log('  server has note:', synced ? JSON.stringify(synced).slice(0,120) : 'NONE');
  // second device
  const p2 = await ctx.newPage();
  await p2.route('**/data.cityofchicago.org/**', r => r.fulfill({ json: r.request().url().includes('Removal') ? SITES : [] }));
  await p2.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js',  contentType:'application/javascript' }));
  await p2.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p2.route('**/*.png', r => r.fulfill({ body: PNG, contentType:'image/png' }));
  await p2.route('**/api/marks', r => r.fulfill({ json:{ marks: store } }));
  await p2.addInitScript(()=>{ try{ localStorage.clear(); }catch(e){} });
  await p2.goto('http://localhost:'+PORT+'/');
  await p2.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p2.waitForTimeout(2000);
  await p2.click('#tasksbtn'); await p2.waitForTimeout(700);
  console.log('  other device   :', (await p2.$eval('.task .notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())).slice(0,60));

  console.log('\n=== 6. an SR number and a note coexist ===');
  await p.click('[data-file]'); await p.waitForTimeout(500);
  await p.fill('.srinput','SR26-98765432');
  await p.click('.srform button[type="submit"]'); await p.waitForTimeout(900);
  console.log('  filed w/ number:', await p.$$eval('.donerow .drmeta', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  await p.click('.donerow summary'); await p.waitForTimeout(500);
  console.log('  note still here:', (await p.$eval('.donerow[open] .notebtn', e=>e.textContent.replace(/\s+/g,' ').trim())).slice(0,40));
  console.log('  stored         :', await p.evaluate(()=>{
    const m=JSON.parse(localStorage.getItem('stump.marks')||'{}');
    return JSON.stringify(Object.values(m).find(x=>x.sr)); }));

  console.log('\npage errors     :', errs.length ? errs : 'none');
  await b.close();
})();

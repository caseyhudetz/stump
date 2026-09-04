/* One vector basemap (crisp at any zoom), with a raster fallback, and a
   sheet you can drag. Runs the REAL maplibre-gl + leaflet plugin from npm. */
const { chromium } = require('playwright');
const fs = require('fs');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = [
  { sr_number:'SR26-A', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date:'2026-04-11T00:00:00.000' }
];
const plantings = [
  { sr_number:'SR26-P1', street_number:'702', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', latitude:'41.944080', longitude:'-87.650000',
    created_date:'2026-08-01T00:00:00.000', status:'Open' }
];

// a minimal but valid MapLibre style: no network sources, just a ground
const STYLE = { version:8, name:'test', sources:{}, layers:[
  { id:'bg', type:'background', paint:{ 'background-color':'#F2F1EC' } } ] };

(async (mode) => {
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
  // the real libraries, straight out of the npm tarballs
  await p.route('**/maplibre-gl.css', r => r.fulfill({ path:'ml.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl@*/dist/maplibre-gl.js', r =>
    mode === 'nolib' ? r.abort() : r.fulfill({ path:'ml.js', contentType:'application/javascript' }));
  await p.route('**/leaflet-maplibre-gl.js', r =>
    mode === 'nolib' ? r.abort() : r.fulfill({ path:'mlleaf.js', contentType:'application/javascript' }));
  await p.route('**/tiles.openfreemap.org/**', r =>
    mode === 'nostyle' ? r.abort() : r.fulfill({ json: STYLE }));
  await p.route('**/tile.openstreetmap.org/**', r => r.fulfill({
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'),
    contentType:'image/png' }));
  await p.route('**/api/marks', r => r.fulfill({ json:{ marks:{} } }));
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(mode === 'nostyle' ? 9000 : 2500);

  console.log(`=== mode: ${mode} ===`);
  console.log('  maplibre loaded  :', await p.evaluate(()=>typeof maplibregl !== 'undefined'));
  console.log('  plugin loaded    :', await p.evaluate(()=>typeof L.maplibreGL === 'function'));
  console.log('  rasterMode       :', await p.evaluate(()=>rasterMode));
  console.log('  gl canvas on map :', await p.evaluate(()=>!!document.querySelector('#map .maplibregl-canvas')));
  console.log('  raster img tiles :', await p.evaluate(()=>document.querySelectorAll('#map img.leaflet-tile').length));
  console.log('  map maxZoom      :', await p.evaluate(()=>map.getMaxZoom()));
  console.log('  pins drawn       :', await p.evaluate(()=>document.querySelectorAll('#map .pin').length));
  if (mode !== 'ok') console.log('  toast            :', await p.$eval('#toast', e=>e.textContent.trim()));

  console.log('  zoom to street   :', await p.evaluate(async ()=>{
    map.setView([41.944,-87.650], 19); await new Promise(r=>setTimeout(r,900));
    return map.getZoom(); }));
  console.log('  pins still there :', await p.evaluate(()=>document.querySelectorAll('#map .pin').length));
  await p.screenshot({ path:`vec-${mode}.png` });

  if (mode === 'ok'){
    console.log('\n  --- dragging the card ---');
    const tap = async () => {
      const mb = await p.$eval('#map', e=>{const r=e.getBoundingClientRect();return {t:r.top,b:r.bottom,l:r.left,r:r.right};});
      for (const h of await p.$$('#map .leaflet-marker-icon')){
        const bb = await h.boundingBox();
        if (bb && bb.y>mb.t && bb.y+bb.height<mb.b && bb.x>mb.l && bb.x+bb.width<mb.r){
          await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); return true;
        }
      }
      return false;
    };
    console.log('  tapped a pin     :', await tap()); await p.waitForTimeout(800);
    console.log('  sheet up         :', await p.$eval('#pitsheet', e=>!e.hasAttribute('hidden')));
    console.log('  handle exists    :', await p.evaluate(()=>!!document.querySelector('#pitsheet .dragzone .grip')));
    console.log('  handle is grabby :', await p.evaluate(()=>
      getComputedStyle(document.querySelector('.dragzone')).touchAction === 'none'),
      '(touch-action: none, so the browser does not steal the drag)');

    const grip = await p.$eval('#pitsheet .grip', e=>{const r=e.getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};});
    // drag it up past the threshold
    await p.mouse.move(grip.x, grip.y);
    await p.mouse.down();
    for (let i=1;i<=10;i++) await p.mouse.move(grip.x, grip.y - i*40);
    await p.mouse.up();
    await p.waitForTimeout(900);
    console.log('  dragged up  ->   :', await p.$eval('#pitsheet', e=>e.classList.contains('full')) ? 'card opened' : 'NOTHING');
    console.log('  reveals details  :', await p.evaluate(()=>{
      const q = document.querySelector('#pitsheet .restpart .quiet');
      const r = q.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
    await p.screenshot({ path:'vec-dragged.png' });

    // down again: once back to the peek, then off the bottom
    const stop = () => p.evaluate(()=>{
      const el = document.querySelector('#pitsheet');
      return el.hidden ? 'dismissed' : el.classList.contains('full') ? 'still full' : 'peek'; });
    const dragDown = async () => {
      await p.waitForTimeout(400);
      const g = await p.$eval('#pitsheet .grip', e=>{const r=e.getBoundingClientRect();
        return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};});
      await p.mouse.move(g.x, g.y); await p.mouse.down();
      for (let i=1;i<=10;i++) await p.mouse.move(g.x, g.y + i*40);
      await p.mouse.up(); await p.waitForTimeout(700);
    };
    await dragDown();
    console.log('  dragged down ->  :', await stop(), '(the nearer stop)');
    await dragDown();
    console.log('  and again ->     :', await stop());

    // a small movement must still count as a tap on the buttons
    await p.evaluate(()=>unpick()); await p.waitForTimeout(400);
    await p.evaluate(()=>map.setView([41.944,-87.650], 17)); await p.waitForTimeout(600);
    await tap(); await p.waitForTimeout(800);
    await p.click('#pitsheet .act.no'); await p.waitForTimeout(700);
    if (await p.$('#pitsheet .chooser')) { await p.click('#pitsheet .chooser .mini.ghost'); await p.waitForTimeout(900); }
    console.log('  buttons still tap:', await p.evaluate(()=>!document.querySelector('#taskdot').hidden));
  }

  console.log('  page errors      :', errs.length ? errs.slice(0,3) : 'none');
  await b.close();
})(process.argv[2] || 'ok');

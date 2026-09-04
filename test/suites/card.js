/* The card drags open over the map; controls sit on the map; the key stays
   on screen; the locate control comes and goes. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = [
  { sr_number:'SR26-A', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.947000', longitude:'-87.652000',
    closed_date:'2026-04-11T00:00:00.000' }
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
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#f0efe9'}}]} }));
  await p.route('**/tile.openstreetmap.org/**', r => r.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'), contentType:'image/png' }));
  await p.route('**/api/marks', r => r.fulfill({ json:{ marks:{} } }));
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(2200);

  const vh = 844;
  const box = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect();
    return { top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height), w:Math.round(r.width) }; });

  console.log('=== everything fits: the key is on screen ===');
  const lg = await box('#legend'), mp = await box('#map');
  console.log('  map              :', JSON.stringify(mp));
  console.log('  legend           :', JSON.stringify(lg));
  console.log('  legend visible   :', lg.bottom <= vh, `(bottom ${lg.bottom} of ${vh})`);
  console.log('  no page scroll   :', await p.evaluate(()=>{
    const f = document.querySelector('.browsefit');
    return f.scrollHeight <= f.clientHeight + 2; }));
  await p.screenshot({ path:'c1-map.png' });

  console.log('\n=== controls sit on the map ===');
  const ctls = await p.$$eval('.mapctls .mapctl', e => e.filter(x=>!x.hidden).map(x=>x.id));
  console.log('  stacked on map   :', ctls);
  console.log('  inside the map   :', await p.evaluate(()=>{
    const m = document.querySelector('#map').getBoundingClientRect();
    return [...document.querySelectorAll('.mapctls .mapctl')].filter(x=>!x.hidden).every(x=>{
      const r = x.getBoundingClientRect();
      return r.top > m.top && r.bottom < m.bottom && r.right < m.right + 2; }); }));
  console.log('  filter gone from the page:', await p.evaluate(()=>!document.querySelector('.countrow #sortbtn')));

  console.log('\n=== locate: only when you are off it ===');
  console.log('  before a fix     :', await p.$eval('#mecenter', e=>!e.hidden), '(offered, so you can ask)');
  await p.click('#mecenter'); await p.waitForTimeout(1800);
  console.log('  once centred     :', await p.$eval('#mecenter', e=>!e.hidden), '(hidden)');
  await p.evaluate(()=>map.panBy([0,400],{animate:false})); await p.waitForTimeout(700);
  console.log('  after panning off:', await p.$eval('#mecenter', e=>!e.hidden), '(back)');
  await p.click('#mecenter'); await p.waitForTimeout(900);
  console.log('  centred again    :', await p.$eval('#mecenter', e=>!e.hidden), '(hidden)');
  await p.screenshot({ path:'c2-controls.png' });

  console.log('\n=== the filter is a sheet off the map control ===');
  await p.click('#sortbtn'); await p.waitForTimeout(600);
  console.log('  sheet up         :', await p.$eval('#sortwrap', e=>!e.hasAttribute('hidden')));
  console.log('  titled           :', await p.$eval('.ptitle', e=>e.textContent.trim()));
  const sp = await box('#sortpanel');
  console.log('  sits at bottom   :', sp.bottom >= vh - 2, JSON.stringify(sp));
  console.log('  options          :', (await p.$$eval('#sortpanel .plabel', e=>e.map(x=>x.textContent.trim()))).join(' / '));
  await p.screenshot({ path:'c3-filter.png' });
  await p.click('#sortclose'); await p.waitForTimeout(500);
  console.log('  closed           :', await p.$eval('#sortwrap', e=>e.hasAttribute('hidden')));

  console.log('\n=== the card: peek, then dragged open ===');
  const tapPin = async () => {
    const m = await p.$eval('#map', e=>{const r=e.getBoundingClientRect();return {t:r.top,b:r.bottom,l:r.left,r:r.right};});
    for (const h of await p.$$('#map .leaflet-marker-icon')){
      const bb = await h.boundingBox();
      if (bb && bb.y>m.t && bb.y+bb.height<m.b && bb.x>m.l && bb.x+bb.width<m.r){
        await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); return true; } }
    return false;
  };
  console.log('  tapped a pin     :', await tapPin()); await p.waitForTimeout(900);
  const peek = await box('#pitsheet');
  console.log('  card at peek     :', JSON.stringify(peek), `(shows ${vh - peek.top}px)`);
  console.log('  map still visible:', peek.top > 300);
  console.log('  decision showing :', await p.evaluate(()=>{
    const b = document.querySelector('#pitsheet .act'); if (!b) return false;
    const r = b.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; }));
  console.log('  details hidden   :', await p.evaluate(()=>{
    const d = document.querySelector('#pitsheet .restpart');
    return d.getBoundingClientRect().top > innerHeight - 10; }));
  await p.screenshot({ path:'c4-peek.png' });

  // drag it up slowly and watch the card climb
  const g = await p.$eval('#pitsheet .grip', e=>{const r=e.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};});
  await p.mouse.move(g.x, g.y); await p.mouse.down();
  const steps = [];
  for (let i=1;i<=10;i++){
    await p.mouse.move(g.x, g.y - i*40);
    if (i % 3 === 0) steps.push((await box('#pitsheet')).top);
  }
  console.log('  tracks the finger:', steps, steps.every((v,i,a)=>i===0||v<=a[i-1]) ? '(rises)' : '(STUCK)');
  await p.mouse.up(); await p.waitForTimeout(600);
  const full = await box('#pitsheet');
  console.log('  settles open     :', JSON.stringify(full));
  console.log('  is full          :', await p.$eval('#pitsheet', e=>e.classList.contains('full')));
  console.log('  details now shown:', await p.evaluate(()=>{
    const d = document.querySelector('#pitsheet .restpart .quiet');
    const r = d.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
  console.log('  what it reveals  :', await p.$$eval('#pitsheet .restpart .qact, #pitsheet .restpart summary, #pitsheet .restpart .notebtn',
    e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  still over the map:', full.top > 20);
  await p.screenshot({ path:'c5-full.png' });

  // and back down
  const g2 = await p.$eval('#pitsheet .grip', e=>{const r=e.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};});
  await p.mouse.move(g2.x, g2.y); await p.mouse.down();
  for (let i=1;i<=10;i++) await p.mouse.move(g2.x, g2.y + i*40);
  await p.mouse.up(); await p.waitForTimeout(600);
  console.log('  dragged down     :', await p.$eval('#pitsheet', e=>e.hasAttribute('hidden')) ? 'dismissed' : 'back to peek');

  console.log('\n=== buttons still work ===');
  await tapPin(); await p.waitForTimeout(800);
  await p.click('#pitsheet .act.no'); await p.waitForTimeout(900);
  console.log('  reported         :', await p.evaluate(()=>!document.querySelector('#taskdot').hidden));
  console.log('  card still up    :', await p.$eval('#pitsheet', e=>!e.hasAttribute('hidden')));

  console.log('\n=== tasks lost its back button ===');
  await p.click('#tasksbtn'); await p.waitForTimeout(600);
  console.log('  no back button   :', await p.evaluate(()=>!document.querySelector('#backsites')));
  console.log('  wordmark works   :', await p.evaluate(async ()=>{
    document.querySelector('#home').click(); await new Promise(r=>setTimeout(r,400));
    return !document.querySelector('#browse').hasAttribute('hidden'); }));

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

/* One tap makes the task: the phone already knows where it is, so the
   address is looked up rather than typed. And the photo stays with the task
   on the device that took it. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// one removal, far from where we are standing, so the photo lands on nothing
const removals = [
  { sr_number:'SR26-A', street_number:'3139', street_direction:'N', street_name:'Sheffield',
    street_type:'Ave', zip_code:'60657', latitude:'41.940000', longitude:'-87.653000',
    closed_date:'2026-05-11T00:00:00.000' },
  { sr_number:'SR26-B', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' }
];

// a real-looking jpeg, 1x1, no EXIF — the fix comes from the browser
const noGPS = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwAqn//Z','base64');

const run = async (opts) => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE,
    hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9355, longitude:-87.6480}, permissions:['geolocation'] });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js', contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl.css', r => r.fulfill({ path:'ml.css', contentType:'text/css' }));
  await p.route('**/maplibre-gl@*/dist/maplibre-gl.js', r => r.fulfill({ path:'ml.js', contentType:'application/javascript' }));
  await p.route('**/leaflet-maplibre-gl.js', r => r.fulfill({ path:'mlleaf.js', contentType:'application/javascript' }));
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#f2f1ea'}}]} }));

  // the geocoder, in whichever mood this run wants
  const asked = [];
  await p.route('**/nominatim.openstreetmap.org/**', r => {
    asked.push(r.request().url());
    if (opts.geocoder === 'down') return r.fulfill({ status:503, body:'no' });
    if (opts.geocoder === 'nonumber')
      return r.fulfill({ json:{ address:{ road:'West Cornelia Avenue', postcode:'60657' } } });
    return r.fulfill({ json:{ address:{
      house_number:'623', road:'West Stratford Place', postcode:'60657', city:'Chicago' } } });
  });

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
  return { b, ctx, p, errs, asked, store: () => store };
};

(async () => {
  // ---------------------------------------------------------------- happy
  console.log('=== one tap, no typing ===');
  let t = await run({ geocoder:'ok' });
  await t.p.click('#mecenter'); await t.p.waitForTimeout(1800);
  await t.p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer:noGPS });
  await t.p.waitForTimeout(1200);
  console.log('  offers        :', await t.p.$eval('#spotstart', e=>e.textContent.trim()));
  console.log('  no form yet   :', await t.p.evaluate(()=>!document.querySelector('#spotform')));
  await t.p.click('#spotstart');
  await t.p.waitForTimeout(1600);
  console.log('  never asked   :', await t.p.evaluate(()=>!document.querySelector('#spotform')));
  console.log('  asked the geocoder:', t.asked.length, t.asked[0] ? new URL(t.asked[0]).pathname : '');
  console.log('  coords sent   :', t.asked[0] ? new URL(t.asked[0]).search.replace(/^\?/,'').split('&').filter(x=>/^la|^lo/.test(x)).join(' ') : '');
  console.log('  on tasks      :', await t.p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  task made for :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  shortened     :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim()))
    .then(a=>a[0] === '623 W Stratford Pl' ? 'yes — "West Stratford Place" -> "623 W Stratford Pl"' : 'NO'));
  const pkt = await t.p.$$eval('.task .fval p', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('  311 address   :', pkt.find(x=>/Chicago, IL/.test(x)), '(zip came from the lookup)');
  console.log('  says how      :', await t.p.$eval('.task .addrnote', e=>e.textContent.replace(/\s+/g,' ').trim()));
  await t.p.screenshot({ path:'sp1-onetap.png', fullPage:true });

  console.log('\n=== the photo rides along, on this device ===');
  console.log('  photo shown   :', await t.p.evaluate(()=>{
    const l = document.querySelector('.task .shotline');
    return l ? !l.hidden : false; }));
  console.log('  says what     :', await t.p.$eval('.task .shotline .shotsay p', e=>e.textContent.trim()));
  console.log('  src is a blob :', await t.p.$eval('.task .tshot', e=>/^blob:/.test(e.src)));
  console.log('  renders       :', await t.p.$eval('.task .tshot', e=>e.naturalWidth > 0));
  console.log('  stored in IDB :', await t.p.evaluate(async ()=>{
    const db = await photos();
    return await new Promise(r=>{ const q = db.transaction('shots').objectStore('shots').getAllKeys();
      q.onsuccess = ()=>r(q.result); }); }));
  console.log('  not in sync   :', await t.p.evaluate(()=>JSON.stringify(
    Object.values(JSON.parse(localStorage.getItem('stump.marks')||'{}'))[0])).then(s=>!/blob|data:|photo/i.test(s)));
  console.log('  mark stays small:', JSON.stringify(Object.values(t.store())[0]).length + ' bytes on the wire');

  console.log('\n=== and it is still there after a reload ===');
  await t.p.reload(); await t.p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await t.p.waitForTimeout(2200);
  await t.p.click('#tasksbtn'); await t.p.waitForTimeout(900);
  console.log('  task          :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  photo back    :', await t.p.evaluate(()=>{
    const l = document.querySelector('.task .shotline'); return l ? !l.hidden : false; }));

  console.log('\n=== the looked-up address can be corrected ===');
  await t.p.click('.task [data-addr]'); await t.p.waitForTimeout(500);
  console.log('  prefilled     :', await t.p.$eval('#addrfix', e=>e.value));
  console.log('  16px          :', await t.p.$eval('#addrfix', e=>getComputedStyle(e).fontSize));
  await t.p.fill('#addrfix', '625 W Stratford Pl');
  await t.p.click('.task [data-addrfor] button[type="submit"]'); await t.p.waitForTimeout(900);
  console.log('  now reads     :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  311 follows   :', await t.p.$$eval('.task .fval p', e=>e.map(x=>x.textContent.trim()))
    .then(a=>a.find(x=>/Chicago, IL/.test(x))));
  console.log('  synced        :', await t.p.evaluate(()=>true) &&
    JSON.stringify(Object.values(t.store())[0].site.address));

  console.log('\n=== undoing the task takes the photo with it ===');
  await t.p.click('.task [data-undo]'); await t.p.waitForTimeout(900);
  console.log('  keys left     :', await t.p.evaluate(async ()=>{
    const db = await photos();
    return await new Promise(r=>{ const q = db.transaction('shots').objectStore('shots').getAllKeys();
      q.onsuccess = ()=>r(q.result); }); }));
  console.log('  page errors   :', t.errs.length ? t.errs : 'none');
  await t.b.close();

  // ------------------------------------------------------------ geocoder off
  console.log('\n=== when the lookup cannot answer, you type it ===');
  t = await run({ geocoder:'down' });
  await t.p.click('#mecenter'); await t.p.waitForTimeout(1800);
  await t.p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer:noGPS });
  await t.p.waitForTimeout(1200);
  await t.p.click('#spotstart'); await t.p.waitForTimeout(1600);
  console.log('  falls back    :', await t.p.evaluate(()=>!!document.querySelector('#spotform')));
  console.log('  asks          :', await t.p.$eval('#photosheet .flabel', e=>e.textContent.trim()));
  console.log('  focused       :', await t.p.evaluate(()=>document.activeElement.id));
  console.log('  said so       :', await t.p.$eval('#toast', e=>e.textContent.trim()));
  await t.p.screenshot({ path:'sp2-fallback.png' });
  await t.p.fill('#spotaddr', '2841 N Sheffield Ave');
  await t.p.click('#spotform button[type="submit"]'); await t.p.waitForTimeout(1200);
  console.log('  task made     :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  photo kept too:', await t.p.evaluate(()=>{
    const l = document.querySelector('.task .shotline'); return l ? !l.hidden : false; }));
  console.log('  page errors   :', t.errs.length ? t.errs : 'none');
  await t.b.close();

  // ------------------------------------------------- a point with no number
  console.log('\n=== a point the geocoder cannot put a number on ===');
  t = await run({ geocoder:'nonumber' });
  await t.p.click('#mecenter'); await t.p.waitForTimeout(1800);
  await t.p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer:noGPS });
  await t.p.waitForTimeout(1200);
  await t.p.click('#spotstart'); await t.p.waitForTimeout(1600);
  console.log('  will not guess:', await t.p.evaluate(()=>!!document.querySelector('#spotform')),
    '(a 311 request without a house number is no use)');
  console.log('  page errors   :', t.errs.length ? t.errs : 'none');
  await t.b.close();

  // ------------------------------------- a photo that lands on a known pit
  console.log('\n=== a photo of a pit the city does know keeps its picture too ===');
  t = await run({ geocoder:'ok' });
  await t.p.evaluate(()=>{ me = { lat:41.944, lng:-87.650 }; meAcc = 10; meState='on'; });
  await t.p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer:noGPS });
  await t.p.waitForTimeout(1200);
  console.log('  matched       :', await t.p.$eval('#photosheet h3', e=>e.textContent.trim()));
  await t.p.click('#photosheet [data-mark$="::none"]'); await t.p.waitForTimeout(1200);
  console.log('  task made     :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  photo on it   :', await t.p.evaluate(()=>{
    const l = document.querySelector('.task .shotline'); return l ? !l.hidden : false; }));
  console.log('  no address row:', await t.p.evaluate(()=>!document.querySelector('.task .addrnote')),
    '(the city already named this one)');
  await t.p.screenshot({ path:'sp3-known-pit.png', fullPage:true });
  console.log('  page errors   :', t.errs.length ? t.errs : 'none');
  await t.b.close();

  // ------------------------------------- a task with no photo shows nothing
  console.log('\n=== a task made without a photo shows no photo row ===');
  t = await run({ geocoder:'ok' });
  await t.p.evaluate(()=>{ if (view!=='list'){ } });
  await t.p.click('#sortbtn'); await t.p.waitForTimeout(400);
  await t.p.click('.chip[data-view="list"]'); await t.p.waitForTimeout(400);
  await t.p.click('#sortclose'); await t.p.waitForTimeout(400);
  await t.p.click('#list .row'); await t.p.waitForTimeout(800);
  await t.p.click('#dock .act.no'); await t.p.waitForTimeout(1000);
  console.log('  task made     :', await t.p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  row hidden    :', await t.p.evaluate(()=>{
    const l = document.querySelector('.task .shotline'); return !l || l.hidden; }));
  console.log('  page errors   :', t.errs.length ? t.errs : 'none');
  await t.b.close();
})();

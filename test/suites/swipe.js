/* Every sheet goes away the same way, and a record that knows about one pit
   can be overruled by the person looking at two. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DAY = 86400000, now = Date.now();
const iso = d => new Date(d).toISOString().replace('Z','');

const removals = [
  // this morning's case: a pit the city has a request for, and a second one
  // beside it that nobody has asked about
  { sr_number:'SR26-A', street_number:'648', street_direction:'W', street_name:'Aldine',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date: iso(now - 100*DAY) },
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date: iso(now - 120*DAY) }
];
const plantings = [
  { sr_number:'SR26-00935042', street_number:'648', street_direction:'W', street_name:'Aldine',
    street_type:'Ave', latitude:'41.944050', longitude:'-87.650000',
    created_date: iso(now - 92*DAY), status:'Open' }
];
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwAqn//Z','base64');

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE,
    hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9440, longitude:-87.6500}, permissions:['geolocation'] });
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
  await p.route('**/nominatim.openstreetmap.org/**', r => {
    const lat = +new URL(r.request().url()).searchParams.get('lat');
    return r.fulfill({ json:{ address: lat > 41.948
      ? { house_number:'902', road:'West Cornelia Avenue', postcode:'60657' }
      : { house_number:'648', road:'West Aldine Avenue',   postcode:'60657' } } });
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

  /* Drag the top of whatever sheet is up, the way a thumb would. */
  const dragDown = async (sel, px) => {
    const g = await p.$eval(sel + ' .dragzone .grip', e=>{const r=e.getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};});
    await p.mouse.move(g.x, g.y); await p.mouse.down();
    for (let i=1;i<=8;i++) await p.mouse.move(g.x, g.y + i*(px/8));
    await p.mouse.up(); await p.waitForTimeout(600);
  };

  console.log('=== the filter sheet has the same grab area as the card ===');
  await p.click('#sortbtn'); await p.waitForTimeout(500);
  console.log('  up               :', await p.$eval('#sortwrap', e=>!e.hasAttribute('hidden')));
  console.log('  has a dragzone   :', await p.evaluate(()=>!!document.querySelector('#sortpanel .dragzone .grip')));
  console.log('  touch-action     :', await p.evaluate(()=>
    getComputedStyle(document.querySelector('#sortpanel .dragzone')).touchAction));
  await p.screenshot({ path:'sw1-filter.png' });

  console.log('\n  a short pull springs back');
  await dragDown('#sortpanel', 30);
  console.log('  still up         :', await p.$eval('#sortwrap', e=>!e.hasAttribute('hidden')));
  console.log('  sitting flat     :', await p.$eval('#sortpanel', e=>e.style.transform === ''));

  console.log('\n  a real swipe dismisses it');
  await dragDown('#sortpanel', 200);
  console.log('  gone             :', await p.$eval('#sortwrap', e=>e.hasAttribute('hidden')));
  console.log('  button collapsed :', await p.$eval('#sortbtn', e=>e.getAttribute('aria-expanded')) === 'false');

  console.log('\n=== the photo sheet, the same ===');
  await p.click('#mecenter'); await p.waitForTimeout(1800);
  await p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer:jpeg });
  await p.waitForTimeout(1200);
  console.log('  up               :', await p.$eval('#photosheet', e=>!e.hasAttribute('hidden')));
  console.log('  has a dragzone   :', await p.evaluate(()=>!!document.querySelector('#photosheet .dragzone .grip')));
  await dragDown('#photosheet', 30);
  console.log('  short pull holds :', await p.$eval('#photosheet', e=>!e.hasAttribute('hidden')));
  await dragDown('#photosheet', 200);
  console.log('  swipe dismisses  :', await p.$eval('#photosheet', e=>e.hasAttribute('hidden')));

  console.log('\n=== and the card still behaves as it always did ===');
  await p.evaluate(()=>pick('SR26-B')); await p.waitForTimeout(800);
  console.log('  card up          :', await p.$eval('#pitsheet', e=>!e.hasAttribute('hidden')));
  await dragDown('#pitsheet', 200);
  console.log('  swipe dismisses  :', await p.$eval('#pitsheet', e=>e.hasAttribute('hidden')));

  console.log('\n=== two pits, one request: the planting card is no longer a dead end ===');
  // 648 W Aldine has an open request, so the removal leaves the worklist and
  // the only thing on the map there is the request itself — the screenshot
  if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){ await p.click('#sortbtn'); await p.waitForTimeout(400); }
  await p.click('.chip[data-show="plant"]'); await p.waitForTimeout(600);
  await p.click('#sortclose'); await p.waitForTimeout(400);
  await p.evaluate(()=>pick('plant:SR26-00935042')); await p.waitForTimeout(800);
  console.log('  the card         :', await p.$eval('#pitsheet h3', e=>e.textContent.trim()));
  console.log('  the app says     :', await p.$eval('#pitsheet .pbody', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  but now offers   :', await p.$eval('#pitsheet .override', e=>e.textContent.replace(/\s+/g,' ').trim()));
  await p.screenshot({ path:'sw2-override.png', fullPage:true });

  await p.click('#pitsheet [data-another]'); await p.waitForTimeout(2000);
  console.log('  on tasks         :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  tasks now        :', await p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  its own record   :', await p.evaluate(()=>Object.keys(marks).filter(k=>k.startsWith('spot:')).length),
    'new task; the request itself untouched:', await p.evaluate(()=>!marks['SR26-00935042']));
  console.log('  note explains    :', await p.$eval('.task .notebtn span', e=>e.textContent.trim()));
  const pkt = await p.$$eval('.task .fval p', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('  311 address      :', pkt.find(t=>/Chicago, IL/.test(t)));
  console.log('  311 says why     :', (pkt.find(t=>/parkway/.test(t))||'').match(/Noted on site.*/)||'(none)');
  console.log('  card put away    :', await p.evaluate(()=>document.querySelector('#pitsheet').hidden));

  console.log('\n=== and from a photo that lands on an answered pit ===');
  await p.click('#home'); await p.waitForTimeout(500);
  await p.evaluate(()=>{ marks['SR26-B'] = { state:'req', at:new Date().toISOString(), sr:'SR26-77777777' };
    me = { lat:41.951, lng:-87.658 }; meAcc = 10; meState = 'on'; });
  await p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer:jpeg });
  await p.waitForTimeout(1200);
  console.log('  matched          :', await p.$eval('#photosheet h3', e=>e.textContent.trim()));
  console.log('  the app says     :', await p.$eval('#photosheet .verdict', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  but offers       :', await p.evaluate(()=>!!document.querySelector('#photosheet .override')));
  await p.click('#photosheet [data-another]'); await p.waitForTimeout(2000);
  console.log('  tasks now        :', await p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  photo came along :', await p.evaluate(()=>{
    const l = document.querySelector('.task .shotline'); return l ? !l.hidden : false; }));

  console.log('\n=== the map card offers it too, once a pit is answered ===');
  await p.click('#home'); await p.waitForTimeout(600);
  await p.evaluate(()=>pick('SR26-B')); await p.waitForTimeout(800);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  console.log('  answered card    :', await p.$eval('#pitsheet .pkind', e=>e.textContent.trim()));
  console.log('  offers it        :', await p.evaluate(()=>!!document.querySelector('#pitsheet .override')));

  console.log('\n=== but an unchecked pit does not: "No tree" already does that job ===');
  await p.evaluate(()=>{ delete marks['SR26-B']; repaint(); }); await p.waitForTimeout(500);
  await p.evaluate(()=>pick('SR26-B')); await p.waitForTimeout(800);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  console.log('  unchecked card   :', await p.$$eval('#pitsheet .act', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  no override      :', await p.evaluate(()=>!document.querySelector('#pitsheet .override')));

  console.log('\npage errors      :', errs.length ? errs : 'none');
  await b.close();
})();

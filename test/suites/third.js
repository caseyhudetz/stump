/* A third answer offered in place, a card that stays put, fields that don't
   zoom iOS, and a task for a stump the city never recorded. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DAY = 86400000, now = Date.now();
const iso = d => new Date(d).toISOString().replace('Z','');

const removals = [
  // requests open all around it
  { sr_number:'SR26-A', street_number:'3139', street_direction:'N', street_name:'Sheffield',
    street_type:'Ave', zip_code:'60657', latitude:'41.940000', longitude:'-87.653000',
    closed_date:'2026-05-11T00:00:00.000' },
  // nothing near it
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date:'2026-04-11T00:00:00.000' }
];
const plantings = [
  ...Array.from({length:12}, (_,i) => ({
    sr_number:'P-C'+i, street_number:String(100+i), street_direction:'W', street_name:'Melrose',
    street_type:'St', latitude:'41.930000', longitude:'-87.640000',
    created_date: iso(now - (400+i*10)*DAY), closed_date: iso(now - (400+i*10-200)*DAY),
    status:'Completed' })),
  { sr_number:'SR26-00971147', street_number:'959', street_direction:'W', street_name:'Fletcher',
    street_type:'St', latitude:'41.940280', longitude:'-87.653000',
    created_date: iso(now - 95*DAY), status:'Open' }
];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9355, longitude:-87.6480}, permissions:['geolocation'] });
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
  await p.route('**/nominatim.openstreetmap.org/**', r => r.fulfill({ status:503, body:'no' }));
  await p.route('**/tiles.openfreemap.org/**', r => r.fulfill({ json:{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#f2f1ea'}}]} }));
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

  console.log('=== the third answer is offered, not hidden behind a step ===');
  await p.evaluate(()=>pick('SR26-A')); await p.waitForTimeout(800);
  console.log('  buttons          :', await p.$$eval('#pitsheet .act', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  third one says   :', await p.$eval('#pitsheet .act.knows', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  no interstitial  :', await p.evaluate(()=>!document.querySelector('.chooser')));
  await p.screenshot({ path:'th1-three.png' });
  await p.click('#pitsheet .act.knows'); await p.waitForTimeout(900);
  console.log('  marks in queue   :', await p.evaluate(()=>stateOf(byId('SR26-A'))));
  console.log('  one tap, no task :', await p.evaluate(()=>tasks().length === 0));
  console.log('  synced           :', JSON.stringify(store['SR26-A'] && store['SR26-A'].state));

  console.log('\n=== a site with nothing nearby keeps two answers ===');
  await p.evaluate(()=>unpick()); await p.waitForTimeout(400);
  await p.evaluate(()=>pick('SR26-B')); await p.waitForTimeout(700);
  console.log('  buttons          :', await p.$$eval('#pitsheet .act', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));

  console.log('\n=== the map holds the pin instead of throwing it off ===');
  const where = await p.evaluate(()=>{
    const m = pins['SR26-B'].getLatLng();
    const pt = map.latLngToContainerPoint(m);
    const box = document.querySelector('#map').getBoundingClientRect();
    const card = document.querySelector('#pitsheet').getBoundingClientRect();
    return { pinY: Math.round(pt.y + box.top), mapTop: Math.round(box.top),
             cardTop: Math.round(card.top), h: Math.round(box.height) };
  });
  console.log('  pin / card       :', JSON.stringify(where));
  console.log('  pin on screen    :', where.pinY > where.mapTop && where.pinY < where.cardTop,
    '(above the card, below the top)');
  await p.screenshot({ path:'th2-centred.png' });

  console.log('\n=== fields are 16px, so iOS leaves the zoom alone ===');
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(400);
  await p.click('#pitsheet .notebtn'); await p.waitForTimeout(500);
  console.log('  note input       :', await p.$eval('#pitsheet .noteinput', e=>getComputedStyle(e).fontSize));
  await p.click('#pitsheet [data-notecancel]'); await p.waitForTimeout(400);
  await p.evaluate(()=>unpick()); await p.waitForTimeout(300);
  await p.click('#sortbtn'); await p.waitForTimeout(400);
  console.log('  search input     :', await p.$eval('#q', e=>getComputedStyle(e).fontSize));
  await p.click('#sortclose'); await p.waitForTimeout(400);

  console.log('\n=== the photo sheet wears the card\'s clothes ===');
  // the photo carries no location, so the app needs a fix of its own
  await p.click('#mecenter'); await p.waitForTimeout(1800);
  const noGPS = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwAqn//Z','base64');
  await p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer: noGPS });
  await p.waitForTimeout(1200);
  console.log('  has a grip       :', await p.evaluate(()=>!!document.querySelector('#photosheet .grip')));
  console.log('  rounded like card:', await p.evaluate(()=>
    getComputedStyle(document.querySelector('#photosheet .sheet')).borderTopLeftRadius));
  console.log('  heading          :', await p.$eval('#photosheet h3', e=>e.textContent.trim()));
  console.log('  explains         :', (await p.$eval('#photosheet .sdist', e=>e.textContent)).replace(/\s+/g,' ').trim());
  console.log('  offers a task    :', await p.$eval('#spotstart', e=>e.textContent.trim()));
  await p.screenshot({ path:'th3-photo.png' });

  console.log('\n=== and makes one for a stump the city never recorded ===');
  await p.click('#spotstart'); await p.waitForTimeout(1400);
  console.log('  asks the address :', await p.$eval('.spotform .flabel', e=>e.textContent.trim()),
    '(only because the lookup could not answer — see spot.js)');
  console.log('  field is 16px    :', await p.$eval('#spotaddr', e=>getComputedStyle(e).fontSize));
  await p.fill('#spotaddr', '2841 N Sheffield Ave');
  await p.click('#spotform button[type="submit"]'); await p.waitForTimeout(1200);
  console.log('  on tasks         :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  task made for    :', await p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  console.log('  says no removal  :', await p.$$eval('.task .tm', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()))
    .then(a=>a.filter(t=>/no removal/i.test(t))));
  const pkt = await p.$$eval('.task .fval p', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('  311 address      :', pkt.find(t=>/Chicago, IL/.test(t)));
  console.log('  311 wording      :', (pkt.find(t=>/parkway/.test(t))||'').slice(0,150));
  console.log('  cites no removal :', !/Prior removal/.test(pkt.join(' ')));
  console.log('  synced           :', JSON.stringify(Object.entries(store).find(([k])=>k.startsWith('spot:'))));
  await p.screenshot({ path:'th4-spot-task.png', fullPage:true });

  console.log('\n=== and it survives a reload ===');
  await p.reload(); await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(2200);
  await p.click('#tasksbtn'); await p.waitForTimeout(700);
  console.log('  still there      :', await p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

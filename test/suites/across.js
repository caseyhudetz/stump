/* The false negative: a photo taken across the street from a past filing
   must not be read as that filing. Plus the open-plantings filter. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/* 700 W Buckingham on the north side; 701 W Buckingham directly across the
   street, ~65 ft south. Then two more well down the block. */
const removals = [
  { sr_number:'SR26-A', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  { sr_number:'SR26-B', street_number:'701', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.943820', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  { sr_number:'SR26-C', street_number:'760', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.652400',
    closed_date:'2026-04-02T00:00:00.000' },
  { sr_number:'SR26-D', street_number:'800', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.947500', longitude:'-87.653000',
    closed_date:'2026-03-02T00:00:00.000' }
];
const plantings = [
  { sr_number:'SR26-P1', street_number:'900', street_direction:'W', street_name:'Oakdale',
    street_type:'Ave', latitude:'41.936000', longitude:'-87.651000',
    created_date:'2026-06-01T00:00:00.000', status:'Open' },
  { sr_number:'SR26-P2', street_number:'910', street_direction:'W', street_name:'Oakdale',
    street_type:'Ave', latitude:'41.936200', longitude:'-87.651500',
    created_date:'2026-07-14T00:00:00.000', status:'Open - Dup' },
  { sr_number:'SR26-P3', street_number:'920', street_direction:'W', street_name:'Oakdale',
    street_type:'Ave', latitude:'41.936400', longitude:'-87.652000',
    created_date:'2026-02-02T00:00:00.000', status:'Completed' }   // planted: excluded
];

function jpegWithGPS(lat, lng){
  const deg = Math.floor(Math.abs(lat)), latMin = (Math.abs(lat)-deg)*60;
  const dg  = Math.floor(Math.abs(lng)), lngMin = (Math.abs(lng)-dg)*60;
  const rat = (n,d) => { const b = Buffer.alloc(8); b.writeUInt32BE(n,0); b.writeUInt32BE(d,4); return b; };
  const header = Buffer.alloc(8);
  header.write('MM',0,'ascii'); header.writeUInt16BE(42,2); header.writeUInt32BE(8,4);
  const ifd0 = Buffer.alloc(2+12+4);
  ifd0.writeUInt16BE(1,0); ifd0.writeUInt16BE(0x8825,2); ifd0.writeUInt16BE(4,4);
  ifd0.writeUInt32BE(1,6); ifd0.writeUInt32BE(8+ifd0.length,10); ifd0.writeUInt32BE(0,14);
  const gpsStart = 8+ifd0.length, nE = 4;
  const gpsHead = Buffer.alloc(2+nE*12+4);
  const valuesAt = gpsStart + gpsHead.length;
  gpsHead.writeUInt16BE(nE,0);
  const entry = (i,tag,type,count,v,inline) => { const o=2+i*12;
    gpsHead.writeUInt16BE(tag,o); gpsHead.writeUInt16BE(type,o+2); gpsHead.writeUInt32BE(count,o+4);
    if (inline) gpsHead.write(v,o+8,'ascii'); else gpsHead.writeUInt32BE(v,o+8); };
  entry(0,1,2,2, lat>=0?'N\0':'S\0', true); entry(1,2,5,3, valuesAt, false);
  entry(2,3,2,2, lng>=0?'E\0':'W\0', true); entry(3,4,5,3, valuesAt+24, false);
  gpsHead.writeUInt32BE(0, 2+nE*12);
  const vals = Buffer.concat([
    rat(deg,1), rat(Math.floor(latMin),1), rat(Math.round((latMin%1)*60*10000),10000),
    rat(dg,1),  rat(Math.floor(lngMin),1), rat(Math.round((lngMin%1)*60*10000),10000)]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0','binary'),
    Buffer.concat([header, ifd0, gpsHead, vals])]);
  const seg = Buffer.alloc(4); seg.writeUInt16BE(0xFFE1,0); seg.writeUInt16BE(app1.length+2,2);
  const body = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwAqn//Z','base64');
  return Buffer.concat([Buffer.from([0xFF,0xD8]), seg, app1, body.slice(2)]);
}

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9440, longitude:-87.6500}, permissions:['geolocation'] });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Planting Request/.test(u)) return r.fulfill({ json: plantings });
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js',  contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p.route('**/*.png', r => r.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'), contentType:'image/png' }));
  const store = {};
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
  await p.waitForTimeout(1500);

  const pick = async v => {
    // the filter lives with the list now, so get back to it first
    if (await p.$eval('#browse', e=>e.hasAttribute('hidden'))){
      await p.click('.mark button'); await p.waitForTimeout(400);
    }
    if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){ await p.click('#sortbtn'); await p.waitForTimeout(250); }
    await p.click(`.chip[data-${v.k}="${v.v}"]`); await p.waitForTimeout(500);
    await p.click('#sortclose'); await p.waitForTimeout(400);
  };

  console.log('=== mark 700 W as filed, the way it happened ===');
  await pick({k:'view',v:'list'});
  await p.click('.row'); await p.waitForTimeout(800);
  console.log('  opened        :', await p.$eval('.daddr', e=>e.textContent.trim()));
  await p.click('#dock .act.no'); await p.waitForTimeout(900);
  await p.click('[data-file]'); await p.waitForTimeout(500);
  await p.click('[data-skipsr]'); await p.waitForTimeout(900);
  console.log('  state of 700W :', await p.evaluate(()=>stateOf(byId('SR26-A'))));

  console.log('\n=== the photo from across the street ===');
  // a real fix lands between the two: ~22 ft from the filed pit at 700 W,
  // ~45 ft from the fresh stump at 701 W. Neither is distinguishable.
  const shotAcross = jpegWithGPS(41.943940, -87.650000);
  await p.setInputFiles('#shotfile', { name:'across.jpg', mimeType:'image/jpeg', buffer: shotAcross });
  await p.waitForTimeout(900);
  const head = await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim());
  console.log('  heading       :', head);
  console.log('  asserts filed :', await p.evaluate(()=>!!document.querySelector('#photosheet .verdict.req')),
              head === 'Which pit is this?' ? '(asks instead — GOOD)' : '(ASSERTED — BAD)');
  console.log('  explains why  :', (await p.$eval('#photosheet .sdist', e=>e.textContent)).replace(/\s+/g,' ').trim());
  console.log('  accuracy shown:', (await p.$eval('.acc', e=>e.textContent)).trim());
  console.log('  choices       :', await p.$$eval('#photosheet .others .row', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  await p.screenshot({ path:'ac1-ask.png' });

  console.log('\n=== picking the right one answers for that pit ===');
  await p.click('[data-pick="SR26-B"]'); await p.waitForTimeout(600);
  console.log('  now showing   :', await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim()));
  console.log('  verdict       :', (await p.$eval('#photosheet .verdict', e=>e.textContent)).replace(/\s+/g,' ').trim());
  console.log('  offers a task :', await p.$$eval('#photosheet .sheet .btnrow button', e=>e.map(x=>x.textContent.trim())));
  console.log('  can go back   :', await p.$$eval('#photosheet .others .row .raddr', e=>e.map(x=>x.textContent.trim())));
  await p.screenshot({ path:'ac2-picked.png' });
  await p.click('#shotclose'); await p.waitForTimeout(300);

  console.log('\n=== an isolated pit is still answered outright ===');
  const shotAlone = jpegWithGPS(41.947500, -87.653000);   // 800 W Cornelia, far from any other
  await p.setInputFiles('#shotfile', { name:'alone.jpg', mimeType:'image/jpeg', buffer: shotAlone });
  await p.waitForTimeout(900);
  console.log('  heading       :', await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim()));
  console.log('  verdict       :', (await p.$eval('#photosheet .verdict', e=>e.textContent)).replace(/\s+/g,' ').trim());
  await p.click('#shotclose'); await p.waitForTimeout(300);

  console.log('\n=== open planting requests, as an option ===');
  await pick({k:'view',v:'map'});
  await pick({k:'show',v:'plant'});
  console.log('  count         :', await p.evaluate(()=>filteredPlants().length) + ' open requests');
  console.log('  map pins      :', await p.evaluate(()=>document.querySelectorAll('#map .pin.plant').length));
  console.log('  completed one excluded:', await p.evaluate(()=>!PLANTS.some(x=>x.id==='SR26-P3')));
  console.log('  legend swaps  :', await p.evaluate(()=>{
    const l = document.querySelector('#legend');
    return { plantsKeyShown: getComputedStyle(l.querySelector('.lplant')).display !== 'none',
             siteKeyHidden: getComputedStyle(l.querySelector('.lsite')).display === 'none' }; }));
  await p.screenshot({ path:'ac3-plants-map.png' });
  await pick({k:'view',v:'list'});
  console.log('  list rows     :', await p.$$eval('#list .row', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  not clickable :', await p.$$eval('#list .row', e=>e.every(x=>x.tagName==='DIV')));
  await p.screenshot({ path:'ac4-plants-list.png' });

  console.log('\n=== back to sites, pins still there and popups still open ===');
  await pick({k:'show',v:'all'});
  await pick({k:'view',v:'map'});
  console.log('  site pins     :', await p.evaluate(()=>document.querySelectorAll('#map .pin').length));
  console.log('  plant pins gone:', await p.evaluate(()=>document.querySelectorAll('#map .pin.plant').length === 0));
  // zoom to an isolated pit first: at neighbourhood zoom two pins 22 ft
  // apart sit on top of each other, and the upper one takes the tap
  await p.evaluate(()=>map.setView([41.9475,-87.653], 18)); await p.waitForTimeout(700);
  const mb = await p.$eval('#map', e=>{const r=e.getBoundingClientRect();
    return {t:r.top,b:r.bottom,l:r.left,r:r.right};});
  let pin = null;
  for (const h of await p.$$('#map .leaflet-marker-icon')){
    const bb = await h.boundingBox();
    if (bb && bb.y > mb.t && bb.y + bb.height < mb.b && bb.x > mb.l && bb.x + bb.width < mb.r){ pin = bb; break; }
  }
  console.log('  a pin on screen:', !!pin);
  await p.mouse.click(pin.x + pin.width/2, pin.y + pin.height/2); await p.waitForTimeout(500);
  console.log('  sheet opens   :', await p.evaluate(()=>{
    const el = document.querySelector('#pitsheet'); return !!el && !el.hidden; }));
  await p.evaluate(()=>window.repaint()); await p.waitForTimeout(500);
  console.log('  survives repaint:', await p.evaluate(()=>{
    const el = document.querySelector('#pitsheet'); return !!el && !el.hidden; }));
  await p.screenshot({ path:'ac5-map.png' });

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

/* Photograph a stump; the location should say which pit it is and whether a
   request already exists. Uses a real JPEG carrying real Exif GPS bytes. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = Array.from({length:6}, (_,i)=>({
  sr_number:'SR26-0000'+i, street_number:String(700+i*10), street_direction:'W',
  street_name:'Buckingham', street_type:'Ave', zip_code:'60657',
  latitude:String(41.9440+i*0.0009), longitude:String(-87.6500+i*0.0009),
  closed_date:'2026-05-11T00:00:00.000'
}));

/* A JPEG with an APP1 Exif block whose IFD0 points at a GPS sub-IFD.
   Big-endian ('MM'), so the parser's byte-order handling is exercised too. */
function jpegWithGPS(lat, lng){
  const deg = Math.floor(Math.abs(lat)), latMin = (Math.abs(lat)-deg)*60;
  const dg  = Math.floor(Math.abs(lng)), lngMin = (Math.abs(lng)-dg)*60;
  const rat = (n, d) => { const b = Buffer.alloc(8); b.writeUInt32BE(n,0); b.writeUInt32BE(d,4); return b; };
  // GPS values live after the IFDs; offsets are from the start of the TIFF header
  const tiff = [];
  const push = b => { tiff.push(b); return b.length; };

  const header = Buffer.alloc(8);
  header.write('MM', 0, 'ascii'); header.writeUInt16BE(42, 2); header.writeUInt32BE(8, 4);
  // IFD0: one entry (GPSInfo 0x8825) -> sub-IFD
  const ifd0 = Buffer.alloc(2 + 12 + 4);
  ifd0.writeUInt16BE(1, 0);
  ifd0.writeUInt16BE(0x8825, 2); ifd0.writeUInt16BE(4, 4);        // LONG
  ifd0.writeUInt32BE(1, 6); ifd0.writeUInt32BE(8 + ifd0.length, 10);
  ifd0.writeUInt32BE(0, 2 + 12);                                   // no next IFD

  const gpsStart = 8 + ifd0.length;
  const nEntries = 4;
  const gpsHead = Buffer.alloc(2 + nEntries*12 + 4);
  const valuesAt = gpsStart + gpsHead.length;
  gpsHead.writeUInt16BE(nEntries, 0);
  const entry = (i, tag, type, count, valueOrOffset, inline) => {
    const o = 2 + i*12;
    gpsHead.writeUInt16BE(tag, o); gpsHead.writeUInt16BE(type, o+2);
    gpsHead.writeUInt32BE(count, o+4);
    if (inline) gpsHead.write(valueOrOffset, o+8, 'ascii');        // left-justified
    else gpsHead.writeUInt32BE(valueOrOffset, o+8);
  };
  entry(0, 1, 2, 2, lat >= 0 ? 'N\0' : 'S\0', true);               // GPSLatitudeRef
  entry(1, 2, 5, 3, valuesAt, false);                              // GPSLatitude
  entry(2, 3, 2, 2, lng >= 0 ? 'E\0' : 'W\0', true);               // GPSLongitudeRef
  entry(3, 4, 5, 3, valuesAt + 24, false);                         // GPSLongitude
  gpsHead.writeUInt32BE(0, 2 + nEntries*12);

  const vals = Buffer.concat([
    rat(deg,1), rat(Math.floor(latMin),1), rat(Math.round((latMin%1)*60*10000),10000),
    rat(dg,1),  rat(Math.floor(lngMin),1), rat(Math.round((lngMin%1)*60*10000),10000)
  ]);

  const tiffBuf = Buffer.concat([header, ifd0, gpsHead, vals]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0','binary'), tiffBuf]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xFFE1, 0); seg.writeUInt16BE(app1.length + 2, 2);
  // a 1x1 grey JPEG body, so the file is a real decodable image
  const body = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'+
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'+
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
  return Buffer.concat([Buffer.from([0xFF,0xD8]), seg, app1, body.slice(2)]);
}

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true,
    geolocation:{latitude:41.94425, longitude:-87.65015}, permissions:['geolocation'] });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Planting Request/.test(u)) return r.fulfill({ json: [] });
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js',  contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  await p.route('**/*.png', r => r.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64'), contentType:'image/png' }));
  await p.route('**/api/marks', r => r.fulfill({ json:{ marks:{} } }));
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1400);

  // 730 W Buckingham sits at 41.9467, -87.6473 in the fixture
  const target = removals[3];
  const withGPS = jpegWithGPS(+target.latitude + 0.00004, +target.longitude - 0.00004);
  const noGPS = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwAqn//Z','base64');

  console.log('=== the parser reads GPS out of a real Exif block ===');
  console.log('  parsed        :', await p.evaluate(async bytes => {
    const g = exifGPS(new Uint8Array(bytes).buffer);
    return g ? { lat:+g.lat.toFixed(5), lng:+g.lng.toFixed(5) } : null;
  }, [...withGPS]), '(want 41.94674, -87.64734)');
  console.log('  no-GPS jpeg   :', await p.evaluate(async bytes =>
    exifGPS(new Uint8Array(bytes).buffer), [...noGPS]));
  console.log('  junk bytes    :', await p.evaluate(() =>
    exifGPS(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]).buffer)));

  console.log('\n=== a photo with its own location finds the pit ===');
  await p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer: withGPS });
  await p.waitForTimeout(900);
  console.log('  sheet open    :', await p.$eval('#photosheet', e=>!e.hasAttribute('hidden')));
  console.log('  located from  :', (await p.$eval('#photosheet .sfrom', e=>e.textContent)).trim());
  console.log('  matched       :', await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim()),
              '(want', target.street_number, 'W Buckingham Ave )');
  console.log('  distance      :', (await p.$eval('#photosheet .sdist', e=>e.textContent)).replace(/\s+/g,' ').trim());
  console.log('  verdict       :', (await p.$eval('#photosheet .verdict', e=>e.textContent)).replace(/\s+/g,' ').trim());
  console.log('  actions       :', await p.$$eval('#photosheet .sheet .btnrow button', e=>e.map(x=>x.textContent.trim())));
  console.log('  others listed :', await p.$$eval('#photosheet .others .raddr', e=>e.map(x=>x.textContent.trim())));
  await p.screenshot({ path:'ph1-sheet.png' });

  console.log('\n=== "no tree" from the photo makes the task ===');
  await p.click('#photosheet .sheet .btnrow button.fill'); await p.waitForTimeout(1000);
  console.log('  sheet closed  :', await p.$eval('#photosheet', e=>e.hasAttribute('hidden')));
  console.log('  on tasks      :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  task made for :', await p.$$eval('.task h3', e=>e.map(x=>x.textContent.trim())));
  await p.screenshot({ path:'ph2-task.png' });

  console.log('\n=== the same photo again now reports the task ===');
  await p.setInputFiles('#shotfile', { name:'stump.jpg', mimeType:'image/jpeg', buffer: withGPS });
  await p.waitForTimeout(800);
  console.log('  verdict       :', (await p.$eval('#photosheet .verdict', e=>e.textContent)).replace(/\s+/g,' ').trim());
  console.log('  actions       :', await p.$$eval('#photosheet .sheet .btnrow button', e=>e.map(x=>x.textContent.trim())));
  await p.click('#shotclose'); await p.waitForTimeout(400);
  console.log('  closed        :', await p.$eval('#photosheet', e=>e.hasAttribute('hidden')));

  console.log('\n=== a photo with no location falls back to where you are ===');
  await p.click('.mark button'); await p.waitForTimeout(500);
  await p.click('#mecenter'); await p.waitForTimeout(1800);   // grant + locate
  await p.setInputFiles('#shotfile', { name:'plain.jpg', mimeType:'image/jpeg', buffer: noGPS });
  await p.waitForTimeout(900);
  console.log('  located from  :', (await p.$eval('#photosheet .sfrom', e=>e.textContent)).trim());
  const h = await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim());
  console.log('  heading       :', h, '(standing ~100 ft from 700 W Buckingham)');
  if (h === 'Which pit is this?'){
    // a live fix carries its own accuracy; when two pits fall inside it the
    // sheet asks rather than picking, and choosing resolves it
    console.log('  offers        :', await p.$$eval('#photosheet .others .raddr', e=>e.map(x=>x.textContent.trim())));
    await p.click('#photosheet .others .row'); await p.waitForTimeout(500);
    console.log('  after picking :', await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim()));
  }
  console.log('  verdict       :', (await p.$eval('#photosheet .verdict', e=>e.textContent)).replace(/\s+/g,' ').trim());
  await p.screenshot({ path:'ph3-fallback.png' });
  await p.click('#shotclose'); await p.waitForTimeout(300);

  console.log('\n=== a photo from somewhere else says so ===');
  const farAway = jpegWithGPS(41.8781, -87.6298);   // the Loop
  await p.setInputFiles('#shotfile', { name:'loop.jpg', mimeType:'image/jpeg', buffer: farAway });
  await p.waitForTimeout(800);
  console.log('  heading       :', await p.$eval('#photosheet .sheet h3', e=>e.textContent.trim()));
  console.log('  explains      :', (await p.$eval('#photosheet .sheet .sdist', e=>e.textContent)).replace(/\s+/g,' ').trim().slice(0,110));
  console.log('  still offers  :', await p.$$eval('#photosheet .others .raddr', e=>e.map(x=>x.textContent.trim())).catch(()=>[]));
  await p.screenshot({ path:'ph4-faraway.png' });

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

/* Tap a pin: a sheet from the bottom, the duplicates drawn around it, and
   a basemap you can change (with a fallback when tiles don't answer). */
const { chromium } = require('playwright');
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
    created_date:'2026-08-01T00:00:00.000', status:'Open' },
  { sr_number:'SR26-P2', street_number:'706', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', latitude:'41.944200', longitude:'-87.650300',
    created_date:'2026-07-02T00:00:00.000', status:'Open' }
];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9441, longitude:-87.6501}, permissions:['geolocation'] });
  const p = await ctx.newPage();
  await p.route('**/data.cityofchicago.org/**', r => {
    const u = decodeURIComponent(r.request().url()).replace(/\+/g,' ');
    if (/Tree Planting Request/.test(u)) return r.fulfill({ json: plantings });
    if (/Tree Removal Inspection/.test(u)) return r.fulfill({ json: removals });
    return r.fulfill({ json: [] });
  });
  await p.route('**/leaflet.min.js',  r => r.fulfill({ path:'real-leaflet.js',  contentType:'application/javascript' }));
  await p.route('**/leaflet.min.css', r => r.fulfill({ path:'real-leaflet.css', contentType:'text/css' }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');
  const hosts = [];
  let esriFails = false;
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (/arcgisonline|tile\.openstreetmap|openfreemap/.test(u)){
      hosts.push(new URL(u).hostname);
      if (esriFails && /arcgisonline/.test(u)) return r.abort();
      return r.fulfill({ body: PNG, contentType:'image/png' });
    }
    if (/\/api\/marks/.test(u)) return r.fulfill({ json:{ marks:{} } });
    return r.fallback();
  });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1800);

  const tapPin = async n => {
    const mb = await p.$eval('#map', e=>{const r=e.getBoundingClientRect();return {t:r.top,b:r.bottom,l:r.left,r:r.right};});
    const on = [];
    for (const h of await p.$$('#map .leaflet-marker-icon')){
      const bb = await h.boundingBox();
      if (bb && bb.y>mb.t && bb.y+bb.height<mb.b && bb.x>mb.l && bb.x+bb.width<mb.r) on.push(bb);
    }
    const bb = on[n];
    await p.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2);
  };

  // the basemap is one vector style now, covered by vec.js
  console.log('\n=== tap a pin: the sheet, not a popup ===');
  await p.reload(); await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1800);
  await tapPin(0); await p.waitForTimeout(800);
  console.log('  no leaflet popup :', await p.evaluate(()=>!document.querySelector('.leaflet-popup')));
  const sh = await p.$eval('#pitsheet', e=>{const r=e.getBoundingClientRect();
    return { up:!e.hasAttribute('hidden'), top:Math.round(r.top), bottom:Math.round(r.bottom) };});
  console.log('  sheet up         :', JSON.stringify(sh), '(viewport 844)');
  console.log('  address          :', await p.$eval('#pitsheet h3', e=>e.textContent.trim()));
  console.log('  meta             :', await p.$eval('#pitsheet .pmeta', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  decision buttons :', await p.$$eval('#pitsheet .act', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  way in           :', await p.evaluate(()=>!!document.querySelector('#pitsheet .grip')),
    '(the grip — the full page button was retired)');
  console.log('  pin marked chosen:', await p.evaluate(()=>!!document.querySelector('#map .pin.sel')));
  await p.screenshot({ path:'sh2-sheet.png' });

  console.log('\n=== the duplicates, drawn ===');
  console.log('  warned in sheet  :', (await p.$eval('#pitsheet .act.knows', e=>e.textContent.replace(/\s+/g,' ').trim())));
  console.log('  request pins     :', await p.evaluate(()=>document.querySelectorAll('#map .pin.plant.near').length));
  console.log('  lines to them    :', await p.evaluate(()=>
    [...document.querySelectorAll('#map path')].filter(x=>(x.getAttribute('stroke')||'').toLowerCase()==='#c87a16').length));
  await p.click('#pitsheet .dupwarn'); await p.waitForTimeout(900);
  console.log('  frames them all  :', await p.evaluate(()=>{
    const b = map.getBounds();
    return b.contains([41.944000,-87.650000]) && b.contains([41.944200,-87.650300]); }));
  await p.screenshot({ path:'sh3-dups.png' });

  console.log('\n=== deciding from the sheet keeps you on the map ===');
  await p.click('#pitsheet .act.no'); await p.waitForTimeout(700);
  if (await p.$('#pitsheet .chooser')) { await p.click('#pitsheet .chooser .mini.ghost'); await p.waitForTimeout(900); }
  console.log('  still on the map :', await p.$eval('#browse', e=>!e.hasAttribute('hidden')));
  console.log('  sheet updated    :', await p.$eval('#pitsheet .pkind', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  went to tasks    :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  console.log('  said so          :', await p.$eval('#toast', e=>e.textContent.trim()));
  console.log('  task counted     :', await p.evaluate(()=>!document.querySelector('#taskdot').hidden));
  console.log('  pin now checked  :', await p.evaluate(()=>{
    const el = pins['SR26-A'] && pins['SR26-A'].getElement();
    const dot = el && el.querySelector('.pin');
    return dot ? dot.className : '(gone)'; }));
  await p.screenshot({ path:'sh4-decided.png' });

  console.log('\n=== expanding the card reveals the rest ===');
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(600);
  console.log('  card full        :', await p.$eval('#pitsheet', e=>e.classList.contains('full')));
  console.log('  reveals          :', await p.$$eval('#pitsheet .restpart .qact', e=>e.map(x=>x.textContent.trim())));
  console.log('  the whole record :', await p.$$eval('#pitsheet .fact dt', e=>e.map(x=>x.textContent.trim())));
  console.log('  stays on the map :', await p.$eval('#browse', e=>!e.hasAttribute('hidden')));

  console.log('\n=== a planting pin explains itself ===');
  await p.evaluate(()=>unpick()); await p.waitForTimeout(600);
  if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){ await p.click('#sortbtn'); await p.waitForTimeout(300); }
  await p.click('.chip[data-show="plant"]'); await p.waitForTimeout(600);
  await p.click('#sortclose'); await p.waitForTimeout(400);
  // the planting fixtures are on Oakdale; frame them, then tap one
  await p.evaluate(()=>{ if (typeof unpick === 'function') unpick();
    map.setView([41.9362,-87.6515], 16); }); await p.waitForTimeout(900);
  console.log('  plant pins on map:', await p.evaluate(()=>document.querySelectorAll('#map .pin.plant').length));
  // tapping a pin is covered in card.js; here it is the card's content that matters
  await p.evaluate(()=>pick('plant:SR26-P1')); await p.waitForTimeout(800);
  console.log('  kind             :', await p.$eval('#pitsheet .pkind', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  says             :', await p.$eval('#pitsheet .pbody', e=>e.textContent.replace(/\s+/g,' ').trim()).catch(()=>'(none)'));
  console.log('  no decision      :', await p.evaluate(()=>!document.querySelector('#pitsheet .act')));

  console.log('\n=== tapping the map closes it ===');
  // find bare map, not a pin — the card now centres its pin near the middle
  const spot = await p.evaluate(()=>{
    for (let y = 140; y < 420; y += 20) for (let x = 40; x < 350; x += 30){
      const el = document.elementFromPoint(x,y);
      if (el && el.closest('#map') && !el.closest('.leaflet-marker-icon')
          && !el.closest('.leaflet-control-container')) return {x,y};
    }
    return null; });
  console.log('  bare map at      :', JSON.stringify(spot));
  await p.mouse.click(spot.x, spot.y); await p.waitForTimeout(700);
  console.log('  closed           :', await p.$eval('#pitsheet', e=>e.hasAttribute('hidden')));

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

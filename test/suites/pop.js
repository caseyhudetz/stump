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
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:'+PORT+'/');
  await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(1500);

  // the popup became a bottom sheet; the invariant is the same — a
  // re-render must not close what you just tapped open
  const popup = () => p.evaluate(() => {
    const el = document.querySelector('#pitsheet');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    const h = el.querySelector('h3');
    return { text: h ? h.textContent.trim().slice(0,40) : '',
             top:Math.round(r.top), bottom:Math.round(r.bottom),
             onScreen: r.top >= 0 && r.top < window.innerHeight };
  });
  // pins are styled elements now, not SVG circles
  const tapPin = async (n=0) => {
    // put any open card away and pull back out: opening one zooms the map
    // in to street level, which leaves most pins off the screen
    await p.evaluate(()=>{ if (typeof unpick === 'function') unpick();
      if (typeof map !== 'undefined' && map) map.fitBounds(EAST_LAKEVIEW, {padding:[12,12]}); });
    await p.waitForTimeout(420);
    const mb = await p.$eval('#map', e=>{const r=e.getBoundingClientRect();
      return {t:r.top,b:r.bottom,l:r.left,r:r.right};});
    // the card covers the lower map while it is up, as it does for a thumb
    const cardTop = await p.evaluate(()=>{
      const c = document.querySelector('#pitsheet');
      return (!c || c.hidden) ? 99999 : c.getBoundingClientRect().top; });
    const lim = Math.min(mb.b, cardTop - 6);
    const onScreen = [];
    for (const h of await p.$$('#map .leaflet-marker-icon')){
      const bb = await h.boundingBox();
      if (bb && bb.y > mb.t && bb.y+bb.height < lim && bb.x > mb.l && bb.x+bb.width < mb.r) onScreen.push(bb);
    }
    const bb = onScreen[n % onScreen.length];
    await p.mouse.click(bb.x + bb.width/2, bb.y + bb.height/2);
  };

  console.log('pins on map    :', (await p.$$('#map .leaflet-marker-icon')).length);

  console.log('\n=== A. stationary tap ===');
  await tapPin(0);
  await p.waitForTimeout(150);
  console.log('  t+150ms      :', JSON.stringify(await popup()));
  await p.waitForTimeout(1200);
  console.log('  t+1.4s       :', JSON.stringify(await popup()));
  await p.screenshot({ path:'pop-a.png' });

  console.log('\n=== B. tap while location is on and moving (biking) ===');
  await p.click('#mecenter').catch(()=>{});
  await p.waitForTimeout(1500);
  console.log('  located      :', await p.evaluate(()=>!!document.querySelector('#map .pin.me')),
    '(the you-dot; the readout line was retired)');
  await tapPin(3);
  await p.waitForTimeout(200);
  console.log('  popup after tap:', JSON.stringify(await popup()));
  // simulate movement — watchPosition fires
  await ctx.setGeolocation({latitude:41.9450, longitude:-87.6506});
  await p.waitForTimeout(900);
  console.log('  after GPS tick :', JSON.stringify(await popup()));
  await ctx.setGeolocation({latitude:41.9454, longitude:-87.6510});
  await p.waitForTimeout(900);
  console.log('  after 2nd tick :', JSON.stringify(await popup()));
  await p.screenshot({ path:'pop-b.png' });

  console.log('\n=== C. tap a pin near the top of a scrolled map ===');
  await p.evaluate(()=>{ const sc=document.querySelector('.browsefit'); if(sc) sc.scrollTop = 40; });
  await p.waitForTimeout(300);
  await tapPin(1);
  await p.waitForTimeout(250);
  console.log('  popup        :', JSON.stringify(await popup()));
  await p.waitForTimeout(1000);
  console.log('  1s later     :', JSON.stringify(await popup()));
  await p.screenshot({ path:'pop-c.png' });

  console.log('\n=== D. does a background sync pull nuke it? ===');
  await tapPin(5); await p.waitForTimeout(250);
  console.log('  open         :', !!(await popup()));
  await p.evaluate(()=>window.repaint && window.repaint());
  await p.waitForTimeout(400);
  console.log('  after repaint:', JSON.stringify(await popup()));

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

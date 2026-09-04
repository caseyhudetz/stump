/* The third answer looks like a button, says its piece once, and a photo
   can be pinned to any site from the card. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DAY = 86400000, now = Date.now();
const iso = d => new Date(d).toISOString().replace('Z','');

const removals = [
  // the screenshot's case: a request 27 ft away, three days old
  { sr_number:'SR26-01244097', street_number:'3511', street_direction:'N', street_name:'Reta',
    street_type:'Ave', zip_code:'60657', latitude:'41.945000', longitude:'-87.650000',
    closed_date: iso(now - 45*DAY) },   // lands on "1 month ago"
  // nothing near this one
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date: iso(now - 120*DAY) }
];
const plantings = [
  ...Array.from({length:12}, (_,i) => ({
    sr_number:'P-C'+i, street_number:String(100+i), street_direction:'W', street_name:'Melrose',
    street_type:'St', latitude:'41.930000', longitude:'-87.640000',
    created_date: iso(now - (400+i*10)*DAY), closed_date: iso(now - (400+i*10-182)*DAY),
    status:'Completed' })),
  // 3.6 days old: "open 3 days" must match "requested 3 days ago"
  { sr_number:'SR26-01740031', street_number:'3509', street_direction:'N', street_name:'Reta',
    street_type:'Ave', latitude:'41.945075', longitude:'-87.650000',
    created_date: iso(now - 3.6*DAY), status:'Open' }
];

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwAqn//Z','base64');

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE,
    hasTouch:true, isMobile:true,
    geolocation:{latitude:41.9440, longitude:-87.6490}, permissions:['geolocation'] });
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

  const ID = 'SR26-01244097';
  await p.evaluate(id=>pick(id), ID); await p.waitForTimeout(800);
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(600);

  console.log('=== the third answer reads as a button ===');
  console.log('  is a <button>    :', await p.$eval('.act.knows', e=>e.tagName));
  const look = await p.evaluate(()=>{
    const k = document.querySelector('.act.knows');
    const no = document.querySelector('.act.no');
    const c = getComputedStyle(k), r = k.getBoundingClientRect(), nr = no.getBoundingClientRect();
    return { bg:c.backgroundColor, colour:c.color, filled: c.backgroundColor !== 'rgba(0, 0, 0, 0)',
             width:Math.round(r.width), pairWidth:Math.round(nr.right - no.parentElement.getBoundingClientRect().left),
             chevron: !!k.querySelector('.kchev'), cursor:c.cursor };
  });
  console.log('  filled, not a box:', look.filled, look.bg, 'text', look.colour);
  console.log('  full width       :', look.width, 'vs the pair above', look.pairWidth);
  console.log('  has a chevron    :', look.chevron);
  await p.screenshot({ path:'lk1-button.png' });

  console.log('\n=== and says its piece once ===');
  const card = await p.$eval('#pitsheet', e=>e.textContent.replace(/\s+/g,' ').trim());
  console.log('  no banner above  :', await p.evaluate(()=>!document.querySelector('#pitsheet .nearline')));
  console.log('  "nearest 27 ft" x:', (card.match(/nearest 27 ft/g)||[]).length);
  console.log('  the button       :', await p.$eval('.act.knows', e=>e.textContent.replace(/\s+/g,' ').trim()));
  console.log('  the evidence     :', await p.$eval('#pitsheet .dhit', e=>e.textContent.replace(/\s+/g,' ').trim()));

  console.log('\n=== the ages agree with each other ===');
  console.log('  button says      :', (card.match(/open [\d.]+ \w+/)||[])[0]);
  console.log('  evidence says    :', (card.match(/requested [\d.]+ \w+ ago/)||[])[0]);
  console.log('  and one month is singular:', await p.$eval('#pitsheet .pmeta', e=>e.textContent.trim()));

  console.log('\n=== the evidence puts them on the map ===');
  console.log('  is tappable      :', await p.$eval('#pitsheet .dupwarn', e=>e.tagName),
    await p.$eval('#pitsheet .dshow', e=>e.textContent.trim()));
  await p.click('#pitsheet .dupwarn'); await p.waitForTimeout(900);
  console.log('  frames them      :', await p.evaluate(()=>{
    const b2 = map.getBounds();
    return b2.contains([41.945000,-87.650000]) && b2.contains([41.945075,-87.650000]); }));

  console.log('\n=== a photo can be pinned to any site ===');
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  console.log('  offered by       :', await p.$$eval('#pitsheet .quiet .qact', e=>e.map(x=>x.textContent.trim())));
  console.log('  row fits         :', await p.evaluate(()=>{
    const q = document.querySelector('#pitsheet .quiet');
    return q.scrollWidth <= q.clientWidth + 1; }), '(no sideways scroll at 390px)');
  console.log('  nothing yet      :', await p.evaluate(()=>{
    const l = document.querySelector('#pitsheet .shotline'); return !l || l.hidden; }));
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.click('#pitsheet [data-addshot]')
  ]);
  await chooser.setFiles({ name:'stump.jpg', mimeType:'image/jpeg', buffer:jpeg });
  await p.waitForTimeout(1200);
  console.log('  saved            :', await p.$eval('#toast', e=>e.textContent.trim()));
  await p.evaluate(()=>setSheetFull(true)); await p.waitForTimeout(500);
  console.log('  shown on the card:', await p.evaluate(()=>{
    const l = document.querySelector('#pitsheet .shotline'); return l ? !l.hidden : false; }));
  console.log('  renders          :', await p.$eval('#pitsheet .tshot', e=>e.naturalWidth > 0));
  console.log('  label changed    :', await p.$$eval('#pitsheet .quiet .qact', e=>e.map(x=>x.textContent.trim())));
  await p.screenshot({ path:'lk2-photo-card.png' });

  console.log('\n=== answering keeps it ===');
  await p.click('#pitsheet .act.no'); await p.waitForTimeout(1000);
  await p.click('#tasksbtn'); await p.waitForTimeout(800);
  console.log('  on the task      :', await p.evaluate(()=>{
    const l = document.querySelector('.task .shotline'); return l ? !l.hidden : false; }));
  console.log('  task says        :', await p.$eval('.task .shotsay p', e=>e.textContent.trim()));
  await p.screenshot({ path:'lk3-task.png', fullPage:true });

  console.log('\n=== it is there on the site page too, after a reload ===');
  await p.reload(); await p.waitForSelector('#tasksbtn:not([hidden])',{timeout:20000});
  await p.waitForTimeout(2400);
  console.log('  keys known early :', await p.evaluate(()=>[...hasPhoto]));
  await p.click('#sortbtn'); await p.waitForTimeout(400);
  await p.click('.chip[data-view="list"]'); await p.waitForTimeout(400);
  await p.click('#sortclose'); await p.waitForTimeout(400);
  const rows = await p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  await (await p.$$('#list .row'))[rows.findIndex(t=>/Reta/.test(t))].click(); await p.waitForTimeout(900);
  console.log('  on               :', await p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  photo on the page:', await p.evaluate(()=>{
    const l = document.querySelector('#detail .shotline'); return l ? !l.hidden : false; }));
  console.log('  says Replace     :', await p.$$eval('#detail .quiet .qact', e=>e.map(x=>x.textContent.trim())));
  await p.screenshot({ path:'lk4-detail.png', fullPage:true });

  console.log('\n=== and can be taken off again ===');
  await p.click('#detail [data-dropshot]'); await p.waitForTimeout(800);
  console.log('  gone             :', await p.evaluate(()=>{
    const l = document.querySelector('#detail .shotline'); return !l || l.hidden; }));
  console.log('  label back       :', await p.$$eval('#detail .quiet .qact', e=>e.map(x=>x.textContent.trim())));
  console.log('  and out of store :', await p.evaluate(()=>[...hasPhoto]));

  console.log('\n=== a site with nothing nearby is unchanged ===');
  await p.click('#back'); await p.waitForTimeout(600);
  const rows2 = await p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  await (await p.$$('#list .row'))[rows2.findIndex(t=>/Cornelia/.test(t))].click(); await p.waitForTimeout(900);
  console.log('  two answers      :', await p.$$eval('#dock .act', e=>e.map(x=>x.textContent.replace(/\s+/g,' ').trim())));
  console.log('  no evidence box  :', await p.evaluate(()=>!document.querySelector('#detail .dupwarn')));

  console.log('\npage errors      :', errs.length ? errs : 'none');
  await b.close();
})();

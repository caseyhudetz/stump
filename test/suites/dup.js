/* Not asking twice: a planting request already open next door must be
   surfaced before the 311 form is opened. Plus the chrome moves. */
const { chromium } = require('playwright');
const PORT = process.env.PORT || '8150';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const removals = [
  // 700 W Buckingham: a request already sits at 702, 30 ft along the parkway
  { sr_number:'SR26-A', street_number:'700', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', zip_code:'60657', latitude:'41.944000', longitude:'-87.650000',
    closed_date:'2026-05-11T00:00:00.000' },
  // 900 W Cornelia: nothing near it at all
  { sr_number:'SR26-B', street_number:'900', street_direction:'W', street_name:'Cornelia',
    street_type:'Ave', zip_code:'60657', latitude:'41.951000', longitude:'-87.658000',
    closed_date:'2026-04-11T00:00:00.000' },
  // 500 W Roscoe: a request on the same street, loosely geocoded far away
  { sr_number:'SR26-C', street_number:'500', street_direction:'W', street_name:'Roscoe',
    street_type:'St', zip_code:'60657', latitude:'41.943000', longitude:'-87.640000',
    closed_date:'2026-04-11T00:00:00.000' }
];
const plantings = [
  { sr_number:'SR26-P1', street_number:'702', street_direction:'W', street_name:'Buckingham',
    street_type:'Ave', latitude:'41.944080', longitude:'-87.650000',
    created_date:'2026-08-01T00:00:00.000', status:'Open' },
  { sr_number:'SR26-P2', street_number:'504', street_direction:'W', street_name:'Roscoe',
    street_type:'St', latitude:'41.943300', longitude:'-87.640900',   // ~250 ft off
    created_date:'2026-07-01T00:00:00.000', status:'Open' }
];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, userAgent:IPHONE, hasTouch:true, isMobile:true });
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

  const openPanel = async () => {
    if (await p.$eval('#sortwrap', e=>e.hasAttribute('hidden'))){ await p.click('#sortbtn'); await p.waitForTimeout(300); }
  };
  const chip = async (k,v) => { await openPanel(); await p.click(`.chip[data-${k}="${v}"]`); await p.waitForTimeout(500); };
  const shut = async () => { await p.click('#sortclose'); await p.waitForTimeout(400); };

  console.log('=== chrome: what is in the header now ===');
  console.log('  sync gone from header:', await p.evaluate(()=>!document.querySelector('.topbar #sync')));
  console.log('  filter gone from header:', await p.evaluate(()=>!document.querySelector('.topbar #sortbtn')));
  console.log('  header holds          :', await p.$$eval('.topbar button', e=>e.map(x=>x.id||x.className)));
  console.log('  filter on the map     :', await p.evaluate(()=>!!document.querySelector('.mapctls #sortbtn')));
  await p.screenshot({ path:'du1-header.png' });

  console.log('\n=== sync moved to Tasks ===');
  console.log('  sync on tasks page    :', await p.evaluate(()=>!!document.querySelector('#tasks #sync')));
  await p.click('#tasksbtn'); await p.waitForTimeout(600);
  console.log('  reads                 :', JSON.stringify(await p.$eval('#sync', e=>e.textContent.trim())));
  console.log('  visible there         :', await p.$eval('#sync', e=>!!e.offsetParent));

  console.log('\n=== you can see where you are ===');
  console.log('  tasks button marked   :', await p.$eval('#tasksbtn', e=>e.classList.contains('on')));
  console.log('  aria-current          :', await p.$eval('#tasksbtn', e=>e.getAttribute('aria-current')));
  await p.screenshot({ path:'du2-tasks-current.png' });
  await p.click('#home'); await p.waitForTimeout(500);
  console.log('  cleared on browse     :', await p.$eval('#tasksbtn', e=>!e.classList.contains('on')));

  console.log('\n=== clear all filters ===');
  await chip('show','open');
  await chip('sort','new');
  await p.fill('#q','buck'); await p.waitForTimeout(400);
  console.log('  clear offered         :', await p.$eval('#clearfilters', e=>!e.hasAttribute('hidden')));
  console.log('  dot showing           :', await p.$eval('#sortdot', e=>!e.hasAttribute('hidden')));
  await p.click('#clearfilters'); await p.waitForTimeout(500);
  console.log('  after clear           :', await p.evaluate(()=>({ show, sort, query, view })));
  console.log('  search box emptied    :', JSON.stringify(await p.$eval('#q', e=>e.value)));
  console.log('  chips reset           :', await p.evaluate(()=>
    document.querySelector('.chip[data-show="all"]').getAttribute('aria-pressed') === 'true' &&
    document.querySelector('.chip[data-sort="street"]').getAttribute('aria-pressed') === 'true'));
  console.log('  clear hidden again    :', await p.$eval('#clearfilters', e=>e.hasAttribute('hidden')));
  console.log('  view untouched by clear:', await p.evaluate(()=>view === 'map'));
  await p.screenshot({ path:'du3-panel.png' });

  console.log('\n=== the duplicate warning ===');
  await chip('view','list'); await shut();
  console.log('  flagged in the list   :', await p.$$eval('#list .row', e=>e.map(x=>
    x.querySelector('.raddr').textContent.trim() + (x.querySelector('.dflag') ? '  ← request nearby' : ''))));

  await p.click('.row'); await p.waitForTimeout(800);
  console.log('  on 700 W Buckingham   :', await p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  warns                 :', await p.evaluate(()=>!!document.querySelector('#detail .dupwarn')));
  console.log('  says what             :', (await p.$eval('#detail .dupwarn', e=>e.textContent)).replace(/\s+/g,' ').trim());
  await p.screenshot({ path:'du4-detail-warn.png' });

  console.log('\n=== and again at the moment of filing ===');
  await p.click('#dock .act.no'); await p.waitForTimeout(700);
  // a nearby open request now opens the chooser first
  if (await p.$('.chooser')) { await p.click('.chooser .mini.ghost'); await p.waitForTimeout(900); }
  console.log('  on tasks              :', await p.$eval('#tasks', e=>!e.hasAttribute('hidden')));
  const warnBox = await p.$eval('.task .dupwarn', e=>{const r=e.getBoundingClientRect();return Math.round(r.top);});
  const formBtn = await p.$eval('.task a.mini.hot', e=>{const r=e.getBoundingClientRect();return Math.round(r.top);});
  console.log('  warning above the form button:', warnBox < formBtn, `(${warnBox} vs ${formBtn})`);
  console.log('  names the request     :', (await p.$eval('.task .dhit', e=>e.textContent)).replace(/\s+/g,' ').trim());
  await p.screenshot({ path:'du5-task-warn.png', fullPage:true });

  console.log('\n=== a site with nothing near it is not warned ===');
  await p.click('#home'); await p.waitForTimeout(500);
  await chip('show','open'); await shut();
  const rows = await p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  console.log('  unchecked rows        :', rows);
  const idx = rows.findIndex(t => /Cornelia/.test(t));
  await (await p.$$('#list .row'))[idx].click(); await p.waitForTimeout(800);
  console.log('  on                    :', await p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  no warning            :', await p.evaluate(()=>!document.querySelector('#detail .dupwarn')));

  console.log('\n=== same street, loose geocoding, still caught ===');
  await p.click('#back'); await p.waitForTimeout(500);
  const rows2 = await p.$$eval('#list .row .raddr', e=>e.map(x=>x.textContent.trim()));
  const ri = rows2.findIndex(t => /Roscoe/.test(t));
  await (await p.$$('#list .row'))[ri].click(); await p.waitForTimeout(800);
  console.log('  on                    :', await p.$eval('.daddr', e=>e.textContent.trim()));
  console.log('  caught by street+number:', await p.evaluate(()=>!!document.querySelector('#detail .dupwarn')));
  console.log('  distance stated       :', (await p.$eval('#detail .dhit', e=>e.textContent)).replace(/\s+/g,' ').trim());

  console.log('\npage errors    :', errs.length ? errs : 'none');
  await b.close();
})();

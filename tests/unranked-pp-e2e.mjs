// CHROMIUM_PATH=/usr/bin/chromium node tests/unranked-pp-e2e.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'), root = new URL('../', import.meta.url);
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]; if (path.includes('..')) return res.writeHead(403).end();
  for (const p of [path === '/' ? 'index.html' : path.slice(1), 'public' + path]) {
    try { const data = readFileSync(new URL(p, root)); res.setHeader('content-type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); return res.end(data); } catch {}
  }
  res.writeHead(404).end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 591 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }), errors = [];
  await page.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
  if (await page.$('.onboarding')) {
    if (await page.$('.setup-choice[data-id=new]')) await page.click('.setup-choice[data-id=new]');
    await page.fill('.onboarding .ob-name', 'MobileTester'); await page.keyboard.press('Enter');
    await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => Onboarding.finish());
  }
  await page.waitForFunction(() => !Screens.busy);


  const result=await page.evaluate(async()=>{
    while(Overlays.top()) Overlays.top().close();
    Settings.set('gameplay.mobileLayout','auto');
    const score={id:'unranked-pp',mapHash:'unranked-fixture',rankStatus:'pending',player:'Tester',accuracy:.99,grade:'S',score:900000,scoreStd:900000,counts:[990,10,0,0,0,0],mods:[],keys:4,maxCombo:1000,stars:5,srVersion:SR_VERSION,pp:123,passed:true,date:Date.now(),title:'Unranked map',artist:'Test'};
    await Screens.go('results',{score,browse:true});
    const cell=[...document.querySelectorAll('.rs-stat')].find(e=>e.textContent.includes('Unranked'));
    if(!cell||!cell.textContent.includes('123')) throw Error('Missing labelled unranked pp');
    if(!document.querySelector('.res-right').textContent.includes('Achieved PP · Unranked')) throw Error('Breakdown missing label');
    if(ScoreManager.ppOf(score)!==0||ScoreManager.bestPpPerMap([score]).length!==0) throw Error('Unranked score counted toward rankings');
    return cell.textContent;
  });
  console.log('PASS results show calculated unranked pp without ranked credit:',result);
} finally {if(browser) await browser.close();server.close();}

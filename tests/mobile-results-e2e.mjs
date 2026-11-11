// CHROMIUM_PATH=/usr/bin/chromium node tests/mobile-column-alignment-e2e.mjs
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

  for (const viewport of [{width:591,height:1280},{width:360,height:740},{width:1280,height:591}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      while (Overlays.top()) Overlays.top().close();
      Settings.set('gameplay.mobileLayout', 'portrait');
      await Screens.go('results', {score:{replayId:'test-replay',player:'Tester',accuracy:.95,grade:'A',score:718227,scoreStd:718227,counts:[100,10,2,1,0,1],mods:[],keys:4,maxCombo:100,pp:103,passed:true,date:Date.now(),title:'Test map',artist:'Test artist'}});
    });
    await page.waitForTimeout(1000);
    const out = await page.evaluate(() => {
      const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; };
      const actions=[...document.querySelectorAll('.res-actions button')].map(e=>({name:e.getAttribute('aria-label')||e.textContent,r:rect(e)}));
      for(const a of actions) if(a.r.x < -1 || a.r.right > innerWidth+1 || a.r.y < 0 || a.r.bottom > innerHeight+1) throw Error('Unreachable action '+JSON.stringify(a));
      if(Orientation.wanted()!=='portrait') throw Error('Portrait results ignored');
      Settings.set('gameplay.mobileLayout','expanded'); if(Orientation.wanted()!=='landscape') throw Error('Expanded results ignored');
      Settings.set('gameplay.mobileLayout','auto'); if(Orientation.wanted()!=='any') throw Error('Auto results ignored');
      return actions;
    });
    console.log(viewport, out);
    await page.screenshot({path:`/tmp/mobile-results-${viewport.width}.png`});
  }
  console.log('PASS mobile results orientation and reachable actions');
} finally { if(browser) await browser.close(); server.close(); }

// CHROMIUM_PATH=/usr/bin/chromium node tests/profile-scaling-e2e.mjs
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


  for (const viewport of [{width:1280,height:591},{width:360,height:740},{width:1440,height:960}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(()=>{
      while(Overlays.top()) Overlays.top().close();
      ProfileAppearance.open();
    });
    for(const scale of [.75,1.25]) {
      await page.evaluate(scale=>Settings.set('ui.scale',scale),scale);
      await page.waitForTimeout(300);
      const result=await page.evaluate(()=>{
        const editor=document.querySelector('.pa-editor'), wrap=editor.parentElement, app=document.querySelector('#app');
        const er=editor.getBoundingClientRect(), ar=app.getBoundingClientRect();
        const button=editor.querySelector('.pa-foot button'), br=button.getBoundingClientRect();
        const appScale=ar.width/app.offsetWidth, buttonScale=br.height/button.offsetHeight;
        if(Math.abs(appScale-buttonScale)>.02) throw Error('Editor does not inherit app scale');
        if(Math.abs(er.width-ar.width)>2||Math.abs(er.height-ar.height)>2) throw Error('Editor does not fill scaled app');
        if(br.right>innerWidth+2||br.bottom>innerHeight+2) throw Error('Editor buttons clipped');
        if(getComputedStyle(wrap).transform!=='none') throw Error('Editor has independent zoom transform');
        return {appScale,buttonScale};
      });
      console.log(viewport,scale,result);
    }
    await page.screenshot({path:`/tmp/profile-scaling-${viewport.width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS profile editor inherits app scaling with accessible footer');
} finally {if(browser) await browser.close();server.close();}

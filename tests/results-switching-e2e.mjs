// CHROMIUM_PATH=/usr/bin/chromium node tests/results-switching-e2e.mjs
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


  await page.evaluate(async () => {
    while (Overlays.top()) Overlays.top().close();
    Settings.set('gameplay.mobileLayout','auto');
    const hash='results-uninstalled-fixture';
    const score={id:'o-first',online:true,onlineSetId:12345,mapHash:hash,player:'First',accuracy:.95,grade:'A',score:718227,scoreStd:718227,counts:[100,10,2,1,0,1],mods:[],keys:4,maxCombo:100,pp:103,passed:true,date:Date.now(),title:'Test map',artist:'Test artist'};
    MpResults.boards.set(hash,{at:Date.now(),scores:[{pid:'first',name:'First',score:718227,acc:.95,grade:'A',combo:100,counts:score.counts},{pid:'second',name:'Second',score:600000,acc:.9,grade:'B',combo:80,counts:score.counts}]});
    await Screens.go('results',{score,browse:true});
  });
  await page.waitForTimeout(800);
  const expectedBackground=await page.evaluate(()=>Background.current);
  assert.ok(expectedBackground);
  for (const player of ['second','first','second']) {
    // Open statistics before switching, as players do while comparing scores.
    await page.locator('.res-grid > .rs').click();
    await page.evaluate(pid=>document.querySelector(`.cp[data-sid="o-${pid}"]`).click(),player);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>Background.current),expectedBackground);
    assert.equal(await page.locator('[aria-label="Download beatmap"]').count(),1);
    assert.equal(await page.locator('[aria-label="Share"]').count(),1);
    assert.equal(await page.locator('.results > .res-actions > .lz-back').count(),1);
    assert.equal(await page.evaluate(()=>ResultsScreen.el===ResultsScreen._el && ResultsScreen.el.isConnected),true);
    assert.equal(await page.locator('.results.stats-open').count(),0);
    assert.equal(await page.evaluate(()=>ResultsScreen.p.score.onlineSetId),12345);
  }
  await page.evaluate(async () => {
    const lookup=BeatmapManager.mapByHash, bg=BeatmapManager.bgURL;
    let resolve;
    const pending=new Promise(r=>resolve=r), original=ResultsScreen.p.score;
    BeatmapManager.mapByHash=function(hash) { return hash==='delayed-local' ? {id:'delayed',hash,keys:4,setId:12345,title:'Delayed map'} : lookup.call(this,hash); };
    BeatmapManager.bgURL=()=>pending;
    try {
      await Screens.go('results',{force:true,browse:true,score:{...original,mapHash:'delayed-local'}});
      await Screens.go('results',{force:true,browse:true,score:original});
      const expected=Background.current;
      resolve('data:image/png;base64,stale');
      await pending; await Promise.resolve();
      if(Background.current!==expected) throw Error('Stale background replaced selected score background');
    } finally { BeatmapManager.mapByHash=lookup; BeatmapManager.bgURL=bg; }
  });
  assert.deepEqual(errors,[]);
  console.log('PASS repeated result switching preserves background, download, share, back and screen ownership');
} finally { if(browser) await browser.close(); server.close(); }

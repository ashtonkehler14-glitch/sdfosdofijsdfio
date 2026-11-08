// MINIFLARE_DIR=<dir> CHROMIUM_PATH=/usr/bin/chromium node tests/dropdowns-e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const { Miniflare } = createRequire(join(process.env.MINIFLARE_DIR || process.cwd(), 'package.json'))('miniflare');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mf = new Miniflare({ modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, host: '127.0.0.1', port: 0, durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  serviceBindings: { ASSETS: async req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try { return new Response(readFileSync(f), { headers: { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(f)] || 'application/octet-stream' } }); } catch { /* next */ }
    return new Response('not found', { status: 404 });
  } },
});
let browser;
try {
  const url = String(await mf.ready);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 960 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
      await page.fill('.onboarding .ob-name', 'DropdownTest'); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.evaluate(() => {
      while (Overlays.top()) Overlays.top().close();
      window.dropdownChanges = 0;
      const select = h('select.select', { id: 'dropdown-test', 'aria-label': 'Test options', style: { position: 'fixed', bottom: '15px', left: '15px', width: '240px', zIndex: '13000' } }, h('option', { value: 'a' }, 'Alpha'), h('option', { value: 'b', disabled: true }, 'Beta disabled'), h('option', { value: 'c' }, 'Gamma'));
      select.addEventListener('change', () => window.dropdownChanges++); document.body.append(select);
    });
    const button = page.getByRole('combobox', { name: 'Test options', exact: true });
    await button.click(); await page.getByRole('listbox', { name: 'Test options' }).waitFor();
    const bounds = await page.locator('.game-select-menu').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; });
    assert.equal(bounds, true);
    assert.equal(await page.getByRole('option', { name: 'Beta disabled' }).getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dropdown-test').inputValue(), 'c'); assert.equal(await page.evaluate(() => window.dropdownChanges), 1);
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    await button.click(); await page.keyboard.press('Home'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dropdown-test').inputValue(), 'c');
    await page.evaluate(() => { document.querySelector('#dropdown-test').value = 'a'; });
    assert.match(await button.textContent(), /Alpha/);
    await page.locator('#dropdown-test').selectOption('c'); assert.match(await button.textContent(), /Gamma/);
    await page.evaluate(() => { document.querySelector('#dropdown-test').append(h('option', { value: 'd' }, 'Delta')); });
    await button.click(); await page.keyboard.press('d'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dropdown-test').inputValue(), 'd');
    await page.evaluate(() => { document.querySelector('#dropdown-test').disabled = true; });
    await page.waitForFunction(() => document.querySelector('.game-select-trigger[aria-label="Test options"]').disabled);
    await page.evaluate(() => { document.querySelector('#dropdown-test')._gameDropdown.anchor.remove(); AshtonkMania.SettingsPanel.open(); });
    await page.locator('.settings-panel .game-select-trigger').first().click();
    await page.locator('.game-select-menu').waitFor();
    if (process.env.SHOT_DIR) await page.screenshot({ path: join(process.env.SHOT_DIR, mobile ? 'dropdown-mobile.png' : 'dropdown-desktop.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.game-select-menu').count(), 0);
    assert.equal(await page.locator('.settings-panel').count(), 1, 'Escape closes the dropdown before the settings panel');
    if (!mobile) {
      await page.evaluate(() => { while (Overlays.top()) Overlays.top().close(); });
      let checks = [];
      await page.route('**/api/lookupBeatmap?*', route => {
        const lookup = new URL(route.request().url());
        if (lookup.searchParams.has('checksum')) {
          checks.push(lookup.searchParams.get('checksum'));
          return route.fulfill({ status: 404, json: { error: 'Beatmap not found.' } });
        }
        return route.continue();
      });
      await page.evaluate(async () => {
        const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
        await AshtonkMania.App.importFiles([new File([blob], 'test-set.osz')]);
        while (Overlays.top()) Overlays.top().close();
        const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()].find(m => m.keys === 4);
        window.eligibilityMap = m;
        A.BeatmapManager.setById.get(m.setId).status = 'ranked';
        A.BeatmapManager.setById.get(m.setId).onlineId = 42;
        m.onlineId = 123; m.rankChecked = 0; delete m.rankStatus;
        await A.ScoreManager.add({ id: 'eligibility-play', mapHash: m.hash, date: Date.now(), passed: true,
          status: 'ranked', pp: 321, srVersion: SR_VERSION, score: 987654, accuracy: 1, counts: [100, 0, 0, 0, 0, 0], mods: [] });
        await BeatmapStatus.checkMap(m);
      });
      assert.ok(checks.length && /^[a-f0-9]{32}$/.test(checks.at(-1)), 'The imported file is checked by checksum');
      const missing = await page.evaluate(async () => {
        const A = AshtonkMania, m = window.eligibilityMap, score = A.ScoreManager.forMap(m.hash)[0];
        return { status: m.rankStatus, ranked: A.ScoreManager.isRanked(score), pp: A.ScoreManager.ppOf(score),
          localSaved: !!(await A.DB.get('scores', 'eligibility-play')) };
      });
      assert.deepEqual(missing, { status: 'missing', ranked: false, pp: 0, localSaved: true });
      await page.unroute('**/api/lookupBeatmap?*');
      await page.route('**/api/lookupBeatmap?*', route => route.fulfill({ json: { beatmapId: 7, setId: 42, status: 'ranked' } }));
      assert.equal(await page.evaluate(async () => {
        window.eligibilityMap.rankChecked = 0;
        await BeatmapStatus.checkMap(window.eligibilityMap);
        return AshtonkMania.ScoreManager.ppOf(AshtonkMania.ScoreManager.forMap(window.eligibilityMap.hash)[0]);
      }), 321, 'Exact ranked confirmation enables the saved score’s ranked PP');
      console.log('PASS: real beatmap import checks file checksum, ignores copied ranked metadata, keeps missing-map scores locally and restores PP only after exact confirmation');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${mobile ? 'mobile' : 'desktop'} styled dropdowns, keyboard/touch, disabled options, reset/programmatic values, dynamic options and viewport-safe settings menu`);
    await context.close();
  }
} finally { await browser?.close(); await mf.dispose(); }

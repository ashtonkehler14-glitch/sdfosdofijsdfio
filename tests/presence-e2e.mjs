// The online list against the real Worker + Durable Objects (run locally in workerd through Miniflare): one account
// with several connections open, each sending its own picture, shows as one entry with one picture.
// Usage: node tests/presence-e2e.mjs   (MINIFLARE_DIR=<dir with node_modules/miniflare> if it isn't installed here)
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let Miniflare;
try {
  const req = createRequire(join(process.env.MINIFLARE_DIR || root, 'package.json'));
  ({ Miniflare } = await import(pathToFileURL(req.resolve('miniflare')).href));
} catch { console.log('SKIP: miniflare is not installed (pnpm add -D miniflare, or set MINIFLARE_DIR)'); process.exit(0); }

const mf = new Miniflare({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  serviceBindings: { ASSETS: () => new Response('not found', { status: 404 }) },
});
const base = new URL(String(await mf.ready));
const wsUrl = new URL('api/mp/presence', base); wsUrl.protocol = 'ws:';

const socks = [];
/** A presence connection: resolves once the server has welcomed it; `last` holds the newest online list. */
function connect(hello) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); socks.push(ws);
    const c = { ws, id: null, last: null };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', status: 'menu', vis: 'online', ...hello }));
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { c.id = m.you; resolve(c); }
      if (m.t === 'online') c.last = m.players;
    };
    ws.onerror = reject;
  });
}
const listOf = c => new Promise(resolve => {
  const was = c.ws.onmessage;
  c.ws.onmessage = ev => { was(ev); const m = JSON.parse(ev.data); if (m.t === 'online') { c.ws.onmessage = was; resolve(m.players); } };
  c.ws.send('{"t":"list"}');
});

let failed = false;
try {
  const me = { name: 'Tiler', pid: 'tilerpid01', key: 'key-tilerpid01-0123456789' };
  const tiles = [];
  for (const n of [1, 2, 3]) tiles.push(await connect({ ...me, cid: 'tab' + n, avatar: `preset:tile-${n}` }));
  const other = await connect({ name: 'Bob', pid: 'bobpid0001', key: 'key-bobpid0001-0123456789', cid: 'bob' });
  const list = await listOf(other);
  const mine = list.filter(p => p.pid === me.pid);
  assert.equal(mine.length, 1, `one entry for the account (got ${mine.length})`);
  assert.equal(mine[0].avatar, 'preset:tile-3', 'the newest picture');
  assert.equal(list.length, 2, 'the account and Bob');
  console.log('PASS presence: 3 connections on one account → 1 entry, newest picture');
} catch (e) { failed = true; console.error('FAIL', e.message); }
finally {
  for (const ws of socks) try { ws.close(); } catch { /* closed */ }
  await mf.dispose();
}
process.exit(failed ? 1 : 0);

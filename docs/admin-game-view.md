# Admin game view

**Admin Spectate** sits beside regular **Spectate** in online player profiles and menus. An authenticated owner/admin joins directly and chooses whether to send an extra notification first. Players do not enable anything and there is no browser tab-sharing picker.

The source renders only this app's own UI into a video canvas. It shows menus, pointer movement, dialogs and gameplay, with no remote control or recording. It cannot see another tab, the browser's chrome, a window or the desktop. The player always has a visible viewing indicator, Pause and Stop controls. Account-code panels, password inputs and panels marked `data-private` pause and clear the view; snapshots taken across a privacy change are discarded.

The viewer fills the screen without dimming. Capture prioritizes the watched player's frame limiter and measured display cadence, including high-refresh displays, independently of the FPS counter. It never changes the player's frame limit or playfield resolution.

The stream uses six adaptive quality levels, from 480px / 2fps up to 1920px / 30fps (also capped at the source viewport and 1440px high). Missed game frames, expensive copies or CPU-limited encoding reduce stream quality quickly; six seconds of stable headroom allow one quality step back up. When there is no spare frame time, capture waits instead of forcing a minimum update rate. Encoder bitrate and frame-rate limits follow the selected level.

Game frames run first. Stream copies are queued into idle time after the game's rendering work, and canvas frames are submitted manually only when due. Full UI capture is split into small cooperative chunks rather than one long DOM/style walk; assets and fonts are cached between snapshots. During play, interface snapshots update less often, while the existing playfield canvas and lightweight score/accuracy HUD can stream immediately. Paused/menu views retain full UI snapshots. This is a best-effort scheduler: browser GPU work, garbage collection and encoding cannot be strictly partitioned, and hardware that cannot reach the player's target without streaming cannot be made to do so by capture.

The renderer (`modern-screenshot` 4.7.0, MIT) loads when an admin view starts, from the game's own assets. Its video cloning snapshots the existing in-game frame without loading/seeking another player. Its clone/embed/raster checkpoints yield to the game's frame budget. Privacy changes and stopping cancel queued work, clear frames and reject stale snapshots.

The browser needs canvas streaming and WebRTC, available in current Chromium and Firefox; unsupported browsers show a clear connection error. Either side can stop. Sessions expire after 30 minutes, and disconnecting, appearing offline or losing the admin role ends the session. No pixels are captured before an authenticated admin session starts or after it stops.

Direct connections use Cloudflare's public STUN service. For connections across restricted networks and symmetric NAT, configure a TURN relay using the `ADMIN_VIEW_ICE_SERVERS` Worker secret. Its value is an array of standard WebRTC ICE server objects, for example:

```json
[{"urls":["turns:relay.example.com:5349?transport=tcp"],"username":"relay-user","credential":"relay-password"}]
```

Set it through the Cloudflare dashboard or `npx wrangler secret put ADMIN_VIEW_ICE_SERVERS`. Use credentials dedicated to this game. The server sends this configuration only to the authenticated pair; it is absent from public presence lists and the built game file.

Validation:

```sh
node --test tests/admin-game-view.test.mjs
MINIFLARE_DIR=/path/to/miniflare CHROMIUM_PATH=/usr/bin/chromium node tests/admin-game-view-e2e.mjs
```

The browser test uses real app rendering and WebRTC, and makes `getDisplayMedia` throw to prove it is never needed. Set `ADMIN_VIEW_ICE_SERVERS` for that command when the test browser requires a TCP/TLS relay.

A repeatable CPU-throttled capture benchmark is available separately (it measures capture rendering, not remote encoding/network performance):

```sh
git show 5fbc0c1:src/js/19qa-game-capture.js > /tmp/baseline-game-capture.js
BASELINE_CAPTURE=/tmp/baseline-game-capture.js CHROMIUM_PATH=/usr/bin/chromium node tests/admin-view-performance-e2e.mjs
```

On the development Chromium runner, a 4× CPU-throttled 1280×720 run with a 60 FPS target improved from about 20 FPS / 83ms p95 frame interval to about 60 FPS / 17ms p95 while reducing the capture to 480px / 2fps. The budgeted path produced live playfield frames and no >50ms main-thread tasks during the six-second measurement window. These are one runner's measurements, not a guarantee for other devices.

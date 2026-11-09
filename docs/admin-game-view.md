# Admin game view

Players have two viewing actions: regular **Spectate** replays gameplay, while an authenticated owner/admin also gets **Live View**, immediately beside it in profiles, online menus and multiplayer rooms. Live View joins the live interface stream directly, without an extra mode chooser. There is no separate admin gameplay spectating mode.

The source renders only this app's own UI into a video canvas. It shows menus, pointer movement, dialogs and gameplay, with no remote control or recording. It cannot see another tab, the browser's chrome, a window or the desktop. The player always has a visible viewing indicator, Pause and Stop controls. Account-code panels, password inputs and panels marked `data-private` pause and clear the view; snapshots taken across a privacy change are discarded.

The viewer fills the screen without dimming. Capture prioritizes the watched player's frame limiter and measured display cadence, including high-refresh displays, independently of the FPS counter. It never changes the player's frame limit or playfield resolution.

The stream uses six adaptive quality levels, from 854px / 2fps up to 1920px / 30fps (also capped at the source viewport and 1440px high). Missed game frames, expensive copies or CPU-limited encoding reduce stream quality quickly; six seconds of stable headroom allow one quality step back up. When there is no spare frame time, capture waits instead of forcing a minimum update rate. Encoder bitrate and frame-rate limits follow the selected level.

Game frames run first. Stream copies are queued into idle time after the game's rendering work, and canvas frames are submitted manually only when due. Full UI capture is split into small cooperative chunks rather than one long DOM/style walk; assets and fonts are cached between snapshots. During gameplay, snapshots cover only the transparent HUD subtree. The playfield, storyboard, custom skin digits, health and error-meter canvases are copied directly; scores, accuracy, judgement counters, health and progress update in lightweight overlay layers. Fast HUD changes do not dirty the static snapshot, and resolution changes reuse the existing HUD image. Cached geometry and styles avoid layout queries for each transmitted frame. Menus and dialogs retain full UI snapshots, refreshed on changes, scrolling or input. The encoder favors preserving resolution for readable UI text. This is a best-effort scheduler: browser GPU work, garbage collection and encoding cannot be strictly partitioned, and hardware that cannot reach the player's target without streaming cannot be made to do so by capture.

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
git show ca7dc61:src/js/19q0-view-budget.js > /tmp/baseline-game-capture.js
git show ca7dc61:src/js/19qa-game-capture.js >> /tmp/baseline-game-capture.js
BASELINE_CAPTURE=/tmp/baseline-game-capture.js CHROMIUM_PATH=/usr/bin/chromium WARMUP_MS=3000 SAMPLE_MS=8000 node tests/admin-view-performance-e2e.mjs
```

On the development Chromium runner, one 4× CPU-throttled 1280×720 comparison with a 60 FPS target, three-second warmup and eight-second sample improved player rendering from 57.25 to 59.63 FPS. Measured long-task time fell from 342ms to 72ms; snapshot yield checkpoints fell from 465 to 145. The stream remained at the player's-priority 2 FPS floor, but with 854px width instead of 480px. The new path completed two HUD snapshots and no full-page gameplay snapshots. This benchmark measures source rendering and canvas capture, without a real network encoder; the separate real WebRTC test covers actual video delivery, menus, privacy and controls. These are one runner's measurements, not a guarantee for other devices.

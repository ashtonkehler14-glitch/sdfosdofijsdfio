# Admin game view

Players have two viewing actions: regular **Spectate** replays gameplay, while an authenticated owner/admin also gets **Live View**, immediately beside it in profiles, online menus and multiplayer rooms. Live View joins the live interface stream directly, without an extra mode chooser. There is no separate admin gameplay spectating mode.

The source shares only this app's own UI. Menus are reconstructed on the viewer; gameplay uses an in-game video canvas. It shows menus, pointer movement, dialogs and gameplay, with no remote control or recording. It cannot see another tab, the browser's chrome, a window or the desktop. The player always has a visible viewing indicator, Pause and Stop controls. Account-code panels, password inputs and panels marked `data-private` pause and clear the view; snapshots taken across a privacy change are discarded.

For the closest match to the player's actual display, supported Chromium browsers offer **Share exact tab** on the player's sharing bar. The player clicks it and approves the browser's tab picker. A fresh per-request Capture Handle verifies this tab without an extra crop. Region Capture verifies and crops to this document as a compatibility fallback. Other tabs and windows are rejected. The browser captures the composited game page directly, including custom CSS, canvas content, and shadow-DOM overlays. This avoids rebuilding screenshots or running a duplicate JS renderer. Capture and WebRTC encoding still use device resources. Negotiation prefers a browser-reported smooth, power-efficient encoder when available and retains all other codecs as fallbacks. Hardware acceleration and performance vary by device.

Exact mode starts at a 720px short side and 30fps, increasing toward 1080p only after sustained spare capacity, with adaptive resolution and bitrate based on source frame-time and encoder pressure. It keeps a 720px short-side target when reducing resolution, but the browser may be limited by the source window's native size, device capabilities or connection. The frame limiter and render resolution of the game itself stay unchanged. The player can choose **Use lightweight view** to return without reconnecting; stopping tab sharing in the browser ends the entire Live View session. Known private account panels and the player's Pause button disable the native track rather than broadcasting the panel. Unsupported browsers keep the existing lightweight view.

The viewer fills the screen without dimming. Capture prioritizes the watched player's frame limiter and measured display cadence, including high-refresh displays, independently of the FPS counter. It never changes the player's frame limit or playfield resolution.

Menus use an ordered WebRTC data channel. The player sends an initial DOM snapshot, coalesced subtree changes, scrolling, form state and pointer position. The viewer renders these in an inert, script-disabled sandbox using its own game styles. Menu updates are checked every 33ms, while animations run locally on the viewer. There is no full-page rasterization or video encoding in menus. Image/font assets are transferred once and cached; small canvas/video regions are sampled separately. The receiver accepts only allowlisted markup and opaque asset references, with bounded messages, node counts and asset sizes. It cannot run source scripts or control the player.

Screen changes retain the last rendered view until the next menu snapshot or first gameplay video frame is available. Private panels deliberately clear both views immediately. The existing screenshot path is retained as a compatibility fallback if the other client cannot join the menu data channel.

Gameplay has six adaptive quality levels targeting 1280–1920px width at 30fps, with a minimum 720px short side and the source's aspect ratio preserved. The encoder allowance ranges from 2.5 to 6Mbps. Quality adjusts to available headroom without lowering the configured resolution/frame-rate floor. Game frames run first; stream copies run in spare frame time and manually submit canvas frames when due. Delivered FPS still depends on the device and network: the scheduler can skip work under load, so 30fps is a target, not a guarantee.

During gameplay, static snapshots cover only the transparent HUD subtree. The playfield, storyboard, custom skin digits, health and error-meter canvases are copied directly; scores, accuracy, judgement counters, health and progress update in lightweight overlay layers. Fast HUD changes do not dirty the static snapshot, and resolution changes reuse the existing HUD image. Cached geometry and styles avoid layout queries for each transmitted frame.

The renderer (`modern-screenshot` 4.7.0, MIT) loads lazily for gameplay or the compatibility fallback, from the game's own assets. Its clone/embed/raster checkpoints yield to the game's frame budget. Privacy changes and stopping cancel queued work, clear frames and reject stale snapshots.

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

The default browser test uses real app rendering and WebRTC, and makes `getDisplayMedia` throw to prove that lightweight viewing needs no browser capture prompt. Set `ADMIN_VIEW_ICE_SERVERS` for that command when the test browser requires a TCP/TLS relay.

The browser test also samples menu viewing under 4× CPU throttling. On the development Chromium runner, a six-second sample retained 59.6 source FPS with no long tasks, page screenshots or pixel copies, while delivering 126 DOM updates; the viewer was one 50ms counter update behind. These are one runner's measurements, not a guarantee for other devices. The same test covers gameplay video, screen handoffs, sandbox isolation, privacy, pause/resume and both sides' Stop controls. Run with `SOURCE_MOBILE=1` to cover a touch/mobile source.

Run with `EXACT_TAB=1` to test real browser tab capture and decoding over authenticated WebRTC. Test-only Chromium flags select the test player's tab; production code always uses the normal browser picker. This path verifies a closed-shadow overlay in the received pixels, measures both source-game and remote-video FPS, and checks that the JS renderer is stopped, Pause/account masking still work, and switching back to lightweight viewing keeps the session connected.

Use `EXACT_CPU_RATE=4` with `EXACT_TAB=1` for the native-capture CPU stress run. The test records whether the runner has a software GPU; its source-FPS check accounts for that environment rather than claiming a guaranteed 60fps. The game itself always keeps the player’s chosen frame limit.

On the software-GPU development runner, a six-second native sample delivered 29 viewer FPS at 1080×720 while the watched game rendered at 49 FPS, with no source long tasks. At 4× source CPU throttling, the final sample delivered 28 viewer FPS and 40 source FPS, again with no source long tasks. This is the cost of exact browser compositing and encoding on that runner; the lightweight menu path remained around 60 source FPS. Use lightweight viewing for the smallest source cost and exact tab sharing when matching the rendered page matters most. These are measured examples, not promises about other devices or networks.

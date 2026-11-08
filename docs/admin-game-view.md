# Admin game view

**Admin Spectate** sits beside regular **Spectate** in online player profiles and menus. An authenticated owner/admin joins directly and chooses whether to send an extra notification first. Players do not enable anything and there is no browser tab-sharing picker.

The source renders only this app's own UI into a video canvas. It shows menus, pointer movement, dialogs and gameplay, with no remote control or recording. It cannot see another tab, the browser's chrome, a window or the desktop. The player always has a visible viewing indicator, Pause and Stop controls. Account-code panels, password inputs and panels marked `data-private` pause and clear the view; snapshots taken across a privacy change are discarded.

The viewer fills the screen without dimming. Rendering preserves the source viewport up to 1920 pixels wide / 1440 high. The gameplay canvas and cursor update in the 30fps video; menu snapshots refresh on changes, with a slower refresh during gameplay to limit overhead. Actual frame rate and quality depend on the browser, source device and network. The renderer (`modern-screenshot` 4.7.0, MIT) loads when an admin view starts, from the game’s own assets. Its video cloning is adapted to snapshot the existing in-game video frame without loading or seeking a second player.

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

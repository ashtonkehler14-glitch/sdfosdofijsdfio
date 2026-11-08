# Admin game view

An authenticated owner or admin can choose **Request live game view…** from an online player's admin menu. The player must accept and choose the current game tab in their browser's sharing picker. The share shows menus, cursor interactions and gameplay as video; it provides no remote control and does not record video. Either side can stop it. Account-code panels automatically pause sharing.

Tab sharing requires desktop Chromium with the Capture Handle API and a secure origin (HTTPS or localhost). Browsers without these APIs decline the request. Only the current game tab is accepted; other tabs, windows and monitors are rejected. Regular gameplay spectating continues to work separately on supported mobile browsers.

Direct connections use Cloudflare's public STUN service. For reliable connections across restricted networks and symmetric NAT, configure a TURN relay using the `ADMIN_VIEW_ICE_SERVERS` Worker secret. Its value is an array of standard WebRTC ICE server objects, for example:

```json
[{"urls":["turns:relay.example.com:5349?transport=tcp"],"username":"relay-user","credential":"relay-password"}]
```

Set it through the Cloudflare dashboard or `npx wrangler secret put ADMIN_VIEW_ICE_SERVERS`. Use credentials dedicated to this game. The server sends this configuration only to the authenticated admin and player after the player accepts a specific session; it is absent from public presence lists and the built game file. Sessions expire after 30 minutes, and disconnects, going offline or losing the admin role end them.

Validation:

```sh
node --test tests/admin-game-view.test.mjs
MINIFLARE_DIR=/path/to/miniflare CHROMIUM_PATH=/usr/bin/chromium node tests/admin-game-view-e2e.mjs
```

The browser test uses Chromium's test-only automatic tab picker and real tab capture/WebRTC. Set `ADMIN_VIEW_ICE_SERVERS` for that command when the test browser requires a TCP/TLS relay.

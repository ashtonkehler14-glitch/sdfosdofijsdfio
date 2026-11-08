# Admin game view

**Admin Spectate** sits beside regular **Spectate** in online player profiles and menus. It opens a full-screen, undimmed game-tab video with high-resolution capture (1920×1080 preferred, up to 2560×1440), a resolution-preserving encoder and an 8 Mbps video budget. Actual quality depends on the source tab, browser and connection. It provides no remote control or recording.

Players enable **Admin viewing** from their own user menu, then choose the current game tab in the browser’s sharing picker. This one-time, tab-scoped permission lets authenticated owners/admins join directly for the rest of that online tab session, without another in-game request. Before joining, the admin chooses whether to send an extra notification. The player’s sharing indicator and pause/stop controls remain visible either way. Account-code panels automatically pause sharing.

Stopping the viewer leaves the player’s opt-in enabled; **Stop sharing**, disabling admin viewing, closing the tab or disconnecting revokes it. A player who has not enabled admin viewing cannot be viewed directly. Older clients can still receive an explicit approval request. Browser sharing permission cannot be bypassed.

Tab sharing requires desktop Chromium with the Capture Handle API and a secure origin (HTTPS or localhost). Browsers without these APIs decline the request. Only the current game tab is accepted; other tabs, windows and monitors are rejected. Regular gameplay spectating continues to work separately on supported mobile browsers.

Direct connections use Cloudflare's public STUN service. For reliable connections across restricted networks and symmetric NAT, configure a TURN relay using the `ADMIN_VIEW_ICE_SERVERS` Worker secret. Its value is an array of standard WebRTC ICE server objects, for example:

```json
[{"urls":["turns:relay.example.com:5349?transport=tcp"],"username":"relay-user","credential":"relay-password"}]
```

Set it through the Cloudflare dashboard or `npx wrangler secret put ADMIN_VIEW_ICE_SERVERS`. Use credentials dedicated to this game. The server sends this configuration only to the authenticated admin and player when a player-enabled session starts; it is absent from public presence lists and the built game file. Sessions expire after 30 minutes, and disconnects, going offline or losing the admin role end them.

Validation:

```sh
node --test tests/admin-game-view.test.mjs
MINIFLARE_DIR=/path/to/miniflare CHROMIUM_PATH=/usr/bin/chromium node tests/admin-game-view-e2e.mjs
```

The browser test uses Chromium's test-only automatic tab picker and real tab capture/WebRTC. Set `ADMIN_VIEW_ICE_SERVERS` for that command when the test browser requires a TCP/TLS relay.

# Admin panel

The panel at `/admin` follows the game's purple overlay palette, title bands, tab navigation and compact cards. It stays server-only and keeps its session, role checks, strict content policy and private audit log. Neru has a different pose in each section, reacts to taps and has a small keyboard easter egg outside text fields. Reduced-motion preferences are respected.

## Player sign-in codes

Open **Players → a player → Player sign-in code → Get sign-in code**. This issues a temporary code for the game's **Use a code** screen. Permanent player codes are one-way hashes and cannot be retrieved.

The temporary code works once, expires after 10 minutes and is only displayed in the issuing panel. **Copy code** copies it; **Revoke code** disables it. Generating another invalidates the previous temporary code. The player's permanent code and existing devices continue to work. The code is never stored in plaintext, browser storage or the audit log; issuance, revocation and use are logged without it.

Only authenticated admins can issue these codes, for ordinary, existing, unbanned accounts. They cannot issue codes for staff or the owner. Removing the issuing admin's role, changing the player's permanent code, banning/deleting the player or choosing **Sign out other devices** invalidates the code. Redemption is atomic to prevent simultaneous reuse. The receiving device stores its own device key, not the spent temporary code.

## Existing-score cleanup

A resumable Durable Object alarm audits stored rankings and beatmap boards, including offline players. It compares each legacy score's file SHA-256 with the actual downloadable difficulty, then checks its exact checksum against the explorer catalogue. IDs, song names and old `ok` flags are discovery hints, never proof. New submissions retain a server-made proof for the file.

Unlisted or modified difficulties lose their ranked scores, leaderboard entries, first places and bonus credit; player totals are recalculated. Profile reports use the same exact-file checks so removed scores cannot reappear through old profile data. Network/API failures pause the audit and retry later. Local play histories are unaffected. Confirmed, unchanged ranked/approved imports remain eligible, and can be submitted again from local history after confirmation.

The audit runs after deployment when the game server is first accessed. It has a persisted cursor and resumes across server restarts. No production cleanup runs in the test-only `TEST_ALL_RANKED` environment.

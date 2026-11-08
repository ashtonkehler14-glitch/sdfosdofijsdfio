# Working on this repository

- Keep ChatGPT work on the existing `chatgpt` branch; do not create a separate branch for each task.
- For every important player-facing update, add a concise entry to `CHANGELOG` in `src/js/17-screens-misc.js`. Put the newest entry first and use the player's local release date.
- Describe useful changes and fixes in plain language. Leave infrastructure, logging configuration, refactoring, tests, branch management, and other changes players will not notice out of the in-game update log. Do not present existing features as newly added.
- Keep admin tools and admin-related changes out of the in-game changelog, including future entries.
- Run `node build.mjs` after client changes and commit the generated HTML and service-worker updates.

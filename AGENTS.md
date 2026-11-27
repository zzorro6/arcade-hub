# Arcade Hub verification

- The hub is a static site. Check its JavaScript with `node --check main.js`.
- Pro Golf 3D lives in `games/golf-3d/`. Run `npm ci`, `npm test`, and `npm run build` there after editing its TypeScript, HTML, or CSS.
- The hub embeds `games/golf-3d/dist/index.html`. Keep this built file with source changes for static hosting. `build.mjs` inlines the IIFE JavaScript and CSS into one HTML file for local/IDE preview compatibility; the script must run after the body markup. Do not replace it with Vite's default external module output.
- Golf is adapted from https://github.com/jackiedeng0/browser-golf-game at revision `92a3954b277b15f4583449e85cb5a48d35b280c7`. Preserve its MIT license and upstream attribution.
- Golf round seeds are versioned in `src/round.ts`; matched players must use the same seed, generator version, hole order, and rules. Proximity points are calculated once per hole, not accumulated per shot.
- The old `games/pro-golf/` implementation remains as a fallback, but is no longer linked from the hub.
- Do not include the unrelated `_remove*.ps1` helper files in commits. The user prefers phone testing and does not want screenshots taken unless requested.

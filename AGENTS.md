<!-- CLAUDE.md next to this file is one line: @AGENTS.md — so both tools read the same notes. -->

# Void Relics

A browser space-flight exploration game built on three.js. The player flies a small ship
through a procedurally generated star system (star, six planets, an asteroid belt and fields,
coloured nebulae, derelict wrecks) looking for 20 alien relics. Everything — the world, the
textures, the music and sound — is generated at runtime from one seed; the game ships no
image or audio files. It is a static site: Vite builds it, GitHub Pages serves it.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
npm run preview      # serve dist/ locally
```

URL parameters: `?seed=<integer>` picks the galaxy (default 1337), `?debug=1` exposes
`window.__vr` (teleport, press keys, aim, open the map) for poking the game from the console.

## Verify

```bash
npm run verify   # tsc --noEmit + node --test "src/**/*.test.ts" — green before every commit
```

## Layout

- `src/core/` — seeded RNG and CPU noise.
- `src/world/` — the system as plain data: `generate.ts` (planets, belt, clusters, nebulae,
  wrecks, the 20 relics, spawn), `regions.ts` (where the ship is, nebula density, scan range),
  `names.ts` (generated names).
- `src/game/` — rules without rendering: `flight.ts` (arcade flight model), `hazards.ts` (star
  heat, collisions, hull), `progress.ts` (relics found, saves), `settings.ts`, `aim.ts`,
  `spatialHash.ts`; `game.ts` wires it all to the scene, HUD and audio and runs the loop.
- `src/render/` — three.js builders: sky, sun, planets, asteroids, nebula smoke, wrecks,
  relics, the player ship (`ship.ts`, skinned by `plating.ts`), speed dust. Shared GLSL in
  `glsl.ts`.
- `src/audio/` — `engine.ts` synthesises music and effects with Web Audio; `theory.ts` holds
  the scales and chord progressions; `rocket.ts` is the engine's pure maths (noise colours,
  crackle, the throttle → mix curve, ignition events) and `rocketVoice.ts` its Web Audio graph,
  which also runs in an `OfflineAudioContext` to render a listening demo.
- `src/ui/` — HUD, system map, menus. `src/text.ts` — every user-facing string.
- `.github/workflows/` — `ci.yml` runs verify on every PR; `deploy.yml` publishes to Pages.

## Things that will bite you

- **Every custom shader needs the log-depth chunks.** The renderer uses
  `logarithmicDepthBuffer` (the scene spans 0.5 m to 400 km). A `ShaderMaterial` without
  `VERT_HEAD/VERT_TAIL/FRAG_HEAD/FRAG_TAIL` from `src/render/glsl.ts` depth-sorts wrongly
  against everything else.
- **Tests run TypeScript straight on Node** (type stripping). Imports carry the `.ts`
  extension, type-only imports must be `import type`, and `erasableSyntaxOnly` forbids enums
  and constructor parameter properties.
- **Changing `generate.ts` moves every galaxy.** Saves are keyed by seed and store relic ids;
  if the relic layout changes, bump the `v1` in `storageKey()` so old saves are not applied to
  new positions.
- **A hidden or minimised window can report 0×0.** `onResize()` skips it, and `aimOf()`,
  `stepFlight()` and `stepExposure()` treat non-finite values as neutral: one NaN in the flight
  state or the exposure used to stick forever (frozen ship, black screen). Keep new per-frame
  state just as defensive.
- **Pointer lock is optional.** Inside iframes or some embedded browsers it is refused; the game
  then steers by the real cursor position. Esc while locked releases the lock and pauses.
- **Audio starts only after a click** (browser autoplay rules): the `AudioEngine` is created in
  `launch()`.
- **GitHub Pages needs a public repository** on the FilioInk free plan; `deploy.yml` skips
  itself while the repository is private.
- **The game is English-only, by the owner's decision** — UI, README, everything. Do not add
  translations or a language picker; new strings go into `src/text.ts` in English.
- The only network request at runtime is the Exo 2 font from Google Fonts; the game falls back
  to system fonts without it.

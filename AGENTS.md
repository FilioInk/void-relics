<!-- CLAUDE.md next to this file is one line: @AGENTS.md — so both tools read the same notes. -->

# Void Relics

A browser space-flight exploration game built on three.js. The player flies a small ship
through a procedurally generated star system (star, six planets, an asteroid belt and fields,
coloured nebulae, derelict wrecks) looking for 20 alien relics. Everything — the world, the
textures, the music and sound — is generated at runtime from one seed; the game ships no
image or audio files except the app icons, which `scripts/icons.mjs` draws. It is a static
site: Vite builds it, GitHub Pages serves it, and it installs as an app (a PWA).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
npm run preview      # serve dist/ locally — the service worker and installing only work here
node scripts/icons.mjs   # redraw public/icons/ after changing the mark
```

URL parameters: `?seed=<integer>` picks the galaxy (default 1337), `?debug=1` exposes
`window.__vr` (teleport, press keys, aim, fire, open the map, `touch(true)` to force the touch
controls on in a desktop window) for poking the game from the console.
`?perf=1` shows a corner readout: FPS, frame / CPU / GPU ms (average and p95 over the last 240
frames), draw calls, triangles and shader programs from `renderer.info`.

### Measuring performance

Use both: `?debug=1&perf=1`. Four fixed benchmark spots exist for every seed
(`src/game/benchSpots.ts`): `__vr.spot('spawn' | 'nebula' | 'belt' | 'star')` flies there and
stops.

- **Compare with `__vr.benchSync(frames)`**, not the overlay's FPS. It renders frames back to
  back and waits for each with a one-pixel read, so it returns the real cost of a frame (CPU and
  GPU together) at full GPU clock. The overlay's FPS sits at the display's refresh rate whenever
  the GPU keeps up, its GPU ms reads high while the GPU idles between vsyncs at low clocks, and a
  hidden or background tab (the desktop app's browser pane when it is not shown) gets 1 frame a
  second. GPU ms is `null` inside `benchSync` (WebGL withholds timer results until the task ends)
  and where the browser hides `EXT_disjoint_timer_query_webgl2`.
- **Other sessions and apps share the GPU.** Take the minimum over several short rounds, and
  compare two builds by alternating between them (two dev servers, one tab) rather than
  measuring one now and one later.
- `__vr.still(t)` pins the clock (no animation, exposure snapped) and `__vr.capture()` resolves
  to a PNG data URL of the next frame: two captures of the same spot and `t` are pixel-identical,
  so a rendering change can be diffed exactly. `__vr.renderer` and `__vr.composer` are there for
  toggling passes from the console; `__vr.perf()` / `__vr.perfReset()` read the overlay's window.

## Verify

```bash
npm run verify   # tsc --noEmit + node --test "src/**/*.test.ts" — green before every commit
```

## Layout

- `src/core/` — seeded RNG and CPU noise.
- `src/infinite/` — infinite flight: `director.ts` (the endless path and what each 6 km segment
  holds, pure and tested), `stream.ts` (builds a segment with the regular `src/render/`
  builders, a few things per frame, and frees it behind the ship), `flight.ts` (autopilot,
  cameras, origin shifts, autopilot guns, place-name captions, the music and full-screen
  buttons). `src/ui/fullscreen.ts` wraps the Fullscreen API with the Safari fallback;
  `src/ui/wakeLock.ts` keeps the screen on while the game is full screen or the installed app.
- `src/world/` — the system as plain data: `generate.ts` (planets, belt, clusters, nebulae,
  wrecks, the 20 relics, spawn, then stations, satellite graveyards and the junk ring;
  `generateJunk()` lists the loose junk pieces), `regions.ts` (where the ship is, nebula density, scan range),
  `names.ts` (generated names), `stars.ts` (star classes from reference tables: the class,
  temperature, radius and luminosity of each infinite-flight star, its colour from a black body,
  and how it is drawn — size, palette, brightness, corona, the light it casts).
- `src/game/` — rules without rendering: `flight.ts` (arcade flight model), `hazards.ts` (star
  heat, collisions, hull), `progress.ts` (relics found, salvage, broken targets, saves),
  `weapons.ts` (rate of fire, heat; the muzzles come from `ship.ts`), `targets.ts` (what bolts hit, how many hits
  things take, deterministic loot, sealed relics), `settings.ts`, `aim.ts`, `spatialHash.ts`;
  `game.ts` wires it all to the scene, HUD and audio and runs the loop.
- `src/render/` — three.js builders: sky, sun, planets, asteroids, nebula smoke, wrecks,
  orbital debris (`debris.ts`: stations, instanced satellites, junk, distance glints), relics,
  the player ship (`ship.ts`, skinned by `plating.ts`), speed dust, laser effects (`combat.ts`:
  bolts, sparks, fragments, salvage, relic shells — all pooled). Shared GLSL in `glsl.ts`.
- `src/audio/` — `engine.ts` synthesises music and effects with Web Audio; `theory.ts` holds
  the scales and chord progressions; `rocket.ts` is the engine's pure maths (noise colours,
  crackle, the throttle → mix curve, ignition events) and `rocketVoice.ts` its Web Audio graph,
  which also runs in an `OfflineAudioContext` to render a listening demo.
- `src/ui/` — HUD, system map, menus, touch controls (`touchControls.ts`: the stick and buttons;
  their maths, finger tracking and the thrust latch are pure, in `src/game/touch.ts`),
  `install.ts` (the menu's Install app: the browser's install event, the steps per browser,
  the service worker's registration). `src/text.ts` — every user-facing string.
- `public/` — copied into `dist/` as is: `manifest.webmanifest`, `sw.js` (the service worker),
  `icons/` (drawn by `scripts/icons.mjs`).
- `.github/workflows/` — `ci.yml` runs verify on every PR; `deploy.yml` publishes to Pages.

## Things that will bite you

- **Every custom shader needs the log-depth chunks.** The scene spans 0.5 m to 400 km. Where
  the browser has `EXT_clip_control` the renderer uses reversed Z into a 32-bit float depth
  target (the chunks then compile to nothing); elsewhere it falls back to
  `logarithmicDepthBuffer`, and a `ShaderMaterial` without `VERT_HEAD/VERT_TAIL/FRAG_HEAD/
  FRAG_TAIL` from `src/render/glsl.ts` depth-sorts wrongly against everything else there.
- **Nothing may sit exactly on a clip plane.** Under reversed depth `z = w` is the *near*
  plane, and three's sky-box shader puts the box right there (`gl_Position.z = gl_Position.w`,
  meant as "at the far plane"). A Mali-G615 in Chrome for Android clipped it into black
  stair-steps and triangles that moved with the view. `createSky()` patches the shader
  (`backgroundVertexFix()` in `src/render/glsl.ts`); a new shader that forces its own depth
  must land strictly inside the clip volume too. Desktop GPUs never show this, so a rendering
  change is worth a look on a phone: `npx vite --host --port <port>` and the Mac's LAN address
  in the phone's Chrome, on the same Wi-Fi.
- **Bloom is split across two passes.** `BloomPass` (`src/render/post.ts`) only builds the
  glow; `BloomOutputPass` adds it during tone mapping. Something inserted between them sees the
  scene without bloom; a pass after the output would need the glow added differently.
- **The fog never leaves the scene.** Outside a nebula its density is 0. Setting `scene.fog`
  to `null` (or a new fog object) recompiles every fog-aware material: a visible hitch.
- **Infinite flight never feeds the GPU big numbers.** It simulates in absolute coordinates
  but draws relative to an origin that jumps to the ship every 40 km; every object is built
  around its own centre and moved, and world-space uniforms (`uSun`, `uCenter`) move with it.
  A new shader that reads world positions must go through `modelMatrix`/`modelViewMatrix`
  (the nebula once used `viewMatrix` directly and could not be moved), and a builder that
  bakes world positions into uniforms has to register them in the chunk's `vectors`.
- **A star's numbers come from references; its look is tuned.** `src/world/stars.ts` keeps
  the physical values (Mamajek's table, Levesque's scale, the published ranges) apart from
  `starLook()`, which squeezes radii (R^0.4), deepens the pale black-body colours and caps the
  surface brightness so the tone mapping does not turn every hot star white. Change the look
  there, not the tables. Every star, the relic hunt's included, is drawn from its `Star`.
- **The relic hunt's star is limited by its planets.** `sampleSystemStar()` draws only stars
  whose warning zone (2.6 radii) keeps the innermost planet (~11 km) outside it: M, K, G, F,
  cooler A dwarfs and white dwarfs, at most `SYSTEM_STAR_MAX_M`. A giant would swallow the
  system; letting one in means moving the planets out too.
- **One light per star would recompile everything.** Three.js rebuilds every material's
  shader when the number of lights changes, so infinite flight drops each star's PointLight
  and moves a single DirectionalLight instead.
- **Tests run TypeScript straight on Node** (type stripping). Imports carry the `.ts`
  extension, type-only imports must be `import type`, and `erasableSyntaxOnly` forbids enums
  and constructor parameter properties.
- **Changing `generate.ts` moves every galaxy.** Saves are keyed by seed and store relic ids;
  if the relic layout changes, bump the `v1` in `storageKey()` so old saves are not applied to
  new positions. (The star's class did not bump it: it moves only the dare relic, along its
  own direction, and in a few seeds with big stars a nebula, wreck or station kept out of the
  larger warning zone; every relic id still means the same relic.) To add content without moving anything, draw it from a new `root.fork(...)`
  and place it after the relics, as the debris does; `generate.test.ts` compares the layout with
  `src/world/fixtures/before-debris.json` and fails if it shifts. Compare floats with a
  tolerance, never by exact hash: `Math.sin` and friends differ in the last bit between a Mac
  and the Linux CI.
- **A hidden or minimised window can report 0×0.** `onResize()` skips it, and `aimOf()`,
  `stepFlight()` and `stepExposure()` treat non-finite values as neutral: one NaN in the flight
  state or the exposure used to stick forever (frozen ship, black screen). Keep new per-frame
  state just as defensive.
- **Targets are identified by index.** A broken rock is saved as `rock:<index into
  generateAsteroids()>`, a satellite or junk piece by its index in the debris lists, a shell by
  its relic's index. Anything that reorders those lists breaks old saves' `broken` field.
- **Touch controls are for touch-first devices only** (`(pointer: coarse)`, which sets
  `body.touch`). There the stick owns the steering cursor and the game ignores mouse events,
  because browsers make up mouse events from taps (a tap on THRUST would fire a shot and yank
  the nose to the tapped spot). The browser pane emulates touch only under 768 px wide; for a
  landscape check use `__vr.touch(true)`.
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
- **The service worker runs in the built game only** (`import.meta.env.PROD`), so `npm run dev`
  never caches anything. To check installing or offline play, `npm run build && npm run
  preview`; afterwards unregister it in the browser (it keeps serving `localhost:<port>`, and
  its hashed files come from its cache). It fetches the page network first, so a deploy is live
  on the next visit online; `assets/` are cache first, and it drops the hashed files the page no
  longer names. It reads the asset names out of `index.html`, so a lazily loaded chunk would be
  fetched online but not kept for offline play until it is listed there too.
- **Paths are relative** (`base: './'`): the manifest, icons and service worker sit next to
  `index.html`, and the worker's scope is wherever the page is served from (`/void-relics/` on
  Pages).
- **The desktop app's browser pane** never fires `beforeinstallprompt` and denies the Wake Lock
  API, so it shows the install steps card and never holds the lock. Real Chrome does both.

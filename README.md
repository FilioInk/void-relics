# Void Relics

A browser space-flight game on three.js: free mouse-steered (or, on a phone, thumb-steered)
flight through a procedurally generated star system, hunting for twenty alien relics. The
world, its textures, the music and the sound are all generated at runtime from a single seed —
the build contains no images and no audio files.

![Nebula and relic](docs/screenshots/nebula-relic.jpg)

| | |
|---|---|
| ![The star](docs/screenshots/star.jpg) | ![System map](docs/screenshots/map.jpg) |
| ![Flight](docs/screenshots/flight.jpg) | ![Menu](docs/screenshots/menu.jpg) |

## What is out there

- **A star** with a boiling surface and a corona. You can fly close, but inside ~1.9 radii the
  hull starts to heat up, and at the surface it burns through in seconds. The heat zone is
  marked on the map.
- **Six planets**: lava, desert or rocky, an Earth-like world with clouds and city lights, gas
  giants (often ringed), ice worlds.
- **An asteroid belt** and four **asteroid fields** — thousands of solid rocks of different
  shapes.
- **Four nebulae** — coloured smoke that cuts visibility, halves the scanner range and now and
  then flashes with lightning.
- **Derelict wrecks** — torn hulls with flickering windows, sparks and a cloud of debris.
- **Station ruins** — a broken truss station with modules and solar wings, or a torn habitat
  wheel, drifting apart in slow tumbles; some portholes and beacons still have power.
- **Satellite graveyards** — clusters of dead satellites (gold foil, solar wings, dishes)
  tumbling among loose panels, and a **debris ring** of junk around the Earth-like world that
  glints from orbit.
- **20 relics**: in the fields, in the belt, inside nebulae, by the wrecks, in planetary orbits,
  in deep space, and one dangerously close to the star.

## How to play

| Key | Action |
|---|---|
| Mouse | Steer: the nose follows the cursor; the further from the centre, the sharper the turn |
| W | Thrust. Let go and the ship stops |
| S | Brake / reverse |
| Space | Boost |
| Left mouse / F | Fire lasers |
| A / D | Strafe |
| Q / E | Roll |
| M (or Tab) | System map |
| Esc | Pause |

**On a phone or tablet** the game shows touch controls instead. Drag anywhere on the left half
of the screen to steer: a stick appears under the thumb. On the right, around the thumb, are
**Thrust** (hold it, or tap it once to keep flying and tap again to stop), **Brake**, **Boost**
and **Fire**; the system map and pause are in the top-right corner. Steering, thrust and fire
work at the same time. Portrait and landscape both work. In infinite flight, a tap brings up
the camera, full-screen and back buttons.

A relic shows from far away as a faint pulsing point of light, and the scanner picks up its
signal within ~6.5 km (half that inside a nebula). On the map, every missing relic is drawn as a
circle it lies somewhere inside. Progress is saved in the browser.

**Lasers.** Twin wing guns fire red bolts at eight shots a second; hold too long and they
overheat and lock until they cool. The red cross ahead of the nose is where both barrels meet.
Smaller rocks (up to ~140 m), satellites and loose junk break apart under fire — the
mountains and station hulls do not. Some of them hold **salvage** (void crystals, data cores)
that drifts out and flies to the ship. The relics in asteroid fields and by the wrecks are
**sealed in rock**: the scanner finds them, but you have to shoot the shell open first. What
you break stays broken.

`?seed=12345` in the URL gives a different galaxy; the **New galaxy** button does the same with a
random number. `?perf=1` shows frame rate, frame / CPU / GPU time and draw-call counts in the
corner.

## Infinite flight

**Infinite flight** in the menu is a screensaver of a mode: the ship flies itself down an endless
path while asteroid fields, nebulae, planets (some ringed, some with a moon), stars, station
ruins and satellite graveyards are generated ahead of it and dropped behind. The autopilot
slows through fields and ruins, opens up across empty space, and in fields picks off a rock now
and then. The camera cuts between a chase view, a slow orbit, fly-bys, a wide shot and the
cockpit. The only things on screen are the name of each new place as it fades in and a small
button in the bottom-right corner (or **F**) that goes full screen; the button and the cursor
fade out while the mouse rests. **C** changes the camera, **H** hides the place names, **Esc**
goes back to the menu; on a touch screen, buttons do the camera and the way back. The journey
is fixed by the galaxy seed.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run verify   # typecheck + tests
npm run build    # static site in dist/
```

Needs Node 24 (`.nvmrc`) and a browser with WebGL 2.

## Publishing to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes the site on every push to `main`. On the
free GitHub plan, Pages only serves public repositories, so while this repository is private the
deploy is skipped. To switch it on: make the repository public and set Settings → Pages →
Source to **GitHub Actions**.

## How it works

- `src/world/generate.ts` — the whole system as data from the seed: orbits, belt, fields,
  nebulae, wrecks, relics, spawn point, stations, satellite graveyards and the junk ring.
  Covered by tests (determinism, exactly 20 relics, none inside a planet or a rock, debris
  clear of everything, old galaxies unchanged by new content, and so on).
- `src/game/flight.ts` — the arcade flight model: thrust → cruise speed, no thrust → stop,
  boost, turning toward the cursor.
- `src/render/` — shaders for the planets, the star and the sky; nebula smoke from a baked
  noise texture; asteroids from displaced icospheres; procedural wrecks, stations, satellites
  and junk; the player ship in plating painted at start-up (`plating.ts`: panel seams, rivets,
  wear, a normal map from the same layout), with a framed canopy, wing cannons and belled
  nozzles.
- `src/audio/engine.ts` — generative ambient on Web Audio: slow chords in drifting modes, FM
  bells with echo, a drone, cosmic wind, a tension layer near the star; plus impact, scanner
  ping, pickup and explosion sounds. Music plays at 90% by default (Music volume under Settings in the menu).
- `src/audio/rocketVoice.ts` — the rocket engine: no tone, only noise — a brown-noise rumble,
  a pink-noise roar, exhaust crackle, combustion flutter and soft saturation, plus a whump on
  ignition and boost and a chuff on cut-off.

Development notes are in [AGENTS.md](AGENTS.md).
